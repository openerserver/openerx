import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CodexWindowsSandboxBackend,
  CodexWindowsSandboxCommandHost,
  CodexWindowsShellToolAdapter,
  codexWindowsSandboxReady,
  type ResolvedCodexWindowsSandboxBackend,
} from "../src/codex-windows-shell-adapter";
import type { ToolExecutionContext } from "../src/types";

interface RpcRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}
interface FakeCommand {
  request: RpcRequest;
  outputBytes: Record<"stdout" | "stderr", number>;
}

// A bidirectional JSON-RPC server with independent command lifetimes. Notifications
// precede the deferred exec response, just as the native command protocol requires.
class CommandServer extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  requests: RpcRequest[] = [];
  commands = new Map<string, FakeCommand>();
  exitCode: number | null = null;
  killed = false;
  holdInitialize = false;
  lateClose = false;
  readinessError: string | undefined;
  probeError: string | undefined;
  timers = new Set<NodeJS.Timeout>();
  stdin = new Writable({
    write: (bytes, _encoding, done) => {
      for (const line of bytes.toString("utf8").trim().split("\n")) {
        const request = JSON.parse(line) as RpcRequest;
        this.requests.push(request);
        queueMicrotask(() => this.dispatch(request));
      }
      done();
    },
  });

  reply(request: RpcRequest, result: unknown) {
    this.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
  }
  output(processId: string, bytes: Buffer, stream: "stdout" | "stderr" = "stdout") {
    const command = this.commands.get(processId);
    if (!command) return;
    const cap = command.request.params.outputBytesCap as number;
    const available = Math.max(0, cap - command.outputBytes[stream]);
    const accepted = bytes.subarray(0, available);
    command.outputBytes[stream] += accepted.length;
    this.stdout.write(
      `${JSON.stringify({
        method: "command/exec/outputDelta",
        params: {
          processId,
          stream,
          deltaBase64: accepted.toString("base64"),
          capReached: bytes.length > available,
        },
      })}\n`,
    );
  }
  finish(processId: string, exitCode = 0) {
    const command = this.commands.get(processId);
    if (!command) return;
    this.commands.delete(processId);
    this.reply(command.request, { exitCode, stdout: "", stderr: "" });
  }
  dispatch(request: RpcRequest) {
    if (this.killed) return;
    if (request.method === "initialize") {
      if (!this.holdInitialize) this.reply(request, {});
    } else if (request.method === "windowsSandbox/readiness") {
      if (this.readinessError)
        this.stdout.write(
          `${JSON.stringify({ id: request.id, error: { code: -32000, message: this.readinessError } })}\n`,
        );
      else this.reply(request, { status: "ready" });
    } else if (request.method === "windowsSandbox/setupStart") {
      this.reply(request, { started: true });
      this.stdout.write(
        `${JSON.stringify({ method: "windowsSandbox/setupCompleted", params: { mode: "elevated", success: true } })}\n`,
      );
    } else if (request.method === "command/exec") {
      const p = request.params;
      expect(p).toMatchObject({
        streamStdin: true,
        streamStdoutStderr: true,
        outputBytesCap: 2_000_000,
        sandboxPolicy: { type: "workspaceWrite", excludeTmpdirEnvVar: true, excludeSlashTmp: true },
      });
      expect(p).not.toHaveProperty("permissionProfile");
      const processId = p.processId as string;
      this.commands.set(processId, { request, outputBytes: { stdout: 0, stderr: 0 } });
      const mode = (p.command as string[])[1];
      if ((p.command as string[]).includes("echo OPENERX_SANDBOX_READY")) {
        if (this.probeError) {
          this.stdout.write(
            `${JSON.stringify({ id: request.id, error: { code: 1385, message: this.probeError } })}\n`,
          );
          this.commands.delete(processId);
        } else {
          this.output(processId, Buffer.from("OPENERX_SANDBOX_READY\r\n"));
          this.finish(processId);
        }
      } else if (mode === "fail-native") {
        this.stdout.write(
          `${JSON.stringify({ id: request.id, error: { code: 1385, message: "Windows logon type denied: 1385" } })}\n`,
        );
        this.commands.delete(processId);
      } else if (mode === "unicode") {
        for (const stream of ["stdout", "stderr"] as const) {
          for (const byte of Buffer.from("中文😀\n"))
            this.output(processId, Buffer.from([byte]), stream);
        }
        this.finish(processId);
      } else if (mode === "large") {
        this.output(processId, Buffer.alloc(2_100_000, "x"));
        this.finish(processId);
      } else if (mode === "declared-codecs") {
        for (const byte of Buffer.from("d6d0cec4", "hex"))
          this.output(processId, Buffer.from([byte]));
        for (const byte of Buffer.from("中文🙂", "utf16le"))
          this.output(processId, Buffer.from([byte]), "stderr");
        this.finish(processId);
      } else if (mode === "invalid-tail") {
        this.output(processId, Buffer.from("e4b8", "hex"));
        this.finish(processId);
      } else if (mode === "large-cp936") {
        this.output(processId, Buffer.from("d6d0".repeat(700_000), "hex"));
        this.finish(processId);
      } else if (mode === "encoded-input") {
        // Keep pending without emitting bytes in an assumed codec.
      } else if (mode === "exit124") this.finish(processId, 124);
      else this.output(processId, Buffer.from("ready:"));
    } else if (request.method === "command/exec/write") {
      const processId = request.params.processId as string;
      this.output(processId, Buffer.from(request.params.deltaBase64 as string, "base64"));
      this.reply(request, {});
      this.finish(processId);
    } else if (request.method === "command/exec/terminate") {
      const processId = request.params.processId as string;
      const command = this.commands.get(processId);
      this.reply(request, {});
      if ((command?.request.params.command as string[] | undefined)?.[1] !== "stalled-terminate") {
        this.finish(processId, 137);
      }
    } else throw new Error(`Unexpected protocol method: ${request.method}`);
  }
  kill() {
    this.killed = true;
    this.exitCode = 1;
    this.commands.clear();
    for (const timer of this.timers) clearTimeout(timer);
    if (!this.lateClose) queueMicrotask(() => this.emit("close", 1));
    return true;
  }
}

