import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import type {
  ManagedNodeRuntime,
  ManagedNodeRuntimeError,
  NormalizedToolResult,
  ResolvedShellEncoding,
  ShellEncoding,
  ToolOperation,
  WorkspaceGrant,
} from "@openerx/contracts";
import { managedNodeRuntimeEnvironment, resolveManagedNodeCommand } from "./managed-node-runtime";
import {
  appendShellOutput,
  encodeShellInput,
  normalizeShellEncoding,
  type ShellOutputDecodingError,
  ShellTextOutputDecoder,
} from "./shell-text-codec";
import { type ToolAdapter, ToolAdapterError, type ToolExecutionContext } from "./types";
import { windowsCodexRuntimeState } from "./windows-codex-runtime";
import { windowsManagedNodeLaunch } from "./windows-managed-node-launcher";
import { resolveWindowsPowerShellCommand } from "./windows-powershell";
import {
  sandboxDiagnosticText,
  type WindowsSandboxDiagnostic,
  WindowsSandboxError,
  type WindowsSandboxStage,
  windowsSandboxDiagnosticDetails,
  windowsSandboxFailure,
} from "./windows-sandbox-diagnostics";

const OUTPUT_LIMIT = 2_000_000;

interface JsonRpcResponse {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: string | number; data?: unknown };
}

interface PendingRequest {
  stage: WindowsSandboxStage;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  stopped?: boolean;
  outputTruncated?: boolean;
  outputDecodingErrors?: ShellOutputDecodingError[];
}

interface WindowsSandboxCommandInput {
  command: string[];
  cwd: string;
  writableRoot: string;
  timeoutMs: number;
  allowNetwork: boolean;
  encoding?: ShellEncoding;
  signal?: AbortSignal;
  onOutput(delta: string, stream: "stdout" | "stderr", truncated: boolean): void;
}

export interface WindowsSandboxCommandHandle {
  readonly processId: string;
  readonly isolation?: CodexWindowsSandboxIsolation;
  readonly completion: Promise<CommandResult>;
  write(input: string): Promise<void>;
  stop(): Promise<void>;
}

export interface WindowsSandboxCommandHost {
  readonly isolation?: CodexWindowsSandboxIsolation | undefined;
  start(input: WindowsSandboxCommandInput): Promise<WindowsSandboxCommandHandle>;
  close(): Promise<void>;
}

export interface CodexWindowsSandboxProbe {
  platform?: NodeJS.Platform;
  codexExecutable?: string | null;
  setupMarkerExists?: boolean;
  helpersExist?: boolean;
  backend?: CodexWindowsSandboxBackend;
  mxcSupported?: boolean;
}

export type CodexWindowsSandboxBackend = "auto" | "elevated" | "mxc";
export type ResolvedCodexWindowsSandboxBackend = Exclude<CodexWindowsSandboxBackend, "auto">;
export type CodexWindowsSandboxIsolation = "codex-windows-restricted-token" | "codex-windows-mxc";

export function codexWindowsSandboxBackend(
  value = process.env.OPENERX_WINDOWS_SANDBOX_BACKEND,
): CodexWindowsSandboxBackend {
  if (value === undefined || value === "" || value === "auto") return "auto";
  if (value === "elevated" || value === "mxc") return value;
  throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_BACKEND_INVALID");
}

export async function selectCodexWindowsSandboxBackend(
  backend: CodexWindowsSandboxBackend,
  probe: {
    mxcSupported(): Promise<boolean>;
    elevatedReady(): boolean;
  },
): Promise<ResolvedCodexWindowsSandboxBackend> {
  if (backend !== "auto" && backend !== "mxc" && backend !== "elevated") {
    throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_BACKEND_INVALID");
  }
  if (backend !== "elevated" && (await probe.mxcSupported())) return "mxc";
  if (backend !== "mxc" && probe.elevatedReady()) return "elevated";
  throw new Error(
    backend === "mxc"
      ? "SHELL_WINDOWS_CODEX_MXC_UNAVAILABLE"
      : "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE",
  );
}

const execFileAsync = promisify(execFile);
const mxcProbes = new Map<string, { checkedAt: number; supported: Promise<boolean> }>();

async function mxcSupported(codexExecutable: string, cwd: string): Promise<boolean> {
  try {
    const key = `${codexExecutable}:${statSync(codexExecutable).mtimeMs}:${realpathSync(cwd)}`;
    const cached = mxcProbes.get(key);
    if (cached && Date.now() - cached.checkedAt < 60_000) return cached.supported;
    const supported = execFileAsync(
      codexExecutable,
      [
        "-c",
        "windows.sandbox=mxc",
        "sandbox",
        "--include-managed-config",
        "--permission-profile",
        ":workspace",
        "--",
        path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
        "/d",
        "/c",
        "echo OPENERX_MXC_READY",
      ],
      {
        cwd,
        env: safeAppServerEnvironment(),
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 1024,
      },
    ).then(
      ({ stdout }) => {
        if (stdout.trim() !== "OPENERX_MXC_READY")
          throw new Error("SHELL_WINDOWS_CODEX_MXC_UNAVAILABLE");
        return true;
      },
      (error: unknown) => {
        throw windowsSandboxFailure(
          error,
          "compatibility",
          "mxc",
          "SHELL_WINDOWS_CODEX_MXC_UNAVAILABLE",
        );
      },
    );
    mxcProbes.set(key, { checkedAt: Date.now(), supported });
    void supported.catch(() => {
      if (mxcProbes.get(key)?.supported === supported) mxcProbes.delete(key);
    });
    return supported;
  } catch (error) {
    throw windowsSandboxFailure(
      error,
      "compatibility",
      "mxc",
      "SHELL_WINDOWS_CODEX_MXC_UNAVAILABLE",
    );
  }
}

