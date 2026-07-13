import type {
  LatencyPercentiles,
  OperationCounters,
  OperationReport,
  ThroughputReport,
  WorkerMetrics,
} from "./types";
import { createEmptyWorkerMetrics } from "./types";

const MAX_LATENCY_SAMPLES = 2_000;
const PERCENTILE_MINIMUM = 0;
const PERCENTILE_MAXIMUM = 100;
const P50 = 50;
const P95 = 95;
const P99 = 99;
const MILLISECONDS_PER_SECOND = 1_000;

function addBoundedSample({
  samples,
  value,
  cursor,
}: {
  samples: number[];
  value: number;
  cursor: number;
}): number {
  if (samples.length < MAX_LATENCY_SAMPLES) {
    samples.push(value);
    return cursor + 1;
  }

  const replacementIndex = cursor % MAX_LATENCY_SAMPLES;
  samples[replacementIndex] = value;
  return cursor + 1;
}

function cloneCounters(counters: OperationCounters): OperationCounters {
  return { ...counters };
}

export function calculatePercentile({
  samples,
  percentile,
}: {
  samples: number[];
  percentile: number;
}): number | null {
  if (samples.length === 0) return null;
  if (percentile < PERCENTILE_MINIMUM || percentile > PERCENTILE_MAXIMUM) {
    throw new Error("percentile must be between 0 and 100");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((percentile / PERCENTILE_MAXIMUM) * sorted.length);
  return sorted[Math.max(rank - 1, PERCENTILE_MINIMUM)] ?? null;
}

function aggregateCounters({
  workers,
  operation,
}: {
  workers: WorkerMetrics[];
  operation: "append" | "load";
}): OperationCounters {
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

function collectSamples({
  workers,
  operation,
}: {
  workers: WorkerMetrics[];
  operation: "append" | "load" | "overall";
}): number[] {
  const samples: number[] = [];
  let cursor = 0;
  for (const worker of workers) {
    for (const value of worker.latencySamples[operation]) {
      cursor = addBoundedSample({ samples, value, cursor });
    }
  }
  return samples;
}

function createLatencyReport(samples: number[]): LatencyPercentiles {
  return {
    count: samples.length,
    p50: calculatePercentile({ samples, percentile: P50 }),
    p95: calculatePercentile({ samples, percentile: P95 }),
    p99: calculatePercentile({ samples, percentile: P99 }),
  };
}

function createOperationReport({
  counters,
  samples,
}: {
  counters: OperationCounters;
  samples: number[];
}): OperationReport {
  return { ...counters, latency: createLatencyReport(samples) };
}

function calculateRate({
  count,
  durationMs,
}: {
  count: number;
  durationMs: number;
}): number {
  const durationSeconds = durationMs / MILLISECONDS_PER_SECOND;
  return durationSeconds === 0 ? 0 : count / durationSeconds;
}

export function buildAggregateReport({
  workers,
  durationMs,
}: {
  workers: WorkerMetrics[];
  durationMs: number;
}): {
  append: OperationReport;
  load: OperationReport;
  overallLatency: LatencyPercentiles;
  throughput: ThroughputReport;
  errors: string[];
} {
  const appendCounters = aggregateCounters({ workers, operation: "append" });
  const loadCounters = aggregateCounters({ workers, operation: "load" });
  const appendSamples = collectSamples({ workers, operation: "append" });
  const loadSamples = collectSamples({ workers, operation: "load" });
  const overallSamples = collectSamples({ workers, operation: "overall" });
  return {
    append: createOperationReport({
      counters: appendCounters,
      samples: appendSamples,
    }),
    load: createOperationReport({
      counters: loadCounters,
      samples: loadSamples,
    }),
    overallLatency: createLatencyReport(overallSamples),
    throughput: {
      operationsPerSecond: calculateRate({
        count: appendCounters.succeeded + loadCounters.succeeded,
        durationMs,
      }),
      appendEventsPerSecond: calculateRate({
        count: appendCounters.eventCount,
        durationMs,
      }),
      loadEventsPerSecond: calculateRate({
        count: loadCounters.eventCount,
        durationMs,
      }),
    },
    errors: workers.flatMap((worker) => worker.errors),
  };
}

export class MetricsCollector {
  private readonly metrics: WorkerMetrics;
  private appendSampleCursor = 0;
  private loadSampleCursor = 0;
  private overallSampleCursor = 0;

  constructor(workerId: number) {
    this.metrics = createEmptyWorkerMetrics(workerId);
  }

  recordAppendAttempt(): void {
    this.metrics.counters.append.attempted++;
  }

  recordAppendConflict(): void {
    this.metrics.counters.append.conflicts++;
    this.metrics.counters.append.retries++;
  }

  recordAppendSuccess(durationMs: number, eventCount: number): void {
    this.metrics.counters.append.succeeded++;
    this.metrics.counters.append.eventCount += eventCount;
    this.appendSampleCursor = addBoundedSample({
      samples: this.metrics.latencySamples.append,
      value: durationMs,
      cursor: this.appendSampleCursor,
    });
    this.overallSampleCursor = addBoundedSample({
      samples: this.metrics.latencySamples.overall,
      value: durationMs,
      cursor: this.overallSampleCursor,
    });
  }

  recordAppendFailure(durationMs: number, error: unknown): void {
    this.metrics.counters.append.failed++;
    this.recordError(error);
    this.recordOverallLatency(durationMs);
  }

  recordLoadAttempt(): void {
    this.metrics.counters.load.attempted++;
  }

  recordLoadSuccess(durationMs: number, eventCount: number): void {
    this.metrics.counters.load.succeeded++;
    this.metrics.counters.load.eventCount += eventCount;
    this.loadSampleCursor = addBoundedSample({
      samples: this.metrics.latencySamples.load,
      value: durationMs,
      cursor: this.loadSampleCursor,
    });
    this.recordOverallLatency(durationMs);
  }

  recordLoadFailure(durationMs: number, error: unknown): void {
    this.metrics.counters.load.failed++;
    this.recordError(error);
    this.recordOverallLatency(durationMs);
  }

  toMetrics(): WorkerMetrics {
    return {
      workerId: this.metrics.workerId,
      counters: {
        append: cloneCounters(this.metrics.counters.append),
        load: cloneCounters(this.metrics.counters.load),
      },
      latencySamples: {
        append: [...this.metrics.latencySamples.append],
        load: [...this.metrics.latencySamples.load],
        overall: [...this.metrics.latencySamples.overall],
      },
      errors: [...this.metrics.errors],
    };
  }

  private recordOverallLatency(durationMs: number): void {
    this.overallSampleCursor = addBoundedSample({
      samples: this.metrics.latencySamples.overall,
      value: durationMs,
      cursor: this.overallSampleCursor,
    });
  }

  private recordError(error: unknown): void {
    this.metrics.errors.push(
      error instanceof Error ? error.message : String(error),
    );
  }
}
