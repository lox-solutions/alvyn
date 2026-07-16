import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  HttpLoadTestConfig,
  HttpWorkerCommand,
  HttpWorkerConfig,
  HttpWorkerMessage,
  SerializedHttpError,
} from "./http-types";

const WORKER_LOADER_ARGUMENTS = ["--import", "tsx/esm"];
const WORKER_STDIO: ["inherit", "inherit", "inherit", "ipc"] = [
  "inherit",
  "inherit",
  "inherit",
  "ipc",
];
const TERMINATION_TIMEOUT_MS = 2_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
  settled: boolean;
}

export interface HttpWorkerHandle {
  child: ChildProcess;
  workerId: number;
  ready: Promise<number>;
  send(command: HttpWorkerCommand): Promise<void>;
  terminate(): Promise<void>;
  isAlive(): boolean;
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

function errorFromMessage(error: SerializedHttpError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  result.stack = error.stack;
  return result;
}

function sendCommand(
  child: ChildProcess,
  command: HttpWorkerCommand,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!child.connected) {
      reject(new Error("HTTP worker IPC channel is unavailable"));
      return;
    }
    child.send(command, (error: Error | null) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, TERMINATION_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.kill("SIGTERM");
  });
}

function attachWorkerListeners({
  child,
  workerId,
  ready,
  setAlive,
}: {
  child: ChildProcess;
  workerId: number;
  ready: Deferred<number>;
  setAlive: (value: boolean) => void;
}): void {
  child.on("message", (message: HttpWorkerMessage) => {
    if (message.workerId !== workerId) {
      ready.reject(
        new Error(
          `Worker ${workerId} received a message for worker ${message.workerId}`,
        ),
      );
      return;
    }
    if (message.type === "ready") ready.resolve(message.port);
    else ready.reject(errorFromMessage(message.error));
  });
  child.on("error", (error) => ready.reject(error));
  child.on("exit", (code, signal) => {
    setAlive(false);
    if (!ready.settled) {
      ready.reject(
        new Error(
          `HTTP worker ${workerId} exited before readiness (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    }
  });
}

export function createHttpWorker({
  workerId,
  connectionString,
  schema,
  config,
}: {
  workerId: number;
  connectionString: string;
  schema: string;
  config: HttpLoadTestConfig;
}): HttpWorkerHandle {
  const workerPath = fileURLToPath(
    new URL("./http-worker.ts", import.meta.url),
  );
  const child = fork(workerPath, [], {
    execArgv: WORKER_LOADER_ARGUMENTS,
    serialization: "advanced",
    stdio: WORKER_STDIO,
  });
  const ready = createDeferred<number>();
  let alive = true;
  attachWorkerListeners({
    child,
    workerId,
    ready,
    setAlive: (value) => {
      alive = value;
    },
  });
  const workerConfig: HttpWorkerConfig = {
    ...config,
    connectionString,
    schema,
    workerId,
  };
  void sendCommand(child, { type: "initialize", config: workerConfig }).catch(
    (error: Error) => ready.reject(error),
  );
  return {
    child,
    workerId,
    ready: ready.promise,
    send: (command) => sendCommand(child, command),
    terminate: () => terminateChild(child),
    isAlive: () => alive,
  };
}

export async function terminateWorkers(
  workers: HttpWorkerHandle[],
): Promise<void> {
  await Promise.all(
    workers.map(async (worker) => {
      if (worker.isAlive()) {
        await worker.send({ type: "shutdown" }).catch(() => undefined);
      }
      await worker.terminate();
    }),
  );
}