function codexHome(): string | null {
  const profile = process.env.USERPROFILE;
  return profile ? path.join(profile, ".codex") : null;
}

export function findCodexExecutable(): string | null {
  return windowsCodexRuntimeState().executable ?? null;
}

function helpersExist(codexExecutable: string): boolean {
  const directory = path.dirname(codexExecutable);
  return ["codex-command-runner.exe", "codex-windows-sandbox-setup.exe"].every((name) =>
    existsSync(path.join(directory, name)),
  );
}

function setupMarkerExists(): boolean {
  const home = codexHome();
  if (!home) return false;
  const markerPath = path.join(home, ".sandbox", "setup_marker.json");
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
      version?: number;
      offline_username?: string;
      online_username?: string;
    };
    return (
      typeof marker.version === "number" &&
      marker.version >= 5 &&
      Boolean(marker.offline_username) &&
      Boolean(marker.online_username)
    );
  } catch {
    return false;
  }
}

export function codexWindowsSandboxReady(probe: CodexWindowsSandboxProbe = {}): boolean {
  const platform = probe.platform ?? process.platform;
  if (platform !== "win32") return false;
  const executable =
    probe.codexExecutable === undefined ? findCodexExecutable() : probe.codexExecutable;
  if (!executable) return false;
  let backend: CodexWindowsSandboxBackend;
  try {
    backend = probe.backend ?? codexWindowsSandboxBackend();
  } catch {
    return false;
  }
  // Installation readiness is synchronous; native capability validation happens
  // asynchronously before execution so catalog reads cannot block the UI.
  if (backend === "mxc") return probe.mxcSupported ?? true;
  if (backend === "auto" && probe.mxcSupported !== false) return true;
  return (
    (probe.helpersExist ?? helpersExist(executable)) &&
    (probe.setupMarkerExists ?? setupMarkerExists())
  );
}

function safeAppServerEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PROGRAMDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "SystemDrive",
    "HOMEDRIVE",
    "HOMEPATH",
  ];
  return {
    ...Object.fromEntries(
      allowed.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
    ),
    NO_COLOR: "1",
    TERM: "dumb",
  };
}

// CreateProcessAsUser does not reliably search the caller's PATH. Resolve the
// executable before crossing the sandbox boundary; argv and sandbox policy stay intact.
export function resolveWindowsExecutable(
  command: string,
  searchPath = process.env.PATH ?? "",
): string {
  if (path.isAbsolute(command) || /[/\\]/u.test(command)) return command;
  const names = path.extname(command) ? [command] : [command, `${command}.exe`, `${command}.com`];
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    const root = directory.replace(/^"|"$/gu, "");
    if (!path.isAbsolute(root)) continue;
    for (const name of names) {
      const candidate = path.join(root, name);
      try {
        if (statSync(candidate).isFile()) return realpathSync(candidate);
      } catch {
        // Missing or inaccessible PATH entries are not executable candidates.
      }
    }
  }
  throw new Error("SHELL_EXECUTABLE_NOT_FOUND");
}

interface CommandConnection {
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, PendingRequest>;
  commands: Map<string, StreamingCommand>;
  stderr: string;
  closed: boolean;
  key: string;
  backend: ResolvedCodexWindowsSandboxBackend;
  setupCompleted?: (result: { success?: boolean; error?: unknown }) => void;
}

interface StreamingCommand {
  onOutput: WindowsSandboxCommandInput["onOutput"];
  decoders: Record<"stdout" | "stderr", ShellTextOutputDecoder>;
  encoding: ResolvedShellEncoding;
  decodingErrors: Set<"stdout" | "stderr">;
  output: Record<"stdout" | "stderr", string>;
  truncated: Record<"stdout" | "stderr", boolean>;
}

/** Trusted host dependencies, separate from model-controlled command parameters. */
export interface CodexWindowsCommandHostRuntime {
  nodeRuntime?: ManagedNodeRuntime;
  nodeRuntimeError?: ManagedNodeRuntimeError;
  validateProtocol(executable: string): Promise<void>;
  selectBackend(
    executable: string,
    preference: CodexWindowsSandboxBackend,
    cwd?: string,
  ): Promise<ResolvedCodexWindowsSandboxBackend>;
  spawn(executable: string, args: string[], cwd?: string): ChildProcessWithoutNullStreams;
}

const protocolProbes = new Map<string, { checkedAt: number; supported: Promise<void> }>();
const PROTOCOL_UNSUPPORTED = "SHELL_WINDOWS_CODEX_COMMAND_PROTOCOL_UNSUPPORTED";

async function removeSchemaDirectory(directory: string, parent: string): Promise<void> {
  const target = realpathSync(directory);
  if (
    path.dirname(target) !== parent ||
    !path.basename(target).startsWith("openerx-codex-command-schema-")
  )
    throw new Error("SHELL_WINDOWS_CODEX_SCHEMA_CLEANUP_OUT_OF_SCOPE");
  await rm(target, { recursive: true, force: true });
}

function schemaHasMethod(value: unknown, method: string): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const properties = record.properties as Record<string, { enum?: unknown[] }> | undefined;
  if (properties?.method?.enum?.includes(method)) return true;
  return Object.values(record).some((child) =>
    Array.isArray(child)
      ? child.some((entry) => schemaHasMethod(entry, method))
      : schemaHasMethod(child, method),
  );
}

