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
  AccountBalanceSnapshot,
  createSeedDepositEvents,
  createSeedEvents,
  getAccountStreamId,
} from "./http-aggregate";
import {
  HttpLatencyCollector,
  HttpMetricsCollector,
  latencyImprovementPercent,
} from "./http-metrics";
import { ProgressRenderer } from "./progress";
import { evaluateHttpSlos } from "./http-slo";
import { createTrafficPhases } from "./http-traffic";
import type {
  HttpLoadTestConfig,
  HttpLoadTestReport,
  HttpOperationPlan,
  HttpPhaseDurations,
  HttpReplicaReport,
  HttpSnapshotBenchmarkReport,
  HttpTrafficPhaseReport,
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
const HTTP_RETRY_BASE_DELAY_MS = 5;
const HTTP_RETRY_MAX_DELAY_MS = 50;
const HTTP_RETRY_JITTER_RANGE_MS = 10;
const HTTP_RETRY_OPERATION_JITTER = 17;
const HTTP_RETRY_ATTEMPT_JITTER = 13;

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
  historyEventCounts: number[];
  eventCount: number;
  snapshotEventCount: number;
}

interface SuccessfulDeposit {
  accountId: string;
  amount: number;
}

function getHttpRetryDelayMs(
  operationIndex: number,
  retryNumber: number,
): number {
  const exponentialDelay = Math.min(
    HTTP_RETRY_MAX_DELAY_MS,
    HTTP_RETRY_BASE_DELAY_MS * 2 ** retryNumber,
  );
  const jitter =
    (operationIndex * HTTP_RETRY_OPERATION_JITTER +
      retryNumber * HTTP_RETRY_ATTEMPT_JITTER) %
    HTTP_RETRY_JITTER_RANGE_MS;
  return exponentialDelay + jitter;
}

export function getHttpWorkerIndex(
  operationIndex: number,
  attempt: number,
  workerCount: number,
): number {
  return (operationIndex + attempt) % workerCount;
}

export async function retryHttpRequest<T>({
  operationIndex,
  maxRetries,
  send,
  isConflict,
  wait = (delayMs) =>
    new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, delayMs);
    }),
}: {
  operationIndex: number;
  maxRetries: number;
  send: (attempt: number) => Promise<T>;
  isConflict: (value: T) => boolean;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<{ value: T; conflicts: number; retries: number }> {
  let conflicts = 0;
  let retries = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const value = await send(attempt);
    if (!isConflict(value)) return { value, conflicts, retries };
    conflicts++;
    if (attempt >= maxRetries) return { value, conflicts, retries };
    retries++;
    await wait(getHttpRetryDelayMs(operationIndex, retries - 1));
  }
  throw new Error("HTTP retry loop did not terminate");
}

