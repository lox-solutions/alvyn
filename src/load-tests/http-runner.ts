import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import pg from "pg";
import { EventStore } from "../event-store";
import { parseHttpLoadTestConfig } from "./http-config";
import {
  AccountAggregate,
  createSeedDepositEvents,
  createSeedEvents,
  getAccountStreamId,
} from "./http-aggregate";
import { HttpMetricsCollector } from "./http-metrics";
import { ProgressRenderer } from "./progress";
import type {
  HttpLoadTestConfig,
  HttpLoadTestReport,
  HttpOperationPlan,
  HttpVerificationSummary,
  HttpWorkerCommand,
  HttpWorkerConfig,
  HttpWorkerMessage,
  SerializedHttpError,
} from "./http-types";
import { getAccountIds, getExpectedHttpOperation } from "./http-workload";

const { Pool } = pg;
const WORKER_LOADER_ARGUMENTS = ["--import", "tsx/esm"];
const WORKER_STDIO: ["inherit", "inherit", "inherit", "ipc"] = [
  "inherit",
  "inherit",
  "inherit",
  "ipc",
];
const VERIFICATION_PAGE_SIZE = 1_000;
const TERMINATION_TIMEOUT_MS = 2_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
  settled: boolean;
}

interface HttpWorkerHandle {
  child: ChildProcess;
  workerId: number;
  ready: Promise<number>;
  send(command: HttpWorkerCommand): Promise<void>;
  terminate(): Promise<void>;
  isAlive(): boolean;
}

interface SeedSummary {
  accountIds: string[];
  eventCount: number;
}