export async function validateCodexWindowsCommandProtocol(executable: string): Promise<void> {
  const actual = realpathSync(executable);
  const key = `${actual}:${statSync(actual).mtimeMs}`;
  const cached = protocolProbes.get(key);
  if (cached && Date.now() - cached.checkedAt < 60_000) return await cached.supported;
  const supported = (async () => {
    const parent = realpathSync(tmpdir());
    const directory = await mkdtemp(path.join(parent, "openerx-codex-command-schema-"));
    try {
      await execFileAsync(
        actual,
        ["app-server", "generate-json-schema", "--experimental", "--out", directory],
        {
          cwd: path.dirname(actual),
          env: safeAppServerEnvironment(),
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 8_192,
        },
      );
      for (const [file, names] of [
        [
          "CommandExecParams",
          [
            "processId",
            "streamStdin",
            "streamStdoutStderr",
            "outputBytesCap",
            "sandboxPolicy",
            "timeoutMs",
          ],
        ],
        ["CommandExecWriteParams", ["processId", "deltaBase64", "closeStdin"]],
        ["CommandExecTerminateParams", ["processId"]],
        [
          "CommandExecOutputDeltaNotification",
          ["processId", "stream", "deltaBase64", "capReached"],
        ],
      ] as const) {
        const schema = JSON.parse(
          await readFile(path.join(directory, "v2", `${file}.json`), "utf8"),
        ) as {
          properties?: Record<string, unknown>;
        };
        if (!names.every((name) => Object.hasOwn(schema.properties ?? {}, name))) {
          throw new Error(PROTOCOL_UNSUPPORTED);
        }
      }
      const requests = JSON.parse(
        await readFile(path.join(directory, "ClientRequest.json"), "utf8"),
      );
      const notifications = JSON.parse(
        await readFile(path.join(directory, "ServerNotification.json"), "utf8"),
      );
      if (
        !["command/exec", "command/exec/write", "command/exec/terminate"].every((method) =>
          schemaHasMethod(requests, method),
        ) ||
        !schemaHasMethod(notifications, "command/exec/outputDelta")
      )
        throw new Error(PROTOCOL_UNSUPPORTED);
    } catch (error) {
      if (error instanceof Error && error.message === PROTOCOL_UNSUPPORTED) throw error;
      throw windowsSandboxFailure(
        error,
        "protocol",
        undefined,
        "SHELL_WINDOWS_CODEX_PROTOCOL_CHECK_FAILED",
      );
    } finally {
      // Only remove the directory created by this probe, under its resolved temp parent.
      await removeSchemaDirectory(directory, parent);
    }
  })();
  protocolProbes.set(key, { checkedAt: Date.now(), supported });
  void supported.catch(() => {
    if (protocolProbes.get(key)?.supported === supported) protocolProbes.delete(key);
  });
  return await supported;
}

