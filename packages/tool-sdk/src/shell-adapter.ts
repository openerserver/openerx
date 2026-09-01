import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  HostToolAvailability,
  NormalizedToolResult,
  ToolOperation,
  WorkspaceGrant,
} from "@openerx/contracts";
import {
  CodexWindowsShellToolAdapter,
  codexWindowsSandboxReady,
  type WindowsSandboxCommandHost,
} from "./codex-windows-shell-adapter";
import { type ToolAdapter, ToolAdapterError, type ToolExecutionContext } from "./types";

const OUTPUT_LIMIT = 2_000_000;

export interface ShellAvailabilityProbe {
  platform?: NodeJS.Platform;
  sandboxExecutableExists?: boolean;
  windowsSandboxReady?: boolean;
}

export function shellToolAvailability(probe: ShellAvailabilityProbe = {}): HostToolAvailability {
  const platform = probe.platform ?? process.platform;
  const sandboxExecutableExists =
    probe.sandboxExecutableExists ?? existsSync("/usr/bin/sandbox-exec");
  if (platform === "darwin" && sandboxExecutableExists) {
    return {
      availableToolNames: ["openerx_shell", "openerx_shell_process"],
      unavailableReasons: {},
    };
  }
  if (platform === "win32" && (probe.windowsSandboxReady ?? codexWindowsSandboxReady())) {
    return {
      availableToolNames: ["openerx_shell", "openerx_shell_process"],
      unavailableReasons: {},
    };
  }
  return {
    availableToolNames: [],
    unavailableReasons: {
      openerx_shell:
        platform === "win32"
          ? "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE"
          : "SHELL_OS_SANDBOX_UNAVAILABLE",
      openerx_shell_process:
        platform === "win32"
          ? "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE"
          : "SHELL_OS_SANDBOX_UNAVAILABLE",
    },
  };
}

interface ProcessRecord {
  id: string;
  child: ChildProcessWithoutNullStreams;
  command: string;
  cwd: string;
  output: string;
  state: "running" | "completed" | "failed" | "stopped" | "timed_out";
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  timeout: NodeJS.Timeout;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shellEnvironment(cwd: string): NodeJS.ProcessEnv {
  const allowed = ["PATH", "LANG", "LC_ALL", "SystemRoot", "WINDIR"];
  return {
    ...Object.fromEntries(
      allowed.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
    ),
    TMPDIR: cwd,
    TEMP: cwd,
    TMP: cwd,
  } as NodeJS.ProcessEnv;
}

function appendOutput(record: ProcessRecord, chunk: Buffer): void {
  if (record.output.length >= OUTPUT_LIMIT) return;
  record.output += chunk.toString("utf8").slice(0, OUTPUT_LIMIT - record.output.length);
}

function sandboxPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function executablePath(command: string, cwd: string): string | null {
  const candidates = command.includes(path.sep)
    ? [path.resolve(cwd, command)]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((entry) => path.join(entry, command));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) return null;
  return realpathSync(executable);
}

function sandboxedCommand(
  command: string,
  args: string[],
  cwd: string,
  workspaceRoot: string,
  allowNetwork: boolean,
): { command: string; args: string[]; isolation: "macos-sandbox" } {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
    throw new Error("SHELL_OS_SANDBOX_UNAVAILABLE");
  }
  const executable = executablePath(command, cwd);
  if (!executable) throw new Error("SHELL_EXECUTABLE_NOT_FOUND");
  const systemReadRoots = [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/private/etc",
    "/private/var/db",
    "/private/var/run",
    "/dev",
    "/opt/homebrew",
  ].filter(existsSync);
  const readRules = [workspaceRoot, ...systemReadRoots]
    .map((root) => `(subpath "${sandboxPath(root)}")`)
    .join(" ");
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read-metadata)",
    '(allow file-read-data (literal "/"))',
    `(allow file-read* ${readRules} (literal "${sandboxPath(executable)}"))`,
    `(allow file-write* (subpath "${sandboxPath(workspaceRoot)}"))`,
    allowNetwork ? "(allow network*)" : "(deny network*)",
  ].join(" ");
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-p", profile, executable, ...args],
    isolation: "macos-sandbox",
  };
}

