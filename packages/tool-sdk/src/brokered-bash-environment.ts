import { createHash } from "node:crypto";
import path from "node:path";
import {
  BROKERED_BASH_ALL_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_NONE_ENVIRONMENT_POLICY_ID,
} from "@openerx/contracts";

export type BrokeredBashEnvironmentMode = "none" | "core" | "all";

export interface BrokeredBashEnvironmentPolicy {
  mode: BrokeredBashEnvironmentMode;
  include: string[];
  exclude: string[];
  set: Record<string, string>;
}

export interface BrokeredBashEnvironmentRuntime {
  runnerTempRoot: string;
  bashExecutable: string;
  pathEntries: string[];
  additional: Record<string, string>;
}

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ALWAYS_BLOCKED_NAMES = new Set([
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "PIP_INDEX_URL",
  "PIP_EXTRA_INDEX_URL",
  "PIP_TRUSTED_HOST",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);
const BLOCKED_NAME_PATTERNS = [
  /^PI_/u,
  /^(?:CODEX|OPENERX)_/u,
  /^GIT_(?:ASKPASS|CONFIG_COUNT|CONFIG_KEY_|CONFIG_VALUE_|CONFIG_PARAMETERS|CREDENTIAL|SSH_COMMAND)/u,
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|AUTH|CREDENTIALS?)(?:_|$)/u,
  /^(?:AWS|AZURE|GOOGLE|GCP|GCLOUD|GITHUB|GITLAB|OPENAI|ANTHROPIC|STRIPE|DATABASE)_/u,
  /^(?:ELECTRON|CHROME|CHROMIUM|FIREFOX).*(?:PROFILE|USER_DATA)/u,
];
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /(?:^|[^A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})/u,
  /(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*\S+/iu,
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/u,
];

export const BROKERED_BASH_CORE_ENVIRONMENT_POLICY: BrokeredBashEnvironmentPolicy = {
  mode: "core",
  include: [],
  exclude: [],
  set: {},
};

export function brokeredBashEnvironmentPolicyId(policy: BrokeredBashEnvironmentPolicy): string {
  switch (policy.mode) {
    case "none":
      return BROKERED_BASH_NONE_ENVIRONMENT_POLICY_ID;
    case "core":
      return BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID;
    case "all":
      return BROKERED_BASH_ALL_ENVIRONMENT_POLICY_ID;
  }
}

export function brokeredBashEnvironmentPolicyDigest(policy: BrokeredBashEnvironmentPolicy): string {
  assertBrokeredBashEnvironmentPolicy(policy);
  const canonical = JSON.stringify({
    mode: policy.mode,
    include: [...policy.include].sort(),
    exclude: [...policy.exclude].sort(),
    set: Object.fromEntries(
      Object.entries(policy.set).sort(([left], [right]) => left.localeCompare(right)),
    ),
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function freezeBrokeredBashEnvironmentPolicy(
  policy: BrokeredBashEnvironmentPolicy,
  hostEnvironment: NodeJS.ProcessEnv,
): BrokeredBashEnvironmentPolicy {
  assertBrokeredBashEnvironmentPolicy(policy);
  const excluded = new Set(policy.exclude);
  const inherited = Object.fromEntries(
    policy.include.flatMap((name) => {
      const value = hostEnvironment[name];
      return value !== undefined && !excluded.has(name) && !isSensitiveEnvironmentEntry(name, value)
        ? [[name, value]]
        : [];
    }),
  );
  return {
    mode: policy.mode,
    include: [],
    exclude: [...policy.exclude],
    set: { ...inherited, ...policy.set },
  };
}

export function assertBrokeredBashEnvironmentPolicy(policy: BrokeredBashEnvironmentPolicy): void {
  const names = [...policy.include, ...policy.exclude, ...Object.keys(policy.set)];
  if (names.length > 256 || names.some((name) => !ENVIRONMENT_NAME.test(name))) {
    throw new Error("BROKERED_BASH_ENVIRONMENT_POLICY_INVALID");
  }
  if (new Set(policy.include).size !== policy.include.length) {
    throw new Error("BROKERED_BASH_ENVIRONMENT_POLICY_INVALID");
  }
  if (new Set(policy.exclude).size !== policy.exclude.length) {
    throw new Error("BROKERED_BASH_ENVIRONMENT_POLICY_INVALID");
  }
  for (const [name, value] of Object.entries(policy.set)) {
    if (isSensitiveEnvironmentEntry(name, value) || value.includes("\0")) {
      throw new Error("BROKERED_BASH_ENVIRONMENT_SECRET_BLOCKED");
    }
  }
}

export function isSensitiveEnvironmentEntry(name: string, value: string): boolean {
  const normalized = name.toLocaleUpperCase();
  return (
    ALWAYS_BLOCKED_NAMES.has(name) ||
    ALWAYS_BLOCKED_NAMES.has(normalized) ||
    BLOCKED_NAME_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function coreEnvironment(runtime: BrokeredBashEnvironmentRuntime): NodeJS.ProcessEnv {
  const home = path.join(runtime.runnerTempRoot, "home");
  const temp = path.join(runtime.runnerTempRoot, "tmp");
  const config = path.join(runtime.runnerTempRoot, "config");
  const cache = path.join(runtime.runnerTempRoot, "cache");
  return {
    PATH: runtime.pathEntries.join(path.delimiter),
    HOME: home,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    SHELL: runtime.bashExecutable,
    TERM: "dumb",
    NO_COLOR: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NPM_CONFIG_CACHE: path.join(cache, "npm"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    PIP_CONFIG_FILE: "/dev/null",
    PIP_CACHE_DIR: path.join(cache, "pip"),
    OPENSSL_CONF: "/dev/null",
  };
}

export function resolveBrokeredBashEnvironment(input: {
  policy: BrokeredBashEnvironmentPolicy;
  hostEnvironment: NodeJS.ProcessEnv;
  runtime: BrokeredBashEnvironmentRuntime;
  allowAll: boolean;
}): NodeJS.ProcessEnv {
  assertBrokeredBashEnvironmentPolicy(input.policy);
  if (input.policy.mode === "all" && !input.allowAll) {
    throw new Error("BROKERED_BASH_ENVIRONMENT_ALL_DENIED");
  }
  const environment: NodeJS.ProcessEnv =
    input.policy.mode === "all" ? { ...input.hostEnvironment } : {};
  if (input.policy.mode === "core") Object.assign(environment, coreEnvironment(input.runtime));

  for (const name of input.policy.include) {
    const value = input.hostEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const name of input.policy.exclude) delete environment[name];
  Object.assign(environment, input.policy.set);

  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || isSensitiveEnvironmentEntry(name, value)) delete environment[name];
  }
  // Runner-owned values are added only after inherited values have passed the canary filter.
  Object.assign(environment, input.runtime.additional);
  return environment;
}

export function brokeredBashEnvironmentDigest(environment: NodeJS.ProcessEnv): string {
  const canonical = Object.entries(environment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name.length}:${name}${value.length}:${value}`)
    .join("");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}
