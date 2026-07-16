import { EventStore } from "../src/event-store";
import { formatWorkerProgress, ProgressRenderer } from "./progress";
import { seedHistory, type SeedSummary } from "./seed-history";
import type {
  LoadTestConfig,
  VerificationSummary,
  WorkerMetrics,
} from "./types";
import { verify } from "./verify";

export async function seedLoadHistory({
  eventStore,
  config,
  progress,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  progress: ProgressRenderer;
}): Promise<SeedSummary> {
  const totalSeedEvents = config.streamCount * config.historyEventsPerStream;
  progress.update(`seeding history: 0/${totalSeedEvents}`);
  return seedHistory({
    eventStore,
    config,
    onProgress: ({ streamIndex, streamCount, eventCount, totalEventCount }) =>
      progress.update(
        `seeding history: ${eventCount}/${totalEventCount} (stream ${streamIndex + 1}/${streamCount})`,
      ),
  });
}

export async function runLoadWorkers({
  config,
  runWorkers,
  progress,
}: {
  config: LoadTestConfig;
  runWorkers: () => Promise<WorkerMetrics[]>;
  progress: ProgressRenderer;
}): Promise<WorkerMetrics[]> {
  progress.update(`starting ${config.workerCount} workers`);
  return runWorkers();
}

export async function verifyLoadRun({
  eventStore,
  config,
  streamIds,
  seedEventCount,
  workers,
  progress,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  streamIds: string[];
  seedEventCount: number;
  workers: WorkerMetrics[];
  progress: ProgressRenderer;
}): Promise<VerificationSummary> {
  progress.update(`verifying streams: 0/${streamIds.length}`);
  return verify({
    eventStore,
    config,
    streamIds,
    seedEventCount,
    workers,
    onProgress: ({ streamIndex, streamCount, eventCount, totalEventCount }) =>
      progress.update(
        `verifying streams: ${streamIndex + 1}/${streamCount} (${eventCount}/${totalEventCount} events)`,
      ),
  });
}

export function updateWorkerProgress({
  config,
  metrics,
  progress,
}: {
  config: LoadTestConfig;
  metrics: WorkerMetrics[];
  progress: ProgressRenderer;
}): void {
  progress.update(
    formatWorkerProgress({
      workers: metrics,
      totalOperations: config.workerCount * config.operationsPerWorker,
    }),
  );
}
