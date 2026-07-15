import type { HttpLoadProfile, HttpLoadTestConfig } from "./http-types";

export const DEFAULT_HTTP_LOAD_TEST_CONFIG: HttpLoadTestConfig = {
  profile: "custom",
  workerCount: 2,
  poolSize: 4,
  accountCount: 20,
  activeUserCount: 20,
  operationsPerUser: 5,
  hotAccountCount: 2,
  hotTrafficPercent: 75,
  historyEventsPerAccount: 20,
  seedBatchSize: 1_000,
  requestCount: 100,
  durationSeconds: 0,
  readPercent: 40,
  concurrency: 16,
  maxRetries: 8,
  capacityStartRequestsPerSecond: 100,
  capacityStepRequestsPerSecond: 100,
  capacityMaxRequestsPerSecond: 2_000,
  capacityStageSeconds: 30,
  enforceSlos: false,
  sloReadP95Ms: 250,
  sloDepositP95Ms: 500,
  sloErrorRatePercent: 0.1,
  snapshotBenchmarkRequests: 1_000,
  snapshotBenchmarkHistoryEventsPerAccount: 10_000,
  seed: 1,
  verbose: false,
};

const PROFILE_DEFAULTS: Record<HttpLoadProfile, HttpLoadTestConfig> = {
  custom: DEFAULT_HTTP_LOAD_TEST_CONFIG,
  daily: {
    ...DEFAULT_HTTP_LOAD_TEST_CONFIG,
    profile: "daily",
    workerCount: 3,
    poolSize: 10,
    accountCount: 100_000,
    activeUserCount: 100_000,
    operationsPerUser: 10,
    hotAccountCount: 0,
    hotTrafficPercent: 0,
    historyEventsPerAccount: 60,
    requestCount: 1_000_000,
    durationSeconds: 3_600,
    readPercent: 70,
    concurrency: 256,
    maxRetries: 20,
    enforceSlos: true,
    snapshotBenchmarkRequests: 0,
  },
  capacity: {
    ...DEFAULT_HTTP_LOAD_TEST_CONFIG,
    profile: "capacity",
    workerCount: 3,
    poolSize: 10,
    accountCount: 20_000,
    activeUserCount: 20_000,
    operationsPerUser: 32,
    hotAccountCount: 500,
    hotTrafficPercent: 10,
    historyEventsPerAccount: 60,
    requestCount: 630_000,
    durationSeconds: 600,
    readPercent: 70,
    concurrency: 1_024,
    maxRetries: 20,
    enforceSlos: true,
    snapshotBenchmarkRequests: 0,
  },
};

const CLI_ARGUMENT_START = 2;
const OUTPUT_OPTION = "output";
const PROFILE_OPTION = "profile";
const VERBOSE_OPTION = "verbose";
const ENFORCE_SLOS_OPTION = "enforce-slos";
const OPTION_PREFIX_LENGTH = 2;
const MAX_PERCENT = 100;
const MIN_INTEGER = 1;
const NON_NEGATIVE = 0;

type NumericConfigKey = Exclude<
  keyof HttpLoadTestConfig,
  "profile" | "outputPath" | "verbose" | "enforceSlos"
>;

interface NumericOption {
  key: NumericConfigKey;
  cliName: string;
  envName: string;
  minimum: number;
  maximum?: number;
  integer?: boolean;
}

const NUMERIC_OPTIONS: readonly NumericOption[] = [
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

function parseArguments(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--"))
      throw new Error(`Unknown argument: ${argument}`);
    const option = argument.slice(OPTION_PREFIX_LENGTH);
    const equalsIndex = option.indexOf("=");
    if (equalsIndex >= 0) {
      options.set(option.slice(0, equalsIndex), option.slice(equalsIndex + 1));
      continue;
    }
    if (option === VERBOSE_OPTION || option === ENFORCE_SLOS_OPTION) {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) options.set(option, "true");
      else {
        options.set(option, next);
        index++;
      }
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--"))
      throw new Error(`Missing value for --${option}`);
    options.set(option, next);
    index++;
  }
  return options;
}

function readNumber(
  options: Map<string, string>,
  env: NodeJS.ProcessEnv,
  definition: NumericOption,
  defaults: HttpLoadTestConfig,
): number {
  const value = options.get(definition.cliName) ?? env[definition.envName];
  if (value === undefined) return defaults[definition.key];
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    (definition.integer !== false && !Number.isInteger(parsed)) ||
    parsed < definition.minimum ||
    (definition.maximum !== undefined && parsed > definition.maximum)
  ) {
    const maximum =
      definition.maximum === undefined ? "" : ` and <= ${definition.maximum}`;
    throw new Error(
      `${definition.cliName} must be an integer >= ${definition.minimum}${maximum}`,
    );
  }
  return parsed;
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  option: string,
): boolean {
  if (value === undefined) return fallback;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error(`${option} must be a boolean`);
}