function getSnapshotBenchmarkAccountIds(config: HttpLoadTestConfig): string[] {
  const accountIds = getAccountIds(config);
  const benchmarkAccountCount = Math.min(
    config.snapshotBenchmarkRequests,
    accountIds.length,
  );
  return accountIds.slice(accountIds.length - benchmarkAccountCount);
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
  const benchmarkAccountCount = getSnapshotBenchmarkAccountIds(config).length;
  const benchmarkAccountStart = accountIds.length - benchmarkAccountCount;
  const historyEventCounts = accountIds.map((_, accountIndex) =>
    accountIndex >= benchmarkAccountStart
      ? Math.max(
          config.historyEventsPerAccount,
          config.snapshotBenchmarkHistoryEventsPerAccount,
        )
      : config.historyEventsPerAccount,
  );
  let eventCount = 0;
  for (const [accountIndex, accountId] of accountIds.entries()) {
    const historyEvents = historyEventCounts[accountIndex]!;
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
      startEventIndex < historyEvents;
      startEventIndex += config.seedBatchSize
    ) {
      const batchSize = Math.min(
        config.seedBatchSize,
        historyEvents - startEventIndex,
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
  return {
    accountIds,
    historyEventCounts,
    eventCount,
    snapshotEventCount: 0,
  };
}

async function seedAccountSnapshots({
  eventStore,
  config,
  seedSummary,
  progress,
}: {
  eventStore: EventStore;
  config: HttpLoadTestConfig;
  seedSummary: SeedSummary;
  progress: ProgressRenderer;
}): Promise<void> {
  const snapshotState = { status: "open" as const, balance: 0 };
  const snapshotAccountIds = getSnapshotBenchmarkAccountIds(config);
  for (const [snapshotIndex, accountId] of snapshotAccountIds.entries()) {
    const accountIndex = seedSummary.accountIds.indexOf(accountId);
    const historyEvents = seedSummary.historyEventCounts[accountIndex]!;
    await eventStore.appendSnapshot({
      streamId: getAccountStreamId(accountId),
      expectedVersion: historyEvents,
      events: [
        {
          type: AccountBalanceSnapshot.snapshotEventType,
          data: {
            ...snapshotState,
            balance: Math.max(0, historyEvents - 1),
          },
        },
      ],
    });
    seedSummary.snapshotEventCount++;
    progress.update(
      `seeding snapshots: ${snapshotIndex + 1}/${snapshotAccountIds.length}`,
    );
  }
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

async function sendHttpAccountRead({
  port,
  accountId,
  snapshots,
}: {
  port: number;
  accountId: string;
  snapshots: boolean;
}): Promise<Response> {
  const suffix = snapshots ? "?snapshot=true" : "";
  return fetch(
    `http://127.0.0.1:${port}/accounts/${encodeURIComponent(accountId)}${suffix}`,
  );
}

function getReplayedEvents(body: unknown): number {
  if (!isRecord(body) || !Number.isInteger(body.replayedEvents)) {
    throw new Error("Snapshot response did not include replayedEvents");
  }
  const replayedEvents = body.replayedEvents as number;
  if (replayedEvents < 0) {
    throw new Error("Snapshot response included a negative replay count");
  }
  return replayedEvents;
}

function emptySnapshotBenchmark(
  requestCount: number,
  historyEventsPerAccount: number,
): HttpSnapshotBenchmarkReport {
  return {
    requestCount,
    historyEventsPerAccount,
    withoutSnapshots: { count: 0, p50: null, p95: null, p99: null },
    withSnapshots: { count: 0, p50: null, p95: null, p99: null },
    latencyImprovementPercent: { p50: null, p95: null, p99: null },
    snapshotReplay: {
      count: 0,
      totalEvents: 0,
      averageEvents: null,
      maxEvents: null,
    },
  };
}

async function runSnapshotBenchmark({
  config,
  ports,
  progress,
}: {
  config: HttpLoadTestConfig;
  ports: number[];
  progress: ProgressRenderer;
}): Promise<HttpSnapshotBenchmarkReport> {
  const withoutSnapshots = new HttpLatencyCollector();
  const withSnapshots = new HttpLatencyCollector();
  const historyEventsPerAccount = Math.max(
    config.historyEventsPerAccount,
    config.snapshotBenchmarkHistoryEventsPerAccount,
  );
  const accountIds = getSnapshotBenchmarkAccountIds(config);
  const replayedEvents: number[] = [];
  let nextRequest = 0;
  let completed = 0;

  const measureRead = async ({
    requestIndex,
    snapshots,
  }: {
    requestIndex: number;
    snapshots: boolean;
  }): Promise<void> => {
    const accountId = accountIds[requestIndex % accountIds.length]!;
    const port = ports[requestIndex % ports.length]!;
    const startedAt = performance.now();
    const response = await sendHttpAccountRead({
      port,
      accountId,
      snapshots,
    });
    const body = await readJsonResponse(response);
    if (response.status !== 200) {
      throw new Error(
        `Snapshot benchmark ${snapshots ? "with" : "without"} snapshots failed for ${accountId}: HTTP ${response.status}`,
      );
    }
    const latency = performance.now() - startedAt;
    if (snapshots) {
      withSnapshots.record(latency);
      replayedEvents.push(getReplayedEvents(body));
    } else {
      withoutSnapshots.record(latency);
    }
  };

  const runLane = async (): Promise<void> => {
    while (true) {
      const requestIndex = nextRequest++;
      if (requestIndex >= config.snapshotBenchmarkRequests) return;
      const firstSnapshots = requestIndex % 2 === 0;
      await measureRead({ requestIndex, snapshots: firstSnapshots });
      await measureRead({ requestIndex, snapshots: !firstSnapshots });
      completed++;
      if (
        completed % 100 === 0 ||
        completed === config.snapshotBenchmarkRequests
      ) {
        progress.update(
          `snapshot benchmark: ${completed}/${config.snapshotBenchmarkRequests}`,
        );
      }
    }
  };

  if (config.snapshotBenchmarkRequests === 0)
    return emptySnapshotBenchmark(
      config.snapshotBenchmarkRequests,
      historyEventsPerAccount,
    );
  await Promise.all(
    Array.from(
      {
        length: Math.min(config.concurrency, config.snapshotBenchmarkRequests),
      },
      () => runLane(),
    ),
  );

  const withoutReport = withoutSnapshots.report();
  const withReport = withSnapshots.report();
  const totalEvents = replayedEvents.reduce((total, count) => total + count, 0);
  return {
    requestCount: config.snapshotBenchmarkRequests,
    historyEventsPerAccount,
    withoutSnapshots: withoutReport,
    withSnapshots: withReport,
    latencyImprovementPercent: {
      p50: latencyImprovementPercent(withoutReport.p50, withReport.p50),
      p95: latencyImprovementPercent(withoutReport.p95, withReport.p95),
      p99: latencyImprovementPercent(withoutReport.p99, withReport.p99),
    },
    snapshotReplay: {
      count: replayedEvents.length,
      totalEvents,
      averageEvents:
        replayedEvents.length === 0
          ? null
          : totalEvents / replayedEvents.length,
      maxEvents:
        replayedEvents.length === 0
          ? null
          : replayedEvents.reduce(
              (maximum, count) => Math.max(maximum, count),
              0,
            ),
    },
  };
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
  trafficPhases: HttpTrafficPhaseReport[];
  replicaRequestAttempts: number[];
  durationMs: number;
}> {
  const startedAt = performance.now();
  const collector = new HttpMetricsCollector();
  const successfulDeposits = new Map<string, SuccessfulDeposit>();
  const trafficPhases: HttpTrafficPhaseReport[] = [];
  const replicaRequestAttempts = ports.map(() => 0);
  let completed = 0;
  const runOperation = async (
    operationIndex: number,
    phaseCollector: HttpMetricsCollector,
  ): Promise<void> => {
    const operation = getExpectedHttpOperation({ config, operationIndex });
    const startedAt = performance.now();
    let conflicts = 0;
    let retries = 0;
    let lastError: string | undefined;
    try {
      const result = await retryHttpRequest({
        operationIndex,
        maxRetries: config.maxRetries,
        send: async (attempt) => {
          const workerIndex = getHttpWorkerIndex(
            operationIndex,
            attempt,
            ports.length,
          );
          replicaRequestAttempts[workerIndex]++;
          const response = await sendHttpOperation({
            port: ports[workerIndex]!,
            operation,
          });
          return { response, body: await readJsonResponse(response) };
        },
        isConflict: ({ response }) =>
          response.status === 409 && operation.kind === "deposit",
      });
      const { response, body } = result.value;
      conflicts = result.conflicts;
      retries = result.retries;
      if (
        (operation.kind === "read" && response.status === 200) ||
        (operation.kind === "deposit" && response.status === 201)
      ) {
        const record = {
          kind: operation.kind,
          succeeded: true,
          latencyMs: performance.now() - startedAt,
          conflicts,
          retries,
        } as const;
        collector.record(record);
        phaseCollector.record(record);
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
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    const record = {
      kind: operation.kind,
      succeeded: false,
      latencyMs: performance.now() - startedAt,
      conflicts,
      retries,
      error: `${operation.operationToken}: ${lastError ?? "request failed"}`,
    } as const;
    collector.record(record);
    phaseCollector.record(record);
    completed++;
  };

  const plans = createTrafficPhases(config);
  const totalRequests = plans.reduce(
    (total, trafficPhase) => total + trafficPhase.requestCount,
    0,
  );
  for (const trafficPhase of plans) {
    const phaseStartedAt = performance.now();
    const phaseCollector = new HttpMetricsCollector();
    let nextPhaseOperation = 0;
    const runLane = async (): Promise<void> => {
      while (true) {
        const phaseOperationIndex = nextPhaseOperation++;
        if (phaseOperationIndex >= trafficPhase.requestCount) return;
        if (trafficPhase.targetRequestsPerSecond !== null) {
          const dueAt =
            phaseStartedAt +
            (phaseOperationIndex / trafficPhase.targetRequestsPerSecond) *
              1_000;
          const delayMs = dueAt - performance.now();
          if (delayMs > 0) {
            await new Promise<void>((resolvePromise) => {
              setTimeout(resolvePromise, delayMs);
            });
          }
        }
        await runOperation(
          trafficPhase.requestOffset + phaseOperationIndex,
          phaseCollector,
        );
        if (completed % 100 === 0 || completed === totalRequests) {
          progress.update(
            `${trafficPhase.name}: ${completed}/${totalRequests} HTTP requests | concurrency: ${Math.min(config.concurrency, trafficPhase.requestCount)}`,
          );
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(config.concurrency, trafficPhase.requestCount) },
        () => runLane(),
      ),
    );
    const remainingPhaseMs =
      phaseStartedAt + trafficPhase.durationMs - performance.now();
    if (remainingPhaseMs > 0) {
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, remainingPhaseMs);
      });
    }
    const durationMs = performance.now() - phaseStartedAt;
    const phaseMetrics = phaseCollector.report();
    trafficPhases.push({
      name: trafficPhase.name,
      requestOffset: trafficPhase.requestOffset,
      requestCount: trafficPhase.requestCount,
      targetRequestsPerSecond: trafficPhase.targetRequestsPerSecond,
      durationMs,
      achievedRequestsPerSecond:
        durationMs === 0
          ? 0
          : phaseMetrics.request.succeeded / (durationMs / 1_000),
      ...phaseMetrics,
      slo: evaluateHttpSlos({ config, ...phaseMetrics }),
    });
  }
  return {
    metrics: collector.report(),
    successfulDeposits,
    trafficPhases,
    replicaRequestAttempts,
    durationMs: performance.now() - startedAt,
  };
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
  for (const [accountIndex, accountId] of seedSummary.accountIds.entries()) {
    expectedBalances.set(
      accountId,
      seedSummary.historyEventCounts[accountIndex]! - 1,
    );
  }
  const expectedSourceEventCounts = new Map<string, number>();
  for (const [accountIndex, accountId] of seedSummary.accountIds.entries()) {
    expectedSourceEventCounts.set(
      accountId,
      seedSummary.historyEventCounts[accountIndex]!,
    );
  }
  for (const deposit of successfulDeposits.values()) {
    expectedBalances.set(
      deposit.accountId,
      (expectedBalances.get(deposit.accountId) ?? 0) + deposit.amount,
    );
    expectedSourceEventCounts.set(
      deposit.accountId,
      (expectedSourceEventCounts.get(deposit.accountId) ?? 0) + 1,
    );
  }

  let eventCount = 0;
  let storedEventCount = 0;
  let snapshotEventCount = 0;
  let finalBalance = 0;
  for (const [accountIndex, accountId] of seedSummary.accountIds.entries()) {
    const streamId = getAccountStreamId(accountId);
    const streamVersion = await eventStore.getStreamVersion(streamId);
    let fromVersion = 1;
    let accountBalance = 0;
    let accountSourceEventCount = 0;
    let accountStoredEventCount = 0;
    let accountSnapshotEventCount = 0;
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
        const expectedVersion = accountStoredEventCount + 1;
        if (event.streamVersion !== expectedVersion) {
          throw new Error(
            `Non-contiguous ${streamId}: expected ${expectedVersion}, got ${event.streamVersion}`,
          );
        }
        if (event.type === "AccountOpened") {
          if (accountSourceEventCount !== 0)
            throw new Error(`Invalid opening event in ${streamId}`);
          if (!isRecord(event.data) || event.data.initialBalance !== 0) {
            throw new Error(`Invalid opening payload in ${streamId}`);
          }
          accountSourceEventCount++;
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
          const seedToken = `seed:${config.seed}:${accountIndex}:${accountSourceEventCount}`;
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
          accountSourceEventCount++;
        } else if (event.type === AccountBalanceSnapshot.snapshotEventType) {
          if (
            !isRecord(event.data) ||
            event.data.status !== "open" ||
            event.data.balance !== accountBalance
          ) {
            throw new Error(`Invalid snapshot payload in ${streamId}`);
          }
          accountSnapshotEventCount++;
        } else {
          throw new Error(`Unexpected event type ${event.type} in ${streamId}`);
        }
        accountStoredEventCount++;
      }
      fromVersion += events.length;
    }
    if (accountStoredEventCount !== streamVersion) {
      throw new Error(
        `Version mismatch for ${streamId}: read ${accountStoredEventCount}, version ${streamVersion}`,
      );
    }
    const expectedSourceEventCount = expectedSourceEventCounts.get(accountId);
    if (expectedSourceEventCount !== accountSourceEventCount) {
      throw new Error(
        `Source event count mismatch for ${streamId}: expected ${expectedSourceEventCount}, got ${accountSourceEventCount}`,
      );
    }
    const expectedBalance = expectedBalances.get(accountId);
    if (expectedBalance !== accountBalance) {
      throw new Error(
        `Balance mismatch for ${accountId}: expected ${expectedBalance}, got ${accountBalance}`,
      );
    }
    eventCount += accountSourceEventCount;
    storedEventCount += accountStoredEventCount;
    snapshotEventCount += accountSnapshotEventCount;
    finalBalance += accountBalance;
    progress.update(
      `verifying accounts: ${accountIndex + 1}/${seedSummary.accountIds.length} | stored events: ${storedEventCount}`,
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
  if (snapshotEventCount < seedSummary.snapshotEventCount) {
    throw new Error(
      `Snapshot count mismatch: expected at least ${seedSummary.snapshotEventCount}, got ${snapshotEventCount}`,
    );
  }
  return {
    accountCount: seedSummary.accountIds.length,
    eventCount,
    storedEventCount,
    snapshotEventCount,
    expectedEventCount,
    seedEventCount: seedSummary.eventCount,
    seedSnapshotEventCount: seedSummary.snapshotEventCount,
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
  phaseDurations,
  metrics,
  snapshotBenchmark,
  verification,
  workers,
  trafficPhases = [],
  failure,
}: {
  config: HttpLoadTestConfig;
  schema: string;
  startedAt: number;
  phaseDurations: HttpPhaseDurations;
  metrics: ReturnType<HttpMetricsCollector["report"]>;
  snapshotBenchmark: HttpSnapshotBenchmarkReport | null;
  verification: HttpVerificationSummary | null;
  workers: HttpReplicaReport[];
  trafficPhases?: HttpTrafficPhaseReport[];
  failure?: string;
}): HttpLoadTestReport {
  const durationMs = performance.now() - startedAt;
  const workerConnectionCount = config.workerCount * config.poolSize;
  const coordinatorConnectionCount = config.poolSize;
  const slo = evaluateHttpSlos({ config, ...metrics });
  const sloFailure = config.enforceSlos && !slo.passed;
  const reportFailure =
    failure ??
    (sloFailure ? "Configured HTTP SLO thresholds were exceeded" : undefined);
  const capacityPhases = trafficPhases.filter(
    (trafficPhase) => trafficPhase.targetRequestsPerSecond !== null,
  );
  const sustainableCapacityPhases = capacityPhases.filter(
    (trafficPhase) =>
      trafficPhase.slo.passed &&
      trafficPhase.targetRequestsPerSecond !== null &&
      trafficPhase.achievedRequestsPerSecond >=
        trafficPhase.targetRequestsPerSecond * 0.95,
  );
  const firstUnsustainableCapacityPhase = capacityPhases.find(
    (trafficPhase) => !sustainableCapacityPhases.includes(trafficPhase),
  );
  return {
    status: reportFailure === undefined ? "passed" : "failed",
    ...(reportFailure === undefined ? {} : { failure: reportFailure }),
    configuration: config,
    schema,
    workerConnectionCount,
    coordinatorConnectionCount,
    connectionCount: workerConnectionCount + coordinatorConnectionCount,
    durationMs,
    phaseDurations,
    request: metrics.request,
    read: metrics.read,
    deposit: metrics.deposit,
    throughput: {
      durationMs: phaseDurations.httpRequestsMs,
      successfulRequests: metrics.request.succeeded,
      requestsPerSecond:
        phaseDurations.httpRequestsMs === 0
          ? 0
          : metrics.request.succeeded / (phaseDurations.httpRequestsMs / 1000),
    },
    trafficPhases,
    slo,
    capacity:
      config.profile !== "capacity"
        ? null
        : {
            maximumSustainableRequestsPerSecond:
              sustainableCapacityPhases.at(-1)?.targetRequestsPerSecond ?? null,
            firstUnsustainableRequestsPerSecond:
              firstUnsustainableCapacityPhase?.targetRequestsPerSecond ?? null,
          },
    snapshotBenchmark,
    errors: metrics.errors,
    verification,
    workers,
  };
}

function formatReport(report: HttpLoadTestReport): string {
  return [
    "Alvyn aggregate HTTP load test",
    `profile: ${report.configuration.profile}`,
    `status: ${report.status}`,
    ...(report.failure === undefined ? [] : [`failure: ${report.failure}`]),
    `workers: ${report.workers.length}`,
    `replica request attempts: ${report.workers.map((worker) => `${worker.workerId}=${worker.requestAttempts}`).join(", ")}`,
    `connections: ${report.connectionCount} (workers: ${report.workerConnectionCount}, coordinator: ${report.coordinatorConnectionCount})`,
    `duration: ${Math.round(report.durationMs)} ms`,
    `HTTP phase: ${Math.round(report.throughput.durationMs)} ms`,
    `HTTP requests: ${report.request.succeeded}/${report.request.attempted}`,
    `reads: ${report.read.succeeded}/${report.read.attempted}`,
    `deposits: ${report.deposit.succeeded}/${report.deposit.attempted}`,
    `OCC conflicts/retries: ${report.deposit.conflicts}/${report.deposit.retries}`,
    `throughput: ${report.throughput.requestsPerSecond.toFixed(2)} requests/s`,
    `latency p50/p95/p99: ${report.request.latency.p50 ?? "n/a"}/${report.request.latency.p95 ?? "n/a"}/${report.request.latency.p99 ?? "n/a"} ms`,
    `SLO: ${report.slo.passed ? "passed" : "failed"}${report.slo.enforced ? " (enforced)" : " (report only)"}`,
    ...report.trafficPhases.map(
      (trafficPhase) =>
        `phase ${trafficPhase.name}: ${trafficPhase.achievedRequestsPerSecond.toFixed(2)} requests/s, p95 ${trafficPhase.request.latency.p95 ?? "n/a"} ms, SLO ${trafficPhase.slo.passed ? "passed" : "failed"}`,
    ),
    ...(report.capacity === null
      ? []
      : [
          `maximum sustainable capacity: ${report.capacity.maximumSustainableRequestsPerSecond === null ? "not reached" : `${report.capacity.maximumSustainableRequestsPerSecond} requests/s`}`,
          `first unsustainable capacity: ${report.capacity.firstUnsustainableRequestsPerSecond === null ? "not reached" : `${report.capacity.firstUnsustainableRequestsPerSecond} requests/s`}`,
        ]),
    ...(report.snapshotBenchmark === null
      ? []
      : [
          `snapshot history: ${report.snapshotBenchmark.historyEventsPerAccount} events/account`,
          `snapshot latency p99 without/with: ${report.snapshotBenchmark.withoutSnapshots.p99 ?? "n/a"}/${report.snapshotBenchmark.withSnapshots.p99 ?? "n/a"} ms`,
          `snapshot p99 improvement: ${report.snapshotBenchmark.latencyImprovementPercent.p99 === null ? "n/a" : `${report.snapshotBenchmark.latencyImprovementPercent.p99.toFixed(2)}%`}`,
        ]),
    `verified accounts/source/stored events: ${report.verification === null ? "n/a" : `${report.verification.accountCount}/${report.verification.eventCount}/${report.verification.storedEventCount}`}`,
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
  let trafficPhases: HttpTrafficPhaseReport[] = [];
  let replicaRequestAttempts = Array.from(
    { length: config.workerCount },
    () => 0,
  );
  let snapshotBenchmark: HttpSnapshotBenchmarkReport | null = null;
  let phaseDurations: HttpPhaseDurations = {
    setupMs: 0,
    seedingMs: 0,
    workerStartupMs: 0,
    snapshotBenchmarkMs: 0,
    httpRequestsMs: 0,
    verificationMs: 0,
  };
  let reportWritten = false;
  const schema = uniqueSchema();
  const startedAt = performance.now();
  const progress = new ProgressRenderer(config.verbose);
  try {
    progress.update("starting PostgreSQL container");
    const setupStartedAt = performance.now();
    let eventStore: EventStore;
    let seedSummary: SeedSummary;
    try {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      const connectionString = container.getConnectionUri();
      coordinatorPool = new Pool({
        connectionString,
        max: config.poolSize,
      });
      eventStore = new EventStore({ pool: coordinatorPool, schema });
      progress.update("creating schema");
      await eventStore.setup();
    } finally {
      phaseDurations.setupMs = performance.now() - setupStartedAt;
    }
    const seedStartedAt = performance.now();
    try {
      seedSummary = await seedAccounts({ eventStore, config, progress });
      await seedAccountSnapshots({ eventStore, config, seedSummary, progress });
    } finally {
      phaseDurations.seedingMs = performance.now() - seedStartedAt;
    }
    progress.update(`starting ${config.workerCount} HTTP workers`);
    const workerStartupStartedAt = performance.now();
    try {
      const connectionString = container!.getConnectionUri();
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
    } finally {
      phaseDurations.workerStartupMs =
        performance.now() - workerStartupStartedAt;
    }
    progress.update(
      `HTTP workers ready: ${ports.length}/${config.workerCount}`,
    );
    progress.update("benchmarking aggregate reads with and without snapshots");
    const snapshotBenchmarkStartedAt = performance.now();
    try {
      snapshotBenchmark = await runSnapshotBenchmark({
        config,
        ports,
        progress,
      });
    } finally {
      phaseDurations.snapshotBenchmarkMs =
        performance.now() - snapshotBenchmarkStartedAt;
    }
    const requestResult = await runHttpRequests({ config, ports, progress });
    phaseDurations.httpRequestsMs = requestResult.durationMs;
    metrics = requestResult.metrics;
    trafficPhases = requestResult.trafficPhases;
    replicaRequestAttempts = requestResult.replicaRequestAttempts;
    if (requestResult.metrics.request.failed > 0) {
      throw new Error(
        `${requestResult.metrics.request.failed} HTTP requests failed`,
      );
    }
    if (workers.some((worker) => !worker.isAlive())) {
      throw new Error("An HTTP worker exited during the request phase");
    }
    progress.update("verifying aggregate state");
    const verificationStartedAt = performance.now();
    let verification: HttpVerificationSummary;
    try {
      verification = await verifyAccounts({
        eventStore,
        config,
        seedSummary,
        successfulDeposits: requestResult.successfulDeposits,
        progress,
      });
    } finally {
      phaseDurations.verificationMs = performance.now() - verificationStartedAt;
    }
    const report = createReport({
      config,
      schema,
      startedAt,
      phaseDurations,
      metrics: requestResult.metrics,
      snapshotBenchmark,
      verification,
      workers: ports.map((port, workerId) => ({
        workerId,
        port,
        requestAttempts: replicaRequestAttempts[workerId] ?? 0,
      })),
      trafficPhases,
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
        phaseDurations,
        metrics,
        trafficPhases,
        snapshotBenchmark,
        verification: null,
        failure,
        workers: ports.map((port, workerId) => ({
          workerId,
          port,
          requestAttempts: replicaRequestAttempts[workerId] ?? 0,
        })),
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
  if (report.status === "failed") throw new Error(report.failure);
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