interface SuccessfulDeposit {
  accountId: string;
  amount: number;
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

function uniqueSchema(): string {
  return `http_load_${randomBytes(8).toString("hex")}`;
}

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

function createHttpWorker({
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
  const workerConfig: HttpWorkerConfig = {
    ...config,
    connectionString,
    schema,
    workerId,
  };
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
    alive = false;
    if (!ready.settled) {
      ready.reject(
        new Error(
          `HTTP worker ${workerId} exited before readiness (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    }
  });
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

async function terminateWorkers(workers: HttpWorkerHandle[]): Promise<void> {
  await Promise.all(
    workers.map(async (worker) => {
      if (worker.isAlive()) {
        await worker.send({ type: "shutdown" }).catch(() => undefined);
      }
      await worker.terminate();
    }),
  );
}

async function seedAccounts({
  eventStore,
  config,
  progress,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  progress: ProgressRenderer;
}): Promise<SeedSummary> {
  const accountIds = getAccountIds(config);
  let eventCount = 0;
  for (const [accountIndex, accountId] of accountIds.entries()) {
    await AccountAggregate.append(eventStore, {
      entityId: accountId,
      expectedVersion: -1,
      events: createSeedEvents({
        seed: config.seed,
        accountIndex,
        eventCount: 1,
      }),
    });
    eventCount++;
    for (
      let startEventIndex = 1;
      startEventIndex < config.historyEventsPerAccount;
      startEventIndex += config.seedBatchSize
    ) {
      const batchSize = Math.min(
        config.seedBatchSize,
        config.historyEventsPerAccount - startEventIndex,
      );
      await AccountAggregate.append(eventStore, {
        entityId: accountId,
        expectedVersion: startEventIndex,
        events: createSeedDepositEvents({
          seed: config.seed,
          accountIndex,
          startEventIndex,
          eventCount: batchSize,
        }),
      });
      eventCount += batchSize;
      progress.update(
        `seeding accounts: ${accountIndex + 1}/${config.accountCount} | events: ${eventCount}`,
      );
    }
    progress.update(
      `seeding accounts: ${accountIndex + 1}/${config.accountCount} | events: ${eventCount}`,
    );
  }
  return { accountIds, eventCount };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

async function sendHttpOperation({
  port,
  operation,
}: {
  port: number;
  operation: HttpOperationPlan;
}): Promise<Response> {
  const baseUrl = `http://127.0.0.1:${port}`;
  if (operation.kind === "read") {
    return fetch(
      `${baseUrl}/accounts/${encodeURIComponent(operation.accountId)}`,
    );
  }
  return fetch(
    `${baseUrl}/accounts/${encodeURIComponent(operation.accountId)}/deposit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: operation.amount,
        operationToken: operation.operationToken,
      }),
    },
  );
}

async function runHttpRequests({
  config,
  ports,
  progress,
}: {
  config: HttpLoadTestConfig;
  ports: number[];
  progress: ProgressRenderer;
}): Promise<{
  metrics: ReturnType<HttpMetricsCollector["report"]>;
  successfulDeposits: Map<string, SuccessfulDeposit>;
}> {
  const collector = new HttpMetricsCollector();
  const successfulDeposits = new Map<string, SuccessfulDeposit>();
  let nextOperationIndex = 0;
  let completed = 0;
  const runOperation = async (operationIndex: number): Promise<void> => {
    const operation = getExpectedHttpOperation({ config, operationIndex });
    const startedAt = performance.now();
    let conflicts = 0;
    let retries = 0;
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const response = await sendHttpOperation({
          port: ports[operationIndex % ports.length]!,
          operation,
        });
        const body = await readJsonResponse(response);
        if (response.status === 409 && operation.kind === "deposit") {
          conflicts++;
          if (attempt < config.maxRetries) {
            retries++;
            continue;
          }
        }
        if (
          (operation.kind === "read" && response.status === 200) ||
          (operation.kind === "deposit" && response.status === 201)
        ) {
          collector.record({
            kind: operation.kind,
            succeeded: true,
            latencyMs: performance.now() - startedAt,
            conflicts,
            retries,
          });
          if (operation.kind === "deposit") {
            if (successfulDeposits.has(operation.operationToken)) {
              throw new Error(
                `Duplicate successful HTTP operation ${operation.operationToken}`,
              );
            }
            successfulDeposits.set(operation.operationToken, {
              accountId: operation.accountId,
              amount: operation.amount,
            });
          }
          completed++;
          return;
        }
        lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    collector.record({
      kind: operation.kind,
      succeeded: false,
      latencyMs: performance.now() - startedAt,
      conflicts,
      retries,
      error: `${operation.operationToken}: ${lastError ?? "request failed"}`,
    });
    completed++;
  };

  const runLane = async (): Promise<void> => {
    while (true) {
      const operationIndex = nextOperationIndex++;
      if (operationIndex >= config.requestCount) return;
      await runOperation(operationIndex);
      if (completed % 100 === 0 || completed === config.requestCount) {
        progress.update(
          `HTTP requests: ${completed}/${config.requestCount} | concurrency: ${Math.min(config.concurrency, config.requestCount)}`,
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(config.concurrency, config.requestCount) },
      () => runLane(),
    ),
  );
  return { metrics: collector.report(), successfulDeposits };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function verifyAccounts({
  eventStore,
  config,
  seedSummary,
  successfulDeposits,
  progress,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  seedSummary: SeedSummary;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  progress: ProgressRenderer;
}): Promise<HttpVerificationSummary> {
  const seenLiveTokens = new Set<string>();
  const expectedBalances = new Map<string, number>();
  for (const accountId of seedSummary.accountIds) {
    expectedBalances.set(accountId, config.historyEventsPerAccount - 1);
  }
  for (const deposit of successfulDeposits.values()) {
    expectedBalances.set(
      deposit.accountId,
      (expectedBalances.get(deposit.accountId) ?? 0) + deposit.amount,
    );
  }

  let eventCount = 0;
  let finalBalance = 0;
  for (const [accountIndex, accountId] of seedSummary.accountIds.entries()) {
    const streamId = getAccountStreamId(accountId);
    const streamVersion = await eventStore.getStreamVersion(streamId);
    let fromVersion = 1;
    let accountBalance = 0;
    let accountEventCount = 0;
    while (fromVersion <= streamVersion) {
      const events = await eventStore.loadFrom(streamId, {
        fromVersion,
        maxEvents: VERIFICATION_PAGE_SIZE,
      });
      if (events.length === 0) {
        throw new Error(
          `Missing events for ${streamId} from version ${fromVersion}`,
        );
      }
      for (const event of events) {
        const expectedVersion = accountEventCount + 1;
        if (event.streamVersion !== expectedVersion) {
          throw new Error(
            `Non-contiguous ${streamId}: expected ${expectedVersion}, got ${event.streamVersion}`,
          );
        }
        if (event.type === "AccountOpened") {
          if (expectedVersion !== 1)
            throw new Error(`Invalid opening event in ${streamId}`);
          if (!isRecord(event.data) || event.data.initialBalance !== 0) {
            throw new Error(`Invalid opening payload in ${streamId}`);
          }
        } else if (event.type === "MoneyDeposited") {
          if (!isRecord(event.data))
            throw new Error(`Invalid deposit in ${streamId}`);
          const amount = event.data.amount;
          const operationToken = event.data.operationToken;
          if (
            typeof amount !== "number" ||
            typeof operationToken !== "string"
          ) {
            throw new Error(`Invalid deposit payload in ${streamId}`);
          }
          const seedToken = `seed:${config.seed}:${accountIndex}:${expectedVersion - 1}`;
          if (operationToken === seedToken) {
            if (amount !== 1)
              throw new Error(`Invalid seed amount in ${streamId}`);
          } else {
            const expectedDeposit = successfulDeposits.get(operationToken);
            if (!expectedDeposit || expectedDeposit.accountId !== accountId) {
              throw new Error(`Unexpected live operation ${operationToken}`);
            }
            if (
              expectedDeposit.amount !== amount ||
              seenLiveTokens.has(operationToken)
            ) {
              throw new Error(
                `Duplicate or invalid live operation ${operationToken}`,
              );
            }
            seenLiveTokens.add(operationToken);
          }
          accountBalance += amount;
        } else {
          throw new Error(`Unexpected event type ${event.type} in ${streamId}`);
        }
        accountEventCount++;
      }
      fromVersion += events.length;
    }
    if (accountEventCount !== streamVersion) {
      throw new Error(
        `Version mismatch for ${streamId}: read ${accountEventCount}, version ${streamVersion}`,
      );
    }
    const expectedBalance = expectedBalances.get(accountId);
    if (expectedBalance !== accountBalance) {
      throw new Error(
        `Balance mismatch for ${accountId}: expected ${expectedBalance}, got ${accountBalance}`,
      );
    }
    eventCount += accountEventCount;
    finalBalance += accountBalance;
    progress.update(
      `verifying accounts: ${accountIndex + 1}/${seedSummary.accountIds.length} | events: ${eventCount}`,
    );
  }
  if (seenLiveTokens.size !== successfulDeposits.size) {
    throw new Error(
      `Missing successful HTTP operations: expected ${successfulDeposits.size}, found ${seenLiveTokens.size}`,
    );
  }
  const expectedEventCount = seedSummary.eventCount + successfulDeposits.size;
  if (eventCount !== expectedEventCount) {
    throw new Error(
      `Event count mismatch: expected ${expectedEventCount}, got ${eventCount}`,
    );
  }
  return {
    accountCount: seedSummary.accountIds.length,
    eventCount,
    expectedEventCount,
    seedEventCount: seedSummary.eventCount,
    successfulDeposits: successfulDeposits.size,
    finalBalance,
  };
}

export async function writeReport(
  config: HttpLoadTestConfig,
  report: HttpLoadTestReport,
): Promise<void> {
  if (!config.outputPath) return;
  const outputPath = isAbsolute(config.outputPath)
    ? config.outputPath
    : resolve(process.cwd(), config.outputPath);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

export function createReport({
  config,
  schema,
  startedAt,
  metrics,
  verification,
  workers,
  failure,
}: {
  config: HttpLoadTestConfig;
  schema: string;
  startedAt: number;
  metrics: ReturnType<HttpMetricsCollector["report"]>;
  verification: HttpVerificationSummary | null;
  workers: Array<{ workerId: number; port: number }>;
  failure?: string;
}): HttpLoadTestReport {
  const durationMs = performance.now() - startedAt;
  return {
    status: failure === undefined ? "passed" : "failed",
    ...(failure === undefined ? {} : { failure }),
    configuration: config,
    schema,
    connectionCount: (config.workerCount + 1) * config.poolSize,
    durationMs,
    request: metrics.request,
    read: metrics.read,
    deposit: metrics.deposit,
    throughput: {
      requestsPerSecond:
        durationMs === 0 ? 0 : metrics.request.succeeded / (durationMs / 1000),
    },
    errors: metrics.errors,
    verification,
    workers,
  };
}

function formatReport(report: HttpLoadTestReport): string {
  return [
    "Alvyn aggregate HTTP load test",
    `status: ${report.status}`,
    ...(report.failure === undefined ? [] : [`failure: ${report.failure}`]),
    `workers: ${report.workers.length}`,
    `connections: ${report.connectionCount}`,
    `duration: ${Math.round(report.durationMs)} ms`,
    `HTTP requests: ${report.request.succeeded}/${report.request.attempted}`,
    `reads: ${report.read.succeeded}/${report.read.attempted}`,
    `deposits: ${report.deposit.succeeded}/${report.deposit.attempted}`,
    `OCC conflicts/retries: ${report.deposit.conflicts}/${report.deposit.retries}`,
    `throughput: ${report.throughput.requestsPerSecond.toFixed(2)} requests/s`,
    `latency p50/p95/p99: ${report.request.latency.p50 ?? "n/a"}/${report.request.latency.p95 ?? "n/a"}/${report.request.latency.p99 ?? "n/a"} ms`,
    `verified accounts/events: ${report.verification === null ? "n/a" : `${report.verification.accountCount}/${report.verification.eventCount}`}`,
  ].join("\n");
}

export async function runHttpLoadTest(
  config: HttpLoadTestConfig,
): Promise<HttpLoadTestReport> {
  let container: StartedPostgreSqlContainer | null = null;
  let coordinatorPool: pg.Pool | null = null;
  const workers: HttpWorkerHandle[] = [];
  let ports: number[] = [];
  let metrics = new HttpMetricsCollector().report();
  let reportWritten = false;
  const schema = uniqueSchema();
  const startedAt = performance.now();
  const progress = new ProgressRenderer(config.verbose);
  try {
    progress.update("starting PostgreSQL container");
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const connectionString = container.getConnectionUri();
    coordinatorPool = new Pool({
      connectionString,
      max: config.poolSize,
    });
    const eventStore = new EventStore({ pool: coordinatorPool, schema });
    progress.update("creating schema");
    await eventStore.setup();
    const seedSummary = await seedAccounts({ eventStore, config, progress });
    progress.update(`starting ${config.workerCount} HTTP workers`);
    for (let workerId = 0; workerId < config.workerCount; workerId++) {
      workers.push(
        createHttpWorker({
          workerId,
          connectionString,
          schema,
          config,
        }),
      );
    }
    ports = await Promise.all(workers.map((worker) => worker.ready));
    progress.update(
      `HTTP workers ready: ${ports.length}/${config.workerCount}`,
    );
    const requestResult = await runHttpRequests({ config, ports, progress });
    metrics = requestResult.metrics;
    if (requestResult.metrics.request.failed > 0) {
      throw new Error(
        `${requestResult.metrics.request.failed} HTTP requests failed`,
      );
    }
    if (workers.some((worker) => !worker.isAlive())) {
      throw new Error("An HTTP worker exited during the request phase");
    }
    progress.update("verifying aggregate state");
    const verification = await verifyAccounts({
      eventStore,
      config,
      seedSummary,
      successfulDeposits: requestResult.successfulDeposits,
      progress,
    });
    const report = createReport({
      config,
      schema,
      startedAt,
      metrics: requestResult.metrics,
      verification,
      workers: ports.map((port, workerId) => ({ workerId, port })),
    });
    await writeReport(config, report);
    reportWritten = true;
    return report;
  } catch (error) {
    if (!reportWritten) {
      const failure = serializeError(error).message;
      const failureReport = createReport({
        config,
        schema,
        startedAt,
        metrics,
        verification: null,
        failure,
        workers: ports.map((port, workerId) => ({ workerId, port })),
      });
      await writeReport(config, failureReport);
    }
    throw error;
  } finally {
    progress.finish();
    await terminateWorkers(workers);
    try {
      if (coordinatorPool) await coordinatorPool.end();
    } finally {
      if (container) await container.stop();
    }
  }
}

export async function main(): Promise<void> {
  const config = parseHttpLoadTestConfig();
  const report = await runHttpLoadTest(config);
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
