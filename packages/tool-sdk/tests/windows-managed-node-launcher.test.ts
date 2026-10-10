import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  CodexWindowsSandboxCommandHost,
  findCodexExecutable,
} from "../src/codex-windows-shell-adapter";
import {
  managedNodeRuntimeCacheKey,
  managedNodeRuntimeEnvironment,
  verifyManagedNodeRuntime,
} from "../src/managed-node-runtime";
import { windowsManagedNodeLaunch } from "../src/windows-managed-node-launcher";

const directory = path.join(
  process.env.LOCALAPPDATA ?? "",
  "openerx-runtime-cache",
  "runtimes",
  managedNodeRuntimeCacheKey,
  "win32-x64",
);
const available = process.platform === "win32" && existsSync(path.join(directory, "manifest.json"));
const nativeMxc = available && process.env.OPENERX_TEST_MANAGED_NODE_MXC === "1";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const runtime = () =>
  verifyManagedNodeRuntime(path.join(directory, "files"), path.join(directory, "manifest.json"));
const workspace = () => {
  const root = mkdtempSync(path.join(tmpdir(), "managed-node-launch-"));
  roots.push(root);
  return root;
};

test("ordinary commands and unverified aliases never acquire an implicit interpreter", () => {
  expect(windowsManagedNodeLaunch(undefined, "node", ["--version"])).toEqual({
    command: "node",
    args: ["--version"],
  });
  expect(windowsManagedNodeLaunch(undefined, "powershell.exe", ["-NoProfile"])).toEqual({
    command: "powershell.exe",
    args: ["-NoProfile"],
  });
});
test.runIf(available)(
  "the trusted launcher preserves CRT argv and raw Unicode stdout/stderr and exit status",
  () => {
    const trusted = runtime();
    const args = [
      "",
      "spaces and 中文 😀",
      'embedded"quote',
      "trailing\\",
      "\\\\",
      "& echo injected",
      "$literal",
      "line\nbreak",
    ];
    const code =
      "process.stdout.write(JSON.stringify(process.argv.slice(1)));process.stderr.write(Buffer.from([0,255,128,10]));process.exit(23)";
    const launch = windowsManagedNodeLaunch(trusted, trusted.nodeExecutable, ["-e", code, ...args]);
    try {
      execFileSync(launch.command, launch.args, {
        cwd: workspace(),
        windowsHide: true,
        timeout: 15_000,
        stdio: "pipe",
      });
      throw new Error("EXIT_CODE_NOT_PROPAGATED");
    } catch (error) {
      const result = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
      expect(result.status).toBe(23);
      expect(JSON.parse(result.stdout!.toString("utf8"))).toEqual(args);
      expect(result.stderr).toEqual(Buffer.from([0, 255, 128, 10]));
    }
  },
  30_000,
);
test.runIf(available)(
  "only the exact verified Node path is wrapped and oversized payloads fail explicitly",
  () => {
    const trusted = runtime();
    expect(windowsManagedNodeLaunch(trusted, "node", ["--version"])).toEqual({
      command: "node",
      args: ["--version"],
    });
    expect(() =>
      windowsManagedNodeLaunch(trusted, trusted.nodeExecutable, ["x".repeat(40_000)]),
    ).toThrow("SHELL_MANAGED_NODE_ARGUMENTS_TOO_LONG");
    const altered = { ...trusted, nodeExecutable: path.join(trusted.rootDirectory, "altered.exe") };
    expect(() => windowsManagedNodeLaunch(altered, altered.nodeExecutable, [])).toThrow(
      "MANAGED_NODE_RUNTIME_INTEGRITY_FAILED",
    );
  },
  30_000,
);
test.runIf(nativeMxc)(
  "native MXC runs Node, npx and npm lifecycle children with only the managed Node PATH",
  () => {
    const trusted = runtime(),
      root = workspace(),
      codex = findCodexExecutable();
    if (!codex) throw new Error("CODEX_RUNTIME_REQUIRED");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ private: true, scripts: { verify: "node --version && npm --version" } }),
    );
    for (const args of [
      ["--version"],
      [trusted.npxCli, "--version"],
      [trusted.npmCli, "run", "verify", "--offline"],
    ]) {
      const launch = windowsManagedNodeLaunch(trusted, trusted.nodeExecutable, args);
      const output = execFileSync(
        codex,
        [
          "-c",
          "windows.sandbox=mxc",
          "sandbox",
          "--include-managed-config",
          "--permission-profile",
          ":workspace",
          "-C",
          root,
          "--",
          launch.command,
          ...launch.args,
        ],
        {
          env: {
            ...process.env,
            ...managedNodeRuntimeEnvironment(trusted, {
              path: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
              cwd: root,
            }),
          },
          windowsHide: true,
          encoding: "utf8",
          timeout: 20_000,
        },
      );
      expect(output).toContain(args[0] === "--version" ? trusted.nodeVersion : trusted.npmVersion);
    }
  },
  60_000,
);
test.runIf(nativeMxc)(
  "native command host flushes small interactive UTF-8 input and streamed output without stdin EOF",
  async () => {
    const trusted = runtime(),
      root = workspace();
    const host = new CodexWindowsSandboxCommandHost(undefined, "mxc", { nodeRuntime: trusted });
    const updates: string[] = [];
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    try {
      const handle = await host.start({
        command: [
          trusted.nodeExecutable,
          "-e",
          "process.stdout.write('READY');process.stdin.once('data',b=>{process.stdout.write(b);process.stderr.write('错😀');process.exit(19)})",
        ],
        cwd: root,
        writableRoot: root,
        allowNetwork: false,
        timeoutMs: 15_000,
        onOutput: (text) => {
          updates.push(text);
          if (updates.join("").includes("READY")) ready();
        },
      });
      await started;
      await handle.write("小输入😀\n");
      const result = await handle.completion;
      expect(result.exitCode).toBe(19);
      expect(updates.join("")).toContain("小输入😀");
      expect(updates.join("")).toContain("错😀");
    } finally {
      await host.close();
    }
  },
  45_000,
);
test.runIf(nativeMxc)(
  "native cancellation terminates the managed Node child and its descendants",
  async () => {
    const trusted = runtime(),
      root = workspace();
    const host = new CodexWindowsSandboxCommandHost(undefined, "mxc", { nodeRuntime: trusted });
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    try {
      const handle = await host.start({
        command: [
          trusted.nodeExecutable,
          "-e",
          "require('node:child_process').spawn(process.execPath,['-e',\"setTimeout(()=>require('node:fs').writeFileSync('survived.txt','unexpected'),2500)\"],{stdio:'ignore'});process.stdout.write('STARTED');setInterval(()=>{},1000)",
        ],
        cwd: root,
        writableRoot: root,
        allowNetwork: false,
        timeoutMs: 15_000,
        onOutput: (text) => {
          if (text.includes("STARTED")) ready();
        },
      });
      await started;
      await handle.stop();
      expect((await handle.completion).stopped).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(existsSync(path.join(root, "survived.txt"))).toBe(false);
    } finally {
      await host.close();
    }
  },
  45_000,
);
test.runIf(nativeMxc)(
  "parent exit bounds drain even when a descendant inherits output pipes",
  async () => {
    const trusted = runtime(),
      root = workspace();
    const host = new CodexWindowsSandboxCommandHost(undefined, "mxc", { nodeRuntime: trusted });
    const began = Date.now();
    try {
      const handle = await host.start({
        command: [
          trusted.nodeExecutable,
          "-e",
          "require('node:child_process').spawn(process.execPath,['-e',\"setTimeout(()=>require('node:fs').writeFileSync('survived.txt','unexpected'),5000)\"],{stdio:'inherit'});process.stdout.write('PARENT_EXIT');process.exit(0)",
        ],
        cwd: root,
        writableRoot: root,
        allowNetwork: false,
        timeoutMs: 15_000,
        onOutput() {},
      });
      expect((await handle.completion).exitCode).toBe(0);
      expect(Date.now() - began).toBeLessThan(8000);
      await new Promise((resolve) => setTimeout(resolve, 5500));
      expect(existsSync(path.join(root, "survived.txt"))).toBe(false);
    } finally {
      await host.close();
    }
  },
  45_000,
);
