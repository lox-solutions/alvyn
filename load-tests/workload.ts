import { OptimisticConcurrencyError } from "../src/errors";
import { EventStore } from "../src/event-store";
import { createLiveEvents } from "./create-live-events";
import { MetricsCollector } from "./metrics";
import type { LoadTestConfig, WorkloadOperation, WorkerMetrics } from "./types";
import { createProgressReporter } from "./workload-progress";

export const STREAM_PREFIX = "load-test-stream";
const PERCENTAGE_SCALE = 100;
const HOT_STREAM_SELECTION_PERCENT = 75;
const TOKEN_SEPARATOR = ":";
const SEED_OPERATION_MULTIPLIER = 31;
const WORKER_OPERATION_MULTIPLIER = 17;
const STREAM_OPERATION_MULTIPLIER = 13;

function createToken(parts: string[]): string {
  return parts.join(TOKEN_SEPARATOR);
}

function deterministicValue({
  seed,
  workerId,
  operationIndex,
}: {
  seed: number;
  workerId: number;
  operationIndex: number;
}): number {
  return Math.abs(
    seed * SEED_OPERATION_MULTIPLIER +
      workerId * WORKER_OPERATION_MULTIPLIER +
      operationIndex * STREAM_OPERATION_MULTIPLIER,
  );
}
function selectStreamIndex({
  config,
  value,
}: {
  config: LoadTestConfig;
  value: number;
}): number {
  const percentage = value % PERCENTAGE_SCALE;
  if (config.hotStreamCount > 0 && percentage < HOT_STREAM_SELECTION_PERCENT) {
    return value % config.hotStreamCount;
  }

  const coldStreamCount = config.streamCount - config.hotStreamCount;
  if (coldStreamCount === 0) return value % config.hotStreamCount;
  return config.hotStreamCount + (value % coldStreamCount);
}
export function getStreamId(streamIndex: number): string {
  return `${STREAM_PREFIX}-${streamIndex}`;
}
export function getStreamIds(config: LoadTestConfig): string[] {
  return Array.from({ length: config.streamCount }, (_, index) =>
    getStreamId(index),
  );
}

function createOperation({
  config,
  workerId,
  operationIndex,
}: {
  config: LoadTestConfig;
  workerId: number;
  operationIndex: number;
}): WorkloadOperation {
  const value = deterministicValue({
    seed: config.seed,
    workerId,
    operationIndex,
  });
  const append = value % PERCENTAGE_SCALE < config.appendPercent;
  const streamIndex = selectStreamIndex({ config, value });
  return {
    append,
    streamId: getStreamId(streamIndex),
    operationToken: createToken([
      "live",
      String(config.seed),
      String(workerId),
      String(operationIndex),
    ]),
  };
}

export function getExpectedWorkloadOperation({
  config,
  workerId,
  operationIndex,
}: {
  config: LoadTestConfig;
  workerId: number;
  operationIndex: number;
}): WorkloadOperation {
  return createOperation({ config, workerId, operationIndex });
}

async function appendLiveOperation({
  eventStore,
  config,
  workerId,
  operationIndex,
  operation,
  collector,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  workerId: number;
  operationIndex: number;
  operation: WorkloadOperation;
  collector: MetricsCollector;
}): Promise<void> {
  collector.recordAppendAttempt();
  const startedAt = performance.now();
  const events = createLiveEvents({
    config,
    workerId,
    operationIndex,
    operationToken: operation.operationToken,
  });

  try {
    const result = await eventStore.withRetry(async () => {
      const version = await eventStore.getStreamVersion(operation.streamId);
      const expectedVersion = version === 0 ? -1 : version;
      try {
        return await eventStore.append({
          streamId: operation.streamId,
          expectedVersion,
          events,
        });
      } catch (error) {
        if (error instanceof OptimisticConcurrencyError) {
          collector.recordAppendConflict();
        }
        throw error;
      }
    }, config.maxRetries);
    collector.recordAppendSuccess(
      performance.now() - startedAt,
      result.toVersion - result.fromVersion + 1,
    );
  } catch (error) {
    collector.recordAppendFailure(performance.now() - startedAt, error);
    throw error;
  }
}

async function loadOperation({
  eventStore,
  operation,
  collector,
}: {
  eventStore: EventStore;
  operation: WorkloadOperation;
  collector: MetricsCollector;
}): Promise<void> {
  collector.recordLoadAttempt();
  const startedAt = performance.now();
  try {
    const events = await eventStore.load(operation.streamId);
    collector.recordLoadSuccess(performance.now() - startedAt, events.length);
  } catch (error) {
    collector.recordLoadFailure(performance.now() - startedAt, error);
    throw error;
  }
}

export async function runWorkerWorkload({
  eventStore,
  config,
  workerId,
  onProgress,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  workerId: number;
  onProgress?: (metrics: WorkerMetrics) => void | Promise<void>;
}): Promise<WorkerMetrics> {
  const collector = new MetricsCollector(workerId);
  const progressReporter = createProgressReporter({
    collector,
    operationCount: config.operationsPerWorker,
    onProgress,
  });
  await progressReporter.initial();
  for (
    let operationIndex = 0;
    operationIndex < config.operationsPerWorker;
    operationIndex++
  ) {
    const operation = createOperation({ config, workerId, operationIndex });
    if (operation.append) {
      await appendLiveOperation({
        eventStore,
        config,
        workerId,
        operationIndex,
        operation,
        collector,
      });
    } else {
      await loadOperation({ eventStore, operation, collector });
    }
    await progressReporter.report(operationIndex);
  }
  return collector.toMetrics();
}
