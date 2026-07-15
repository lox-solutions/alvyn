export type HttpLoadProfile = "custom" | "daily" | "capacity";

export interface HttpLoadTestConfig {
  profile: HttpLoadProfile;
  workerCount: number;
  poolSize: number;
  accountCount: number;
  activeUserCount: number;
  operationsPerUser: number;
  hotAccountCount: number;
  hotTrafficPercent: number;
  historyEventsPerAccount: number;
  seedBatchSize: number;
  requestCount: number;
  durationSeconds: number;
  readPercent: number;
  concurrency: number;
  maxRetries: number;
  capacityStartRequestsPerSecond: number;
  capacityStepRequestsPerSecond: number;
  capacityMaxRequestsPerSecond: number;
  capacityStageSeconds: number;
  enforceSlos: boolean;
  sloReadP95Ms: number;
  sloDepositP95Ms: number;
  sloErrorRatePercent: number;
  snapshotBenchmarkRequests: number;
  snapshotBenchmarkHistoryEventsPerAccount: number;
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
  userId: string;
  userOperationIndex: number;
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

export interface HttpSnapshotBenchmarkReport {
  requestCount: number;
  historyEventsPerAccount: number;
  withoutSnapshots: HttpLatencyReport;
  withSnapshots: HttpLatencyReport;
  latencyImprovementPercent: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  snapshotReplay: {
    count: number;
    totalEvents: number;
    averageEvents: number | null;
    maxEvents: number | null;
  };
}

export interface HttpOperationReport extends HttpOperationCounters {
  latency: HttpLatencyReport;
}

export interface HttpTrafficPhasePlan {
  name: string;
  requestOffset: number;
  requestCount: number;
  durationMs: number;
  targetRequestsPerSecond: number | null;
}

export interface HttpSloCheck {
  metric: "read_p95_ms" | "deposit_p95_ms" | "error_rate_percent";
  actual: number | null;
  threshold: number;
  passed: boolean;
}

export interface HttpSloReport {
  enforced: boolean;
  passed: boolean;
  checks: HttpSloCheck[];
}

export interface HttpTrafficPhaseReport {
  name: string;
  requestOffset: number;
  requestCount: number;
  targetRequestsPerSecond: number | null;
  durationMs: number;
  achievedRequestsPerSecond: number;
  request: HttpOperationReport;
  read: HttpOperationReport;
  deposit: HttpOperationReport;
  errors: string[];
  slo: HttpSloReport;
}

export interface HttpReplicaReport {
  workerId: number;
  port: number;
  requestAttempts: number;
}

export interface HttpVerificationSummary {
  accountCount: number;
  eventCount: number;
  storedEventCount: number;
  snapshotEventCount: number;
  expectedEventCount: number;
  seedEventCount: number;
  seedSnapshotEventCount: number;
  successfulDeposits: number;
  finalBalance: number;
}

export interface HttpPhaseDurations {
  setupMs: number;
  seedingMs: number;
  workerStartupMs: number;
  snapshotBenchmarkMs: number;
  httpRequestsMs: number;
  verificationMs: number;
}

export interface HttpLoadTestReport {
  status: "passed" | "failed";
  failure?: string;
  configuration: HttpLoadTestConfig;
  schema: string;
  workerConnectionCount: number;
  coordinatorConnectionCount: number;
  connectionCount: number;
  durationMs: number;
  phaseDurations: HttpPhaseDurations;
  request: HttpOperationReport;
  read: HttpOperationReport;
  deposit: HttpOperationReport;
  throughput: {
    requestsPerSecond: number;
    durationMs: number;
    successfulRequests: number;
  };
  trafficPhases: HttpTrafficPhaseReport[];
  slo: HttpSloReport;
  capacity: {
    maximumSustainableRequestsPerSecond: number | null;
    firstUnsustainableRequestsPerSecond: number | null;
  } | null;
  snapshotBenchmark: HttpSnapshotBenchmarkReport | null;
  errors: string[];
  verification: HttpVerificationSummary | null;
  workers: HttpReplicaReport[];
}
