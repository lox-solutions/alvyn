export interface HttpLoadTestConfig {
  workerCount: number;
  poolSize: number;
  accountCount: number;
  hotAccountCount: number;
  historyEventsPerAccount: number;
  seedBatchSize: number;
  requestCount: number;
  readPercent: number;
  concurrency: number;
  maxRetries: number;
  seed: number;
  verbose: boolean;
  outputPath?: string;
}

export interface HttpWorkerConfig extends HttpLoadTestConfig {
  connectionString: string;
  schema: string;
  workerId: number;
}

export type HttpOperationKind = "read" | "deposit";

export interface HttpOperationPlan {
  kind: HttpOperationKind;
  accountId: string;
  amount: number;
  operationToken: string;
}

export interface HttpWorkerCommand {
  type: "initialize" | "shutdown";
  config?: HttpWorkerConfig;
}

export interface SerializedHttpError {
  name: string;
  message: string;
  stack?: string;
}

export type HttpWorkerMessage =
  | { type: "ready"; workerId: number; port: number }
  | { type: "failed"; workerId: number; error: SerializedHttpError };

export interface HttpOperationCounters {
  attempted: number;
  succeeded: number;
  failed: number;
  conflicts: number;
  retries: number;
}

export interface HttpLatencyReport {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface HttpOperationReport extends HttpOperationCounters {
  latency: HttpLatencyReport;
}

export interface HttpVerificationSummary {
  accountCount: number;
  eventCount: number;
  expectedEventCount: number;
  seedEventCount: number;
  successfulDeposits: number;
  finalBalance: number;
}

export interface HttpLoadTestReport {
  status: "passed" | "failed";
  failure?: string;
  configuration: HttpLoadTestConfig;
  schema: string;
  connectionCount: number;
  durationMs: number;
  request: HttpOperationReport;
  read: HttpOperationReport;
  deposit: HttpOperationReport;
  throughput: { requestsPerSecond: number };
  errors: string[];
  verification: HttpVerificationSummary | null;
  workers: Array<{ workerId: number; port: number }>;
}
