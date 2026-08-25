import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ShellToolAdapter } from "../src";

const directories: string[] = [];

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
  it("runs argv without a shell inside the approved workspace", async () => {
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
  });

  it("rejects cwd escape and direct network tools before spawning", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-"));
    directories.push(workspace);
    const adapter = new ShellToolAdapter([workspace]);
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
    if (process.platform !== "darwin") {
      await expect(
        adapter.execute(
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
      ).rejects.toThrow("SHELL_NETWORK_DENIED");
    }
  });

  it("denies reads outside the approved workspace on the macOS sandbox", async () => {
    if (process.platform !== "darwin") return;
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-workspace-"));
    directories.push(workspace);
    const adapter = new ShellToolAdapter([workspace]);
    await expect(
      adapter.execute(
        {
          operation: "shell_execute",
          cwd: workspace,
          command: process.execPath,
          args: [
            "-e",
            "require('node:fs').readFileSync(process.argv[1], 'utf8')",
            fileURLToPath(import.meta.url),
          ],
          timeoutMs: 5_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: "shell-command-0007",
        },
        context(),
      ),
    ).rejects.toThrow(/SHELL_EXIT_/);
    await adapter.stopAll();
  });

  it("starts, observes, and stops a long child process", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openerx-shell-"));
    directories.push(workspace);
    const adapter = new ShellToolAdapter([workspace]);
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
    await adapter.stopAll();
  });
});
