export interface LoadTestConfig {
  workerCount: number;
  poolSize: number;
  streamCount: number;
  hotStreamCount: number;
  historyEventsPerStream: number;
  operationsPerWorker: number;
  appendPercent: number;
  appendBatchSize: number;
  maxRetries: number;
  seed: number;
  verbose: boolean;
  outputPath?: string;
}

export interface WorkerConfig extends LoadTestConfig {
  connectionString: string;
  schema: string;
  workerId: number;
}

export interface WorkloadOperation {
  append: boolean;
  streamId: string;
  operationToken: string;
}

export interface OperationCounters {
  attempted: number;
  succeeded: number;
  failed: number;
  conflicts: number;
  retries: number;
  eventCount: number;
}

export interface WorkerCounters {
  append: OperationCounters;
  load: OperationCounters;
}

export interface LatencySamples {
  append: number[];
  load: number[];
  overall: number[];
}

export interface WorkerMetrics {
  workerId: number;
  counters: WorkerCounters;
  latencySamples: LatencySamples;
  errors: string[];
}

export interface LatencyPercentiles {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface OperationReport extends OperationCounters {
  latency: LatencyPercentiles;
}

export interface ThroughputReport {
  operationsPerSecond: number;
  appendEventsPerSecond: number;
  loadEventsPerSecond: number;
}

export interface VerificationSummary {
  streamCount: number;
  eventCount: number;
  liveEventCount: number;
  expectedEventCount: number;
  expectedLiveEventCount: number;
  expectedAppendOperations: number;
  expectedLoadOperations: number;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export type WorkerCommand =
  | { type: "initialize"; config: WorkerConfig }
  | { type: "start" }
  | { type: "shutdown" };

export type WorkerMessage =
  | { type: "ready"; workerId: number }
  | { type: "progress"; workerId: number; metrics: WorkerMetrics }
  | { type: "completed"; workerId: number; metrics: WorkerMetrics }
  | { type: "failed"; workerId: number; error: SerializedError };

export interface LoadTestReport {
  configuration: LoadTestConfig;
  schema: string;
  connectionCount: number;
  durationMs: number;
  append: OperationReport;
  load: OperationReport;
  overallLatency: LatencyPercentiles;
  throughput: ThroughputReport;
  errors: string[];
  verification: VerificationSummary;
  workers: WorkerMetrics[];
}

export function createEmptyWorkerMetrics(workerId: number): WorkerMetrics {
  return {
    workerId,
    counters: {
      append: createEmptyOperationCounters(),
      load: createEmptyOperationCounters(),
    },
    latencySamples: {
      append: [],
      load: [],
      overall: [],
    },
    errors: [],
  };
}

function createEmptyOperationCounters(): OperationCounters {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    conflicts: 0,
    retries: 0,
    eventCount: 0,
  };
}
