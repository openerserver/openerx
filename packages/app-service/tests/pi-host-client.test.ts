import { EventEmitter } from "node:events";
import { type PiToolRequestFrame, piHostContractVersion } from "@openerx/contracts";
import type { MessagePortMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import { MessagePortPiHostClient } from "../src/pi-host-client";

class FakeMessagePort extends EventEmitter {
  readonly sent: unknown[] = [];

  start(): void {}

  postMessage(frame: unknown): void {
    this.sent.push(frame);
  }

  receive(frame: unknown): void {
    this.emit("message", { data: frame });
  }
}

const request: PiToolRequestFrame = {
  kind: "pi.tool.request",
  requestId: "11111111-1111-4111-8111-111111111111",
  generationId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
  branchId: "44444444-4444-4444-8444-444444444444",
  assistantMessageId: "55555555-5555-4555-8555-555555555555",
  piToolCallId: "pi-bash-progress",
  toolName: "bash",
  operation: {
    operation: "shell_command_execute",
    idempotencyKey: "pbash-progress-client-0001",
    contractVersion: "brokered_bash_v1",
    activeExecutionGrantId: "66666666-6666-4666-8666-666666666666",
    additionalExecutionGrantIds: [],
    executionProfile: "read_only",
    executionOrigin: "local_interactive",
    workspaceWriteMode: "none",
    environmentPolicyId: "environment-core-v1",
    networkPolicyId: "network-deny-v1",
    sandboxPolicyVersion: "macos-seatbelt-v1",
    shell: "bash",
    command: "printf ready",
    timeoutMs: 5_000,
  },
};

describe("MessagePortPiHostClient tool progress", () => {
  it("correlates background memory extraction results", async () => {
    const port = new FakeMessagePort();
    const client = new MessagePortPiHostClient(port as unknown as MessagePortMain, "c".repeat(64));
    port.receive({
      kind: "pi-host.ready",
      contractVersion: piHostContractVersion,
      nonce: "c".repeat(64),
    });
    const requestId = crypto.randomUUID();
    const pending = client.extractMemories({
      kind: "pi.memory.extract",
      requestId,
      jobId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      sourceAssistantMessageId: crypto.randomUUID(),
      messages: [
        { messageId: crypto.randomUUID(), text: "第一条有效用户消息" },
        { messageId: crypto.randomUUID(), text: "第二条有效用户消息" },
      ],
    });
    await vi.waitFor(() =>
      expect(port.sent).toContainEqual(expect.objectContaining({ requestId })),
    );
    port.receive({
      kind: "pi.memory.extract-result",
      requestId,
      ok: true,
      output: { candidates: [] },
      usageRecords: [],
    });
    await expect(pending).resolves.toMatchObject({ ok: true, output: { candidates: [] } });
  });

  it("correlates background memory clustering results", async () => {
    const port = new FakeMessagePort();
    const client = new MessagePortPiHostClient(port as unknown as MessagePortMain, "d".repeat(64));
    port.receive({
      kind: "pi-host.ready",
      contractVersion: piHostContractVersion,
      nonce: "d".repeat(64),
    });
    const requestId = crypto.randomUUID();
    const pending = client.clusterMemories({
      kind: "pi.memory.cluster",
      requestId,
      runId: crypto.randomUUID(),
      memories: [
        { id: crypto.randomUUID(), kind: "preference", content: "用户希望先给结论。" },
        { id: crypto.randomUUID(), kind: "preference", content: "用户偏好结论优先。" },
      ],
    });
    await vi.waitFor(() =>
      expect(port.sent).toContainEqual(expect.objectContaining({ requestId })),
    );
    port.receive({
      kind: "pi.memory.cluster-result",
      requestId,
      ok: true,
      output: { proposals: [] },
      usageRecords: [],
    });
    await expect(pending).resolves.toMatchObject({ ok: true, output: { proposals: [] } });
  });

  it("sequences progress and ignores updates after the response settles", async () => {
    const port = new FakeMessagePort();
    const client = new MessagePortPiHostClient(port as unknown as MessagePortMain, "a".repeat(64));
    port.receive({
      kind: "pi-host.ready",
      contractVersion: piHostContractVersion,
      nonce: "a".repeat(64),
    });
    await client.ready();
    let lateProgress: (() => void) | undefined;
    client.onToolRequest(async (_frame, onProgress) => {
      onProgress?.("first", false);
      onProgress?.("second", true);
      lateProgress = () => onProgress?.("late", false);
      return {
        summary: "done",
        content: [{ type: "text", text: "done" }],
        data: {},
        sources: [],
        artifacts: [],
        sideEffectCommitted: false,
        durationMs: 1,
      };
    });

    port.receive(request);
    await vi.waitFor(() => {
      expect(
        port.sent.some((frame) => (frame as { kind?: string }).kind === "pi.tool.response"),
      ).toBe(true);
    });
    lateProgress?.();
    expect(
      port.sent.filter((frame) => (frame as { kind?: string }).kind === "pi.tool.progress"),
    ).toEqual([
      expect.objectContaining({ sequence: 1, delta: "first", truncated: false }),
      expect.objectContaining({ sequence: 2, delta: "second", truncated: true }),
    ]);
  });

  it("forwards request-scoped cancellation and disconnect once", async () => {
    const port = new FakeMessagePort();
    const client = new MessagePortPiHostClient(port as unknown as MessagePortMain, "b".repeat(64));
    const cancelled = vi.fn();
    const disconnected = vi.fn();
    client.onToolCancel?.(cancelled);
    client.onDisconnect?.(disconnected);
    port.receive({
      kind: "pi-host.ready",
      contractVersion: piHostContractVersion,
      nonce: "b".repeat(64),
    });
    await client.ready();
    port.receive({
      kind: "pi.tool.cancel",
      requestId: request.requestId,
      generationId: request.generationId,
    });
    port.emit("close");
    expect(cancelled).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: request.requestId, generationId: request.generationId }),
    );
    expect(disconnected).toHaveBeenCalledOnce();
  });
});
