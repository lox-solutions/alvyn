import type { HttpLoadTestConfig } from "./http-types";

const MAX_PERCENT = 100;
const MIN_INTEGER = 1;
const NON_NEGATIVE = 0;

export type NumericConfigKey = Exclude<
  keyof HttpLoadTestConfig,
  "profile" | "outputPath" | "verbose" | "enforceSlos"
>;

export interface NumericOption {
  key: NumericConfigKey;
  cliName: string;
  envName: string;
  minimum: number;
  maximum?: number;
  integer?: boolean;
}

export const NUMERIC_OPTIONS: readonly NumericOption[] = [
  {
    key: "workerCount",
    cliName: "workers",
    envName: "ALVYN_HTTP_LOAD_WORKERS",
    minimum: MIN_INTEGER,
  },
  {
    key: "poolSize",
    cliName: "pool-size",
    envName: "ALVYN_HTTP_LOAD_POOL_SIZE",
    minimum: MIN_INTEGER,
  },
  {
    key: "operationTimeoutMs",
    cliName: "operation-timeout-ms",
    envName: "ALVYN_HTTP_LOAD_OPERATION_TIMEOUT_MS",
    minimum: MIN_INTEGER,
  },
  {
    key: "workerReadyTimeoutMs",
    cliName: "worker-ready-timeout-ms",
    envName: "ALVYN_HTTP_LOAD_WORKER_READY_TIMEOUT_MS",
    minimum: MIN_INTEGER,
  },
  {
    key: "runTimeoutMs",
    cliName: "run-timeout-ms",
    envName: "ALVYN_HTTP_LOAD_RUN_TIMEOUT_MS",
    minimum: MIN_INTEGER,
  },
  {
    key: "accountCount",
    cliName: "accounts",
    envName: "ALVYN_HTTP_LOAD_ACCOUNTS",
    minimum: MIN_INTEGER,
  },
  {
    key: "activeUserCount",
    cliName: "active-users",
    envName: "ALVYN_HTTP_LOAD_ACTIVE_USERS",
    minimum: MIN_INTEGER,
  },
  {
    key: "operationsPerUser",
    cliName: "operations-per-user",
    envName: "ALVYN_HTTP_LOAD_OPERATIONS_PER_USER",
    minimum: MIN_INTEGER,
  },
  {
    key: "hotAccountCount",
    cliName: "hot-accounts",
    envName: "ALVYN_HTTP_LOAD_HOT_ACCOUNTS",
    minimum: NON_NEGATIVE,
  },
  {
    key: "hotTrafficPercent",
    cliName: "hot-traffic-percent",
    envName: "ALVYN_HTTP_LOAD_HOT_TRAFFIC_PERCENT",
    minimum: NON_NEGATIVE,
    maximum: MAX_PERCENT,
  },
  {
    key: "historyEventsPerAccount",
    cliName: "history",
    envName: "ALVYN_HTTP_LOAD_HISTORY",
    minimum: MIN_INTEGER,
  },
  {
    key: "durationSeconds",
    cliName: "duration-seconds",
    envName: "ALVYN_HTTP_LOAD_DURATION_SECONDS",
    minimum: NON_NEGATIVE,
  },
  {
    key: "seedBatchSize",
    cliName: "seed-batch-size",
    envName: "ALVYN_HTTP_LOAD_SEED_BATCH_SIZE",
    minimum: MIN_INTEGER,
  },
  {
    key: "requestCount",
    cliName: "requests",
    envName: "ALVYN_HTTP_LOAD_REQUESTS",
    minimum: MIN_INTEGER,
  },
  {
    key: "readPercent",
    cliName: "read-percent",
    envName: "ALVYN_HTTP_LOAD_READ_PERCENT",
    minimum: NON_NEGATIVE,
    maximum: MAX_PERCENT,
  },
  {
    key: "concurrency",
    cliName: "concurrency",
    envName: "ALVYN_HTTP_LOAD_CONCURRENCY",
    minimum: MIN_INTEGER,
  },
  {
    key: "maxRetries",
    cliName: "max-retries",
    envName: "ALVYN_HTTP_LOAD_MAX_RETRIES",
    minimum: NON_NEGATIVE,
  },
  {
    key: "capacityStartRequestsPerSecond",
    cliName: "capacity-start-rps",
    envName: "ALVYN_HTTP_LOAD_CAPACITY_START_RPS",
    minimum: MIN_INTEGER,
  },
  {
    key: "capacityStepRequestsPerSecond",
    cliName: "capacity-step-rps",
    envName: "ALVYN_HTTP_LOAD_CAPACITY_STEP_RPS",
    minimum: MIN_INTEGER,
  },
  {
    key: "capacityMaxRequestsPerSecond",
    cliName: "capacity-max-rps",
    envName: "ALVYN_HTTP_LOAD_CAPACITY_MAX_RPS",
    minimum: MIN_INTEGER,
  },
  {
    key: "capacityStageSeconds",
    cliName: "capacity-stage-seconds",
    envName: "ALVYN_HTTP_LOAD_CAPACITY_STAGE_SECONDS",
    minimum: MIN_INTEGER,
  },
  {
    key: "sloReadP95Ms",
    cliName: "slo-read-p95-ms",
    envName: "ALVYN_HTTP_LOAD_SLO_READ_P95_MS",
    minimum: NON_NEGATIVE,
  },
  {
    key: "sloDepositP95Ms",
    cliName: "slo-deposit-p95-ms",
    envName: "ALVYN_HTTP_LOAD_SLO_DEPOSIT_P95_MS",
    minimum: NON_NEGATIVE,
  },
  {
    key: "sloErrorRatePercent",
    cliName: "slo-error-rate-percent",
    envName: "ALVYN_HTTP_LOAD_SLO_ERROR_RATE_PERCENT",
    minimum: NON_NEGATIVE,
    maximum: MAX_PERCENT,
    integer: false,
  },
  {
    key: "snapshotBenchmarkRequests",
    cliName: "snapshot-benchmark-requests",
    envName: "ALVYN_HTTP_LOAD_SNAPSHOT_BENCHMARK_REQUESTS",
    minimum: NON_NEGATIVE,
  },
  {
    key: "snapshotBenchmarkHistoryEventsPerAccount",
    cliName: "snapshot-benchmark-history",
    envName: "ALVYN_HTTP_LOAD_SNAPSHOT_BENCHMARK_HISTORY",
    minimum: MIN_INTEGER,
  },
  {
    key: "seed",
    cliName: "seed",
    envName: "ALVYN_HTTP_LOAD_SEED",
    minimum: NON_NEGATIVE,
  },
];
