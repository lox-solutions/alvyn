const OPTION_PREFIX_LENGTH = 2;
const VERBOSE_OPTION = "verbose";
const ENFORCE_SLOS_OPTION = "enforce-slos";

function parseArgument({
  args,
  index,
  options,
}: {
  args: string[];
  index: number;
  options: Map<string, string>;
}): number {
  const argument = args[index];
  if (argument === "--") return index;
  if (!argument?.startsWith("--"))
    throw new Error(`Unknown argument: ${argument}`);
  const option = argument.slice(OPTION_PREFIX_LENGTH);
  const equalsIndex = option.indexOf("=");
  if (equalsIndex >= 0) {
    options.set(option.slice(0, equalsIndex), option.slice(equalsIndex + 1));
    return index;
  }
  const next = args[index + 1];
  const isBooleanOption =
    option === VERBOSE_OPTION || option === ENFORCE_SLOS_OPTION;
  if (!next || next.startsWith("--")) {
    if (!isBooleanOption) throw new Error(`Missing value for --${option}`);
    options.set(option, "true");
    return index;
  }
  options.set(option, next);
  return index + 1;
}

export function parseHttpLoadTestArguments(
  args: string[],
): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    index = parseArgument({ args, index, options });
  }
  return options;
}
