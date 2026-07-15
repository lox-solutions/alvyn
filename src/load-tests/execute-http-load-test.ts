import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { EventStore } from "../event-store";
import { createReport, writeReport } from "./http-report";
import { runHttpRequests } from "./run-http-requests";
import {
  seedAccountSnapshots,
  seedAccounts,
  type SeedSummary,
} from "./http-seeding";
import { createHttpWorker, terminateWorkers } from "./http-worker-process";
import { runSnapshotBenchmark } from "./run-snapshot-benchmark";
import { verifyAccounts } from "./verify-accounts";
import type {
  HttpLoadTestConfig,
  HttpLoadTestReport,
  HttpReplicaReport,
} from "./http-types";
import { createHttpRunContext, type HttpRunContext } from "./http-run-context";

const { Pool } = pg;

async function setupHttpDatabase(context: HttpRunContext): Promise<void> {
  const { config, progress } = context;
  progress.update("starting PostgreSQL container");
  const setupStartedAt = performance.now();
  try {
    context.container = await new PostgreSqlContainer(
      "postgres:16-alpine",
    ).start();
    const pool = new Pool({
      connectionString: context.container.getConnectionUri(),
      max: config.poolSize,
      connectionTimeoutMillis: config.operationTimeoutMs,
      statement_timeout: config.operationTimeoutMs,
    });
    context.coordinatorPool = pool;
    context.eventStore = new EventStore({ pool, schema: context.schema });
    progress.update("creating schema");
    await context.eventStore.setup();
    const versionResult = await pool.query<{ server_version: string }>(
      "SHOW server_version",
    );
    context.environment = {
      ...context.environment,
      postgresqlVersion: versionResult.rows[0]?.server_version ?? null,
    };
  } finally {
    context.phaseDurations.setupMs = performance.now() - setupStartedAt;
  }
}

async function seedHttpData(context: HttpRunContext): Promise<SeedSummary> {
  const { config, progress } = context;
  const seedStartedAt = performance.now();
  try {
    const seedSummary = await seedAccounts({
      eventStore: context.eventStore!,
      config,
      progress,
    });
    await seedAccountSnapshots({
      eventStore: context.eventStore!,
      config,
      seedSummary,
      progress,
    });
    return seedSummary;
  } finally {
    context.phaseDurations.seedingMs = performance.now() - seedStartedAt;
  }
}

async function startHttpWorkers(context: HttpRunContext): Promise<void> {
  const { config, progress } = context;
  const workerStartedAt = performance.now();
  try {
    progress.update(`starting ${config.workerCount} HTTP workers`);
    for (let workerId = 0; workerId < config.workerCount; workerId++) {
      context.workers.push(
        createHttpWorker({
          workerId,
          connectionString: context.container!.getConnectionUri(),
          schema: context.schema,
          config,
        }),
      );
    }
    context.ports = await Promise.all(
      context.workers.map((worker) => worker.ready),
    );
  } finally {
    context.phaseDurations.workerStartupMs =
      performance.now() - workerStartedAt;
  }
}

async function prepareHttpRun(context: HttpRunContext): Promise<SeedSummary> {
  await setupHttpDatabase(context);
  const seedSummary = await seedHttpData(context);
  await startHttpWorkers(context);
  return seedSummary;
}

async function executeHttpWorkload(
  context: HttpRunContext,
  seedSummary: SeedSummary,
): Promise<void> {
  const { config, progress } = context;
  const snapshotStartedAt = performance.now();
  try {
    progress.update("benchmarking aggregate reads with and without snapshots");
    context.snapshotBenchmark = await runSnapshotBenchmark({
      config,
      ports: context.ports,
      progress,
    });
  } finally {
    context.phaseDurations.snapshotBenchmarkMs =
      performance.now() - snapshotStartedAt;
  }
  const requests = await runHttpRequests({
    config,
    ports: context.ports,
    progress,
  });
  context.metrics = requests.metrics;
  context.trafficPhases = requests.trafficPhases;
  context.replicaRequestAttempts = requests.replicaRequestAttempts;
  context.phaseDurations.httpRequestsMs = requests.durationMs;
  if (requests.metrics.request.failed > 0) {
    throw new Error(`${requests.metrics.request.failed} HTTP requests failed`);
  }
  if (context.workers.some((worker) => !worker.isAlive())) {
    throw new Error("An HTTP worker exited during the request phase");
  }
  const verificationStartedAt = performance.now();
  try {
    progress.update("verifying aggregate state");
    context.verification = await verifyAccounts({
      eventStore: context.eventStore!,
      config,
      seedSummary,
      successfulDeposits: requests.successfulDeposits,
      progress,
    });
  } finally {
    context.phaseDurations.verificationMs =
      performance.now() - verificationStartedAt;
  }
}

function createContextReport(
  context: HttpRunContext,
  failure?: string,
): HttpLoadTestReport {
  const workers: HttpReplicaReport[] = context.ports.map((port, workerId) => ({
    workerId,
    port,
    requestAttempts: context.replicaRequestAttempts[workerId] ?? 0,
  }));
  return createReport({
    config: context.config,
    schema: context.schema,
    startedAt: context.startedAt,
    phaseDurations: context.phaseDurations,
    metrics: context.metrics,
    snapshotBenchmark: context.snapshotBenchmark,
    verification: context.verification,
    workers,
    trafficPhases: context.trafficPhases,
    failure,
    environment: context.environment,
  });
}

async function cleanupHttpRun(context: HttpRunContext): Promise<void> {
  context.progress.finish();
  await terminateWorkers(context.workers);
  if (context.coordinatorPool) await context.coordinatorPool.end();
  if (context.container) await context.container.stop();
}

export async function executeHttpLoadTest(
  config: HttpLoadTestConfig,
  runSignal: AbortSignal,
): Promise<HttpLoadTestReport> {
  const context = createHttpRunContext(config);
  const abortRun = (): void => {
    void terminateWorkers(context.workers);
    void context.coordinatorPool?.end().catch(() => undefined);
    void context.container?.stop().catch(() => undefined);
  };
  runSignal.addEventListener("abort", abortRun, { once: true });
  try {
    const seedSummary = await prepareHttpRun(context);
    await executeHttpWorkload(context, seedSummary);
    const report = createContextReport(context);
    await writeReport(config, report);
    context.reportWritten = true;
    return report;
  } catch (error) {
    if (!context.reportWritten) {
      await writeReport(config, createContextReport(context, String(error)));
    }
    throw error;
  } finally {
    runSignal.removeEventListener("abort", abortRun);
    await cleanupHttpRun(context);
  }
}
