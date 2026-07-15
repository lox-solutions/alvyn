import type {
  HttpLatencyReport,
  HttpOperationCounters,
  HttpOperationKind,
  HttpOperationReport,
} from "./http-types";

const MAX_LATENCY_SAMPLES = 10_000;
const MAX_ERRORS = 100;

interface MutableCounters extends HttpOperationCounters {
  latencies: number[];
}

function createCounters(): MutableCounters {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    conflicts: 0,
    retries: 0,
    latencies: [],
  };
}

function percentile(sortedSamples: number[], fraction: number): number | null {
  if (sortedSamples.length === 0) return null;
  const index = Math.floor((sortedSamples.length - 1) * fraction);
  return sortedSamples[index] ?? null;
}

function latencyReport(samples: number[]): HttpLatencyReport {
  const sortedSamples = [...samples].sort((left, right) => left - right);
  return {
    count: sortedSamples.length,
    p50: percentile(sortedSamples, 0.5),
    p95: percentile(sortedSamples, 0.95),
    p99: percentile(sortedSamples, 0.99),
  };
}

function reportCounters(counters: MutableCounters): HttpOperationReport {
  return {
    attempted: counters.attempted,
    succeeded: counters.succeeded,
    failed: counters.failed,
    conflicts: counters.conflicts,
    retries: counters.retries,
    latency: latencyReport(counters.latencies),
  };
}

function addBoundedSample(
  samples: number[],
  sequence: number,
  value: number,
): void {
  if (samples.length < MAX_LATENCY_SAMPLES) {
    samples.push(value);
    return;
  }
  let hash = Math.imul(sequence + 1, 0x9e3779b1) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  const reservoirIndex = hash % (sequence + 1);
  if (reservoirIndex < MAX_LATENCY_SAMPLES) {
    samples[reservoirIndex] = value;
  }
}

export class HttpMetricsCollector {
  private readonly counters: Record<HttpOperationKind, MutableCounters> = {
    read: createCounters(),
    deposit: createCounters(),
  };

  private readonly overallLatencies: number[] = [];
  private readonly errors: string[] = [];

  record({
    kind,
    succeeded,
    latencyMs,
    conflicts,
    retries,
    error,
  }: {
    kind: HttpOperationKind;
    succeeded: boolean;
    latencyMs: number;
    conflicts: number;
    retries: number;
    error?: string;
  }): void {
    const counters = this.counters[kind];
    counters.attempted++;
    if (succeeded) counters.succeeded++;
    else counters.failed++;
    counters.conflicts += conflicts;
    counters.retries += retries;
    addBoundedSample(counters.latencies, counters.attempted - 1, latencyMs);
    addBoundedSample(
      this.overallLatencies,
      this.counters.read.attempted + this.counters.deposit.attempted - 1,
      latencyMs,
    );
    if (error && this.errors.length < MAX_ERRORS) this.errors.push(error);
  }

  report(): {
    request: HttpOperationReport;
    read: HttpOperationReport;
    deposit: HttpOperationReport;
    errors: string[];
  } {
    const read = reportCounters(this.counters.read);
    const deposit = reportCounters(this.counters.deposit);
    return {
      read,
      deposit,
      request: {
        attempted: read.attempted + deposit.attempted,
        succeeded: read.succeeded + deposit.succeeded,
        failed: read.failed + deposit.failed,
        conflicts: read.conflicts + deposit.conflicts,
        retries: read.retries + deposit.retries,
        latency: latencyReport(this.overallLatencies),
      },
      errors: [...this.errors],
    };
  }
}

export class HttpLatencyCollector {
  private readonly samples: number[] = [];
  private sequence = 0;

  record(latencyMs: number): void {
    addBoundedSample(this.samples, this.sequence, latencyMs);
    this.sequence++;
  }

  report(): HttpLatencyReport {
    return latencyReport(this.samples);
  }
}

export function latencyImprovementPercent(
  withoutSnapshots: number | null,
  withSnapshots: number | null,
): number | null {
  if (
    withoutSnapshots === null ||
    withSnapshots === null ||
    withoutSnapshots === 0
  )
    return null;
  return ((withoutSnapshots - withSnapshots) / withoutSnapshots) * 100;
}
