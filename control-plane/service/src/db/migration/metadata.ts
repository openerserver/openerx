export function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }

    const normalized = token.slice(2);
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex >= 0) {
      parsed[normalized.slice(0, equalsIndex)] = normalized.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[normalized] = next;
      index += 1;
      continue;
    }

    parsed[normalized] = true;
  }

  return parsed;
}

export function getStringArg(
  args: Record<string, string | boolean>,
  key: string,
  defaultValue?: string,
) {
  const value = args[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing required --${key} argument.`);
}

export function getBooleanArg(
  args: Record<string, string | boolean>,
  key: string,
  defaultValue = false,
) {
  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return !["0", "false", "no"].includes(value.toLowerCase());
  }

  return defaultValue;
}