function readProfile(
  options: Map<string, string>,
  env: NodeJS.ProcessEnv,
): HttpLoadProfile {
  const profile = options.get(PROFILE_OPTION) ?? env.ALVYN_HTTP_LOAD_PROFILE;
  if (profile === undefined) return "custom";
  if (profile === "custom" || profile === "daily" || profile === "capacity")
    return profile;
  throw new Error("profile must be custom, daily, or capacity");
}

function hasNumericValue(
  options: Map<string, string>,
  env: NodeJS.ProcessEnv,
  key: NumericConfigKey,
): boolean {
  const definition = NUMERIC_OPTIONS.find((option) => option.key === key)!;
  return (
    options.has(definition.cliName) || env[definition.envName] !== undefined
  );
}

function capacityRequestCount(config: HttpLoadTestConfig): number {
  let count = 0;
  for (
    let rate = config.capacityStartRequestsPerSecond;
    rate <= config.capacityMaxRequestsPerSecond;
    rate += config.capacityStepRequestsPerSecond
  ) {
    count += rate * config.capacityStageSeconds;
  }
  return count;
}

export function parseHttpLoadTestConfig(
  args: string[] = process.argv.slice(CLI_ARGUMENT_START),
  env: NodeJS.ProcessEnv = process.env,
): HttpLoadTestConfig {
  const options = parseArguments(args);
  const profile = readProfile(options, env);
  const defaults = PROFILE_DEFAULTS[profile];
  const knownOptions = new Set([
    ...NUMERIC_OPTIONS.map((option) => option.cliName),
    OUTPUT_OPTION,
    PROFILE_OPTION,
    VERBOSE_OPTION,
    ENFORCE_SLOS_OPTION,
  ]);
  for (const option of options.keys()) {
    if (!knownOptions.has(option))
      throw new Error(`Unknown option --${option}`);
  }

  const numericConfig = {} as Record<NumericConfigKey, number>;
  for (const definition of NUMERIC_OPTIONS) {
    numericConfig[definition.key] = readNumber(
      options,
      env,
      definition,
      defaults,
    );
  }
  if (
    hasNumericValue(options, env, "accountCount") &&
    !hasNumericValue(options, env, "hotAccountCount")
  ) {
    numericConfig.hotAccountCount = Math.min(
      numericConfig.accountCount,
      Math.round(
        numericConfig.accountCount *
          (defaults.hotAccountCount / defaults.accountCount),
      ),
    );
  }
  if (profile === "capacity") {
    numericConfig.requestCount = capacityRequestCount({
      ...defaults,
      ...numericConfig,
    });
  } else if (!hasNumericValue(options, env, "requestCount")) {
    if (profile === "daily") {
      numericConfig.requestCount =
        numericConfig.activeUserCount * numericConfig.operationsPerUser;
    }
  }
  if (numericConfig.hotAccountCount > numericConfig.accountCount) {
    throw new Error("hot-accounts must not exceed accounts");
  }
  if (numericConfig.activeUserCount > numericConfig.accountCount) {
    throw new Error("accounts must be >= active-users");
  }
  if (
    numericConfig.capacityMaxRequestsPerSecond <
    numericConfig.capacityStartRequestsPerSecond
  ) {
    throw new Error("capacity-max-rps must be >= capacity-start-rps");
  }
  if (profile === "daily" && numericConfig.durationSeconds === 0) {
    throw new Error("duration-seconds must be > 0 for the daily profile");
  }
  const verbose = readBoolean(
    options.get(VERBOSE_OPTION) ?? env.ALVYN_HTTP_LOAD_VERBOSE,
    defaults.verbose,
    VERBOSE_OPTION,
  );
  const enforceSlos = readBoolean(
    options.get(ENFORCE_SLOS_OPTION) ?? env.ALVYN_HTTP_LOAD_ENFORCE_SLOS,
    defaults.enforceSlos,
    ENFORCE_SLOS_OPTION,
  );
  const outputPath = options.get(OUTPUT_OPTION) ?? env.ALVYN_HTTP_LOAD_OUTPUT;
  return {
    profile,
    ...numericConfig,
    verbose,
    enforceSlos,
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}
