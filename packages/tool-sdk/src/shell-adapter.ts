import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { NormalizedToolResult, ToolOperation } from "@openerx/contracts";
import type { ToolAdapter, ToolExecutionContext } from "./types";

const OUTPUT_LIMIT = 2_000_000;
const BLOCKED_NETWORK_COMMANDS = new Set([
  "curl",
  "wget",
  "ftp",
  "ssh",
  "scp",
  "sftp",
  "telnet",
  "nc",
  "ncat",
  "ping",
]);

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

function shellEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR"];
  return Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  ) as NodeJS.ProcessEnv;
}

function appendOutput(record: ProcessRecord, chunk: Buffer): void {
  if (record.output.length >= OUTPUT_LIMIT) return;
  record.output += chunk.toString("utf8").slice(0, OUTPUT_LIMIT - record.output.length);
}

function sandboxPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function executableDirectory(command: string, cwd: string): string | null {
  const candidates = command.includes(path.sep)
    ? [path.resolve(cwd, command)]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((entry) => path.join(entry, command));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) return null;
  return path.dirname(path.dirname(realpathSync(executable)));
}

function sandboxedCommand(
  command: string,
  args: string[],
  cwd: string,
  allowNetwork: boolean,
): { command: string; args: string[]; isolation: "macos-sandbox" | "policy" } {
  if (!allowNetwork && process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
    const readRoots = [cwd, executableDirectory(command, cwd)].filter((value): value is string =>
      Boolean(value),
    );
    const readRules = readRoots.map((root) => `(subpath "${sandboxPath(root)}")`).join(" ");
    const profile = [
      "(version 1)",
      "(deny default)",
      "(allow process*)",
      "(allow sysctl-read)",
      "(allow mach-lookup)",
      "(allow file-read*)",
      '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/Network"))',
      `(allow file-read* ${readRules})`,
      `(allow file-write* (subpath "${sandboxPath(cwd)}"))`,
      '(allow file-write* (subpath "/private/tmp"))',
      "(deny network*)",
    ].join(" ");
    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-p", profile, command, ...args],
      isolation: "macos-sandbox",
    };
  }
  if (!allowNetwork) {
    const basename = path.basename(command).toLowerCase();
    if (BLOCKED_NETWORK_COMMANDS.has(basename)) throw new Error("SHELL_NETWORK_DENIED");
    if (["sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "pwsh"].includes(basename)) {
      throw new Error("SHELL_INTERPRETER_DENIED_WITHOUT_OS_SANDBOX");
    }
  }
  return { command, args, isolation: "policy" };
}

export class ShellToolAdapter implements ToolAdapter {
  readonly operations = ["shell_execute", "shell_status", "shell_input", "shell_stop"] as const;
  readonly #workspaceRoots: string[];
  readonly #processes = new Map<string, ProcessRecord>();

  constructor(workspaceRoots: readonly string[]) {
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
        return this.#input(operation.processId, operation.input);
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
    const cwd = realpathSync(operation.cwd);
    if (!this.#workspaceRoots.some((root) => inside(root, cwd)))
      throw new Error("SHELL_CWD_OUT_OF_SCOPE");
    const command = sandboxedCommand(
      operation.command,
      operation.args,
      cwd,
      operation.allowNetwork,
    );
    const child = spawn(command.command, command.args, {
      cwd,
      env: shellEnvironment(),
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
      throw new Error(
        `SHELL_EXIT_${record.exitCode ?? "SPAWN"}:${record.output.slice(-2_000) || "no output"}`,
      );
    }
    return {
      summary: record.output || `进程退出码 ${record.exitCode}`,
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
