import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  LoadTestConfig,
  SerializedError,
  WorkerCommand,
  WorkerConfig,
  WorkerMessage,
  WorkerMetrics,
} from "./types";

const WORKER_LOADER_ARGUMENTS = ["--import", "tsx/esm"];
const WORKER_STDIO: ["inherit", "inherit", "inherit", "ipc"] = [
  "inherit",
  "inherit",
  "inherit",
  "ipc",
];
const TERMINATION_TIMEOUT_MS = 2_000;

export interface WorkerHandle {
  child: ChildProcess;
  workerId: number;
  ready: Promise<void>;
  completed: Promise<WorkerMetrics>;
  send(command: WorkerCommand): Promise<void>;
  terminate(): Promise<void>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
  settled: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const deferred: Deferred<T> = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: (value) => {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise(value);
    },
    reject: (error) => {
      if (deferred.settled) return;
      deferred.settled = true;
      rejectPromise(error);
    },
    settled: false,
  };
  return deferred;
}

function errorFromMessage(error: SerializedError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  result.stack = error.stack;
  return result;
}

function failWorker({
  ready,
  completed,
  error,
}: {
  ready: Deferred<void>;
  completed: Deferred<WorkerMetrics>;
  error: Error;
}): void {
  ready.reject(error);
  completed.reject(error);
}

function handleWorkerMessage({
  workerId,
  message,
  ready,
  completed,
  onProgress,
}: {
  workerId: number;
  message: WorkerMessage;
  ready: Deferred<void>;
  completed: Deferred<WorkerMetrics>;
  onProgress?: (metrics: WorkerMetrics) => void;
}): void {
  if (message.workerId !== workerId) {
    failWorker({
      ready,
      completed,
      error: new Error(
        `Worker ${workerId} received a message for worker ${message.workerId}`,
      ),
    });
    return;
  }

  if (message.type === "ready") ready.resolve(undefined);
  else if (message.type === "progress") onProgress?.(message.metrics);
  else if (message.type === "completed") completed.resolve(message.metrics);
  else if (message.type === "failed") {
    failWorker({
      ready,
      completed,
      error: errorFromMessage(message.error),
    });
  }
}

function sendCommand(
  child: ChildProcess,
  command: WorkerCommand,
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.send(command, (error: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, TERMINATION_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function createChildProcess(): ChildProcess {
  const workerPath = fileURLToPath(new URL("./worker.ts", import.meta.url));
  return fork(workerPath, [], {
    execArgv: WORKER_LOADER_ARGUMENTS,
    serialization: "advanced",
    stdio: WORKER_STDIO,
  });
}

function registerWorkerEvents({
  child,
  workerId,
  ready,
  completed,
  onProgress,
}: {
  child: ChildProcess;
  workerId: number;
  ready: Deferred<void>;
  completed: Deferred<WorkerMetrics>;
  onProgress?: (metrics: WorkerMetrics) => void;
}): void {
  child.on("message", (message: WorkerMessage) => {
    handleWorkerMessage({
      workerId,
      message,
      ready,
      completed,
      onProgress,
    });
  });
  child.on("error", (error) => failWorker({ ready, completed, error }));
  child.on("exit", (code, signal) => {
    if (code === 0 && signal === null && completed.settled) return;
    failWorker({
      ready,
      completed,
      error: new Error(
        `Worker ${workerId} exited before completion (code=${String(code)}, signal=${String(signal)})`,
      ),
    });
  });
}

export function createWorker({
  workerId,
  connectionString,
  schema,
  config,
  onProgress,
}: {
  workerId: number;
  connectionString: string;
  schema: string;
  config: LoadTestConfig;
  onProgress?: (metrics: WorkerMetrics) => void;
}): WorkerHandle {
  const child = createChildProcess();
  const ready = createDeferred<void>();
  const completed = createDeferred<WorkerMetrics>();
  const workerConfig: WorkerConfig = {
    ...config,
    connectionString,
    schema,
    workerId,
  };
  registerWorkerEvents({
    child,
    workerId,
    ready,
    completed,
    onProgress,
  });
  const send = (command: WorkerCommand) => sendCommand(child, command);
  const terminate = () => terminateChild(child);
  const handle: WorkerHandle = {
    child,
    workerId,
    ready: ready.promise,
    completed: completed.promise,
    send,
    terminate,
  };
  void send({ type: "initialize", config: workerConfig }).catch(
    (error: Error) => failWorker({ ready, completed, error }),
  );
  return handle;
}

export async function terminateWorkers(workers: WorkerHandle[]): Promise<void> {
  await Promise.all(workers.map((worker) => worker.terminate()));
}