function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("SHELL_STOPPED"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export class CodexWindowsSandboxCommandHost implements WindowsSandboxCommandHost {
  readonly #codexExecutable: string;
  readonly #backendPreference: CodexWindowsSandboxBackend;
  readonly #runtime: CodexWindowsCommandHostRuntime;
  #backend?: ResolvedCodexWindowsSandboxBackend;
  readonly #connections = new Map<string, CommandConnection>();
  readonly #startPromises = new Map<string, Promise<CommandConnection>>();
  readonly #shutdowns = new Set<Promise<void>>();
  readonly diagnostics: WindowsSandboxDiagnostic[] = [];
  #nextId = 1;
  #epoch = 0;

  constructor(
    codexExecutable = findCodexExecutable(),
    backend = codexWindowsSandboxBackend(),
    runtime: Partial<CodexWindowsCommandHostRuntime> = {},
  ) {
    if (!codexExecutable) throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE");
    this.#codexExecutable = codexExecutable;
    this.#backendPreference = backend;
    this.#runtime = {
      validateProtocol: validateCodexWindowsCommandProtocol,
      selectBackend: async (executable, preference, cwd = path.dirname(executable)) => {
        if (!codexWindowsSandboxReady({ codexExecutable: executable, backend: preference })) {
          throw new Error(
            preference === "elevated"
              ? "SHELL_WINDOWS_CODEX_SETUP_REQUIRED"
              : "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE",
          );
        }
        return await selectCodexWindowsSandboxBackend(preference, {
          mxcSupported: () => mxcSupported(executable, cwd),
          elevatedReady: () =>
            codexWindowsSandboxReady({ codexExecutable: executable, backend: "elevated" }),
        });
      },
      spawn: (executable, args, cwd = path.dirname(executable)) =>
        spawn(executable, args, {
          cwd,
          env: safeAppServerEnvironment(),
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        }),
      ...runtime,
    };
  }

  get isolation(): CodexWindowsSandboxIsolation | undefined {
    if (!this.#backend) return undefined;
    return this.#backend === "mxc" ? "codex-windows-mxc" : "codex-windows-restricted-token";
  }

  async probe(cwd: string): Promise<ResolvedCodexWindowsSandboxBackend> {
    const connection = await this.#ensureStarted(cwd);
    // Readiness alone can report ready while the sandbox account cannot log on.
    // Execute only this fixed, side-effect-free command during inspection.
    try {
      const handle = await this.start({
        command: [
          path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
          "/d",
          "/c",
          "echo OPENERX_SANDBOX_READY",
        ],
        cwd,
        writableRoot: cwd,
        timeoutMs: 5_000,
        allowNetwork: false,
        onOutput: () => undefined,
      });
      const result = await handle.completion;
      if (result.exitCode !== 0 || result.stdout.trim() !== "OPENERX_SANDBOX_READY")
        throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE");
      return connection.backend;
    } catch (error) {
      const failure = windowsSandboxFailure(error, "readiness", connection.backend);
      throw new WindowsSandboxError({ ...failure.diagnostic, stage: "readiness" });
    }
  }

  /** Called only from the explicit desktop settings action, never from a readiness probe. */
  async setup(cwd: string): Promise<void> {
    await this.#runtime.validateProtocol(this.#codexExecutable);
    const connection = await this.#connect("elevated", realpathSync(cwd), this.#epoch, true);
    let timer: NodeJS.Timeout | undefined;
    const completion = new Promise<void>((resolve, reject) => {
      connection.setupCompleted = (result) => {
        if (result.success === true) resolve();
        else
          reject(
            windowsSandboxFailure(
              new Error(
                typeof result.error === "string"
                  ? result.error
                  : "Windows sandbox setup did not complete",
              ),
              "setup",
              "elevated",
              "SHELL_WINDOWS_CODEX_SETUP_REQUIRED",
            ),
          );
      };
      timer = setTimeout(
        () =>
          reject(
            windowsSandboxFailure(
              new Error("Windows sandbox setup timed out"),
              "setup",
              "elevated",
            ),
          ),
        120_000,
      );
    });
    // A pipe failure can settle this while the setupStart acknowledgement is pending.
    void completion.catch(() => undefined);
    try {
      const result = (await this.#request(
        connection,
        "windowsSandbox/setupStart",
        { mode: "elevated", cwd: realpathSync(cwd) },
        5_000,
      )) as { started?: boolean };
      if (result.started !== true) throw new Error("SHELL_WINDOWS_CODEX_SETUP_REQUIRED");
      await completion;
      mxcProbes.clear();
    } finally {
      clearTimeout(timer);
      connection.setupCompleted = undefined;
    }
  }

  async start(input: WindowsSandboxCommandInput): Promise<WindowsSandboxCommandHandle> {
    input.signal?.throwIfAborted();
    const encoding = normalizeShellEncoding(input.encoding);
    const [command, ...originalArgs] = input.command;
    if (!command) throw new Error("SHELL_EXECUTABLE_NOT_FOUND");
    const interpreter = resolveWindowsPowerShellCommand(command, originalArgs);
    const resolved = resolveManagedNodeCommand(
      this.#runtime.nodeRuntime,
      interpreter.command,
      interpreter.args,
      this.#runtime.nodeRuntimeError,
    );
    const executable = resolveWindowsExecutable(resolved.command);
    const args = resolved.args;
    if (
      this.#runtime.nodeRuntime &&
      inside(realpathSync(input.writableRoot), this.#runtime.nodeRuntime.rootDirectory)
    )
      throw new Error("SHELL_MANAGED_RUNTIME_WORKSPACE_OVERLAP");
    const connection = await abortable(this.#ensureStarted(input.cwd), input.signal);
    const launch =
      connection.backend === "mxc"
        ? windowsManagedNodeLaunch(this.#runtime.nodeRuntime, executable, args)
        : { command: executable, args };
    input.signal?.throwIfAborted();
    const processId = randomUUID();
    const stream: StreamingCommand = {
      onOutput: input.onOutput,
      decoders: {
        stdout: new ShellTextOutputDecoder(encoding.stdout),
        stderr: new ShellTextOutputDecoder(encoding.stderr),
      },
      encoding,
      decodingErrors: new Set(),
      output: { stdout: "", stderr: "" },
      truncated: { stdout: false, stderr: false },
    };
    connection.commands.set(processId, stream);
    let settled = false;
    let reason: "stopped" | "timed_out" | undefined;
    let stopping: Promise<void> | undefined;
    let timer: NodeJS.Timeout | undefined;
    let terminationTimer: NodeJS.Timeout | undefined;
    const terminate = (nextReason: "stopped" | "timed_out") => {
      if (settled) return Promise.resolve();
      reason ??= nextReason;
      clearTimeout(timer);
      terminationTimer ??= setTimeout(() => {
        if (!settled)
          this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_TERMINATE_TIMEOUT"));
      }, 5_000);
      stopping ??= this.#request(connection, "command/exec/terminate", { processId }, 5_000)
        .then(() => undefined)
        .catch((error: unknown) => {
          // A failed control RPC cannot leave an untracked command running.
          this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_TERMINATE_FAILED"));
          throw error;
        });
      return stopping;
    };
    const completion = this.#request(
      connection,
      "command/exec",
      {
        processId,
        command: [launch.command, ...launch.args],
        timeoutMs: input.timeoutMs + 5_000,
        streamStdin: true,
        streamStdoutStderr: true,
        outputBytesCap: OUTPUT_LIMIT,
        cwd: input.cwd,
        env: {
          TEMP: input.cwd,
          TMP: input.cwd,
          TMPDIR: input.cwd,
          ...(this.#runtime.nodeRuntime
            ? managedNodeRuntimeEnvironment(this.#runtime.nodeRuntime, { cwd: input.cwd })
            : {}),
        },
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [input.writableRoot],
          networkAccess: input.allowNetwork,
          excludeTmpdirEnvVar: true,
          excludeSlashTmp: true,
        },
      },
      input.timeoutMs + 15_000,
      async () => {
        await terminate("timed_out");
        this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_APP_SERVER_TIMEOUT"));
      },
    )
      .then(
        (value) => {
          const result = value as CommandResult;
          if (
            !result ||
            !Number.isInteger(result.exitCode) ||
            typeof result.stdout !== "string" ||
            typeof result.stderr !== "string"
          )
            throw new Error(PROTOCOL_UNSUPPORTED);
          for (const channel of ["stdout", "stderr"] as const) {
            // Streaming results must not silently fall back to buffered legacy execution.
            if (result[channel]) throw new Error(PROTOCOL_UNSUPPORTED);
            let suffix: string;
            try {
              suffix = stream.decoders[channel].finish(stream.truncated[channel]);
            } catch {
              stream.decodingErrors.add(channel);
              continue;
            }
            this.#output(stream, channel, suffix, false);
          }
          return {
            exitCode: result.exitCode,
            ...stream.output,
            timedOut: reason === "timed_out",
            stopped: reason === "stopped",
            outputTruncated: stream.truncated.stdout || stream.truncated.stderr,
            outputDecodingErrors: [...stream.decodingErrors].map((channel) => ({
              stream: channel,
              encoding: encoding[channel],
              code: "SHELL_OUTPUT_DECODING_FAILED" as const,
            })),
          };
        },
        (error: unknown) => {
          const failure = error instanceof Error ? error : new Error(String(error));
          throw Object.assign(failure, {
            timedOut: reason === "timed_out",
            stopped: reason === "stopped",
          });
        },
      )
      .finally(() => {
        settled = true;
        clearTimeout(timer);
        clearTimeout(terminationTimer);
        input.signal?.removeEventListener("abort", abort);
        connection.commands.delete(processId);
      });
    const abort = () => {
      void terminate("stopped").catch(() => undefined);
    };
    timer = setTimeout(() => {
      void terminate("timed_out").catch(() => undefined);
    }, input.timeoutMs);
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    return {
      processId,
      isolation:
        connection.backend === "mxc" ? "codex-windows-mxc" : "codex-windows-restricted-token",
      completion,
      write: async (text) => {
        if (settled || reason) throw new Error("SHELL_PROCESS_NOT_RUNNING");
        await this.#request(
          connection,
          "command/exec/write",
          {
            processId,
            deltaBase64: encodeShellInput(text, encoding.stdin).toString("base64"),
            closeStdin: false,
          },
          5_000,
          () => terminate("stopped"),
        );
      },
      stop: async () => {
        await terminate("stopped");
        await completion.catch(() => undefined);
      },
    };
  }

  async close(): Promise<void> {
    this.#epoch++;
    for (const connection of this.#connections.values())
      this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED"));
    this.#connections.clear();
    this.#startPromises.clear();
    await Promise.all(this.#shutdowns);
    this.#shutdowns.clear();
  }

  async #ensureStarted(cwd: string): Promise<CommandConnection> {
    const key = realpathSync(cwd);
    const pending = this.#startPromises.get(key) ?? this.#start(key);
    this.#startPromises.set(key, pending);
    try {
      const connection = await pending;
      if (connection.closed) throw new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED");
      return connection;
    } catch (error) {
      if (this.#startPromises.get(key) === pending) this.#startPromises.delete(key);
      throw error;
    }
  }

  async #start(cwd: string): Promise<CommandConnection> {
    const epoch = this.#epoch;
    await this.#runtime.validateProtocol(this.#codexExecutable);
    let backend: ResolvedCodexWindowsSandboxBackend | undefined;
    try {
      backend = await this.#runtime.selectBackend(
        this.#codexExecutable,
        this.#backendPreference,
        cwd,
      );
      if (epoch !== this.#epoch) throw new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED");
      return await this.#connect(backend, cwd, epoch);
    } catch (error) {
      const primary = windowsSandboxFailure(
        error,
        "compatibility",
        backend ?? (this.#backendPreference === "elevated" ? "elevated" : "mxc"),
      );
      this.diagnostics.push(primary.diagnostic);
      // No command/exec has been sent. Once a user command is sent it is never replayed.
      if (this.#backendPreference !== "auto" || backend === "elevated" || epoch !== this.#epoch)
        throw primary;
      try {
        const fallback = await this.#runtime.selectBackend(this.#codexExecutable, "elevated", cwd);
        if (epoch !== this.#epoch) throw new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED");
        return await this.#connect(fallback, cwd, epoch);
      } catch (fallbackError) {
        const failure = windowsSandboxFailure(fallbackError, "readiness", "elevated");
        this.diagnostics.push(failure.diagnostic);
        throw failure;
      }
    }
  }

  async #connect(
    backend: ResolvedCodexWindowsSandboxBackend,
    cwd: string,
    epoch: number,
    setup = false,
  ): Promise<CommandConnection> {
    if (epoch !== this.#epoch) throw new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED");
    const child = this.#runtime.spawn(
      this.#codexExecutable,
      [
        "-c",
        `windows.sandbox=${backend}`,
        // Native prefer_mxc can override windows.sandbox=elevated. Pin the
        // selected backend; a managed feature requirement may reject this.
        ...(backend === "elevated" ? ["-c", "features.prefer_mxc=false"] : []),
        "app-server",
        "--stdio",
      ],
      cwd,
    );
    const connection: CommandConnection = {
      child,
      pending: new Map(),
      commands: new Map(),
      stderr: "",
      closed: false,
      key: cwd,
      backend,
    };
    this.#connections.set(cwd, connection);
    this.#backend = backend;
    const decoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let buffered = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (connection.closed) return;
      buffered += decoder.write(chunk);
      while (true) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) this.#onMessage(connection, line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      connection.stderr = `${connection.stderr}${stderrDecoder.write(chunk)}`.slice(-8_000);
    });
    child.stdin.on("error", () =>
      this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED")),
    );
    child.once("error", () =>
      this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED")),
    );
    child.once("close", () =>
      this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED")),
    );
    try {
      await this.#request(
        connection,
        "initialize",
        {
          clientInfo: { name: "openerx", title: "openerx", version: "2.0" },
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
        5_000,
      );
      if (setup) return connection;
      const readiness = (await this.#request(
        connection,
        "windowsSandbox/readiness",
        null,
        5_000,
      )) as { status?: string; error?: unknown; reason?: unknown };
      if (readiness.status !== "ready") {
        throw windowsSandboxFailure(
          new Error(sandboxDiagnosticText(JSON.stringify(readiness))),
          "readiness",
          backend,
          backend === "elevated"
            ? "SHELL_WINDOWS_CODEX_SETUP_REQUIRED"
            : "SHELL_WINDOWS_CODEX_MXC_UNAVAILABLE",
        );
      }
      return connection;
    } catch (error) {
      this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED"));
      throw error instanceof WindowsSandboxError
        ? error
        : windowsSandboxFailure(
            Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
              stderr: connection.stderr,
            }),
            "initialize",
            backend,
          );
    }
  }

  #request(
    connection: CommandConnection,
    method: string,
    params: unknown,
    timeoutMs: number,
    onTimeout?: () => Promise<void>,
  ): Promise<unknown> {
    const { child } = connection;
    if (connection.closed || child.exitCode !== null || child.killed) {
      return Promise.reject(new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        const finish = () => reject(new Error("SHELL_WINDOWS_CODEX_APP_SERVER_TIMEOUT"));
        if (onTimeout) void onTimeout().then(finish, finish);
        else finish();
      }, timeoutMs);
      const stage =
        method === "initialize"
          ? "initialize"
          : method === "windowsSandbox/readiness"
            ? "readiness"
            : method.startsWith("windowsSandbox/setup")
              ? "setup"
              : "command";
      connection.pending.set(id, { resolve, reject, timer, stage });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
        if (!error) return;
        this.#disconnect(connection, new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED"));
      });
    });
  }

  #output(
    stream: StreamingCommand,
    channel: "stdout" | "stderr",
    delta: string,
    truncated: boolean,
  ): void {
    const previous = stream.output[channel];
    stream.truncated[channel] ||=
      truncated ||
      Buffer.byteLength(previous, "utf8") + Buffer.byteLength(delta, "utf8") > OUTPUT_LIMIT;
    stream.output[channel] = appendBounded(previous, delta);
    const accepted = stream.output[channel].slice(previous.length);
    if (accepted || truncated) stream.onOutput(accepted, channel, stream.truncated[channel]);
  }

  #onMessage(connection: CommandConnection, line: string): void {
    if (connection.closed) return;
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (message.method === "windowsSandbox/setupCompleted") {
      const data = message.params as
        | { mode?: string; success?: boolean; error?: unknown }
        | undefined;
      if (data?.mode === "elevated" && typeof data.success === "boolean")
        connection.setupCompleted?.(data);
      return;
    }
    if (message.method === "command/exec/outputDelta") {
      const data = message.params as
        | { processId?: string; stream?: string; deltaBase64?: string; capReached?: boolean }
        | undefined;
      if (
        !data ||
        typeof data.processId !== "string" ||
        (data.stream !== "stdout" && data.stream !== "stderr") ||
        typeof data.deltaBase64 !== "string" ||
        typeof data.capReached !== "boolean"
      )
        return;
      const stream = connection.commands.get(data.processId);
      if (!stream) return;
      let delta: string;
      try {
        delta = stream.decoders[data.stream].write(Buffer.from(data.deltaBase64, "base64"));
      } catch {
        stream.decodingErrors.add(data.stream);
        stream.truncated[data.stream] ||= data.capReached;
        return;
      }
      this.#output(stream, data.stream, delta, data.capReached);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = connection.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    connection.pending.delete(message.id);
    if (message.error)
      pending.reject(
        windowsSandboxFailure(
          Object.assign(new Error(message.error.message ?? "CODEX_APP_SERVER_ERROR"), {
            code: message.error.code,
            stderr: sandboxDiagnosticText(JSON.stringify(message.error.data ?? "")),
          }),
          pending.stage,
          connection.backend,
        ),
      );
    else pending.resolve(message.result);
  }

  #disconnect(connection: CommandConnection, error: Error): void {
    if (connection.closed) return;
    connection.closed = true;
    connection.setupCompleted?.({ success: false, error: error.message });
    if (this.#connections.get(connection.key) === connection) {
      this.#connections.delete(connection.key);
      this.#startPromises.delete(connection.key);
    }
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    connection.pending.clear();
    if (connection.child.exitCode === null) {
      const shutdown = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("SHELL_WINDOWS_CODEX_SHUTDOWN_TIMEOUT")),
          5_000,
        );
        connection.child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      void shutdown.catch(() => undefined);
      this.#shutdowns.add(shutdown);
    }
    connection.child.stdin.end();
    if (connection.child.exitCode === null && !connection.child.killed) connection.child.kill();
  }
}

