import {
  readJsonResponse,
  sendHttpOperation,
  validateSuccessfulResponse,
} from "./http-client";
import { HttpMetricsCollector } from "./http-metrics";
import { getHttpWorkerIndex, retryHttpRequest } from "./http-retry";
import type { HttpLoadTestConfig, HttpOperationPlan } from "./http-types";
import { getExpectedHttpOperation } from "./http-workload";

const HTTP_CONFLICT_STATUS = 409;

export interface SuccessfulDeposit {
  accountId: string;
  amount: number;
}

interface HttpResponseResult {
  response: Response;
  body: unknown;
}

interface RunHttpOperationOptions {
  operationIndex: number;
  ports: number[];
  config: HttpLoadTestConfig;
  phaseCollector: HttpMetricsCollector;
  collector: HttpMetricsCollector;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  replicaRequestAttempts: number[];
}

interface ExecuteHttpOperationOptions extends RunHttpOperationOptions {
  operation: HttpOperationPlan;
  startedAt: number;
}

function recordFailedOperation({
  operation,
  phaseCollector,
  collector,
  startedAt,
  conflicts,
  retries,
  error,
}: {
  operation: HttpOperationPlan;
  phaseCollector: HttpMetricsCollector;
  collector: HttpMetricsCollector;
  startedAt: number;
  conflicts: number;
  retries: number;
  error: string;
}): void {
  const record = {
    kind: operation.kind,
    succeeded: false,
    latencyMs: performance.now() - startedAt,
    conflicts,
    retries,
    error: `${operation.operationToken}: ${error}`,
  } as const;
  collector.record(record);
  phaseCollector.record(record);
}

async function sendHttpAttempt({
  operation,
  operationIndex,
  attempt,
  ports,
  config,
  replicaRequestAttempts,
}: {
  operation: HttpOperationPlan;
  operationIndex: number;
  attempt: number;
  ports: number[];
  config: HttpLoadTestConfig;
  replicaRequestAttempts: number[];
}): Promise<HttpResponseResult> {
  const workerIndex = getHttpWorkerIndex({
    operationIndex,
    attempt,
    workerCount: ports.length,
  });
  replicaRequestAttempts[workerIndex] =
    (replicaRequestAttempts[workerIndex] ?? 0) + 1;
  const response = await sendHttpOperation({
    port: ports[workerIndex] ?? 0,
    operation,
    timeoutMs: config.operationTimeoutMs,
  });
  return { response, body: await readJsonResponse(response) };
}

function recordSuccessfulOperation({
  operation,
  result,
  collector,
  phaseCollector,
  startedAt,
  conflicts,
  retries,
  successfulDeposits,
}: {
  operation: HttpOperationPlan;
  result: HttpResponseResult;
  collector: HttpMetricsCollector;
  phaseCollector: HttpMetricsCollector;
  startedAt: number;
  conflicts: number;
  retries: number;
  successfulDeposits: Map<string, SuccessfulDeposit>;
}): void {
  validateSuccessfulResponse({
    operation,
    response: result.response,
    body: result.body,
  });
  const record = {
    kind: operation.kind,
    succeeded: true,
    latencyMs: performance.now() - startedAt,
    conflicts,
    retries,
  } as const;
  collector.record(record);
  phaseCollector.record(record);
  if (operation.kind !== "deposit") return;
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

async function executeHttpOperation({
  operation,
  operationIndex,
  ports,
  config,
  phaseCollector,
  collector,
  successfulDeposits,
  replicaRequestAttempts,
  startedAt,
}: ExecuteHttpOperationOptions): Promise<{
  conflicts: number;
  retries: number;
}> {
  const result = await retryHttpRequest({
    operationIndex,
    maxRetries: config.maxRetries,
    send: (attempt) =>
      sendHttpAttempt({
        operation,
        operationIndex,
        attempt,
        ports,
        config,
        replicaRequestAttempts,
      }),
    isConflict: ({ response }) =>
      response.status === HTTP_CONFLICT_STATUS && operation.kind === "deposit",
  });
  recordSuccessfulOperation({
    operation,
    result: result.value,
    collector,
    phaseCollector,
    startedAt,
    conflicts: result.conflicts,
    retries: result.retries,
    successfulDeposits,
  });
  return { conflicts: result.conflicts, retries: result.retries };
}

export async function runHttpOperation(
  options: RunHttpOperationOptions,
): Promise<void> {
  const {
    operationIndex,
    ports,
    config,
    phaseCollector,
    collector,
    successfulDeposits,
    replicaRequestAttempts,
  } = options;
  const operation = getExpectedHttpOperation({ config, operationIndex });
  const startedAt = performance.now();
  let conflicts = 0;
  let retries = 0;
  try {
    const result = await executeHttpOperation({
      operation,
      operationIndex,
      ports,
      config,
      collector,
      phaseCollector,
      successfulDeposits,
      replicaRequestAttempts,
      startedAt,
    });
    conflicts = result.conflicts;
    retries = result.retries;
  } catch (error) {
    recordFailedOperation({
      operation,
      phaseCollector,
      collector,
      startedAt,
      conflicts,
      retries,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
