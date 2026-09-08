import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codexWindowsSandboxReady,
  ShellToolAdapter,
  shellToolAvailability,
  ToolAdapterError,
} from "../src";
import type { WindowsSandboxCommandHost } from "../src/codex-windows-shell-adapter";

const directories: string[] = [];

// Exercise the adapter boundary on stock Windows CI without installing Codex
// or replacing its production sandbox with an unsandboxed child process.
function windowsHostFixture() {
  let finish!: (result: { exitCode: number; stdout: string; stderr: string }) => void;
  const completion = new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve) => {
      finish = resolve;
    },
  );
  const stop = vi.fn(async () => finish({ exitCode: 0, stdout: "tick\n", stderr: "" }));
  const start = vi.fn<WindowsSandboxCommandHost["start"]>(async (input) => {
    input.onOutput("tick\n", "stdout", false);
    return { processId: "fixture-process", completion, write: vi.fn(async () => {}), stop };
  });
  return { start, stop, close: vi.fn(async () => {}) };
}

function context() {
  return {
    signal: new AbortController().signal,
    toolCallId: "tool-call",
    update: () => undefined,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("ShellToolAdapter", () => {
  it("requires the complete Codex Windows sandbox installation", () => {
    expect(
      codexWindowsSandboxReady({
        platform: "win32",
        codexExecutable: "C:\\Codex\\codex.exe",
        helpersExist: true,
        setupMarkerExists: true,
      }),
    ).toBe(true);
    for (const probe of [
      { codexExecutable: null, helpersExist: true, setupMarkerExists: true },
      { codexExecutable: "C:\\Codex\\codex.exe", helpersExist: false, setupMarkerExists: true },
      { codexExecutable: "C:\\Codex\\codex.exe", helpersExist: true, setupMarkerExists: false },
    ]) {
      expect(codexWindowsSandboxReady({ platform: "win32", ...probe })).toBe(false);
    }
    expect(
      codexWindowsSandboxReady({
        platform: "linux",
        codexExecutable: "C:\\Codex\\codex.exe",
        helpersExist: true,
        setupMarkerExists: true,
      }),
    ).toBe(false);
  });

  it("advertises Shell only when a supported platform sandbox is ready", () => {
    expect(shellToolAvailability({ platform: "darwin", sandboxExecutableExists: true })).toEqual({
      availableToolNames: ["openerx_shell", "openerx_shell_process"],
      unavailableReasons: {},
    });
    expect(shellToolAvailability({ platform: "darwin", sandboxExecutableExists: false })).toEqual({
      availableToolNames: [],
      unavailableReasons: {
        openerx_shell: "SHELL_OS_SANDBOX_UNAVAILABLE",
        openerx_shell_process: "SHELL_OS_SANDBOX_UNAVAILABLE",
      },
    });
    expect(
      shellToolAvailability({
        platform: "win32",
        sandboxExecutableExists: true,
        windowsSandboxReady: false,
      }),
    ).toEqual({
      availableToolNames: [],
      unavailableReasons: {
        openerx_shell: "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE",
        openerx_shell_process: "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE",
      },
    });
    expect(shellToolAvailability({ platform: "win32", windowsSandboxReady: true })).toEqual({
      availableToolNames: ["openerx_shell", "openerx_shell_process"],
      unavailableReasons: {},
    });
  });

  it.runIf(process.platform === "darwin" || codexWindowsSandboxReady())(
    "runs argv without a shell inside the approved workspace",
    async () => {
      const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-"));
      directories.push(workspace);
      const adapter = new ShellToolAdapter([workspace]);
      const result = await adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: process.execPath,
          args: ["-e", "process.stdout.write('tool-ok')"],
          timeoutMs: 10_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: "shell-command-0001",
        },
        context(),
      );
      expect(result.summary).toContain("tool-ok");
      expect(result.data).toMatchObject({ state: "completed", exitCode: 0 });
      await adapter.stopAll();
    },
    20_000,
  );

  it.runIf(process.platform === "darwin" || codexWindowsSandboxReady())(
    "retains failed command output as a typed failure result",
    async () => {
      const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-failure-"));
      directories.push(workspace);
      const adapter = new ShellToolAdapter([workspace]);
      try {
        await adapter.execute(
          {
            operation: "shell_execute",
            cwd: workspace,
            command: process.execPath,
            args: ["-e", "process.stderr.write('failure-output'); process.exit(3)"],
            timeoutMs: 10_000,
            background: false,
            allowNetwork: false,
            idempotencyKey: "shell-command-failure-0001",
          },
          context(),
        );
        throw new Error("expected shell failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ToolAdapterError);
        expect((error as ToolAdapterError).code).toBe("SHELL_EXIT_3");
        expect((error as ToolAdapterError).result).toMatchObject({
          content: [{ type: "text", text: "failure-output" }],
          data: { exitCode: 3, state: "failed" },
        });
      } finally {
        await adapter.stopAll();
      }
    },
    20_000,
  );

  it("rejects cwd escape and refuses execution when no native sandbox exists", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-"));
    directories.push(workspace);
    const host = windowsHostFixture();
    const adapter = new ShellToolAdapter([workspace], undefined, host);
    await expect(
      adapter.execute(
        {
          operation: "shell_execute",
          cwd: tmpdir(),
          command: process.execPath,
          args: ["-e", "0"],
          timeoutMs: 1_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: "shell-command-0002",
        },
        context(),
      ),
    ).rejects.toThrow("SHELL_CWD_OUT_OF_SCOPE");
    expect(host.start).not.toHaveBeenCalled();
    await adapter.stopAll();
    if (process.platform !== "darwin" && !codexWindowsSandboxReady()) {
      const unavailableAdapter = new ShellToolAdapter([workspace]);
      await expect(
        unavailableAdapter.execute(
          {
            operation: "shell_execute",
            cwd: workspace,
            command: "curl",
            args: ["https://example.com"],
            timeoutMs: 1_000,
            background: false,
            allowNetwork: false,
            idempotencyKey: "shell-command-0003",
          },
          context(),
        ),
      ).rejects.toThrow(
        process.platform === "win32"
          ? "SHELL_WINDOWS_CODEX_SANDBOX_UNAVAILABLE"
          : "SHELL_OS_SANDBOX_UNAVAILABLE",
      );
      await unavailableAdapter.stopAll();
    }
  });

  it("denies Node and Python reads outside the workspace on macOS", async () => {
    if (process.platform !== "darwin") return;
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-workspace-"));
    const outside = mkdtempSync(path.join(tmpdir(), "openerx-shell-outside-"));
    directories.push(workspace);
    directories.push(outside);
    const adapter = new ShellToolAdapter([workspace]);
    const outsideFile = fileURLToPath(import.meta.url);
    for (const allowNetwork of [false, true]) {
      await expect(
        adapter.execute(
          {
            operation: "shell_execute",
            cwd: workspace,
            command: process.execPath,
            args: ["-e", "require('node:fs').readFileSync(process.argv[1], 'utf8')", outsideFile],
            timeoutMs: 5_000,
            background: false,
            allowNetwork,
            idempotencyKey: `shell-node-read-${allowNetwork}`,
          },
          context(),
        ),
      ).rejects.toThrow(/SHELL_EXIT_/);
      await expect(
        adapter.execute(
          {
            operation: "shell_execute",
            cwd: workspace,
            command: "/usr/bin/python3",
            args: ["-c", "import pathlib,sys; pathlib.Path(sys.argv[1]).read_text()", outsideFile],
            timeoutMs: 5_000,
            background: false,
            allowNetwork,
            idempotencyKey: `shell-python-read-${allowNetwork}`,
          },
          context(),
        ),
      ).rejects.toThrow(/SHELL_EXIT_/);
    }
    await adapter.stopAll();
  });

  it("keeps network policy independent from the platform filesystem sandbox", async () => {
    if (process.platform !== "darwin") return;
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-network-"));
    directories.push(workspace);
    const server = createServer((_request, response) => response.end("network-ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server address missing");
    const url = `http://127.0.0.1:${address.port}`;
    const adapter = new ShellToolAdapter([workspace]);
    const operation = {
      operation: "shell_execute" as const,
      cwd: workspace,
      command: process.execPath,
      args: [
        "-e",
        "require('node:http').get(process.argv[1],r=>{r.pipe(process.stdout);r.on('end',()=>process.exit(0))}).on('error',e=>{throw e})",
        url,
      ],
      timeoutMs: 5_000,
      background: false,
    };
    await expect(
      adapter.execute(
        { ...operation, allowNetwork: false, idempotencyKey: "shell-network-denied-0001" },
        context(),
      ),
    ).rejects.toThrow(/SHELL_EXIT_/);
    await expect(
      adapter.execute(
        { ...operation, allowNetwork: true, idempotencyKey: "shell-network-allowed-0001" },
        context(),
      ),
    ).resolves.toMatchObject({ summary: "network-ok" });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("selects the Codex offline/online identity and keeps temp inside the workspace", async () => {
    if (!codexWindowsSandboxReady()) return;
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-identity-"));
    directories.push(workspace);
    const adapter = new ShellToolAdapter([workspace]);
    for (const [allowNetwork, account] of [
      [false, "codexsandboxoffline"],
      [true, "codexsandboxonline"],
    ] as const) {
      const identity = await adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe"),
          args: [],
          timeoutMs: 10_000,
          background: false,
          allowNetwork,
          idempotencyKey: `shell-windows-identity-${account}`,
        },
        context(),
      );
      expect(identity.summary.trim().toLowerCase()).toMatch(new RegExp(`\\\\${account}$`, "u"));
    }
    const environment = await adapter.execute(
      {
        operation: "shell_execute",
        cwd: workspace,
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.env.TEMP || '')"],
        timeoutMs: 10_000,
        background: false,
        allowNetwork: false,
        idempotencyKey: "shell-windows-temp-0001",
      },
      context(),
    );
    expect(path.resolve(environment.summary)).toBe(path.resolve(workspace));
    await adapter.stopAll();
  }, 20_000);

  it("executes in the real Windows development workspace", async () => {
    if (!codexWindowsSandboxReady()) return;
    const workspace = process.cwd();
    const adapter = new ShellToolAdapter([workspace]);
    await expect(
      adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe"),
          args: [],
          timeoutMs: 10_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: "shell-windows-real-workspace-0001",
        },
        context(),
      ),
    ).resolves.toMatchObject({
      data: { state: "completed", isolation: "codex-windows-restricted-token" },
    });
    await adapter.stopAll();
  }, 30_000);

  it.runIf(process.platform === "darwin" || process.platform === "win32")(
    "starts, observes, and stops a long child process",
    async () => {
      const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-"));
      directories.push(workspace);
      const host = windowsHostFixture();
      const adapter = new ShellToolAdapter([workspace], undefined, host);
      const started = await adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: process.execPath,
          args: ["-e", "setInterval(() => process.stdout.write('tick\\n'), 50)"],
          timeoutMs: 10_000,
          background: true,
          allowNetwork: false,
          idempotencyKey: "shell-command-0004",
        },
        context(),
      );
      const processId = (started.data as { processId: string }).processId;
      expect(processId).toBeTruthy();
      await adapter.execute(
        { operation: "shell_stop", processId, idempotencyKey: "shell-command-0005" },
        context(),
      );
      const status = await adapter.execute(
        { operation: "shell_status", processId, idempotencyKey: "shell-command-0006" },
        context(),
      );
      expect(status.data).toMatchObject({ state: "stopped" });
      if (process.platform === "win32") {
        expect(host.start).toHaveBeenCalledTimes(1);
        expect(host.stop).toHaveBeenCalledTimes(1);
        expect(status.data).toMatchObject({ isolation: "codex-windows-restricted-token" });
      }
      await adapter.stopAll();
    },
  );
});