export interface WindowsSandboxInspection {
  available: boolean;
  backend?: ResolvedCodexWindowsSandboxBackend;
  reason: string | null;
  details: string[];
}

export async function inspectCodexWindowsSandbox(cwd: string): Promise<WindowsSandboxInspection> {
  const runtime = windowsCodexRuntimeState();
  const executable = runtime.executable;
  if (!executable)
    return {
      available: false,
      reason: runtime.error ?? "MANAGED_CODEX_RUNTIME_UNAVAILABLE",
      details: ["应用随包执行组件缺失或校验失败，请重新安装应用"],
    };
  let host: CodexWindowsSandboxCommandHost | undefined;
  try {
    host = new CodexWindowsSandboxCommandHost(executable);
    const backend = await host.probe(cwd);
    return {
      available: true,
      backend,
      reason: null,
      details: [
        `Backend：${backend === "mxc" ? "Codex Windows MXC" : "Codex Windows elevated"}`,
        "检查：工作区兼容性、原生服务与实际沙箱执行",
        ...host.diagnostics.flatMap(windowsSandboxDiagnosticDetails).slice(0, 6),
      ],
    };
  } catch (error) {
    const failure = windowsSandboxFailure(error, "readiness");
    return {
      available: false,
      reason: failure.message,
      details: [
        ...(host?.diagnostics.flatMap(windowsSandboxDiagnosticDetails) ?? []),
        ...windowsSandboxDiagnosticDetails(failure.diagnostic),
      ].slice(0, 10),
    };
  } finally {
    await host?.close();
  }
}

