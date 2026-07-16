import type { LoadTestConfig } from "./types";
import {
  DEFAULT_CONFIG,
  MAX_PERCENTAGE,
  MINIMUM_POSITIVE,
  MIN_PERCENTAGE,
  NON_NEGATIVE,
} from "./config-defaults";

export interface NumericOption {
  key: keyof Omit<LoadTestConfig, "outputPath" | "verbose">;
  cliName: string;
  envName: string;
  defaultValue: number;
  minimum: number;
  maximum?: number;
}

export const NUMERIC_OPTIONS: readonly NumericOption[] = [
  {
    key: "workerCount",
    cliName: "workers",
    envName: "ALVYN_LOAD_WORKERS",
    defaultValue: DEFAULT_CONFIG.workerCount,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "poolSize",
    cliName: "pool-size",
    envName: "ALVYN_LOAD_POOL_SIZE",
    defaultValue: DEFAULT_CONFIG.poolSize,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "operationTimeoutMs",
    cliName: "operation-timeout-ms",
    envName: "ALVYN_LOAD_OPERATION_TIMEOUT_MS",
    defaultValue: DEFAULT_CONFIG.operationTimeoutMs,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "workerReadyTimeoutMs",
    cliName: "worker-ready-timeout-ms",
    envName: "ALVYN_LOAD_WORKER_READY_TIMEOUT_MS",
    defaultValue: DEFAULT_CONFIG.workerReadyTimeoutMs,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "runTimeoutMs",
    cliName: "run-timeout-ms",
    envName: "ALVYN_LOAD_RUN_TIMEOUT_MS",
    defaultValue: DEFAULT_CONFIG.runTimeoutMs,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "streamCount",
    cliName: "streams",
    envName: "ALVYN_LOAD_STREAMS",
    defaultValue: DEFAULT_CONFIG.streamCount,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "hotStreamCount",
    cliName: "hot-streams",
    envName: "ALVYN_LOAD_HOT_STREAMS",
    defaultValue: DEFAULT_CONFIG.hotStreamCount,
    minimum: NON_NEGATIVE,
  },
  {
    key: "historyEventsPerStream",
    cliName: "history",
    envName: "ALVYN_LOAD_HISTORY",
    defaultValue: DEFAULT_CONFIG.historyEventsPerStream,
    minimum: NON_NEGATIVE,
  },
  {
    key: "operationsPerWorker",
    cliName: "operations",
    envName: "ALVYN_LOAD_OPERATIONS",
    defaultValue: DEFAULT_CONFIG.operationsPerWorker,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "appendPercent",
    cliName: "append-percent",
    envName: "ALVYN_LOAD_APPEND_PERCENT",
    defaultValue: DEFAULT_CONFIG.appendPercent,
    minimum: MIN_PERCENTAGE,
    maximum: MAX_PERCENTAGE,
  },
  {
    key: "appendBatchSize",
    cliName: "batch-size",
    envName: "ALVYN_LOAD_BATCH_SIZE",
    defaultValue: DEFAULT_CONFIG.appendBatchSize,
    minimum: MINIMUM_POSITIVE,
  },
  {
    key: "maxRetries",
    cliName: "max-retries",
    envName: "ALVYN_LOAD_MAX_RETRIES",
    defaultValue: DEFAULT_CONFIG.maxRetries,
    minimum: NON_NEGATIVE,
  },
  {
    key: "seed",
    cliName: "seed",
    envName: "ALVYN_LOAD_SEED",
    defaultValue: DEFAULT_CONFIG.seed,
    minimum: NON_NEGATIVE,
  },
];
