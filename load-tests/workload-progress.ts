import { MetricsCollector } from "./metrics";
import type { WorkerMetrics } from "./types";

const PROGRESS_INTERVAL_MS = 500;

export interface WorkloadProgressReporter {
  initial(): Promise<void>;
  report(operationIndex: number): Promise<void>;
}

export function createProgressReporter({
  collector,
  operationCount,
  onProgress,
}: {
  collector: MetricsCollector;
  operationCount: number;
  onProgress?: (metrics: WorkerMetrics) => void | Promise<void>;
}): WorkloadProgressReporter {
  let lastProgressAt = performance.now();
  return {
    initial: async () => {
      await onProgress?.(collector.toMetrics());
    },
    report: async (operationIndex) => {
      const now = performance.now();
      const isLastOperation = operationIndex + 1 === operationCount;
      if (
        !onProgress ||
        (!isLastOperation && now - lastProgressAt < PROGRESS_INTERVAL_MS)
      ) {
        return;
      }
      await onProgress(collector.toMetrics());
      lastProgressAt = now;
    },
  };
}
