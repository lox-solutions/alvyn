import { PROFILE_DEFAULTS } from "./http-config-defaults";
import {
  NUMERIC_OPTIONS,
  type NumericConfigKey,
  type NumericOption,
} from "./http-config-options";
import { parseHttpLoadTestArguments } from "./parse-http-load-test-arguments";
import type { HttpLoadProfile, HttpLoadTestConfig } from "./http-types";

export { DEFAULT_HTTP_LOAD_TEST_CONFIG } from "./http-config-defaults";

const CLI_ARGUMENT_START = 2;
const OUTPUT_OPTION = "output";
const PROFILE_OPTION = "profile";
const VERBOSE_OPTION = "verbose";
const ENFORCE_SLOS_OPTION = "enforce-slos";

function readNumber({
  options,
  env,
  definition,
  defaults,
}: {
  options: Map<string, string>;
  env: NodeJS.ProcessEnv;
  definition: NumericOption;
  defaults: HttpLoadTestConfig;
}): number {
  const value = options.get(definition.cliName) ?? env[definition.envName];
  if (value === undefined) return defaults[definition.key];
  const parsed = Number(value);
  if (!isValidNumber(parsed, definition)) throwInvalidNumber(definition);
  return parsed;
}

function isValidNumber(value: number, definition: NumericOption): boolean {
  const isInteger = definition.integer ?? true;
  const hasValidRange =
    value >= definition.minimum &&
    (definition.maximum === undefined || value <= definition.maximum);
  return (
    Number.isFinite(value) &&
    (!isInteger || Number.isInteger(value)) &&
    hasValidRange
  );
}

function throwInvalidNumber(definition: NumericOption): never {
  const maximum =
    definition.maximum === undefined ? "" : ` and <= ${definition.maximum}`;
  throw new Error(
    `${definition.cliName} must be an integer >= ${definition.minimum}${maximum}`,
  );
}

function readBoolean({
  value,
  fallback,
  option,
}: {
  value: string | undefined;
  fallback: boolean;
  option: string;
}): boolean {
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

function hasNumericValue({
  options,
  env,
  key,
}: {
  options: Map<string, string>;
  env: NodeJS.ProcessEnv;
  key: NumericConfigKey;
}): boolean {
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

function validateOptions(options: Map<string, string>): void {
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
}

function readNumericConfig({
  options,
  env,
  defaults,
}: {
  options: Map<string, string>;
  env: NodeJS.ProcessEnv;
  defaults: HttpLoadTestConfig;
}): Record<NumericConfigKey, number> {
  const numericConfig = {} as Record<NumericConfigKey, number>;
  for (const definition of NUMERIC_OPTIONS) {
    numericConfig[definition.key] = readNumber({
      options,
      env,
      definition,
      defaults,
    });
  }
  return numericConfig;
}

function applyDerivedConfig({
  profile,
  options,
  env,
  defaults,
  numericConfig,
}: {
  profile: HttpLoadProfile;
  options: Map<string, string>;
  env: NodeJS.ProcessEnv;
  defaults: HttpLoadTestConfig;
  numericConfig: Record<NumericConfigKey, number>;
}): void {
  const accountCountProvided = hasNumericValue({
    options,
    env,
    key: "accountCount",
  });
  const hotAccountCountProvided = hasNumericValue({
    options,
    env,
    key: "hotAccountCount",
  });
  if (accountCountProvided && !hotAccountCountProvided) {
    numericConfig.hotAccountCount = Math.min(
      numericConfig.accountCount,
      Math.round(
        numericConfig.accountCount *
          (defaults.hotAccountCount / defaults.accountCount),
      ),
    );
  }
  const requestCountProvided = hasNumericValue({
    options,
    env,
    key: "requestCount",
  });
  if (profile === "capacity") {
    numericConfig.requestCount = capacityRequestCount({
      ...defaults,
      ...numericConfig,
    });
  } else if (profile === "daily" && !requestCountProvided) {
    numericConfig.requestCount =
      numericConfig.activeUserCount * numericConfig.operationsPerUser;
  }
}

function validateNumericConfig({
  profile,
  numericConfig,
}: {
  profile: HttpLoadProfile;
  numericConfig: Record<NumericConfigKey, number>;
}): void {
  if (numericConfig.hotAccountCount > numericConfig.accountCount)
    throw new Error("hot-accounts must not exceed accounts");
  if (numericConfig.activeUserCount > numericConfig.accountCount)
    throw new Error("accounts must be >= active-users");
  if (
    numericConfig.capacityMaxRequestsPerSecond <
    numericConfig.capacityStartRequestsPerSecond
  )
    throw new Error("capacity-max-rps must be >= capacity-start-rps");
  if (profile === "daily" && numericConfig.durationSeconds === 0)
    throw new Error("duration-seconds must be > 0 for the daily profile");
}

export function parseHttpLoadTestConfig(
  args: string[] = process.argv.slice(CLI_ARGUMENT_START),
  env: NodeJS.ProcessEnv = process.env,
): HttpLoadTestConfig {
  const options = parseHttpLoadTestArguments(args);
  const profile = readProfile(options, env);
  const defaults = PROFILE_DEFAULTS[profile];
  validateOptions(options);
  const numericConfig = readNumericConfig({ options, env, defaults });
  applyDerivedConfig({ profile, options, env, defaults, numericConfig });
  validateNumericConfig({ profile, numericConfig });
  const verbose = readBoolean({
    value: options.get(VERBOSE_OPTION) ?? env.ALVYN_HTTP_LOAD_VERBOSE,
    fallback: defaults.verbose,
    option: VERBOSE_OPTION,
  });
  const enforceSlos = readBoolean({
    value: options.get(ENFORCE_SLOS_OPTION) ?? env.ALVYN_HTTP_LOAD_ENFORCE_SLOS,
    fallback: defaults.enforceSlos,
    option: ENFORCE_SLOS_OPTION,
  });
  const outputPath = options.get(OUTPUT_OPTION) ?? env.ALVYN_HTTP_LOAD_OUTPUT;
  return {
    profile,
    ...numericConfig,
    verbose,
    enforceSlos,
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}
