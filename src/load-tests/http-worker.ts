import { type AddressInfo } from "node:net";
import pg from "pg";
import { EventStore } from "../event-store";
import { AccountBalanceSnapshot } from "./http-aggregate";
import { createAggregateHttpServer } from "./http-server";
import type {
  HttpWorkerCommand,
  HttpWorkerConfig,
  HttpWorkerMessage,
  SerializedHttpError,
} from "./http-types";

const { Pool } = pg;

let config: HttpWorkerConfig | null = null;
let pool: pg.Pool | null = null;
let server: ReturnType<typeof createAggregateHttpServer> | null = null;
let shuttingDown = false;

function serializeError(error: unknown): SerializedHttpError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: "UnknownError", message: String(error) };
}

function send(message: HttpWorkerMessage): Promise<void> {
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

async function closeServer(): Promise<void> {
  if (!server) return;
  const currentServer = server;
  server = null;
  await new Promise<void>((resolve, reject) => {
    currentServer.close((error?: Error) => {
      if (
        error &&
        (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
      )
        reject(error);
      else resolve();
    });
  });
}

async function closeResources(): Promise<void> {
  await closeServer();
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  await currentPool.end();
}

async function fail(error: unknown): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await send({
      type: "failed",
      workerId: config?.workerId ?? -1,
      error: serializeError(error),
    });
  } finally {
    await closeResources();
    process.disconnect?.();
  }
}

async function initialize(workerConfig: HttpWorkerConfig): Promise<void> {
  if (config || pool || server) throw new Error("Worker already initialized");
  config = workerConfig;
  pool = new Pool({
    connectionString: workerConfig.connectionString,
    max: workerConfig.poolSize,
    connectionTimeoutMillis: workerConfig.operationTimeoutMs,
    statement_timeout: workerConfig.operationTimeoutMs,
  });
  const eventStore = new EventStore({
    pool,
    schema: workerConfig.schema,
    snapshots: [AccountBalanceSnapshot],
  });
  await eventStore.setup();
  server = createAggregateHttpServer({
    eventStore,
    workerId: workerConfig.workerId,
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("HTTP worker did not expose a TCP address");
  await send({
    type: "ready",
    workerId: workerConfig.workerId,
    port: (address as AddressInfo).port,
  });
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeResources();
  process.disconnect?.();
}

process.on("message", (message: HttpWorkerCommand) => {
  void (async () => {
    try {
      if (message.type === "initialize") {
        if (!message.config) throw new Error("Worker configuration is missing");
        await initialize(message.config);
      } else {
        await shutdown();
      }
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
