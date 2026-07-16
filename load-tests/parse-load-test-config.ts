import { DEFAULT_CONFIG, NON_NEGATIVE } from "./config-defaults";
import { NUMERIC_OPTIONS, type NumericOption } from "./config-options";
import type { LoadTestConfig } from "./types";

export { DEFAULT_CONFIG } from "./config-defaults";

const OPTION_PREFIX_LENGTH = 2;
const CLI_ARGUMENT_START = 2;
const ARGUMENT_SEPARATOR = "--";
const NEXT_ARGUMENT_OFFSET = 1;
const NO_EQUALS_INDEX = -1;
const OUTPUT_OPTION = "output";
const VERBOSE_OPTION = "verbose";
const VERBOSE_ENVIRONMENT_VARIABLE = "ALVYN_LOAD_VERBOSE";
const VERBOSE_TRUE = "true";
const VERBOSE_FALSE = "false";

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
