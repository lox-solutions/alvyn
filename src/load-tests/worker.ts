import pg from "pg";
import { EventStore } from "../event-store";
import type {
  SerializedError,
  WorkerCommand,
  WorkerConfig,
  WorkerMessage,
} from "./types";
import { runWorkerWorkload } from "./workload";

const { Pool } = pg;

let config: WorkerConfig | null = null;
let pool: pg.Pool | null = null;
let eventStore: EventStore | null = null;
let shuttingDown = false;

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

function send(message: WorkerMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error("Worker IPC channel is unavailable"));
      return;
    }

    process.send(message, (error: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function closeResources(): Promise<void> {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  await currentPool.end();
}

async function fail(error: unknown): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const workerId = config?.workerId ?? -1;

  try {
    await send({
      type: "failed",
      workerId,
      error: serializeError(error),
    });
  } finally {
    await closeResources();
    process.disconnect?.();
  }
}

async function initialize(workerConfig: WorkerConfig): Promise<void> {
  if (config || pool || eventStore) {
    throw new Error("Worker has already been initialized");
  }

  config = workerConfig;
  pool = new Pool({
    connectionString: workerConfig.connectionString,
    max: workerConfig.poolSize,
  });
  eventStore = new EventStore({
    pool,
    schema: workerConfig.schema,
  });

  await eventStore.setup();
  await send({ type: "ready", workerId: workerConfig.workerId });
}

async function start(): Promise<void> {
  if (!config || !eventStore) {
    throw new Error("Worker received start before initialization");
  }
  const workerConfig = config;
  const workerEventStore = eventStore;

  const metrics = await runWorkerWorkload({
    eventStore: workerEventStore,
    config: workerConfig,
    workerId: workerConfig.workerId,
    onProgress: (progressMetrics) =>
      send({
        type: "progress",
        workerId: workerConfig.workerId,
        metrics: progressMetrics,
      }),
  });
  await send({
    type: "completed",
    workerId: workerConfig.workerId,
    metrics,
  });
  shuttingDown = true;
  await closeResources();
  process.disconnect?.();
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeResources();
  process.disconnect?.();
}

process.on("message", (message: WorkerCommand) => {
  void (async () => {
    try {
      if (message.type === "initialize") await initialize(message.config);
      else if (message.type === "start") await start();
      else await shutdown();
    } catch (error) {
      await fail(error);
    }
  })();
});

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