export async function setupCodexWindowsSandbox(): Promise<{
  success: boolean;
  reason: string | null;
  details: string[];
}> {
  if (process.platform !== "win32")
    return { success: false, reason: "SHELL_OS_SANDBOX_UNAVAILABLE", details: [] };
  const runtime = windowsCodexRuntimeState();
  const executable = runtime.executable;
  if (!executable)
    return {
      success: false,
      reason: runtime.error ?? "MANAGED_CODEX_RUNTIME_UNAVAILABLE",
      details: [],
    };
  const host = new CodexWindowsSandboxCommandHost(executable, "elevated");
  try {
    await host.setup(process.env.USERPROFILE ?? tmpdir());
    return {
      success: true,
      reason: null,
      details: ["传统 Windows 沙箱初始化完成，请重新检测工具状态"],
    };
  } catch (error) {
    const failure = windowsSandboxFailure(error, "setup", "elevated");
    return {
      success: false,
      reason: failure.message,
      details: windowsSandboxDiagnosticDetails(failure.diagnostic),
    };
  } finally {
    await host.close();
  }
}

type ProcessState = "running" | "completed" | "failed" | "stopped" | "timed_out";

interface ProcessRecord {
  id: string;
  handle: WindowsSandboxCommandHandle;
  output: string;
  stdout: string;
  stderr: string;
  state: ProcessState;
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  isolation: CodexWindowsSandboxIsolation;
  outputTruncated: boolean;
  encoding: ResolvedShellEncoding;
  outputDecodingErrors: ShellOutputDecodingError[];
  completion: Promise<void>;
  failureCode?: string;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function appendBounded(current: string, delta: string): string {
  return appendShellOutput(current, delta, OUTPUT_LIMIT).text;
}

export class CodexWindowsShellToolAdapter implements ToolAdapter {
  readonly operations = ["shell_execute", "shell_status", "shell_input", "shell_stop"] as const;
  readonly #workspaceRoots: string[];
  readonly #processes = new Map<string, ProcessRecord>();
  private readonly host: WindowsSandboxCommandHost;

