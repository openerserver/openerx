import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  BROKERED_BASH_ALL_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID,
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
  BROKERED_BASH_DENY_NETWORK_POLICY_ID,
  BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION,
  BROKERED_BASH_NONE_ENVIRONMENT_POLICY_ID,
} from "@openerx/contracts";
import {
  BrokeredBashControlledEgressProxy,
  type BrokeredBashNetworkPolicy,
  brokeredBashNetworkPolicyDigest,
} from "./brokered-bash-egress";
import {
  BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  type BrokeredBashEnvironmentPolicy,
  brokeredBashEnvironmentDigest,
  brokeredBashEnvironmentPolicyDigest,
  brokeredBashEnvironmentPolicyId,
  resolveBrokeredBashEnvironment,
} from "./brokered-bash-environment";
import { BrokeredBashOutputSanitizer, type OutputReplacement } from "./brokered-bash-output";
import {
  PLATFORM_SANDBOX_ENGINE_VERSION,
  type PlatformSandboxCapability,
  type PlatformSandboxDestructionStatus,
  type PlatformSandboxEngine,
  type PlatformSandboxExecutionRequest,
  type PlatformSandboxExecutionResult,
  type PlatformSandboxResourceLimits,
  type PlatformSandboxRoot,
} from "./platform-sandbox-engine";
import {
  captureWorkspaceWriteBaseline,
  collectWorkspaceWriteChanges,
} from "./workspace-change-tracker";

const MACOS_SANDBOX_BACKEND_ID = "macos_sandbox_exec";
const DEFAULT_SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
const DEFAULT_BASH_EXECUTABLE = "/bin/bash";
const MAX_PROFILE_BYTES = 65_536;
const TERMINATION_GRACE_MS = 500;
const FORCE_KILL_SETTLE_MS = 100;
const MAX_WORKSPACE_PREFLIGHT_ENTRIES = 250_000;

const DEFAULT_SYSTEM_READ_ROOTS = [
  "/System",
  "/usr/bin",
  "/usr/sbin",
  "/usr/lib",
  "/usr/libexec",
  "/usr/share",
  "/bin",
  "/sbin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/opt/homebrew/lib",
  "/opt/homebrew/Cellar",
  "/opt/homebrew/opt",
  "/opt/homebrew/share",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/local/lib",
  "/usr/local/Cellar",
  "/usr/local/opt",
  "/usr/local/share",
  "/Library/Developer",
  "/Library/Java",
  "/Applications/Xcode.app",
  "/etc/ssl",
  "/private/etc/ssl",
  "/private/var/db/dyld",
  "/private/var/select",
];

const SAFE_DEVICE_PATHS = ["/dev/null", "/dev/random", "/dev/urandom", "/dev/zero"];

interface CanonicalRoot extends PlatformSandboxRoot {
  rootPath: string;
  writable: boolean;
}

interface ActiveProcess {
  child: ChildProcessWithoutNullStreams;
  timedOut: boolean;
  cancelled: boolean;
  termination?: Promise<PlatformSandboxDestructionStatus>;
}

interface HardlinkObservation {
  linkCount: number;
  observedAliases: number;
  observedWritableAliases: number;
  observedReadOnlyAliases: number;
}

export interface MacOSSandboxEngineOptions {
  platform?: NodeJS.Platform;
  platformRelease?: string;
  sandboxExecutable?: string;
  bashExecutable?: string;
  systemReadRoots?: string[];
}

export interface MacOSSandboxProfileInput {
  roots: Array<{ rootPath: string; writable: boolean }>;
  runnerTempRoot: string;
  systemReadRoots: string[];
  egressProxyPort?: number;
}

