import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkspaceGrant } from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexWindowsSandboxReady } from "../src/codex-windows-shell-adapter";
import { ShellToolAdapter } from "../src/shell-adapter";
import type { ToolExecutionContext } from "../src/types";

const directories: string[] = [];
const adapters: ShellToolAdapter[] = [];
const nativeAvailable =
  (process.platform === "win32" && codexWindowsSandboxReady()) ||
  (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"));

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-terminal-中文 space-"));
  directories.push(root);
  return root;
}

function context(signal = new AbortController().signal): ToolExecutionContext {
  return { signal, toolCallId: randomUUID(), update: () => undefined };
}

afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.stopAll();
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("terminal operating system contracts", () => {
  it("does not start an already cancelled command even when a Windows host is installed", async () => {
    const root = workspace();
    const start = vi.fn(async () => {
      throw new Error("CANCELLED_COMMAND_STARTED");
    });
    const adapter = new ShellToolAdapter([root], undefined, {
      start,
      close: vi.fn(async () => undefined),
    });
    adapters.push(adapter);
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.execute(
        {
          operation: "shell_execute",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          cwd: root,
          timeoutMs: 5_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: randomUUID(),
        },
        context(controller.signal),
      ),
    ).rejects.toThrow("SHELL_STOPPED");
    expect(start).not.toHaveBeenCalled();
  });

  it.runIf(nativeAvailable)(
    "preserves Unicode, spaces and literal metacharacters in argv",
    async () => {
      const root = workspace();
      const adapter = new ShellToolAdapter([root]);
      adapters.push(adapter);
      const args = ["中文🙂", "space in argument", 'literal"quote', "a&b", "$HOME", "trailing\\"];
      const result = await adapter.execute(
        {
          operation: "shell_execute",
          command: process.execPath,
          args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args],
          cwd: root,
          timeoutMs: 10_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: randomUUID(),
        },
        context(),
      );
      expect(JSON.parse(result.content.find((entry) => entry.type === "text")?.text ?? "")).toEqual(
        args,
      );
    },
    20_000,
  );

  it.runIf(nativeAvailable)(
    "decodes split UTF-8 bytes and reports capped output",
    async () => {
      const root = workspace();
      const adapter = new ShellToolAdapter([root]);
      adapters.push(adapter);
      const result = await adapter.execute(
        {
          operation: "shell_execute",
          command: process.execPath,
          args: [
            "-e",
            "const bytes=Buffer.from('中文🙂');let i=0;const timer=setInterval(()=>{process.stdout.write(bytes.subarray(i,i+1));if(++i===bytes.length){clearInterval(timer);process.stdout.write('X'.repeat(2100000))}},5)",
          ],
          cwd: root,
          timeoutMs: 10_000,
          background: false,
          allowNetwork: false,
          idempotencyKey: randomUUID(),
        },
        context(),
      );
      const text = result.content.find((entry) => entry.type === "text")?.text ?? "";
      expect(text.startsWith("中文🙂")).toBe(true);
      expect(text).not.toContain("\uFFFD");
      expect(text.length).toBeLessThanOrEqual(2_000_000);
      expect(result.data).toMatchObject({ outputTruncated: true });
    },
    20_000,
  );

  it.runIf(nativeAvailable)(
    "collects background files on completion without polling status",
    async () => {
      const root = workspace();
      const conversationId = randomUUID();
      const grant: WorkspaceGrant = {
        id: randomUUID(),
        ownerProfileId: "terminal-regression",
        conversationId,
        displayName: "Terminal regression",
        rootPath: root,
        access: "read_write",
        allowNetwork: false,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
      };
      const recorded = vi.fn();
      const adapter = new ShellToolAdapter([root], () => grant, undefined, recorded);
      adapters.push(adapter);
      const execution = context();
      execution.projection = {
        generationId: randomUUID(),
        workItemId: randomUUID(),
        runId: randomUUID(),
        conversationId,
        assistantMessageId: randomUUID(),
        piToolCallId: randomUUID(),
        toolName: "openerx_shell",
      };
      await adapter.execute(
        {
          operation: "shell_execute",
          workspaceGrantId: grant.id,
          command: process.execPath,
          args: ["-e", "require('node:fs').writeFileSync('background.txt','created by terminal')"],
          timeoutMs: 10_000,
          background: true,
          allowNetwork: false,
          idempotencyKey: randomUUID(),
        },
        execution,
      );
      await vi.waitFor(() => expect(recorded).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      expect(recorded.mock.calls[0]?.[0].manifest).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "created", relativePath: "background.txt" }),
        ]),
      );
    },
    20_000,
  );

  it.runIf(process.platform === "win32")(
    "waits for actual background completion when cancellation marks the process stopped during startup",
    async () => {
      const root = workspace();
      const controller = new AbortController();
      const conversationId = randomUUID();
      const grant: WorkspaceGrant = {
        id: randomUUID(),
        ownerProfileId: "terminal-regression",
        conversationId,
        displayName: "Terminal cancellation regression",
        rootPath: root,
        access: "read_write",
        allowNetwork: false,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
      };
      const stopped = { exitCode: 137, stdout: "", stderr: "", stopped: true };
      let settle = (_result: typeof stopped) => undefined as void;
      const completion = new Promise<typeof stopped>((resolve) => {
        settle = resolve;
      });
      const processId = randomUUID();
      const stop = vi.fn(async () => {
        await completion;
      });
      const recorded = vi.fn();
      const adapter = new ShellToolAdapter(
        [root],
        () => grant,
        {
          isolation: "codex-windows-mxc",
          start: async () => {
            controller.abort();
            return { processId, completion, write: async () => undefined, stop };
          },
          close: async () => settle(stopped),
        },
        recorded,
      );
      adapters.push(adapter);
      const execution = context(controller.signal);
      execution.projection = {
        generationId: randomUUID(),
        workItemId: randomUUID(),
        runId: randomUUID(),
        conversationId,
        assistantMessageId: randomUUID(),
        piToolCallId: randomUUID(),
        toolName: "openerx_shell",
      };
      const result = await adapter.execute(
        {
          operation: "shell_execute",
          workspaceGrantId: grant.id,
          command: process.execPath,
          args: ["-e", "unused fake command"],
          timeoutMs: 10_000,
          background: true,
          allowNetwork: false,
          idempotencyKey: randomUUID(),
        },
        execution,
      );
      expect(result.data).toMatchObject({ processId, state: "stopped" });
      expect(stop).toHaveBeenCalledTimes(1);
      writeFileSync(path.join(root, "late-background.txt"), "written before termination settled");
      await Promise.resolve();
      expect(recorded).not.toHaveBeenCalled();
      const stopping = await adapter.execute(
        { operation: "shell_status", processId, idempotencyKey: randomUUID() },
        context(),
      );
      expect(stopping.data).toMatchObject({ state: "stopped" });
      expect(recorded).not.toHaveBeenCalled();
      settle(stopped);
      await vi.waitFor(() => expect(recorded).toHaveBeenCalledTimes(1));
      expect(recorded.mock.calls[0]?.[0].manifest).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "created", relativePath: "late-background.txt" }),
        ]),
      );
      await adapter.execute(
        { operation: "shell_status", processId, idempotencyKey: randomUUID() },
        context(),
      );
      expect(recorded).toHaveBeenCalledTimes(1);
    },
  );
});