const directories: string[] = [];
const hosts: CodexWindowsSandboxCommandHost[] = [];
const workspace = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-command-host-test-"));
  directories.push(directory);
  return directory;
};
function fakeHost(configure?: (server: CommandServer, index: number) => void) {
  const servers: CommandServer[] = [];
  const runtime = {
    validateProtocol: vi.fn(async () => undefined),
    selectBackend: vi.fn(
      async (
        _executable: string,
        _preference: CodexWindowsSandboxBackend,
        _cwd?: string,
      ): Promise<ResolvedCodexWindowsSandboxBackend> => "mxc",
    ),
    spawn: vi.fn((_executable: string, _args: string[], _cwd?: string) => {
      const server = new CommandServer();
      configure?.(server, servers.length);
      servers.push(server);
      return server as unknown as ChildProcessWithoutNullStreams;
    }),
  };
  const host = new CodexWindowsSandboxCommandHost(process.execPath, "auto", runtime);
  hosts.push(host);
  return { host, servers, runtime };
}
function command(cwd: string, mode: string, extra: Record<string, unknown> = {}) {
  return {
    command: [process.execPath, mode],
    cwd,
    writableRoot: cwd,
    timeoutMs: 10_000,
    allowNetwork: false,
    onOutput: vi.fn(),
    ...extra,
  };
}
function context(signal = new AbortController().signal): ToolExecutionContext {
  return { signal, toolCallId: "command-host-test", update: vi.fn() };
}
function operation(cwd: string, mode: string, extra: Record<string, unknown> = {}) {
  return {
    operation: "shell_execute" as const,
    cwd,
    command: process.execPath,
    args: [mode],
    timeoutMs: 10_000,
    background: false,
    allowNetwork: false,
    idempotencyKey: mode,
    ...extra,
  };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("sandboxed Windows command JSON-RPC", () => {
  it("decodes declared streams independently without changing argv or guessing encodings", async () => {
    const { host, servers } = fakeHost();
    const input = command(workspace(), "declared-codecs", {
      encoding: { stdout: "cp936", stderr: "utf16le" },
    });
    const handle = await host.start(input);
    await expect(handle.completion).resolves.toMatchObject({
      stdout: "中文",
      stderr: "中文🙂",
      outputDecodingErrors: [],
      outputTruncated: false,
    });
    const request = servers[0]!.requests.find((item) => item.method === "command/exec");
    expect(request?.params.command).toEqual(input.command);
    expect(request?.params).not.toHaveProperty("encoding");
  });

  it("reports invalid output with the real successful exit status instead of replacing text", async () => {
    const { host } = fakeHost();
    const root = workspace();
    const adapter = new CodexWindowsShellToolAdapter([root], undefined, host);
    await expect(adapter.execute(operation(root, "invalid-tail"), context())).rejects.toMatchObject(
      {
        code: "SHELL_OUTPUT_DECODING_FAILED",
        result: {
          data: {
            state: "completed",
            exitCode: 0,
            outputDecodingErrors: [
              { stream: "stdout", encoding: "utf8", code: "SHELL_OUTPUT_DECODING_FAILED" },
            ],
          },
        },
      },
    );
  });

  it("caps decoded CP936 output by UTF-8 bytes even below the native raw-byte limit", async () => {
    const { host } = fakeHost();
    const handle = await host.start(
      command(workspace(), "large-cp936", { encoding: { stdout: "cp936" } }),
    );
    const result = await handle.completion;
    expect(Buffer.byteLength(result.stdout, "utf8")).toBe(1_999_998);
    expect(result.outputTruncated).toBe(true);
    expect(result.outputDecodingErrors).toEqual([]);
    expect(result.stdout).not.toContain("\uFFFD");
  });

  it("encodes stdin per process and refuses unrepresentable input before a write RPC", async () => {
    const { host, servers } = fakeHost();
    const root = workspace();
    const cp936 = await host.start(
      command(root, "encoded-input", { encoding: { stdin: "cp936", stdout: "cp936" } }),
    );
    const utf16 = await host.start(
      command(root, "encoded-input", { encoding: { stdin: "utf16le", stdout: "utf16le" } }),
    );
    await expect(cp936.write("🙂")).rejects.toThrow("SHELL_INPUT_ENCODING_UNREPRESENTABLE");
    expect(
      servers[0]!.requests.filter((item) => item.method === "command/exec/write"),
    ).toHaveLength(0);
    await cp936.write("中文");
    await utf16.write("中文🙂");
    await expect(cp936.completion).resolves.toMatchObject({ stdout: "中文" });
    await expect(utf16.completion).resolves.toMatchObject({ stdout: "中文🙂" });
    const writes = servers[0]!.requests.filter((item) => item.method === "command/exec/write");
    expect(Buffer.from(writes[0]!.params.deltaBase64 as string, "base64").toString("hex")).toBe(
      "d6d0cec4",
    );
  });

  it("rejects unknown declared encoding before starting a server or executing argv", async () => {
    const { host, runtime } = fakeHost();
    await expect(
      host.start(command(workspace(), "interactive", { encoding: { stdout: "auto" } })),
    ).rejects.toThrow("SHELL_ENCODING_UNSUPPORTED");
    expect(runtime.spawn).not.toHaveBeenCalled();
  });

  it("streams split UTF-8 independently for stdout/stderr without duplicating final output", async () => {
    const { host, servers } = fakeHost();
    const input = command(workspace(), "unicode");
    const handle = await host.start(input);
    await expect(handle.completion).resolves.toMatchObject({
      stdout: "中文😀\n",
      stderr: "中文😀\n",
      outputTruncated: false,
    });
    for (const stream of ["stdout", "stderr"] as const) {
      expect(
        input.onOutput.mock.calls
          .filter((call) => call[1] === stream)
          .map((call) => call[0])
          .join(""),
      ).toBe("中文😀\n");
    }
    expect(servers[0]!.requests.filter((r) => r.method === "command/exec")).toHaveLength(1);
  });

  it("exposes live output, encodes input, and terminates only the selected concurrent command", async () => {
    const { host, servers } = fakeHost();
    const root = workspace();
    const first = await host.start(command(root, "interactive"));
    const secondInput = command(root, "interactive");
    const second = await host.start(secondInput);
    await vi.waitFor(() =>
      expect(secondInput.onOutput).toHaveBeenCalledWith("ready:", "stdout", false),
    );
    expect(servers[0]!.commands.size).toBe(2);
    await first.stop();
    expect(servers[0]!.killed).toBe(false);
    expect(servers[0]!.commands.has(second.processId)).toBe(true);
    await second.write("输入😀\n");
    await expect(second.completion).resolves.toMatchObject({
      stdout: "ready:输入😀\n",
      stopped: false,
    });
    await expect(first.completion).resolves.toMatchObject({ stopped: true });
    expect(servers[0]!.requests.every((r) => !r.method.startsWith("process/"))).toBe(true);
  });

  it("reports server output caps and preserves adapter completion state for background collection", async () => {
    const { host } = fakeHost();
    const adapter = new CodexWindowsShellToolAdapter([workspace()], undefined, host);
    const root = directories.at(-1)!;
    const result = await adapter.execute(operation(root, "large", { background: true }), context());
    const processId = (result.data as { processId: string }).processId;
    await adapter.whenProcessCompletes(processId);
    const status = await adapter.execute(
      { operation: "shell_status", processId, idempotencyKey: "large-status" },
      context(),
    );
    expect(status.data).toMatchObject({ state: "completed", outputTruncated: true });
    expect(
      Buffer.byteLength(
        status.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      ),
    ).toBe(2_000_000);
    await expect(adapter.whenProcessCompletes("missing")).rejects.toThrow(
      "SHELL_PROCESS_NOT_FOUND",
    );
  });

  it("never dispatches a pre-aborted command or a command cancelled during initialization", async () => {
    const { host, servers, runtime } = fakeHost((server) => {
      server.holdInitialize = true;
    });
    const root = workspace();
    const controller = new AbortController();
    controller.abort();
    await expect(
      host.start(command(root, "interactive", { signal: controller.signal })),
    ).rejects.toThrow();
    expect(runtime.spawn).not.toHaveBeenCalled();
    const during = new AbortController();
    const pending = host.start(command(root, "interactive", { signal: during.signal }));
    await vi.waitFor(() => expect(servers[0]?.requests[0]?.method).toBe("initialize"));
    during.abort();
    await expect(pending).rejects.toThrow();
    servers[0]!.reply(servers[0]!.requests[0]!, {});
    const next = await host.start(command(root, "unicode"));
    await next.completion;
    expect(servers[0]!.requests.filter((r) => r.method === "command/exec")).toHaveLength(1);
  });

  it("distinguishes a host deadline from an ordinary exit 124 and normalizes both records", async () => {
    const { host, servers } = fakeHost();
    const root = workspace();
    const adapter = new CodexWindowsShellToolAdapter([root], undefined, host);
    await expect(
      adapter.execute(operation(root, "interactive", { timeoutMs: 30 }), context()),
    ).rejects.toMatchObject({ code: "SHELL_TIMEOUT", result: { data: { state: "timed_out" } } });
    await expect(adapter.execute(operation(root, "exit124"), context())).rejects.toMatchObject({
      code: "SHELL_EXIT_124",
      result: { data: { state: "failed", exitCode: 124 } },
    });
    expect(servers[0]!.killed).toBe(false);
  });

  it("fails closed when termination stalls instead of leaving a ghost command", async () => {
    vi.useFakeTimers();
    const { host, servers } = fakeHost();
    const handle = await host.start(command(workspace(), "stalled-terminate", { timeoutMs: 100 }));
    const completed = expect(handle.completion).rejects.toMatchObject({ timedOut: true });
    await vi.advanceTimersByTimeAsync(5_101);
    await completed;
    expect(servers[0]!.killed).toBe(true);
    expect(servers[0]!.commands.size).toBe(0);
  });

  it("recovers after server death while late old-connection events cannot reject new work", async () => {
    const { host, servers } = fakeHost((server, index) => {
      server.lateClose = index === 0;
    });
    const root = workspace();
    const old = await host.start(command(root, "interactive"));
    const rejected = expect(old.completion).rejects.toThrow(
      "SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED",
    );
    servers[0]!.emit("error", new Error("fixture connection death"));
    await rejected;
    const next = await host.start(command(root, "interactive"));
    servers[0]!.emit("close", 1);
    await next.write("new connection");
    await expect(next.completion).resolves.toMatchObject({ stdout: "ready:new connection" });
    expect(servers).toHaveLength(2);
  });

  it("handles stdin pipe errors by rejecting pending work and reconnecting", async () => {
    const { host, servers } = fakeHost();
    const root = workspace();
    const running = await host.start(command(root, "interactive"));
    const rejected = expect(running.completion).rejects.toThrow(
      "SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED",
    );
    expect(() =>
      servers[0]!.stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" })),
    ).not.toThrow();
    await rejected;
    expect(servers[0]!.killed).toBe(true);
    const next = await host.start(command(root, "interactive"));
    await next.write("recovered stdin");
    await expect(next.completion).resolves.toMatchObject({ stdout: "ready:recovered stdin" });
    expect(servers).toHaveLength(2);
  });

  it("rejects an unsupported protocol before spawning or executing a user command", async () => {
    const { host, runtime } = fakeHost();
    runtime.validateProtocol.mockRejectedValue(
      new Error("SHELL_WINDOWS_CODEX_COMMAND_PROTOCOL_UNSUPPORTED"),
    );
    await expect(host.start(command(workspace(), "interactive"))).rejects.toThrow(
      "SHELL_WINDOWS_CODEX_COMMAND_PROTOCOL_UNSUPPORTED",
    );
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(runtime.selectBackend).not.toHaveBeenCalled();
  });

  it("checks the executable's generated protocol and rejects an incompatible executable without starting work", async () => {
    const spawn = vi.fn<() => ChildProcessWithoutNullStreams>();
    const selectBackend = vi.fn(async () => "mxc" as const);
    const host = new CodexWindowsSandboxCommandHost(process.execPath, "auto", {
      spawn,
      selectBackend,
    });
    hosts.push(host);
    // Node cannot generate Codex's protocol. This exercises the real asynchronous
    // capability check and its temporary schema-directory cleanup, without a model.
    await expect(host.start(command(workspace(), "interactive"))).rejects.toThrow(
      "SHELL_WINDOWS_CODEX_PROTOCOL_CHECK_FAILED",
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(selectBackend).not.toHaveBeenCalled();
  });
});

describe("Windows sandbox startup recovery", () => {
  it("does not mark an unusable sandbox account ready", async () => {
    const { host } = fakeHost((server) => {
      server.probeError = "Windows logon type denied: 1385";
    });
    await expect(host.probe(workspace())).rejects.toMatchObject({
      diagnostic: { stage: "readiness", code: "SHELL_WINDOWS_CODEX_LOGON_DENIED" },
    });
  });

  it("checks actual sandbox execution during readiness inspection", async () => {
    const { host, servers } = fakeHost();
    const root = workspace();
    await expect(host.probe(root)).resolves.toBe("mxc");
    const probe = servers[0]?.requests.find(({ method }) => method === "command/exec");
    expect(probe?.params).toMatchObject({
      cwd: root,
      sandboxPolicy: { writableRoots: [root], networkAccess: false },
    });
    expect(probe?.params.command).toContain("echo OPENERX_SANDBOX_READY");
  });

  it("falls back only before user execution when MXC initialization fails", async () => {
    const { host, runtime, servers } = fakeHost((server, index) => {
      if (index === 0) server.readinessError = "MXC unavailable";
    });
    runtime.selectBackend.mockImplementation(async (_executable, preference) =>
      preference === "elevated" ? "elevated" : "mxc",
    );
    const handle = await host.start(command(workspace(), "unicode"));
    await expect(handle.completion).resolves.toMatchObject({ exitCode: 0, stdout: "中文😀\n" });
    expect(handle.isolation).toBe("codex-windows-restricted-token");
    expect(runtime.spawn.mock.calls[0]?.[1]).not.toContain("features.prefer_mxc=false");
    expect(runtime.spawn.mock.calls[1]?.[1]).toContain("features.prefer_mxc=false");
    expect(servers[0]!.requests.some(({ method }) => method === "command/exec")).toBe(false);
    expect(servers[1]!.requests.filter(({ method }) => method === "command/exec")).toHaveLength(1);
  });

  it("preserves command failure details and never retries an already dispatched command", async () => {
    const { host, runtime, servers } = fakeHost();
    const handle = await host.start(command(workspace(), "fail-native"));
    await expect(handle.completion).rejects.toMatchObject({
      diagnostic: {
        stage: "command",
        nativeCode: "1385",
        code: "SHELL_WINDOWS_CODEX_LOGON_DENIED",
      },
    });
    expect(runtime.selectBackend).toHaveBeenCalledTimes(1);
    expect(servers).toHaveLength(1);
    expect(servers[0]!.requests.filter(({ method }) => method === "command/exec")).toHaveLength(1);
  });

  it("keeps explicit MXC selection strict and does not fall back", async () => {
    const { runtime } = fakeHost((server) => {
      server.readinessError = "MXC unavailable";
    });
    const host = new CodexWindowsSandboxCommandHost(process.execPath, "mxc", runtime);
    hosts.push(host);
    await expect(host.start(command(workspace(), "unicode"))).rejects.toMatchObject({
      diagnostic: { backend: "mxc" },
    });
    expect(runtime.selectBackend).toHaveBeenCalledTimes(1);
    expect(runtime.spawn).toHaveBeenCalledTimes(1);
  });

  it("uses separate native configuration contexts for separate workspaces", async () => {
    const { host, runtime, servers } = fakeHost();
    const first = workspace();
    const second = workspace();
    await (await host.start(command(first, "unicode"))).completion;
    await (await host.start(command(second, "unicode"))).completion;
    expect(servers).toHaveLength(2);
    expect(runtime.spawn.mock.calls.map((call) => call[2])).toEqual([first, second]);
  });

  it("initializes legacy setup only through the explicit setup API", async () => {
    const { host, servers } = fakeHost();
    await host.setup(workspace());
    expect(servers[0]!.requests.map(({ method }) => method)).toEqual([
      "initialize",
      "windowsSandbox/setupStart",
    ]);
    expect(servers[0]!.requests.some(({ method }) => method === "command/exec")).toBe(false);
  });
});

describe.runIf(process.platform === "win32" && codexWindowsSandboxReady())(
  "native Windows sandbox command lifecycle",
  () => {
    it("runs the explicit UTF-8 PowerShell entrypoint including Chinese and emoji stdin", async () => {
      const host = new CodexWindowsSandboxCommandHost();
      hosts.push(host);
      const handle = await host.start({
        ...command(workspace(), "unused"),
        command: [
          "openerx-powershell",
          "[Console]::WriteLine('中文🙂'); [Console]::WriteLine([Console]::ReadLine())",
        ],
      });
      await handle.write("输入😀\n");
      await expect(handle.completion).resolves.toMatchObject({
        exitCode: 0,
        stdout: "中文🙂\r\n输入😀\r\n",
      });
    }, 30_000);
    it("decodes explicit CP936 cmd and UTF16LE cmd /u output without changing either argv", async () => {
      const root = workspace();
      const host = new CodexWindowsSandboxCommandHost();
      hosts.push(host);
      const cmd = path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "cmd.exe");
      for (const [args, encoding] of [
        [["/d", "/c", "echo CMD_中文"], "cp936"],
        [["/d", "/u", "/c", "echo CMD_中文🙂"], "utf16le"],
      ] as const) {
        const handle = await host.start({
          ...command(root, "unused"),
          command: [cmd, ...args],
          encoding: { stdout: encoding },
        });
        const result = await handle.completion;
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe(encoding === "cp936" ? "CMD_中文" : "CMD_中文🙂");
        expect(result.outputDecodingErrors).toEqual([]);
      }
    }, 30_000);

    it("round trips declared legacy stdin through actual native pipes", async () => {
      const root = workspace();
      const host = new CodexWindowsSandboxCommandHost();
      hosts.push(host);
      for (const encoding of ["cp936", "utf16le"] as const) {
        const updates: string[] = [];
        const handle = await host.start({
          ...command(root, "unused"),
          encoding: { stdin: encoding, stdout: encoding },
          command: [
            process.execPath,
            "-e",
            `process.stdout.write(Buffer.from('ready:',${JSON.stringify(encoding === "cp936" ? "ascii" : "utf16le")}));process.stdin.once('data',b=>{process.stdout.write(b);process.exit(0)});setInterval(()=>{},1000)`,
          ],
          onOutput: (text) => updates.push(text),
        });
        await vi.waitFor(() => expect(updates.join("")).toBe("ready:"), { timeout: 10_000 });
        if (encoding === "cp936")
          await expect(handle.write("🙂")).rejects.toThrow("SHELL_INPUT_ENCODING_UNREPRESENTABLE");
        const text = encoding === "cp936" ? "中文" : "中文🙂";
        await handle.write(text);
        await expect(handle.completion).resolves.toMatchObject({
          exitCode: 0,
          stdout: `ready:${text}`,
          outputDecodingErrors: [],
        });
      }
    }, 30_000);

    it("streams input and concurrent output while stop leaves another command alive", async () => {
      const host = new CodexWindowsSandboxCommandHost();
      hosts.push(host);
      const root = workspace();
      const updates: string[] = [];
      const first = await host.start({
        ...command(root, "unused"),
        command: [
          process.execPath,
          "-e",
          "process.stdout.write('ready中文😀');process.stdin.once('data',b=>{process.stdout.write(b);process.exit(0)});setInterval(()=>{},1000)",
        ],
        onOutput: (delta) => updates.push(delta),
      });
      await vi.waitFor(() => expect(updates.join("")).toContain("ready中文😀"), {
        timeout: 10_000,
      });
      const second = await host.start({
        ...command(root, "unused"),
        command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
      });
      await second.stop();
      await first.write("输入😀\n");
      await expect(first.completion).resolves.toMatchObject({
        exitCode: 0,
        stdout: "ready中文😀输入😀\n",
        stopped: false,
      });
      await expect(second.completion).resolves.toMatchObject({ stopped: true });
    }, 30_000);

    it("reports large output, deadlines, exit124, and rejects pre-aborted file writes", async () => {
      const root = workspace();
      const host = new CodexWindowsSandboxCommandHost();
      hosts.push(host);
      const adapter = new CodexWindowsShellToolAdapter([root], undefined, host);
      const run = (source: string, timeoutMs = 10_000) =>
        adapter.execute(
          { ...operation(root, "unused"), args: ["-e", source], timeoutMs },
          context(),
        );
      const large = await run("process.stdout.write('x'.repeat(2100000))");
      expect(large.data).toMatchObject({ state: "completed", outputTruncated: true });
      expect(
        Buffer.byteLength(
          large.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
        ),
      ).toBe(2_000_000);
      await expect(run("setInterval(()=>{},1000)", 300)).rejects.toMatchObject({
        code: "SHELL_TIMEOUT",
        result: { data: { state: "timed_out" } },
      });
      await expect(run("process.exit(124)")).rejects.toMatchObject({ code: "SHELL_EXIT_124" });
      const marker = path.join(root, "must-not-exist.txt");
      const controller = new AbortController();
      controller.abort();
      await expect(
        adapter.execute(
          {
            ...operation(root, "unused"),
            args: ["-e", "require('node:fs').writeFileSync('must-not-exist.txt','bad')"],
          },
          context(controller.signal),
        ),
      ).rejects.toThrow();
      expect(existsSync(marker)).toBe(false);
    }, 30_000);

    it("stops the native command tree and exposes settled background completion", async () => {
      const root = workspace();
      const host = new CodexWindowsSandboxCommandHost();
      hosts.push(host);
      const adapter = new CodexWindowsShellToolAdapter([root], undefined, host);
      const controller = new AbortController();
      const childSource =
        "setInterval(()=>require('node:fs').appendFileSync('heartbeat.txt','x'),50)";
      const result = await adapter.execute(
        {
          ...operation(root, "unused", { background: true }),
          args: [
            "-e",
            `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'});setInterval(()=>{},1000)`,
          ],
        },
        context(controller.signal),
      );
      const processId = (result.data as { processId: string }).processId;
      const heartbeat = path.join(root, "heartbeat.txt");
      await vi.waitFor(() => expect(existsSync(heartbeat)).toBe(true), { timeout: 10_000 });
      controller.abort();
      await adapter.whenProcessCompletes(processId);
      const status = await adapter.execute(
        { operation: "shell_status", processId, idempotencyKey: "cancelled-tree-status" },
        context(),
      );
      expect(status.data).toMatchObject({ state: "stopped" });
      const before = readFileSync(heartbeat, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(readFileSync(heartbeat, "utf8")).toBe(before);
    }, 30_000);

    it("disconnects a native command tree without orphan heartbeats and can start a fresh connection", async () => {
      const root = workspace();
      const host = new CodexWindowsSandboxCommandHost();
      hosts.push(host);
      const childSource =
        "setInterval(()=>require('node:fs').appendFileSync('disconnect-heartbeat.txt','x'),40)";
      const running = await host.start({
        ...command(root, "unused"),
        command: [
          process.execPath,
          "-e",
          `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'});setInterval(()=>{},1000)`,
        ],
      });
      const disconnected = expect(running.completion).rejects.toThrow(
        "SHELL_WINDOWS_CODEX_APP_SERVER_DISCONNECTED",
      );
      const heartbeat = path.join(root, "disconnect-heartbeat.txt");
      await vi.waitFor(
        () => expect(readFileSync(heartbeat, "utf8").length).toBeGreaterThanOrEqual(3),
        { timeout: 10_000 },
      );
      await host.close();
      await disconnected;
      // close tears down the owned server. The runner's process tree must stop as
      // well, rather than leaving a sandboxed child writing after disconnection.
      await vi.waitFor(
        async () => {
          const before = readFileSync(heartbeat, "utf8");
          await new Promise((resolve) => setTimeout(resolve, 200));
          expect(readFileSync(heartbeat, "utf8")).toBe(before);
        },
        { timeout: 5_000 },
      );
      const next = await host.start({
        ...command(root, "unused"),
        command: [process.execPath, "-e", "process.stdout.write('fresh connection')"],
      });
      await expect(next.completion).resolves.toMatchObject({
        exitCode: 0,
        stdout: "fresh connection",
      });
      const before = readFileSync(heartbeat, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(readFileSync(heartbeat, "utf8")).toBe(before);
    }, 30_000);
  },
);
