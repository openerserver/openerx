import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatEvent, PiToolRequestFrame } from "@openerx/contracts";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolAppService } from "../src";

const directories: string[] = [];

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-tool-service-"));
  directories.push(directory);
  const databasePath = path.join(directory, "openerx.sqlite");
  const chat = new ChatRepository(databasePath, { ownerProfileId: "profile-a" });
  const tools = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
  const generation = chat.createGeneration({
    text: "打开网页",
    idempotencyKey: "chat-tool-service-0001",
  });
  const events: ChatEvent[] = [];
  const host = {
    execute: vi.fn(async () => ({
      summary: "isolated browser opened",
      data: { sessionId: "00000000-0000-4000-8000-000000000777" },
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 2,
    })),
    resolve: vi.fn(async () => "secret"),
    clear: vi.fn(async () => undefined),
  };
  const service = new ToolAppService({
    repository: tools,
    workspaceDirectory: directory,
    host,
    resolveUploadPath: (fileId) => path.join(directory, "content", fileId),
    ingestDownload: async (downloadPath) => ({
      fileId: crypto.randomUUID(),
      displayName: path.basename(downloadPath),
    }),
    selectedModelRef: () => "platform/auto",
    emit: (event) => events.push(event),
  });
  const base = {
    kind: "pi.tool.request" as const,
    requestId: "00000000-0000-4000-8000-000000000701",
    generationId: "00000000-0000-4000-8000-000000000702",
    conversationId: generation.receipt.conversationId,
    assistantMessageId: generation.receipt.assistantMessageId,
    piToolCallId: "pi-browser-call",
    toolName: "openerx_browser",
  };
  return { chat, tools, service, host, events, base };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("ToolAppService", () => {
  it("projects a permission wait, resumes the same Pi call, and completes the run", async () => {
    const { chat, tools, service, host, events, base } = fixture();
    service.initialize();
    const frame: PiToolRequestFrame = {
      ...base,
      operation: {
        operation: "browser",
        action: "open",
        url: "https://example.com/current",
        idempotencyKey: "browser-side-effect-0001",
      },
    };
    const pending = service.handleRequest(frame);
    await vi.waitFor(() => {
      expect(events.some(({ type }) => type === "permission.required")).toBe(true);
    });
    expect(host.execute).not.toHaveBeenCalled();
    const permission = events.find(({ type }) => type === "permission.required")?.payload
      .permission;
    if (!permission) throw new Error("permission not projected");
    service.resolvePermission({
      permissionRequestId: permission.id,
      decision: "once",
      payloadDigest: permission.payloadDigest,
    });

    await expect(pending).resolves.toMatchObject({ summary: "isolated browser opened" });
    expect(host.execute).toHaveBeenCalledTimes(1);
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "run.started",
        "tool.requested",
        "permission.required",
        "permission.resolved",
        "tool.completed",
      ]),
    );

    service.completeGeneration(base.generationId, "completed");
    const workItem = tools.listWorkItems(base.conversationId)[0];
    expect(workItem?.status).toBe("completed");
    if (workItem) expect(tools.workItemDetail(workItem.id).toolCalls[0]?.status).toBe("completed");
    chat.close();
    await service.close();
  });
});
