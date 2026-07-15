import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { EventStore } from "../event-store";
import { parseLoadTestConfig } from "./config";
import { ProgressRenderer } from "./progress";
import {
  createLoadTestEnvironment,
  type LoadTestEnvironment,
} from "./provenance";
import { createReport, writeReport } from "./report";
import {
  seedLoadHistory,
  updateWorkerProgress,
  verifyLoadRun,
} from "./run-phases";
import {
  createWorker,
  terminateWorkers,
  type WorkerHandle,
} from "./worker-process";
import type {
  LoadTestConfig,
  LoadTestReport,
  SerializedError,
  WorkerMetrics,
} from "./types";
import { withTimeout } from "./timeout";

const { Pool } = pg;
const SCHEMA_RANDOM_BYTES = 8;

function uniqueSchema(): string {
  return `load_${randomBytes(SCHEMA_RANDOM_BYTES).toString("hex")}`;
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: "UnknownError", message: String(error) };
}

async function runWorkers({
  config,
  connectionString,
  schema,
  workers,
  onStatus,
  onProgress,
}: {
  config: LoadTestConfig;
  connectionString: string;
  schema: string;
  workers: WorkerHandle[];
  onStatus?: (message: string) => void;
  onProgress?: (metrics: WorkerMetrics[]) => void;
}): Promise<LoadTestReport["workers"]> {
  const latestMetrics = new Map<number, WorkerMetrics>();
  for (let workerId = 0; workerId < config.workerCount; workerId++) {
    onStatus?.(`starting workers: ${workers.length}/${config.workerCount}`);
    workers.push(
      createWorker({
        workerId,
        connectionString,
        schema,
        config,
        onProgress: (metrics) => {
          latestMetrics.set(metrics.workerId, metrics);
          onProgress?.([...latestMetrics.values()]);
        },
      }),
    );
  }
  await withTimeout(
    Promise.all(workers.map((worker) => worker.ready)),
    config.workerReadyTimeoutMs,
    "load-test worker readiness",
  );
  onStatus?.(`workers ready: ${config.workerCount}/${config.workerCount}`);
  await Promise.all(workers.map((worker) => worker.send({ type: "start" })));
  onStatus?.("live operations: 0");
  return Promise.all(workers.map((worker) => worker.completed));
}

async function executeLoadRun({
  config,
  connectionString,
  schema,
  eventStore,
  workers,
  startedAt,
  progress,
  environment,
}: {
  config: LoadTestConfig;
  connectionString: string;
  schema: string;
  eventStore: EventStore;
  workers: WorkerHandle[];
  startedAt: number;
  progress: ProgressRenderer;
  environment: LoadTestEnvironment;
}): Promise<LoadTestReport> {
  progress.update("creating schema");
  await eventStore.setup();
  const seedSummary = await seedLoadHistory({ eventStore, config, progress });
  progress.update(`starting ${config.workerCount} workers`);
  const workerMetrics = await runWorkers({
    config,
    connectionString,
    schema,
    workers,
    onStatus: (message) => progress.update(message),
    onProgress: (metrics) =>
      updateWorkerProgress({ config, metrics, progress }),
  });
  const verification = await verifyLoadRun({
    eventStore,
    config,
    streamIds: seedSummary.streamIds,
    seedEventCount: seedSummary.eventCount,
    workers: workerMetrics,
    progress,
  });
  const report = createReport({
    config,
    schema,
    workerMetrics,
    startedAt,
    verification,
    environment,
  });
  await writeReport(config, report);
  return report;
}

export async function runLoadTest(
  config: LoadTestConfig,
  runSignal?: AbortSignal,
): Promise<LoadTestReport> {
  if (runSignal === undefined) {
    const controller = new AbortController();
    return withTimeout(
      runLoadTest(config, controller.signal),
      config.runTimeoutMs,
      "load-test run",
      () => controller.abort(),
    );
  }
  let container: StartedPostgreSqlContainer | null = null;
  let coordinatorPool: pg.Pool | null = null;
  const workers: WorkerHandle[] = [];
  const schema = uniqueSchema();
  const startedAt = performance.now();
  const progress = new ProgressRenderer(config.verbose);
  const abortRun = (): void => {
    void terminateWorkers(workers);
    void coordinatorPool?.end().catch(() => undefined);
    void container?.stop().catch(() => undefined);
  };
  runSignal.addEventListener("abort", abortRun, { once: true });

  try {
    progress.update("starting PostgreSQL container");
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const connectionString = container.getConnectionUri();
    coordinatorPool = new Pool({
      connectionString,
      max: config.poolSize,
      connectionTimeoutMillis: config.operationTimeoutMs,
      statement_timeout: config.operationTimeoutMs,
    });
    const eventStore = new EventStore({
      pool: coordinatorPool,
      schema,
    });
    const versionResult = await coordinatorPool.query<{
      server_version: string;
    }>("SHOW server_version");
    const environment = createLoadTestEnvironment(
      versionResult.rows[0]?.server_version ?? null,
    );
    return await executeLoadRun({
      config,
      connectionString,
      schema,
      eventStore,
      workers,
      startedAt,
      progress,
      environment,
    });
  } finally {
    runSignal.removeEventListener("abort", abortRun);
    progress.finish();
    await terminateWorkers(workers);
    await Promise.allSettled(workers.map((worker) => worker.ready));
    await Promise.allSettled(workers.map((worker) => worker.completed));
    try {
      if (coordinatorPool) await coordinatorPool.end();
    } finally {
      if (container) await container.stop();
    }
  }
}

function formatReport(report: LoadTestReport): string {
  const workerCount = report.workers.length;
  return [
    "Alvyn load test",
    `workers: ${workerCount}`,
    `connections: ${report.connectionCount}`,
    `duration: ${Math.round(report.durationMs)} ms`,
    `append operations: ${report.append.succeeded}/${report.append.attempted} (${report.append.eventCount} events)`,
    `load operations: ${report.load.succeeded}/${report.load.attempted} (${report.load.eventCount} events)`,
    `OCC conflicts/retries: ${report.append.conflicts}/${report.append.retries}`,
    `throughput: ${report.throughput.operationsPerSecond.toFixed(2)} operations/s`,
    `latency p50/p95/p99: ${report.overallLatency.p50 ?? "n/a"}/${report.overallLatency.p95 ?? "n/a"}/${report.overallLatency.p99 ?? "n/a"} ms`,
    `verified streams/events: ${report.verification.streamCount}/${report.verification.eventCount}`,
  ].join("\n");
}

export async function main(): Promise<void> {
  const config = parseLoadTestConfig();
  const report = await runLoadTest(config);
  console.log(formatReport(report));
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  await main().catch((error: unknown) => {
    console.error(serializeError(error));
    process.exitCode = 1;
  });
}
