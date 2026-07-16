import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { EventStore } from "../src/event-store";
import { parseLoadTestConfig } from "./parse-load-test-config";
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
import type { LoadTestConfig, LoadTestReport, WorkerMetrics } from "./types";
import { withTimeout } from "./timeout";
import { formatLoadTestReport } from "./format-load-test-report";
import { cleanupLoadRun } from "./cleanup-load-run";
import { serializeError } from "./serialize-error";

const { Pool } = pg;
const SCHEMA_RANDOM_BYTES = 8;

function uniqueSchema(): string {
  return `load_${randomBytes(SCHEMA_RANDOM_BYTES).toString("hex")}`;
}

async function startLoadDatabase(config: LoadTestConfig): Promise<{
  container: StartedPostgreSqlContainer;
  coordinatorPool: pg.Pool;
}> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const coordinatorPool = new Pool({
    connectionString: container.getConnectionUri(),
    max: config.poolSize,
    connectionTimeoutMillis: config.operationTimeoutMs,
    statement_timeout: config.operationTimeoutMs,
  });
  return { container, coordinatorPool };
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
  await withTimeout({
    operation: Promise.all(workers.map((worker) => worker.ready)),
    timeoutMs: config.workerReadyTimeoutMs,
    label: "load-test worker readiness",
  });
  onStatus?.(`workers ready: ${config.workerCount}/${config.workerCount}`);
  await Promise.all(workers.map((worker) => worker.send({ type: "start" })));
  onStatus?.("live operations: 0");
  return Promise.all(workers.map((worker) => worker.completed));
}

interface ExecuteLoadRunOptions {
  config: LoadTestConfig;
  connectionString: string;
  schema: string;
  eventStore: EventStore;
  workers: WorkerHandle[];
  startedAt: number;
  progress: ProgressRenderer;
  environment: LoadTestEnvironment;
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
}: ExecuteLoadRunOptions): Promise<LoadTestReport> {
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

async function startLoadRun({
  config,
  container,
  coordinatorPool,
  schema,
  workers,
  startedAt,
  progress,
}: {
  config: LoadTestConfig;
  container: StartedPostgreSqlContainer;
  coordinatorPool: pg.Pool;
  schema: string;
  workers: WorkerHandle[];
  startedAt: number;
  progress: ProgressRenderer;
}): Promise<LoadTestReport> {
  const connectionString = container.getConnectionUri();
  const eventStore = new EventStore({ pool: coordinatorPool, schema });
  const versionResult = await coordinatorPool.query<{
    server_version: string;
  }>("SHOW server_version");
  const environment = createLoadTestEnvironment(
    versionResult.rows[0]?.server_version ?? null,
  );
  return executeLoadRun({
    config,
    connectionString,
    schema,
    eventStore,
    workers,
    startedAt,
    progress,
    environment,
  });
}

export async function runLoadTest(
  config: LoadTestConfig,
  runSignal?: AbortSignal,
): Promise<LoadTestReport> {
  if (runSignal === undefined) {
    const controller = new AbortController();
    return withTimeout({
      operation: runLoadTest(config, controller.signal),
      timeoutMs: config.runTimeoutMs,
      label: "load-test run",
      onTimeout: () => controller.abort(),
    });
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
    const database = await startLoadDatabase(config);
    container = database.container;
    coordinatorPool = database.coordinatorPool;
    return await startLoadRun({
      config,
      container,
      coordinatorPool,
      schema,
      workers,
      startedAt,
      progress,
    });
  } finally {
    await cleanupLoadRun({
      runSignal,
      abortRun,
      progress,
      workers,
      coordinatorPool,
      container,
    });
  }
}

export async function main(): Promise<void> {
  const config = parseLoadTestConfig();
  const report = await runLoadTest(config);
  console.log(formatLoadTestReport(report));
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
