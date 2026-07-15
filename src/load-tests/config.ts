import type { LoadTestConfig } from "./types";

const OPTION_PREFIX_LENGTH = 2;
const CLI_ARGUMENT_START = 2;
const ARGUMENT_SEPARATOR = "--";
const NEXT_ARGUMENT_OFFSET = 1;
const NO_EQUALS_INDEX = -1;
const NON_NEGATIVE = 0;
const MINIMUM_POSITIVE = 1;
const MIN_PERCENTAGE = 0;
const MAX_PERCENTAGE = 100;
const DEFAULT_WORKER_COUNT = 2;
const DEFAULT_POOL_SIZE = 4;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_WORKER_READY_TIMEOUT_MS = 60_000;
const DEFAULT_RUN_TIMEOUT_MS = 7_200_000;
const DEFAULT_STREAM_COUNT = 20;
const DEFAULT_HOT_STREAM_COUNT = 2;
const DEFAULT_HISTORY_EVENTS = 100;
const DEFAULT_OPERATIONS_PER_WORKER = 50;
const DEFAULT_APPEND_PERCENT = 50;
const DEFAULT_APPEND_BATCH_SIZE = 1;
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_SEED = 1;
const OUTPUT_OPTION = "output";
const VERBOSE_OPTION = "verbose";
const VERBOSE_ENVIRONMENT_VARIABLE = "ALVYN_LOAD_VERBOSE";
const VERBOSE_TRUE = "true";
const VERBOSE_FALSE = "false";

export const DEFAULT_CONFIG: LoadTestConfig = {
  workerCount: DEFAULT_WORKER_COUNT,
  poolSize: DEFAULT_POOL_SIZE,
  operationTimeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
  workerReadyTimeoutMs: DEFAULT_WORKER_READY_TIMEOUT_MS,
  runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
  streamCount: DEFAULT_STREAM_COUNT,
  hotStreamCount: DEFAULT_HOT_STREAM_COUNT,
  historyEventsPerStream: DEFAULT_HISTORY_EVENTS,
  operationsPerWorker: DEFAULT_OPERATIONS_PER_WORKER,
  appendPercent: DEFAULT_APPEND_PERCENT,
  appendBatchSize: DEFAULT_APPEND_BATCH_SIZE,
  maxRetries: DEFAULT_MAX_RETRIES,
  seed: DEFAULT_SEED,
  verbose: false,
};

interface NumericOption {
  key: keyof Omit<LoadTestConfig, "outputPath" | "verbose">;
  cliName: string;
  envName: string;
  defaultValue: number;
  minimum: number;
  maximum?: number;
}

const NUMERIC_OPTIONS: readonly NumericOption[] = [
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

function parseArguments(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === ARGUMENT_SEPARATOR) continue;
    if (!argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const withoutPrefix = argument.slice(OPTION_PREFIX_LENGTH);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex !== NO_EQUALS_INDEX) {
      options.set(
        withoutPrefix.slice(NON_NEGATIVE, equalsIndex),
        withoutPrefix.slice(equalsIndex + NEXT_ARGUMENT_OFFSET),
      );
      continue;
    }

    if (withoutPrefix === VERBOSE_OPTION) {
      const next = args[index + NEXT_ARGUMENT_OFFSET];
      if (!next || next.startsWith("--")) {
        options.set(VERBOSE_OPTION, VERBOSE_TRUE);
        continue;
      }
      options.set(VERBOSE_OPTION, next);
      index += NEXT_ARGUMENT_OFFSET;
      continue;
    }

    const next = args[index + NEXT_ARGUMENT_OFFSET];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${withoutPrefix}`);
    }
    options.set(withoutPrefix, next);
    index += NEXT_ARGUMENT_OFFSET;
  }
  return options;
}

function validateOptions(options: Map<string, string>): void {
  const knownOptions = new Set([
    ...NUMERIC_OPTIONS.map((definition) => definition.cliName),
    OUTPUT_OPTION,
    VERBOSE_OPTION,
  ]);
  for (const option of options.keys()) {
    if (!knownOptions.has(option))
      throw new Error(`Unknown option --${option}`);
  }
}

function readOption({
  options,
  env,
  definition,
}: {
  options: Map<string, string>;
  env: NodeJS.ProcessEnv;
  definition: NumericOption;
}): string | undefined {
  return options.get(definition.cliName) ?? env[definition.envName];
}

function parseNumber(
  value: string | undefined,
  definition: NumericOption,
): number {
  if (value === undefined) return definition.defaultValue;
  const parsed = Number(value);
  const aboveMinimum = parsed >= definition.minimum;
  const belowMaximum =
    definition.maximum === undefined || parsed <= definition.maximum;
  if (!Number.isInteger(parsed) || !aboveMinimum || !belowMaximum) {
    const maximumMessage =
      definition.maximum === undefined ? "" : ` and <= ${definition.maximum}`;
    throw new Error(
      `${definition.cliName} must be an integer >= ${definition.minimum}${maximumMessage}`,
    );
  }
  return parsed;
}

function readNumericConfig(
  options: Map<string, string>,
  env: NodeJS.ProcessEnv,
): Omit<LoadTestConfig, "outputPath" | "verbose"> {
  const config = {} as Omit<LoadTestConfig, "outputPath" | "verbose">;
  for (const definition of NUMERIC_OPTIONS) {
    config[definition.key] = parseNumber(
      readOption({ options, env, definition }),
      definition,
    );
  }
  return config;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) return DEFAULT_CONFIG.verbose;
  if (value.toLowerCase() === VERBOSE_TRUE) return true;
  if (value.toLowerCase() === VERBOSE_FALSE) return false;
  throw new Error("verbose must be a boolean");
}

export function parseLoadTestConfig(
  args: string[] = process.argv.slice(CLI_ARGUMENT_START),
  env: NodeJS.ProcessEnv = process.env,
): LoadTestConfig {
  const options = parseArguments(args);
  validateOptions(options);
  const config = readNumericConfig(options, env);
  if (config.hotStreamCount > config.streamCount) {
    throw new Error("hot-streams must not exceed streams");
  }
  const outputPath = options.get(OUTPUT_OPTION) ?? env.ALVYN_LOAD_OUTPUT;
  const verbose = parseBoolean(
    options.get(VERBOSE_OPTION) ?? env[VERBOSE_ENVIRONMENT_VARIABLE],
  );
  return {
    ...config,
    verbose,
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}