export class ShellToolAdapter implements ToolAdapter {
  readonly operations = ["shell_execute", "shell_status", "shell_input", "shell_stop"] as const;
  readonly #workspaceRoots: string[];
  readonly #processes = new Map<string, ProcessRecord>();
  readonly #windowsAdapter?: CodexWindowsShellToolAdapter;

  constructor(
    workspaceRoots: readonly string[],
    private readonly resolveWorkspaceGrant?: (
      workspaceGrantId: string,
      conversationId: string,
    ) => WorkspaceGrant,
    windowsHost?: WindowsSandboxCommandHost,
  ) {
    this.#workspaceRoots = workspaceRoots.map((root) => realpathSync(root));
    if (process.platform === "win32" && (windowsHost || codexWindowsSandboxReady())) {
      this.#windowsAdapter = new CodexWindowsShellToolAdapter(
        workspaceRoots,
        resolveWorkspaceGrant,
        windowsHost,
      );
    }
  }

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (this.#windowsAdapter) return await this.#windowsAdapter.execute(operation, context);
    if (process.platform === "win32") {
      throw new Error("SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE");
    }
    switch (operation.operation) {
      case "shell_execute":
        return await this.#execute(operation, context);
      case "shell_status":
        return this.#status(operation.processId);
      case "shell_input":
        return this.#input(operation.processId, operation.input);
      case "shell_stop":
        await this.#stop(operation.processId);
        return this.#status(operation.processId);
      default:
        throw new Error("SHELL_OPERATION_NOT_SUPPORTED");
    }
  }

  async stopAll(): Promise<void> {
    if (this.#windowsAdapter) {
      await this.#windowsAdapter.stopAll();
      return;
    }
    await Promise.all(
      [...this.#processes.values()]
        .filter((record) => record.state === "running")
        .map((record) => this.#stop(record.id)),
    );
  }

  async #execute(
    operation: Extract<ToolOperation, { operation: "shell_execute" }>,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (
      operation.command.includes("\0") ||
      operation.args.some((argument) => argument.includes("\0"))
    ) {
      throw new Error("SHELL_INVALID_ARGUMENT");
    }
    let cwd: string;
    let workspaceRoot: string;
    if (operation.workspaceGrantId) {
      if (operation.cwd !== undefined) throw new Error("SHELL_AMBIGUOUS_WORKSPACE");
      const conversationId = context.projection?.conversationId;
      if (!conversationId || !this.resolveWorkspaceGrant)
        throw new Error("SHELL_WORKSPACE_GRANT_REQUIRED");
      const grant = this.resolveWorkspaceGrant(operation.workspaceGrantId, conversationId);
      if (grant.access !== "read_write") throw new Error("SHELL_WORKSPACE_WRITE_NOT_GRANTED");
      if (operation.allowNetwork && !grant.allowNetwork)
        throw new Error("SHELL_NETWORK_NOT_GRANTED");
      workspaceRoot = realpathSync(grant.rootPath);
      const requestedRelativeCwd = operation.relativeCwd ?? ".";
      const relative = requestedRelativeCwd.split(/[\\/]+/u);
      if (
        path.isAbsolute(requestedRelativeCwd) ||
        path.win32.isAbsolute(requestedRelativeCwd) ||
        relative.some((segment) => segment === "..")
      ) {
        throw new Error("SHELL_CWD_OUT_OF_SCOPE");
      }
      cwd = realpathSync(path.resolve(workspaceRoot, requestedRelativeCwd));
      if (!inside(workspaceRoot, cwd)) throw new Error("SHELL_CWD_OUT_OF_SCOPE");
    } else {
      if (!operation.cwd) throw new Error("SHELL_WORKSPACE_GRANT_REQUIRED");
      cwd = realpathSync(operation.cwd);
      const approvedRoot = this.#workspaceRoots.find((root) => inside(root, cwd));
      if (!approvedRoot) throw new Error("SHELL_CWD_OUT_OF_SCOPE");
      workspaceRoot = approvedRoot;
    }
    const command = sandboxedCommand(
      operation.command,
      operation.args,
      cwd,
      workspaceRoot,
      operation.allowNetwork,
    );
    const child = spawn(command.command, command.args, {
      cwd,
      env: shellEnvironment(cwd),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const record: ProcessRecord = {
      id: randomUUID(),
      child,
      command: [operation.command, ...operation.args].join(" "),
      cwd,
      output: "",
      state: "running",
      exitCode: null,
      startedAt: Date.now(),
      completedAt: null,
      timeout: setTimeout(() => {
        record.state = "timed_out";
        void this.#terminate(record);
      }, operation.timeoutMs),
    };
    this.#processes.set(record.id, record);
    child.stdout.on("data", (chunk: Buffer) => {
      appendOutput(record, chunk);
      context.update(record.output.slice(-2_000));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      appendOutput(record, chunk);
      context.update(record.output.slice(-2_000));
    });
    const completed = new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        clearTimeout(record.timeout);
        appendOutput(record, Buffer.from(error.message));
        record.state = "failed";
        record.completedAt = Date.now();
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(record.timeout);
        record.exitCode = exitCode;
        record.completedAt = Date.now();
        if (record.state === "running") record.state = exitCode === 0 ? "completed" : "failed";
        resolve();
      });
    });
    const abort = () => void this.#stop(record.id);
    context.signal.addEventListener("abort", abort, { once: true });
    if (operation.background) {
      void completed
        .catch(() => undefined)
        .finally(() => context.signal.removeEventListener("abort", abort));
      return {
        summary: `进程已启动：${record.id}`,
        content: [{ type: "text", text: `进程已启动：${record.id}` }],
        data: { processId: record.id, state: record.state, isolation: command.isolation },
        sources: [],
        artifacts: [],
        sideEffectCommitted: true,
        durationMs: Date.now() - record.startedAt,
      };
    }
    await completed;
    context.signal.removeEventListener("abort", abort);
    if (record.state === "timed_out") throw new Error("SHELL_TIMEOUT");
    if (record.state === "stopped") throw new Error("SHELL_STOPPED");
    if (record.state === "failed") {
      const code = `SHELL_EXIT_${record.exitCode ?? "SPAWN"}`;
      throw new ToolAdapterError(code, {
        summary: record.output.slice(-8_000) || code,
        content: [{ type: "text", text: record.output || code }],
        data: {
          processId: record.id,
          state: record.state,
          exitCode: record.exitCode,
          outputTruncated: record.output.length >= OUTPUT_LIMIT,
          isolation: command.isolation,
        },
        sources: [],
        artifacts: [],
        sideEffectCommitted: true,
        durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
      });
    }
    return {
      summary: record.output || `进程退出码 ${record.exitCode}`,
      content: [{ type: "text", text: record.output || `进程退出码 ${record.exitCode}` }],
      data: {
        processId: record.id,
        state: record.state,
        exitCode: record.exitCode,
        isolation: command.isolation,
      },
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    };
  }

  #status(processId: string): NormalizedToolResult {
    const record = this.#processes.get(processId);
    if (!record) throw new Error("SHELL_PROCESS_NOT_FOUND");
    return {
      summary: record.output.slice(-8_000) || record.state,
      content: [{ type: "text", text: record.output.slice(-8_000) || record.state }],
      data: {
        processId: record.id,
        state: record.state,
        exitCode: record.exitCode,
        outputTruncated: record.output.length >= OUTPUT_LIMIT,
      },
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 0,
    };
  }

  #input(processId: string, input: string): NormalizedToolResult {
    const record = this.#processes.get(processId);
    if (record?.state !== "running") throw new Error("SHELL_PROCESS_NOT_RUNNING");
    record.child.stdin.write(input);
    return {
      summary: "输入已发送",
      content: [{ type: "text", text: "输入已发送" }],
      data: { processId },
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 0,
    };
  }

  async #stop(processId: string): Promise<void> {
    const record = this.#processes.get(processId);
    if (!record) throw new Error("SHELL_PROCESS_NOT_FOUND");
    if (record.state !== "running") return;
    record.state = "stopped";
    await this.#terminate(record);
  }

  async #terminate(record: ProcessRecord): Promise<void> {
    clearTimeout(record.timeout);
    if (record.child.pid) {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(record.child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        await new Promise<void>((resolve) => killer.once("close", () => resolve()));
      } else {
        try {
          process.kill(-record.child.pid, "SIGTERM");
        } catch {
          record.child.kill("SIGTERM");
        }
        const force = setTimeout(() => {
          try {
            process.kill(-(record.child.pid as number), "SIGKILL");
          } catch {
            record.child.kill("SIGKILL");
          }
        }, 2_000);
        force.unref();
      }
    }
  }
}