  constructor(
    workspaceRoots: readonly string[],
    private readonly resolveWorkspaceGrant?: (
      workspaceGrantId: string,
      conversationId: string,
    ) => WorkspaceGrant,
    host?: WindowsSandboxCommandHost,
    options: { nodeRuntime?: ManagedNodeRuntime; nodeRuntimeError?: ManagedNodeRuntimeError } = {},
  ) {
    this.host = host ?? new CodexWindowsSandboxCommandHost(undefined, undefined, options);
    this.#workspaceRoots = workspaceRoots.map((root) => realpathSync(root));
  }

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    context.signal.throwIfAborted();
    switch (operation.operation) {
      case "shell_execute":
        return await this.#execute(operation, context);
      case "shell_status":
        return this.#status(operation.processId);
      case "shell_input":
        return await this.#input(operation.processId, operation.input);
      case "shell_stop":
        await this.#stop(operation.processId);
        return this.#status(operation.processId);
      default:
        throw new Error("SHELL_OPERATION_NOT_SUPPORTED");
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.#processes.values()]
        .filter(({ state }) => state === "running")
        .map(({ id }) => this.#stop(id)),
    );
    await this.host.close();
  }

  async whenProcessCompletes(processId: string): Promise<void> {
    const record = this.#processes.get(processId);
    if (!record) throw new Error("SHELL_PROCESS_NOT_FOUND");
    await record.completion;
  }

