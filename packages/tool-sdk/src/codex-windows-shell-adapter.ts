import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { NormalizedToolResult, ToolOperation, WorkspaceGrant } from "@openerx/contracts";
import { desktopBrand } from "../../branding/src/index";
import { type ToolAdapter, ToolAdapterError, type ToolExecutionContext } from "./types";

const OUTPUT_LIMIT = 2_000_000;

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WindowsSandboxCommandHandle {
  readonly processId: string;
  readonly completion: Promise<CommandResult>;
  write(input: string): Promise<void>;
  stop(): Promise<void>;
}

export interface WindowsSandboxCommandHost {
  start(input: {
    command: string[];
    cwd: string;
    writableRoot: string;
    timeoutMs: number;
    allowNetwork: boolean;
    onOutput(delta: string, stream: "stdout" | "stderr", truncated: boolean): void;
  }): Promise<WindowsSandboxCommandHandle>;
  close(): Promise<void>;
}

export interface CodexWindowsSandboxProbe {
  platform?: NodeJS.Platform;
  codexExecutable?: string | null;
  setupMarkerExists?: boolean;
  helpersExist?: boolean;
}

function codexHome(): string | null {
  const profile = process.env.USERPROFILE;
  return profile ? path.join(profile, ".codex") : null;
}

export function findCodexExecutable(): string | null {
  const configured = process.env.OPENERX_CODEX_EXECUTABLE;
  if (configured && existsSync(configured)) return realpathSync(configured);
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  if (!existsSync(binRoot)) return null;
  const candidates = readdirSync(binRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(binRoot, entry.name, "codex.exe"))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0] ? realpathSync(candidates[0]) : null;
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

export class CodexWindowsSandboxCommandHost implements WindowsSandboxCommandHost {
  readonly #codexExecutable: string;
  readonly #pending = new Map<number, PendingRequest>();
  #child?: ChildProcessWithoutNullStreams;
  #startPromise?: Promise<void>;
  #nextId = 1;
  #stderr = "";
  #activeProcessId: string | null = null;

  constructor(codexExecutable = findCodexExecutable()) {
    if (!codexExecutable) throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE");
    this.#codexExecutable = codexExecutable;
  }

  async start(input: {
    command: string[];
    cwd: string;
    writableRoot: string;
    timeoutMs: number;
    allowNetwork: boolean;
    onOutput(delta: string, stream: "stdout" | "stderr", truncated: boolean): void;
  }): Promise<WindowsSandboxCommandHandle> {
    await this.#ensureStarted();
    if (this.#activeProcessId) throw new Error("SHELL_WINDOWS_COMMAND_ALREADY_RUNNING");
    const processId = randomUUID();
    this.#activeProcessId = processId;
    const completion = this.#request(
      "command/exec",
      {
        command: input.command,
        timeoutMs: input.timeoutMs,
        cwd: input.cwd,
        env: {
          TEMP: input.cwd,
          TMP: input.cwd,
          TMPDIR: input.cwd,
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
    )
      .then((value) => {
        const result = value as CommandResult;
        if (result.stdout) input.onOutput(result.stdout, "stdout", false);
        if (result.stderr) input.onOutput(result.stderr, "stderr", false);
        return result;
      })
      .finally(() => {
        if (this.#activeProcessId === processId) this.#activeProcessId = null;
      });
    return {
      processId,
      completion,
      write: async () => {
        throw new Error("SHELL_WINDOWS_INTERACTIVE_INPUT_UNAVAILABLE");
      },
      stop: async () => {
        if (this.#activeProcessId !== processId) return;
        await this.close();
      },
    };
  }

  async close(): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    this.#startPromise = undefined;
    this.#activeProcessId = null;
    if (!child) return;
    child.stdin.end();
    if (child.exitCode === null) child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("close", () => resolve());
    });
  }

  async #ensureStarted(): Promise<void> {
    this.#startPromise ??= this.#start();
    try {
      await this.#startPromise;
    } catch (error) {
      this.#startPromise = undefined;
      throw error;
    }
  }

