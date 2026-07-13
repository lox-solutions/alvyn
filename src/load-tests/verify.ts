import { EventStore } from "../event-store";
import { getStreamIds, STREAM_PREFIX } from "./workload";
import type {
  LoadTestConfig,
  OperationCounters,
  VerificationSummary,
  WorkerMetrics,
} from "./types";
import { verifyStream, type StreamVerificationProgress } from "./verify-stream";
import {
  expectedOperations,
  type ExpectedOperations,
} from "./expected-operations";

function assertEqual<T>({
  actual,
  expected,
  label,
}: {
  actual: T;
  expected: T;
  label: string;
}): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function aggregateCounters(
  workers: WorkerMetrics[],
  operation: "append" | "load",
): OperationCounters {
  return workers.reduce(
    (total, worker) => {
      const counters = worker.counters[operation];
      total.attempted += counters.attempted;
      total.succeeded += counters.succeeded;
      total.failed += counters.failed;
      total.conflicts += counters.conflicts;
      total.retries += counters.retries;
      total.eventCount += counters.eventCount;
      return total;
    },
    {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      conflicts: 0,
      retries: 0,
      eventCount: 0,
    },
  );
}

function validateWorkerMetrics({
  workers,
  config,
}: {
  workers: WorkerMetrics[];
  config: LoadTestConfig;
}): void {
  assertEqual({
    actual: workers.length,
    expected: config.workerCount,
    label: "worker count",
  });
  const workerIds = new Set<number>();
  for (const worker of workers) {
    if (worker.workerId < 0 || worker.workerId >= config.workerCount) {
      throw new Error(`Unexpected worker id ${worker.workerId}`);
    }
    if (workerIds.has(worker.workerId)) {
      throw new Error(`Duplicate worker metrics for worker ${worker.workerId}`);
    }
    workerIds.add(worker.workerId);
    if (worker.errors.length > 0) {
      throw new Error(
        `Worker ${worker.workerId} reported errors: ${worker.errors.join("; ")}`,
      );
    }
  }
}

function validateOperationCounters({
  workers,
  expected,
}: {
  workers: WorkerMetrics[];
  expected: ExpectedOperations;
}): void {
  const append = aggregateCounters(workers, "append");
  const load = aggregateCounters(workers, "load");
  assertEqual({
    actual: append.attempted,
    expected: expected.appendOperations,
    label: "append attempts",
  });
  assertEqual({
    actual: append.succeeded,
    expected: expected.appendOperations,
    label: "successful appends",
  });
  assertEqual({ actual: append.failed, expected: 0, label: "append failures" });
  assertEqual({
    actual: append.eventCount,
    expected: expected.liveEventCount,
    label: "appended event count",
  });
  assertEqual({
    actual: load.attempted,
    expected: expected.loadOperations,
    label: "load attempts",
  });
  assertEqual({
    actual: load.succeeded,
    expected: expected.loadOperations,
    label: "successful loads",
  });
  assertEqual({ actual: load.failed, expected: 0, label: "load failures" });
}

function validateCounters({
  workers,
  config,
  expected,
}: {
  workers: WorkerMetrics[];
  config: LoadTestConfig;
  expected: ExpectedOperations;
}): void {
  validateWorkerMetrics({ workers, config });
  validateOperationCounters({ workers, expected });
}

async function validateKnownStreams({
  eventStore,
  config,
  streamIds,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  streamIds: string[];
}): Promise<void> {
  const listedStreamIds = await eventStore.listStreams({
    prefix: STREAM_PREFIX,
    limit: config.streamCount + 1,
  });
  const knownStreamIds = new Set(streamIds);
  for (const streamId of listedStreamIds) {
    if (!knownStreamIds.has(streamId)) {
      throw new Error(`Unexpected load-test stream ${streamId}`);
    }
  }
}

async function verifyStreams({
  eventStore,
  config,
  streamIds,
  expected,
  onProgress,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  streamIds: string[];
  expected: ExpectedOperations;
  onProgress?: (
    progress: StreamVerificationProgress & {
      streamIndex: number;
      streamCount: number;
    },
  ) => void | Promise<void>;
}): Promise<{ eventCount: number; liveEventCount: number }> {
  const seenLiveEvents = new Set<string>();
  let eventCount = 0;
  for (const [streamIndex, streamId] of streamIds.entries()) {
    eventCount += await verifyStream({
      eventStore,
      config,
      streamId,
      streamIndex,
      expectedLiveEvents: expected.liveEvents,
      seenLiveEvents,
      onProgress: (progress) =>
        onProgress?.({
          ...progress,
          streamIndex,
          streamCount: streamIds.length,
        }),
    });
  }
  assertEqual({
    actual: seenLiveEvents.size,
    expected: expected.liveEventCount,
    label: "live event count",
  });
  return { eventCount, liveEventCount: seenLiveEvents.size };
}

export async function verify({
  eventStore,
  config,
  streamIds = getStreamIds(config),
  seedEventCount,
  workers,
  onProgress,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  streamIds?: string[];
  seedEventCount: number;
  workers: WorkerMetrics[];
  onProgress?: (
    progress: StreamVerificationProgress & {
      streamIndex: number;
      streamCount: number;
    },
  ) => void | Promise<void>;
}): Promise<VerificationSummary> {
  const expected = expectedOperations(config);
  validateCounters({ workers, config, expected });
  assertEqual({
    actual: seedEventCount,
    expected: config.streamCount * config.historyEventsPerStream,
    label: "seed event count",
  });

  await validateKnownStreams({ eventStore, config, streamIds });
  const { eventCount, liveEventCount } = await verifyStreams({
    eventStore,
    config,
    streamIds,
    expected,
    onProgress,
  });
  assertEqual({
    actual: eventCount,
    expected: seedEventCount + expected.liveEventCount,
    label: "verified event count",
  });

  return {
    streamCount: streamIds.length,
    eventCount,
    liveEventCount,
    expectedEventCount: seedEventCount + expected.liveEventCount,
    expectedLiveEventCount: expected.liveEventCount,
    expectedAppendOperations: expected.appendOperations,
    expectedLoadOperations: expected.loadOperations,
  };
}
