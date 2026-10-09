import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codexWindowsSandboxBackend,
  codexWindowsSandboxReady,
  resolveWindowsExecutable,
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
  it("resolves bare Windows executables from PATH before invoking the sandbox", () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-shell-path-"));
    directories.push(root);
    const bin = path.join(root, "Node runtime");
    mkdirSync(bin);
    const executable = path.join(bin, "node.exe");
    writeFileSync(executable, "fixture");
    const searchPath = [path.join(root, "missing"), `"${bin}"`].join(path.delimiter);
    expect(resolveWindowsExecutable("node.exe", searchPath)).toBe(realpathSync(executable));
    expect(resolveWindowsExecutable("node", searchPath)).toBe(realpathSync(executable));
    expect(resolveWindowsExecutable(executable, "")).toBe(executable);
    expect(() => resolveWindowsExecutable("missing.exe", searchPath)).toThrow(
      "SHELL_EXECUTABLE_NOT_FOUND",
    );
    expect(() => resolveWindowsExecutable("node.exe", ".")).toThrow("SHELL_EXECUTABLE_NOT_FOUND");
  });

  it("requires the complete Codex Windows sandbox installation", () => {
    expect(
      codexWindowsSandboxReady({
        platform: "win32",
        backend: "elevated",
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
      expect(codexWindowsSandboxReady({ platform: "win32", backend: "elevated", ...probe })).toBe(
        false,
      );
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

  it("requires an explicit supported MXC backend and never falls back to the legacy sandbox", () => {
    expect(codexWindowsSandboxBackend("")).toBe("elevated");
    expect(codexWindowsSandboxBackend("elevated")).toBe("elevated");
    expect(codexWindowsSandboxBackend("mxc")).toBe("mxc");
    for (const backend of ["unelevated", "disabled", "MXC", "unknown"]) {
      expect(() => codexWindowsSandboxBackend(backend)).toThrow(
        "SHELL_WINDOWS_CODEX_SANDBOX_BACKEND_INVALID",
      );
    }
    expect(
      codexWindowsSandboxReady({
        platform: "win32",
        backend: "mxc",
        codexExecutable: "C:\\Codex\\codex.exe",
        helpersExist: false,
        setupMarkerExists: false,
        mxcSupported: true,
      }),
    ).toBe(true);
    expect(
      codexWindowsSandboxReady({
        platform: "win32",
        backend: "mxc",
        codexExecutable: "C:\\Codex\\codex.exe",
        helpersExist: true,
        setupMarkerExists: true,
        mxcSupported: false,
      }),
    ).toBe(false);
    expect(
      codexWindowsSandboxReady({
        platform: "win32",
        backend: "mxc",
        codexExecutable: null,
        mxcSupported: true,
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

  it
    .runIf(process.platform === "darwin" || codexWindowsSandboxReady())
    .each(process.platform === "win32" ? [process.execPath, "node.exe"] : [process.execPath])(
    "runs %s argv without a shell inside the approved workspace",
    async (command) => {
      const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-"));
      directories.push(workspace);
      const adapter = new ShellToolAdapter([workspace]);
      const result = await adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command,
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

  it.runIf(process.platform === "darwin")(
    "supports discarded child stdio while writes outside the approved workspace stay denied",
    async () => {
      const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-stdio-"));
      const outside = mkdtempSync(path.join(tmpdir(), "openerx-shell-stdio-outside-"));
      directories.push(workspace, outside);
      const outsideFile = path.join(outside, "private.txt");
      writeFileSync(outsideFile, "private-unchanged");
      const adapter = new ShellToolAdapter([workspace]);
      try {
        const result = await adapter.execute(
          {
            operation: "shell_execute",
            cwd: workspace,
            command: process.execPath,
            args: [
              "-e",
              `const fs=require('node:fs');const {spawnSync}=require('node:child_process');
fs.writeFileSync('/dev/null','discarded-output');
const child=spawnSync(process.execPath,['-e',"process.stdout.write('discarded-child-output')"],{stdio:'ignore'});
if(child.error) throw child.error;
if(child.status!==0) throw new Error('CHILD_FAILED');
let denied=false;try{fs.writeFileSync(process.argv[1],'unwanted-overwrite')}catch(error){denied=['EPERM','EACCES'].includes(error.code)}
if(!denied) throw new Error('OUTSIDE_WRITE_ALLOWED');
process.stdout.write('discarded-stdio-ok');`,
              outsideFile,
            ],
            timeoutMs: 10_000,
            background: false,
            allowNetwork: false,
            idempotencyKey: "shell-discarded-stdio-0001",
          },
          context(),
        );
        expect(result.summary).toContain("discarded-stdio-ok");
        expect(result.data).toMatchObject({ state: "completed", exitCode: 0 });
        expect(readFileSync(outsideFile, "utf8")).toBe("private-unchanged");
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
    if (process.platform !== "darwin" && !codexWindowsSandboxReady()) return;
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
    try {
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
    } finally {
      await adapter.stopAll();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 20_000);

  it("allows Windows workspace writes while denying writes outside the approved root", async () => {
    if (!codexWindowsSandboxReady()) return;
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-writes-"));
    const outside = mkdtempSync(path.join(tmpdir(), "openerx-shell-writes-outside-"));
    directories.push(workspace, outside);
    const outsideFile = path.join(outside, "private.txt");
    writeFileSync(outsideFile, "private-unchanged");
    const adapter = new ShellToolAdapter([workspace]);
    try {
      await expect(
        adapter.execute(
          {
            operation: "shell_execute",
            cwd: workspace,
            command: process.execPath,
            args: [
              "-e",
              `const fs=require('node:fs');fs.writeFileSync('inside.txt','inside-ok');let denied=false;try{fs.writeFileSync(process.argv[1],'outside-overwrite')}catch(e){denied=['EPERM','EACCES'].includes(e.code)}if(!denied)throw new Error('OUTSIDE_WRITE_ALLOWED');process.stdout.write('write-boundary-ok')`,
              outsideFile,
            ],
            timeoutMs: 10_000,
            background: false,
            allowNetwork: false,
            idempotencyKey: "shell-windows-write-boundary-0001",
          },
          context(),
        ),
      ).resolves.toMatchObject({ summary: "write-boundary-ok" });
      expect(readFileSync(path.join(workspace, "inside.txt"), "utf8")).toBe("inside-ok");
      expect(readFileSync(outsideFile, "utf8")).toBe("private-unchanged");
    } finally {
      await adapter.stopAll();
    }
  }, 20_000);

  it("uses the selected Windows sandbox identity and isolates its temporary files", async () => {
    if (!codexWindowsSandboxReady()) return;
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-identity-"));
    directories.push(workspace);
    const adapter = new ShellToolAdapter([workspace]);
    const backend = codexWindowsSandboxBackend();
    const whoami = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
    const hostIdentity =
      backend === "mxc"
        ? execFileSync(whoami, [], { encoding: "utf8", windowsHide: true }).trim().toLowerCase()
        : null;
    for (const [allowNetwork, account] of [
      [false, "codexsandboxoffline"],
      [true, "codexsandboxonline"],
    ] as const) {
      const identity = await adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: whoami,
          args: [],
          timeoutMs: 10_000,
          background: false,
          allowNetwork,
          idempotencyKey: `shell-windows-identity-${account}`,
        },
        context(),
      );
      if (backend === "mxc") expect(identity.summary.trim().toLowerCase()).toBe(hostIdentity);
      else
        expect(identity.summary.trim().toLowerCase()).toMatch(new RegExp(`\\\\${account}$`, "u"));
      expect(identity.data).toMatchObject({
        isolation: backend === "mxc" ? "codex-windows-mxc" : "codex-windows-restricted-token",
      });
    }
    const environment = await adapter.execute(
      {
        operation: "shell_execute",
        cwd: workspace,
        command: process.execPath,
        args: [
          "-e",
          "const fs=require('node:fs'),path=require('node:path');const file=path.join(process.env.TEMP,'openerx-private-temp.txt');fs.writeFileSync(file,'private-temp');process.stdout.write(JSON.stringify({temp:process.env.TEMP,file,writable:fs.readFileSync(file,'utf8')==='private-temp'}))",
        ],
        timeoutMs: 10_000,
        background: false,
        allowNetwork: false,
        idempotencyKey: "shell-windows-temp-0001",
      },
      context(),
    );
    const temporary = JSON.parse(environment.summary) as {
      temp: string;
      file: string;
      writable: boolean;
    };
    expect(temporary.writable).toBe(true);
    if (backend === "elevated") {
      expect(path.resolve(temporary.temp)).toBe(path.resolve(workspace));
    } else {
      expect(path.resolve(temporary.temp)).not.toBe(path.resolve(tmpdir()));
      const second = await adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('node:fs');let previousDenied=false;try{fs.readFileSync(process.argv[1],'utf8')}catch(e){previousDenied=['ENOENT','EACCES','EPERM'].includes(e.code)}process.stdout.write(JSON.stringify({temp:process.env.TEMP,previousDenied}))",
            temporary.file,
          ],
          timeoutMs: 10_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: "shell-windows-private-temp-0002",
        },
        context(),
      );
      const isolated = JSON.parse(second.summary) as { temp: string; previousDenied: boolean };
      expect(path.resolve(isolated.temp)).not.toBe(path.resolve(temporary.temp));
      expect(isolated.previousDenied).toBe(true);
    }
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
      data: {
        state: "completed",
        isolation:
          codexWindowsSandboxBackend() === "mxc"
            ? "codex-windows-mxc"
            : "codex-windows-restricted-token",
      },
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