  async #execute(
    operation: Extract<ToolOperation, { operation: "shell_execute" }>,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    const encoding = normalizeShellEncoding(operation.encoding);
    if (operation.command.includes("\0") || operation.args.some((arg) => arg.includes("\0"))) {
      throw new Error("SHELL_INVALID_ARGUMENT");
    }
    let cwd: string;
    let workspaceRoot: string;
    if (operation.workspaceGrantId) {
      if (operation.cwd !== undefined) throw new Error("SHELL_AMBIGUOUS_WORKSPACE");
      const conversationId = context.projection?.conversationId;
      if (!conversationId || !this.resolveWorkspaceGrant) {
        throw new Error("SHELL_WORKSPACE_GRANT_REQUIRED");
      }
      const grant = this.resolveWorkspaceGrant(operation.workspaceGrantId, conversationId);
      if (grant.access !== "read_write") throw new Error("SHELL_WORKSPACE_WRITE_NOT_GRANTED");
      if (operation.allowNetwork && !grant.allowNetwork)
        throw new Error("SHELL_NETWORK_NOT_GRANTED");
      workspaceRoot = realpathSync(grant.rootPath);
      const relativeCwd = operation.relativeCwd ?? ".";
      if (
        path.isAbsolute(relativeCwd) ||
        path.win32.isAbsolute(relativeCwd) ||
        relativeCwd.split(/[\\/]+/u).includes("..")
      ) {
        throw new Error("SHELL_CWD_OUT_OF_SCOPE");
      }
      cwd = realpathSync(path.resolve(workspaceRoot, relativeCwd));
    } else {
      if (!operation.cwd) throw new Error("SHELL_WORKSPACE_GRANT_REQUIRED");
      cwd = realpathSync(operation.cwd);
      const approved = this.#workspaceRoots.find((root) => inside(root, cwd));
      if (!approved) throw new Error("SHELL_CWD_OUT_OF_SCOPE");
      workspaceRoot = approved;
    }
    if (!inside(workspaceRoot, cwd)) throw new Error("SHELL_CWD_OUT_OF_SCOPE");
    const startedAt = Date.now();
    let record: ProcessRecord | undefined;
    const earlyOutput: Array<[string, "stdout" | "stderr", boolean]> = [];
    const output = (delta: string, stream: "stdout" | "stderr", truncated: boolean) => {
      if (!record) {
        earlyOutput.push([delta, stream, truncated]);
        return;
      }
      record.outputTruncated ||=
        truncated ||
        Buffer.byteLength(record.output, "utf8") + Buffer.byteLength(delta, "utf8") > OUTPUT_LIMIT;
      record.output = appendBounded(record.output, delta);
      if (stream === "stdout") record.stdout = appendBounded(record.stdout, delta);
      else record.stderr = appendBounded(record.stderr, delta);
      context.update(delta, record.outputTruncated);
    };
    const handle = await this.host.start({
      command: [operation.command, ...operation.args],
      cwd,
      writableRoot: workspaceRoot,
      timeoutMs: operation.timeoutMs,
      allowNetwork: operation.allowNetwork,
      encoding,
      signal: context.signal,
      onOutput: output,
    });
    record = {
      id: handle.processId,
      handle,
      output: "",
      stdout: "",
      stderr: "",
      state: "running",
      exitCode: null,
      startedAt,
      completedAt: null,
      isolation: handle.isolation ?? this.host.isolation ?? "codex-windows-restricted-token",
      outputTruncated: false,
      encoding,
      outputDecodingErrors: [],
      completion: Promise.resolve(),
    };
    this.#processes.set(record.id, record);
    for (const args of earlyOutput) output(...args);
    const abort = () => {
      void this.#stop(record?.id ?? handle.processId).catch(() => undefined);
    };
    context.signal.addEventListener("abort", abort, { once: true });
    const completed = handle.completion
      .then(
        (result) => {
          if (!record) return;
          record.exitCode = result.exitCode;
          record.completedAt = Date.now();
          record.outputTruncated ||= result.outputTruncated === true;
          record.outputDecodingErrors = result.outputDecodingErrors ?? [];
          if (result.timedOut) record.state = "timed_out";
          else if (result.stopped) record.state = "stopped";
          else if (record.state === "running") {
            record.state = result.exitCode === 0 ? "completed" : "failed";
          }
        },
        (error) => {
          if (!record) return;
          record.completedAt = Date.now();
          record.output = appendBounded(
            record.output,
            error instanceof Error ? error.message : String(error),
          );
          const outcome = error as { timedOut?: boolean; stopped?: boolean };
          if (outcome?.timedOut) record.state = "timed_out";
          else if (outcome?.stopped) record.state = "stopped";
          else if (record.state === "running") record.state = "failed";
          if (error instanceof Error && error.message.startsWith("SHELL_")) {
            record.failureCode = error.message;
          }
        },
      )
      .finally(() => context.signal.removeEventListener("abort", abort));
    record.completion = completed;
    if (context.signal.aborted) abort();
    if (operation.background) {
      void completed;
      return this.#normalized(record, `进程已启动：${record.id}`);
    }
    await completed;
    if (record.state === "failed") {
      const code = record.failureCode ?? `SHELL_EXIT_${record.exitCode ?? "SPAWN"}`;
      throw new ToolAdapterError(code, this.#normalized(record));
    }
    if (record.state === "timed_out")
      throw new ToolAdapterError("SHELL_TIMEOUT", this.#normalized(record));
    if (record.state === "stopped") throw new Error("SHELL_STOPPED");
    if (record.outputDecodingErrors.length > 0)
      throw new ToolAdapterError("SHELL_OUTPUT_DECODING_FAILED", this.#normalized(record));
    return this.#normalized(record);
  }

  #status(processId: string): NormalizedToolResult {
    const record = this.#processes.get(processId);
    if (!record) throw new Error("SHELL_PROCESS_NOT_FOUND");
    return this.#normalized(record);
  }

  async #input(processId: string, input: string): Promise<NormalizedToolResult> {
    const record = this.#processes.get(processId);
    if (record?.state !== "running") throw new Error("SHELL_PROCESS_NOT_RUNNING");
    await record.handle.write(input);
    return this.#normalized(record, "输入已发送");
  }

  async #stop(processId: string): Promise<void> {
    const record = this.#processes.get(processId);
    if (!record) throw new Error("SHELL_PROCESS_NOT_FOUND");
    if (record.state !== "running") return;
    record.state = "stopped";
    record.completedAt = Date.now();
    await record.handle.stop();
  }

  #normalized(record: ProcessRecord, summary?: string): NormalizedToolResult {
    const decodingError =
      record.outputDecodingErrors.length > 0
        ? `终端输出无法按声明的编码解码（${record.outputDecodingErrors.map((item) => `${item.stream}: ${item.encoding}`).join(", ")}）；真实退出码已保留。`
        : "";
    const text = [summary ?? (record.output || record.state), decodingError]
      .filter(Boolean)
      .join("\n");
    return {
      summary: text.slice(-8_000),
      content: [
        {
          type: "text",
          text: [record.output || summary || record.state, decodingError]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      data: {
        processId: record.id,
        state: record.state,
        exitCode: record.exitCode,
        outputTruncated: record.outputTruncated,
        isolation: record.isolation,
        encoding: record.encoding,
        outputDecodingErrors: record.outputDecodingErrors,
      },
      sources: [],
      artifacts: [],
      sideEffectCommitted: record.state !== "running",
      durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    };
  }
}