class BoundedBuffer {
  readonly #chunks: Buffer[] = [];
  #bytes = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  append(chunk: Buffer): void {
    const remaining = this.limit - this.#bytes;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    this.#chunks.push(accepted);
    this.#bytes += accepted.byteLength;
    if (accepted.byteLength !== chunk.byteLength) this.truncated = true;
  }

  text(): string {
    return Buffer.concat(this.#chunks, this.#bytes).toString("utf8");
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function seatbeltString(value: string): string {
  if (hasControlCharacters(value)) throw new Error("BROKERED_BASH_SANDBOX_PATH_INVALID");
  return JSON.stringify(value);
}

function literal(value: string): string {
  return `(literal ${seatbeltString(value)})`;
}

function literalAndSubpath(value: string): string {
  return `${literal(value)} (subpath ${seatbeltString(value)})`;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ancestorPaths(value: string): string[] {
  const result: string[] = [];
  let current = path.dirname(value);
  const filesystemRoot = path.parse(value).root;
  while (current !== filesystemRoot) {
    result.push(current);
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function existingCanonicalRoots(values: string[]): string[] {
  return unique(
    values.flatMap((value) => {
      try {
        return lstatSync(realpathSync(value)).isDirectory()
          ? [path.resolve(value), realpathSync(value)]
          : [];
      } catch {
        return [];
      }
    }),
  );
}

export function compileMacOSSandboxProfile(input: MacOSSandboxProfileInput): string {
  const readRoots = unique([
    ...input.systemReadRoots,
    ...input.roots.map(({ rootPath }) => rootPath),
    input.runnerTempRoot,
  ]);
  const writableRoots = unique([
    input.runnerTempRoot,
    ...input.roots.filter(({ writable }) => writable).map(({ rootPath }) => rootPath),
  ]);
  const readOnlyRoots = unique(
    input.roots.filter(({ writable }) => !writable).map(({ rootPath }) => rootPath),
  );
  const metadataAncestors = unique(readRoots.flatMap(ancestorPaths));
  const gitMetadataFilters = writableRoots
    .filter((root) => root !== input.runnerTempRoot)
    .map(
      (root) =>
        `(regex (string-append "^" (regex-quote ${seatbeltString(root)}) #"/(.*/)?\\.git(/|$)"))`,
    );
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self) (target children))",
    "(allow process-info* (target self) (target children))",
    "(allow sysctl-read)",
    `(allow file-read-metadata ${literal("/")} ${metadataAncestors.map(literal).join(" ")})`,
    `(allow file-read-data ${literal("/")})`,
    `(allow file-read* ${readRoots.map(literalAndSubpath).join(" ")} ${SAFE_DEVICE_PATHS.map(literal).join(" ")})`,
    `(allow file-write* ${writableRoots.map(literalAndSubpath).join(" ")})`,
    `(allow file-write-data ${literal("/dev/null")})`,
    ...(readOnlyRoots.length > 0
      ? [`(deny file-write* ${readOnlyRoots.map(literalAndSubpath).join(" ")})`]
      : []),
    ...(gitMetadataFilters.length > 0
      ? [`(deny file-write* ${gitMetadataFilters.join(" ")})`]
      : []),
    "(deny file-link file-clone)",
    "(deny network*)",
    ...(input.egressProxyPort
      ? [`(allow network-outbound (remote tcp "localhost:${input.egressProxyPort}"))`]
      : []),
  ].join("\n");
  if (Buffer.byteLength(profile, "utf8") > MAX_PROFILE_BYTES) {
    throw new Error("BROKERED_BASH_SANDBOX_PROFILE_TOO_LARGE");
  }
  return profile;
}

function assertResourceLimits(limits: PlatformSandboxResourceLimits): void {
  const values = [
    limits.maxOutputBytes,
    limits.maxProcesses,
    limits.maxOpenFiles,
    limits.maxFileBlocks,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("BROKERED_BASH_RESOURCE_LIMIT_INVALID");
  }
  if (
    limits.maxOutputBytes > 10_000_000 ||
    limits.maxProcesses > 1_024 ||
    limits.maxOpenFiles > 8_192 ||
    limits.maxFileBlocks > 8_388_608
  ) {
    throw new Error("BROKERED_BASH_RESOURCE_LIMIT_INVALID");
  }
}

function absoluteUserProcessLimit(maxAdditionalProcesses: number): number {
  const userId = process.getuid?.();
  if (userId === undefined) throw new Error("BROKERED_BASH_PROCESS_LIMIT_PROBE_FAILED");
  const processList = spawnSync("/bin/ps", ["-U", String(userId), "-o", "pid="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const hardLimit = spawnSync(
    DEFAULT_BASH_EXECUTABLE,
    ["--noprofile", "--norc", "-c", "ulimit -H -u"],
    { encoding: "utf8", timeout: 5_000 },
  );
  const currentCount = processList.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
  const hardLimitValue = Number(hardLimit.stdout.trim());
  if (
    processList.status !== 0 ||
    hardLimit.status !== 0 ||
    currentCount <= 0 ||
    !Number.isSafeInteger(hardLimitValue) ||
    hardLimitValue <= currentCount
  ) {
    throw new Error("BROKERED_BASH_PROCESS_LIMIT_PROBE_FAILED");
  }
  const requested = currentCount + maxAdditionalProcesses + 32;
  if (requested >= hardLimitValue) {
    throw new Error("BROKERED_BASH_PROCESS_LIMIT_UNAVAILABLE");
  }
  return requested;
}

function canonicalRoot(
  root: PlatformSandboxRoot,
  executionProfile: PlatformSandboxExecutionRequest["executionProfile"],
): CanonicalRoot {
  if (hasControlCharacters(root.rootPath)) {
    throw new Error("BROKERED_BASH_SANDBOX_PATH_INVALID");
  }
  let canonical: string;
  try {
    canonical = realpathSync(root.rootPath);
    if (!lstatSync(canonical).isDirectory()) throw new Error("not-directory");
  } catch {
    throw new Error("BROKERED_BASH_WORKSPACE_ROOT_INVALID");
  }
  if (canonical === path.parse(canonical).root || canonical === realpathSync(homedir())) {
    throw new Error("BROKERED_BASH_BROAD_WORKSPACE_DENIED");
  }
  if (canonical.split(path.sep).includes(".git")) {
    throw new Error("BROKERED_BASH_PROTECTED_WORKSPACE_DENIED");
  }
  return {
    ...root,
    rootPath: canonical,
    writable: executionProfile === "workspace_write" && root.access === "read_write",
  };
}

function canonicalRoots(request: PlatformSandboxExecutionRequest): {
  active: CanonicalRoot;
  additional: CanonicalRoot[];
} {
  const active = canonicalRoot(request.activeRoot, request.executionProfile);
  const additional = request.additionalRoots.map((root) =>
    canonicalRoot(root, request.executionProfile),
  );
  const roots = [active, ...additional];
  for (let left = 0; left < roots.length; left += 1) {
    const leftRoot = roots[left];
    if (!leftRoot) continue;
    for (let right = left + 1; right < roots.length; right += 1) {
      const rightRoot = roots[right];
      if (!rightRoot) continue;
      if (
        inside(leftRoot.rootPath, rightRoot.rootPath) ||
        inside(rightRoot.rootPath, leftRoot.rootPath)
      ) {
        throw new Error("BROKERED_BASH_WORKSPACE_ROOT_OVERLAP");
      }
    }
  }
  return { active, additional };
}

function createWorkingCopy(sourceRoot: string, destinationRoot: string): string {
  mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  const copied = spawnSync("/bin/cp", ["-cRp", `${sourceRoot}/.`, destinationRoot], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1_000_000,
    env: { PATH: "/usr/bin:/bin" },
  });
  if (copied.error || copied.status !== 0) throw new Error("BROKERED_BASH_WORKING_COPY_FAILED");
  return realpathSync(destinationRoot);
}

function excludedWorkingCopyPath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return (
    segments.includes("node_modules") ||
    segments.includes("__pycache__") ||
    segments.includes(".pytest_cache") ||
    segments.includes(".mypy_cache") ||
    segments.includes(".pnpm-store") ||
    segments.includes(".gradle") ||
    (segments.includes(".next") && segments.includes("cache")) ||
    (segments.includes(".yarn") && segments.includes("cache"))
  );
}

function assertSafeHardlinkBoundary(roots: CanonicalRoot[]): void {
  const pending = roots.map(({ rootPath, writable }) => ({
    directory: rootPath,
    writable,
  }));
  const observations = new Map<string, HardlinkObservation>();
  let visitedEntries = 0;
  try {
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      const { directory, writable } = current;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        visitedEntries += 1;
        if (visitedEntries > MAX_WORKSPACE_PREFLIGHT_ENTRIES) {
          throw new Error("BROKERED_BASH_WORKSPACE_PREFLIGHT_LIMIT");
        }
        const entryPath = path.join(directory, entry.name);
        const stats = lstatSync(entryPath);
        if (stats.isSymbolicLink()) continue;
        const entryWritable = writable && entry.name !== ".git";
        if (stats.isDirectory()) {
          pending.push({ directory: entryPath, writable: entryWritable });
          continue;
        }
        if (!stats.isFile() || stats.nlink <= 1) continue;
        const inodeKey = `${stats.dev}:${stats.ino}`;
        const observation = observations.get(inodeKey) ?? {
          linkCount: stats.nlink,
          observedAliases: 0,
          observedWritableAliases: 0,
          observedReadOnlyAliases: 0,
        };
        observation.linkCount = Math.max(observation.linkCount, stats.nlink);
        observation.observedAliases += 1;
        if (entryWritable) observation.observedWritableAliases += 1;
        else observation.observedReadOnlyAliases += 1;
        observations.set(inodeKey, observation);
      }
    }
    if (
      [...observations.values()].some(
        ({ linkCount, observedAliases, observedWritableAliases, observedReadOnlyAliases }) =>
          observedAliases < linkCount ||
          (observedWritableAliases > 0 && observedReadOnlyAliases > 0),
      )
    ) {
      throw new Error("BROKERED_BASH_HARDLINK_BOUNDARY_UNSAFE");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BROKERED_BASH_")) throw error;
    throw new Error("BROKERED_BASH_WORKSPACE_PREFLIGHT_FAILED");
  }
}

function makeRunnerEnvironment(
  runnerTempRoot: string,
  roots: CanonicalRoot[] = [],
  bashExecutable = DEFAULT_BASH_EXECUTABLE,
  policy: BrokeredBashEnvironmentPolicy = BROKERED_BASH_CORE_ENVIRONMENT_POLICY,
  runnerEnvironment: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const home = path.join(runnerTempRoot, "home");
  const temp = path.join(runnerTempRoot, "tmp");
  const config = path.join(runnerTempRoot, "config");
  const cache = path.join(runnerTempRoot, "cache");
  const logicalRoots = path.join(runnerTempRoot, "workspaces");
  for (const directory of [
    home,
    temp,
    config,
    cache,
    logicalRoots,
    path.join(cache, "npm"),
    path.join(cache, "pip"),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const additionalRootEnvironment = Object.fromEntries(
    roots.slice(1).map((root, index) => {
      const logicalPath = path.join(logicalRoots, `additional-${index + 1}`);
      symlinkSync(root.rootPath, logicalPath);
      return [`OPENERX_WORKSPACE_${index + 1}`, logicalPath];
    }),
  );
  const pathEntries = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter(existsSync);
  return resolveBrokeredBashEnvironment({
    policy,
    hostEnvironment: process.env,
    runtime: {
      runnerTempRoot,
      bashExecutable,
      pathEntries,
      additional: {
        OPENERX_RUNNER: "brokered-bash",
        OPENERX_WORKSPACE: ".",
        ...additionalRootEnvironment,
        ...runnerEnvironment,
      },
    },
    // The current contract has no danger_full_access profile. Keep `all` implemented but
    // unreachable until that separately reviewed profile exists.
    allowAll: false,
  });
}

function outputReplacements(roots: CanonicalRoot[], runnerTempRoot: string): OutputReplacement[] {
  return [
    ...roots.map(
      (root, index) =>
        ({
          target: root.rootPath,
          replacement: index === 0 ? "<workspace>" : `<workspace:${index}>`,
        }) as const,
    ),
    { target: runnerTempRoot, replacement: "<runner-temp>" },
    { target: homedir(), replacement: "<host-home>" },
  ];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function terminateProcessGroup(
  child: ChildProcessWithoutNullStreams,
): Promise<PlatformSandboxDestructionStatus> {
  const pid = child.pid;
  if (!pid) return "uncertain";
  if (!processGroupAlive(pid)) return "clean";
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await wait(TERMINATION_GRACE_MS);
  if (!processGroupAlive(pid)) return "terminated";
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await wait(FORCE_KILL_SETTLE_MS);
  return processGroupAlive(pid) ? "uncertain" : "killed";
}

function emptyCapabilities(): PlatformSandboxCapability["capabilities"] {
  return {
    filesystemBoundary: false,
    hardlinkBoundary: false,
    readOnlyRoots: false,
    writableRoots: false,
    networkDeny: false,
    sanitizedEnvironment: false,
    processGroupCleanup: false,
    descendantSandboxInheritance: false,
    pty: false,
  };
}

export class MacOSSandboxExecEngine implements PlatformSandboxEngine {
  readonly engineVersion = PLATFORM_SANDBOX_ENGINE_VERSION;
  readonly backendId = MACOS_SANDBOX_BACKEND_ID;
  readonly policyVersion = BROKERED_BASH_MACOS_SANDBOX_POLICY_VERSION;
  readonly #platform: NodeJS.Platform;
  readonly #platformRelease: string;
  readonly #sandboxExecutable: string;
  readonly #bashExecutable: string;
  readonly #systemReadRoots: string[];
  readonly #active = new Map<string, ActiveProcess>();
  #probePromise?: Promise<PlatformSandboxCapability>;

  constructor(options: MacOSSandboxEngineOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#platformRelease = options.platformRelease ?? release();
    this.#sandboxExecutable = options.sandboxExecutable ?? DEFAULT_SANDBOX_EXECUTABLE;
    this.#bashExecutable = options.bashExecutable ?? DEFAULT_BASH_EXECUTABLE;
    this.#systemReadRoots = existingCanonicalRoots(
      options.systemReadRoots ?? DEFAULT_SYSTEM_READ_ROOTS,
    );
  }

  probe(): Promise<PlatformSandboxCapability> {
    this.#probePromise ??= this.#probe();
    return this.#probePromise;
  }

  async execute(request: PlatformSandboxExecutionRequest): Promise<PlatformSandboxExecutionResult> {
    const capability = await this.probe();
    if (!capability.available) {
      throw new Error(capability.reason ?? "BROKERED_BASH_RUNNER_UNAVAILABLE");
    }
    const environmentPolicy = request.environmentPolicy ?? BROKERED_BASH_CORE_ENVIRONMENT_POLICY;
    const networkPolicy: BrokeredBashNetworkPolicy = request.networkPolicy ?? {
      mode: "deny",
    };
    const expectedNetworkPolicyId =
      networkPolicy.mode === "deny"
        ? BROKERED_BASH_DENY_NETWORK_POLICY_ID
        : BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID;
    if (
      request.environmentPolicyId !== brokeredBashEnvironmentPolicyId(environmentPolicy) ||
      request.environmentPolicyDigest !== brokeredBashEnvironmentPolicyDigest(environmentPolicy) ||
      request.networkPolicyId !== expectedNetworkPolicyId ||
      request.networkPolicyDigest !== brokeredBashNetworkPolicyDigest(networkPolicy)
    ) {
      throw new Error("BROKERED_BASH_POLICY_MISMATCH");
    }
    if (request.signal.aborted) throw new Error("BROKERED_BASH_CANCELLED");
    if (this.#active.has(request.identity.toolCallId)) {
      throw new Error("BROKERED_BASH_TOOL_CALL_ALREADY_RUNNING");
    }
    assertResourceLimits(request.resourceLimits);
    const { active, additional } = canonicalRoots(request);
    if (request.executionProfile === "workspace_write" && !active.writable) {
      throw new Error("BROKERED_BASH_EXECUTION_PROFILE_MISMATCH");
    }
    if (
      (request.executionProfile === "read_only" && request.workspaceWriteMode !== "none") ||
      (request.executionProfile === "workspace_write" && request.workspaceWriteMode === "none")
    ) {
      throw new Error("BROKERED_BASH_EXECUTION_PROFILE_MISMATCH");
    }
    const roots = [active, ...additional];
    assertSafeHardlinkBoundary(roots);
    const runnerTempRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "openerx-pbash-runner-")));
    const egressProxy =
      networkPolicy.mode === "controlled_egress"
        ? new BrokeredBashControlledEgressProxy(networkPolicy)
        : null;
    let executionRoots = roots;
    try {
      if (request.workspaceWriteMode === "isolated_change_set") {
        const workingCopyRoot = path.join(runnerTempRoot, "working-copies");
        mkdirSync(workingCopyRoot, { recursive: true, mode: 0o700 });
        executionRoots = roots.map((root, index) =>
          root.writable
            ? {
                ...root,
                rootPath: createWorkingCopy(
                  root.rootPath,
                  path.join(workingCopyRoot, `workspace-${index}`),
                ),
              }
            : root,
        );
        assertSafeHardlinkBoundary(executionRoots);
      }
    } catch (error) {
      rmSync(runnerTempRoot, { recursive: true, force: true });
      if (error instanceof Error && error.message.startsWith("BROKERED_BASH_")) throw error;
      throw new Error("BROKERED_BASH_WORKING_COPY_FAILED");
    }
    const executionActive = executionRoots[0];
    if (!executionActive) {
      rmSync(runnerTempRoot, { recursive: true, force: true });
      throw new Error("BROKERED_BASH_WORKING_COPY_FAILED");
    }
    let workspaceWriteBaseline: ReturnType<typeof captureWorkspaceWriteBaseline> | null = null;
    if (request.executionProfile === "workspace_write") {
      try {
        workspaceWriteBaseline = captureWorkspaceWriteBaseline(
          executionRoots.filter(({ writable }) => writable),
        );
      } catch (error) {
        rmSync(runnerTempRoot, { recursive: true, force: true });
        if (error instanceof Error && error.message.startsWith("BROKERED_BASH_")) throw error;
        throw new Error("BROKERED_BASH_CHANGE_EVIDENCE_FAILED");
      }
    }
    const startedAt = Date.now();
    const replacements = outputReplacements([...roots, ...executionRoots], runnerTempRoot);
    const stdout = new BoundedBuffer(request.resourceLimits.maxOutputBytes);
    const stderr = new BoundedBuffer(request.resourceLimits.maxOutputBytes);
    const output = new BoundedBuffer(request.resourceLimits.maxOutputBytes);
    const stdoutSanitizer = new BrokeredBashOutputSanitizer(replacements);
    const stderrSanitizer = new BrokeredBashOutputSanitizer(replacements);
    const outputSanitizer = new BrokeredBashOutputSanitizer(replacements);
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let outputSequence = 0;
    let truncationEmitted = false;
    const appendOutput = (delta: string) => {
      if (!delta) return;
      output.append(Buffer.from(delta, "utf8"));
      if (!output.truncated) {
        for (let offset = 0; offset < delta.length; offset += 16_384) {
          outputSequence += 1;
          try {
            request.onOutput?.({
              sequence: outputSequence,
              delta: delta.slice(offset, offset + 16_384),
              truncated: false,
            });
          } catch {
            // A detached progress consumer cannot change or crash Runner execution.
          }
        }
      } else if (!truncationEmitted) {
        truncationEmitted = true;
        outputSequence += 1;
        try {
          request.onOutput?.({
            sequence: outputSequence,
            delta: `\n[output truncated at ${request.resourceLimits.maxOutputBytes} bytes]\n`,
            truncated: true,
          });
        } catch {
          // A detached progress consumer cannot change or crash Runner execution.
        }
      }
    };
    let timeout: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    let record: ActiveProcess | undefined;
    try {
      const egressEndpoint = egressProxy ? await egressProxy.start() : null;
      const environment = makeRunnerEnvironment(
        runnerTempRoot,
        executionRoots,
        this.#bashExecutable,
        environmentPolicy,
        egressEndpoint
          ? {
              HTTP_PROXY: egressEndpoint.url,
              HTTPS_PROXY: egressEndpoint.url,
              http_proxy: egressEndpoint.url,
              https_proxy: egressEndpoint.url,
              NO_PROXY: "",
              no_proxy: "",
            }
          : {},
      );
      const profile = compileMacOSSandboxProfile({
        roots: executionRoots.map(({ rootPath, writable }) => ({
          rootPath,
          writable,
        })),
        runnerTempRoot,
        systemReadRoots: this.#systemReadRoots,
        ...(egressEndpoint ? { egressProxyPort: egressEndpoint.port } : {}),
      });
      const cpuSeconds = Math.max(1, Math.ceil(request.timeoutMs / 1_000) + 5);
      const absoluteProcessLimit = absoluteUserProcessLimit(request.resourceLimits.maxProcesses);
      const wrapper = [
        "ulimit -c 0 || exit 125",
        `ulimit -n ${request.resourceLimits.maxOpenFiles} || exit 125`,
        `ulimit -u ${absoluteProcessLimit} || exit 125`,
        `ulimit -f ${request.resourceLimits.maxFileBlocks} || exit 125`,
        `ulimit -t ${cpuSeconds} || exit 125`,
        'exec "$2" --noprofile --norc -c "$1"',
      ].join("; ");
      const child = spawn(
        this.#sandboxExecutable,
        [
          "-p",
          profile,
          this.#bashExecutable,
          "--noprofile",
          "--norc",
          "-c",
          wrapper,
          "openerx-runner",
          request.command,
          this.#bashExecutable,
        ],
        {
          cwd: executionActive.rootPath,
          env: environment,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      record = { child, timedOut: false, cancelled: false };
      this.#active.set(request.identity.toolCallId, record);
      child.stdin.end();
      child.stdout.on("data", (chunk: Buffer) => {
        const decoded = stdoutDecoder.write(chunk);
        for (const delta of stdoutSanitizer.push(decoded)) stdout.append(Buffer.from(delta));
        for (const delta of outputSanitizer.push(decoded)) appendOutput(delta);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const decoded = stderrDecoder.write(chunk);
        for (const delta of stderrSanitizer.push(decoded)) stderr.append(Buffer.from(delta));
        for (const delta of outputSanitizer.push(decoded)) appendOutput(delta);
      });
      const terminate = (cause: "timeout" | "cancelled" | "shutdown" | "natural") => {
        if (!record) return Promise.resolve<PlatformSandboxDestructionStatus>("uncertain");
        if (cause === "timeout") record.timedOut = true;
        if (cause === "cancelled" || cause === "shutdown") record.cancelled = true;
        record.termination ??= terminateProcessGroup(record.child);
        return record.termination;
      };
      timeout = setTimeout(() => void terminate("timeout"), request.timeoutMs);
      abort = () => void terminate("cancelled");
      request.signal.addEventListener("abort", abort, { once: true });
      const exit = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolveExit({ code, signal }));
      });
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
      const destructionStatus = await terminate("natural");
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      for (const delta of stdoutSanitizer.push(stdoutTail)) stdout.append(Buffer.from(delta));
      for (const delta of outputSanitizer.push(stdoutTail)) appendOutput(delta);
      for (const delta of stderrSanitizer.push(stderrTail)) stderr.append(Buffer.from(delta));
      for (const delta of outputSanitizer.push(stderrTail)) appendOutput(delta);
      for (const delta of stdoutSanitizer.finish()) stdout.append(Buffer.from(delta));
      for (const delta of stderrSanitizer.finish()) stderr.append(Buffer.from(delta));
      for (const delta of outputSanitizer.finish()) appendOutput(delta);
      let workspaceChanges = null;
      if (workspaceWriteBaseline) {
        try {
          assertSafeHardlinkBoundary(executionRoots);
          workspaceChanges = collectWorkspaceWriteChanges(workspaceWriteBaseline);
          if (request.workspaceWriteMode === "isolated_change_set") {
            const originalCount = workspaceChanges.manifest.length;
            workspaceChanges.manifest = workspaceChanges.manifest.filter(
              ({ relativePath }) => !excludedWorkingCopyPath(relativePath),
            );
            workspaceChanges.materialization = workspaceChanges.materialization.filter(
              ({ relativePath }) => !excludedWorkingCopyPath(relativePath),
            );
            const includedDiffPaths = new Set(
              workspaceChanges.manifest.map(
                ({ workspaceLogicalName, relativePath }) =>
                  `${workspaceLogicalName}/${relativePath}`,
              ),
            );
            workspaceChanges.diffs = workspaceChanges.diffs.filter(({ relativePath }) =>
              includedDiffPaths.has(relativePath),
            );
            workspaceChanges.excludedPathCount = originalCount - workspaceChanges.manifest.length;
            workspaceChanges.mode = "ISOLATED_CHANGE_SET";
            workspaceChanges.hostWorkspaceMutated = false;
            workspaceChanges.undo = "REVIEW_REQUIRED_BEFORE_APPLY";
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("BROKERED_BASH_")) throw error;
          throw new Error("BROKERED_BASH_CHANGE_EVIDENCE_FAILED");
        }
      }
      return {
        exitCode: exit.code,
        signal: exit.signal,
        stdout: stdout.text(),
        stderr: stderr.text(),
        output: output.text(),
        outputTruncated: stdout.truncated || stderr.truncated || output.truncated,
        timedOut: record.timedOut,
        cancelled: record.cancelled,
        durationMs: Date.now() - startedAt,
        destructionStatus,
        changedPathManifestStatus: workspaceChanges ? "collected" : "not_applicable",
        workspaceChanges,
        proof: {
          engineVersion: this.engineVersion,
          backendId: this.backendId,
          backendVersion: "system",
          policyVersion: this.policyVersion,
          platform: this.#platform,
          platformRelease: this.#platformRelease,
          executionProfile: request.executionProfile,
          environmentPolicyId: request.environmentPolicyId,
          environmentDigest: brokeredBashEnvironmentDigest(environment),
          networkPolicyId: request.networkPolicyId,
          networkPolicyDigest: brokeredBashNetworkPolicyDigest(networkPolicy),
          controlledEgress: networkPolicy.mode === "controlled_egress",
          filesystemBoundary: true,
          hardlinkBoundary: true,
          environmentSanitized: true,
          networkDenied: true,
          processGroupOwned: true,
        },
      };
    } catch (error) {
      if (record) {
        record.termination ??= terminateProcessGroup(record.child);
        await record.termination;
      }
      if (error instanceof Error && error.message.startsWith("BROKERED_BASH_")) throw error;
      throw new Error("BROKERED_BASH_RUNNER_START_FAILED");
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abort) request.signal.removeEventListener("abort", abort);
      this.#active.delete(request.identity.toolCallId);
      await egressProxy?.close();
      rmSync(runnerTempRoot, { recursive: true, force: true });
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.#active.values()].map((record) => {
        record.cancelled = true;
        record.termination ??= terminateProcessGroup(record.child);
        return record.termination;
      }),
    );
  }

  async #probe(): Promise<PlatformSandboxCapability> {
    if (this.#platform !== "darwin") {
      return this.#capability(false, "BROKERED_BASH_PLATFORM_UNSUPPORTED");
    }
    if (!existsSync(this.#sandboxExecutable)) {
      return this.#capability(false, "BROKERED_BASH_SANDBOX_EXEC_MISSING");
    }
    if (!existsSync(this.#bashExecutable)) {
      return this.#capability(false, "BROKERED_BASH_BASH_MISSING");
    }
    const allowedRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), "openerx-pbash-probe-allowed-")),
    );
    const outsideRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), "openerx-pbash-probe-outside-")),
    );
    const runnerTempRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), "openerx-pbash-probe-runner-")),
    );
    const outsideCanary = path.join(outsideRoot, "must-not-exist");
    try {
      const profile = compileMacOSSandboxProfile({
        roots: [{ rootPath: realpathSync(allowedRoot), writable: false }],
        runnerTempRoot: realpathSync(runnerTempRoot),
        systemReadRoots: this.#systemReadRoots,
      });
      const environment = makeRunnerEnvironment(runnerTempRoot, [], this.#bashExecutable);
      const positive = spawnSync(
        this.#sandboxExecutable,
        ["-p", profile, this.#bashExecutable, "--noprofile", "--norc", "-c", "printf probe-ok"],
        {
          cwd: allowedRoot,
          env: environment,
          encoding: "utf8",
          timeout: 5_000,
        },
      );
      const denied = spawnSync(
        this.#sandboxExecutable,
        [
          "-p",
          profile,
          this.#bashExecutable,
          "--noprofile",
          "--norc",
          "-c",
          'touch "$1"',
          "openerx-probe",
          outsideCanary,
        ],
        {
          cwd: allowedRoot,
          env: environment,
          encoding: "utf8",
          timeout: 5_000,
        },
      );
      if (
        positive.status !== 0 ||
        positive.stdout !== "probe-ok" ||
        denied.status === 0 ||
        existsSync(outsideCanary)
      ) {
        return this.#capability(false, "BROKERED_BASH_CAPABILITY_PROBE_FAILED");
      }
      return this.#capability(true, null);
    } catch {
      return this.#capability(false, "BROKERED_BASH_CAPABILITY_PROBE_FAILED");
    } finally {
      for (const directory of [allowedRoot, outsideRoot, runnerTempRoot]) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }

  #capability(available: boolean, reason: string | null): PlatformSandboxCapability {
    return {
      available,
      reason,
      engineVersion: this.engineVersion,
      backendId: this.backendId,
      backendVersion: "system",
      policyVersion: this.policyVersion,
      platform: this.#platform,
      platformRelease: this.#platformRelease,
      supportedProfiles: available ? ["read_only", "workspace_write"] : [],
      environmentPolicyIds: available
        ? [
            BROKERED_BASH_NONE_ENVIRONMENT_POLICY_ID,
            BROKERED_BASH_CORE_ENVIRONMENT_POLICY_ID,
            BROKERED_BASH_ALL_ENVIRONMENT_POLICY_ID,
          ]
        : [],
      networkPolicyIds: available
        ? [BROKERED_BASH_DENY_NETWORK_POLICY_ID, BROKERED_BASH_CONTROLLED_EGRESS_NETWORK_POLICY_ID]
        : [],
      capabilities: available
        ? {
            filesystemBoundary: true,
            hardlinkBoundary: true,
            readOnlyRoots: true,
            writableRoots: true,
            networkDeny: true,
            sanitizedEnvironment: true,
            processGroupCleanup: true,
            descendantSandboxInheritance: true,
            pty: false,
          }
        : emptyCapabilities(),
    };
  }
}
