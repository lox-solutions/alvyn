import type { HttpLoadTestConfig } from "./http-types";

export const DEFAULT_HTTP_LOAD_TEST_CONFIG: HttpLoadTestConfig = {
  workerCount: 2,
  poolSize: 4,
  accountCount: 20,
  hotAccountCount: 2,
  historyEventsPerAccount: 20,
  seedBatchSize: 1_000,
  requestCount: 100,
  readPercent: 40,
  concurrency: 16,
  maxRetries: 8,
  seed: 1,
  verbose: false,
};

const CLI_ARGUMENT_START = 2;
const OUTPUT_OPTION = "output";
const VERBOSE_OPTION = "verbose";
const OPTION_PREFIX_LENGTH = 2;
const MAX_PERCENT = 100;
const MIN_INTEGER = 1;
const NON_NEGATIVE = 0;

interface NumericOption {
  key: keyof Omit<HttpLoadTestConfig, "outputPath" | "verbose">;
  cliName: string;
  envName: string;
  minimum: number;
  maximum?: number;
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
    key: "hotAccountCount",
    cliName: "hot-accounts",
    envName: "ALVYN_HTTP_LOAD_HOT_ACCOUNTS",
    minimum: NON_NEGATIVE,
  },
  {
    key: "historyEventsPerAccount",
    cliName: "history",
    envName: "ALVYN_HTTP_LOAD_HISTORY",
    minimum: MIN_INTEGER,
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
    if (option === VERBOSE_OPTION) {
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
): number {
  const value = options.get(definition.cliName) ?? env[definition.envName];
  if (value === undefined) return DEFAULT_HTTP_LOAD_TEST_CONFIG[definition.key];
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
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

function readBoolean(value: string | undefined): boolean {
  if (value === undefined) return DEFAULT_HTTP_LOAD_TEST_CONFIG.verbose;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error("verbose must be a boolean");
}

export function parseHttpLoadTestConfig(
  args: string[] = process.argv.slice(CLI_ARGUMENT_START),
  env: NodeJS.ProcessEnv = process.env,
): HttpLoadTestConfig {
  const options = parseArguments(args);
  const knownOptions = new Set([
    ...NUMERIC_OPTIONS.map((option) => option.cliName),
    OUTPUT_OPTION,
    VERBOSE_OPTION,
  ]);
  for (const option of options.keys()) {
    if (!knownOptions.has(option))
      throw new Error(`Unknown option --${option}`);
  }

  const numericConfig = {} as Omit<
    HttpLoadTestConfig,
    "outputPath" | "verbose"
  >;
  for (const definition of NUMERIC_OPTIONS) {
    numericConfig[definition.key] = readNumber(options, env, definition);
  }
  if (numericConfig.hotAccountCount > numericConfig.accountCount) {
    throw new Error("hot-accounts must not exceed accounts");
  }
  const verbose = readBoolean(
    options.get(VERBOSE_OPTION) ?? env.ALVYN_HTTP_LOAD_VERBOSE,
  );
  const outputPath = options.get(OUTPUT_OPTION) ?? env.ALVYN_HTTP_LOAD_OUTPUT;
  return {
    ...numericConfig,
    verbose,
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}
