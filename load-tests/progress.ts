import type { WorkerMetrics } from "./types";

const EMPTY_LINE_LENGTH = 0;

export interface ProgressOutput {
  write(value: string): boolean;
}

export class ProgressRenderer {
  private previousLineLength = EMPTY_LINE_LENGTH;

  constructor(
    private readonly enabled: boolean,
    private readonly output: ProgressOutput = process.stdout,
  ) {}

  update(message: string): void {
    if (!this.enabled) return;
    const padding = " ".repeat(
      Math.max(EMPTY_LINE_LENGTH, this.previousLineLength - message.length),
    );
    this.output.write(`\r${message}${padding}`);
    this.previousLineLength = message.length;
  }

  finish(): void {
    if (!this.enabled || this.previousLineLength === EMPTY_LINE_LENGTH) return;
    this.output.write("\n");
    this.previousLineLength = EMPTY_LINE_LENGTH;
  }
}

export function formatWorkerProgress({
  workers,
  totalOperations,
}: {
  workers: WorkerMetrics[];
  totalOperations: number;
}): string {
  const totals = workers.reduce(
    (result, worker) => {
      result.appendAttempted += worker.counters.append.attempted;
      result.appendSucceeded += worker.counters.append.succeeded;
      result.appendFailed += worker.counters.append.failed;
      result.loadAttempted += worker.counters.load.attempted;
      result.loadSucceeded += worker.counters.load.succeeded;
      result.loadFailed += worker.counters.load.failed;
      result.retries += worker.counters.append.retries;
      return result;
    },
    {
      appendAttempted: 0,
      appendSucceeded: 0,
      appendFailed: 0,
      loadAttempted: 0,
      loadSucceeded: 0,
      loadFailed: 0,
      retries: 0,
    },
  );
  const completed = totals.appendSucceeded + totals.loadSucceeded;
  const failures = totals.appendFailed + totals.loadFailed;
  return `live operations: ${completed}/${totalOperations} | append: ${totals.appendSucceeded}/${totals.appendAttempted} | load: ${totals.loadSucceeded}/${totals.loadAttempted} | retries: ${totals.retries} | failures: ${failures}`;
}