  async #start(): Promise<void> {
    if (!codexWindowsSandboxReady({ codexExecutable: this.#codexExecutable })) {
      throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE");
    }
    this.#stderr = "";
    const child = spawn(this.#codexExecutable, ["app-server", "--stdio"], {
      cwd: path.dirname(this.#codexExecutable),
      env: safeAppServerEnvironment(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    const decoder = new StringDecoder("utf8");
    let buffered = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffered += decoder.write(chunk);
      while (true) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) this.#onMessage(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString("utf8")}`.slice(-8_000);
    });
    child.once("error", (error) => this.#failAll(error));
    child.once("close", () =>
      this.#failAll(new Error(this.#stderr || "SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED")),
    );
    try {
      await this.#request(
        "initialize",
        {
          clientInfo: {
            name: desktopBrand.id,
            title: desktopBrand.productName,
            version: "2.0",
          },
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
        5_000,
      );
      const readiness = (await this.#request("windowsSandbox/readiness", null, 5_000)) as {
        status?: string;
      };
      if (readiness.status !== "ready") {
        throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE");
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  #request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.#child;
    if (!child || child.exitCode !== null) {
      return Promise.reject(new Error("SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("SHELL_WINDOWS_CODEX_APP_SERVER_TIMEOUT"));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  #onMessage(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? "CODEX_APP_SERVER_ERROR"));
    else pending.resolve(message.result);
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
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
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function appendBounded(current: string, delta: string): string {
  if (current.length >= OUTPUT_LIMIT) return current;
  return current + delta.slice(0, OUTPUT_LIMIT - current.length);
}

export class CodexWindowsShellToolAdapter implements ToolAdapter {
  readonly operations = ["shell_execute", "shell_status", "shell_input", "shell_stop"] as const;
  readonly #workspaceRoots: string[];
  readonly #processes = new Map<string, ProcessRecord>();

  constructor(
    workspaceRoots: readonly string[],
    private readonly resolveWorkspaceGrant?: (
      workspaceGrantId: string,
      conversationId: string,
    ) => WorkspaceGrant,
    private readonly host: WindowsSandboxCommandHost = new CodexWindowsSandboxCommandHost(),
  ) {
    this.#workspaceRoots = workspaceRoots.map((root) => realpathSync(root));
  }

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
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

  async #execute(
    operation: Extract<ToolOperation, { operation: "shell_execute" }>,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
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
    const handle = await this.host.start({
      command: [operation.command, ...operation.args],
      cwd,
      writableRoot: workspaceRoot,
      timeoutMs: operation.timeoutMs,
      allowNetwork: operation.allowNetwork,
      onOutput: (delta, stream) => {
        if (!record) return;
        record.output = appendBounded(record.output, delta);
        if (stream === "stdout") record.stdout = appendBounded(record.stdout, delta);
        else record.stderr = appendBounded(record.stderr, delta);
        context.update(delta, record.output.length >= OUTPUT_LIMIT);
      },
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
    };
    this.#processes.set(record.id, record);
    const abort = () => void this.#stop(record?.id ?? handle.processId);
    context.signal.addEventListener("abort", abort, { once: true });
    const completed = handle.completion
      .then(
        (result) => {
          if (!record) return;
          record.exitCode = result.exitCode;
          record.completedAt = Date.now();
          if (record.state === "running") {
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
          if (record.state === "running") record.state = "failed";
        },
      )
      .finally(() => context.signal.removeEventListener("abort", abort));
    if (operation.background) {
      void completed;
      return this.#normalized(record, `进程已启动：${record.id}`);
    }
    await completed;
    if (record.state === "failed") {
      const code = `SHELL_EXIT_${record.exitCode ?? "SPAWN"}`;
      throw new ToolAdapterError(code, this.#normalized(record));
    }
    if (record.state === "stopped") throw new Error("SHELL_STOPPED");
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
    const text = summary ?? (record.output || record.state);
    return {
      summary: text.slice(-8_000),
      content: [{ type: "text", text: record.output || text }],
      data: {
        processId: record.id,
        state: record.state,
        exitCode: record.exitCode,
        outputTruncated: record.output.length >= OUTPUT_LIMIT,
        isolation: "codex-windows-restricted-token",
      },
      sources: [],
      artifacts: [],
      sideEffectCommitted: record.state !== "running",
      durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    };
  }
}
