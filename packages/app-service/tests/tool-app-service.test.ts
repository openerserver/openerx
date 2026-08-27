import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ChatEvent,
  HostToolAvailability,
  PiActivityEvent,
  PiToolRequestFrame,
} from "@openerx/contracts";
import { ChatRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolAppService } from "../src";

const directories: string[] = [];

function fixture(options: { shellAvailability?: () => HostToolAvailability } = {}) {
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
    availability: vi.fn(async () => ({
      availableToolNames: ["openerx_browser", "openerx_desktop"],
      unavailableReasons: {},
    })),
    execute: vi.fn(async () => ({
      summary: "isolated browser opened",
      content: [{ type: "text" as const, text: "isolated browser opened" }],
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
    ...(options.shellAvailability ? { shellAvailability: options.shellAvailability } : {}),
  });
  const base = {
    kind: "pi.tool.request" as const,
    requestId: "00000000-0000-4000-8000-000000000701",
    generationId: "00000000-0000-4000-8000-000000000702",
    conversationId: generation.receipt.conversationId,
    branchId: generation.receipt.branchId,
    assistantMessageId: generation.receipt.assistantMessageId,
    piToolCallId: "pi-browser-call",
    toolName: "openerx_browser",
  };
  return { chat, tools, service, host, events, base, directory };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("ToolAppService", () => {
  it("projects a permission wait, resumes the same Pi call, and completes the run", async () => {
    const { chat, tools, service, host, events, base } = fixture();
    service.initialize();
    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "high",
    });
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

    const usageRecords = [1, 2].map((round) => ({
      usageId: crypto.randomUUID(),
      accountId: crypto.randomUUID(),
      conversationId: base.conversationId,
      messageId: base.assistantMessageId,
      runId: null,
      toolCallId: null,
      selectedModelRef: "platform/auto",
      effectiveModelRef: "platform/standard",
      fallbackReason: null,
      inputTokens: 10 * round,
      cachedInputTokens: 0,
      outputTokens: 5,
      reasoningTokens: null,
      totalTokens: 10 * round + 5,
      providerReported: true,
      missingReasons: { reasoningTokens: "provider_not_reported" },
      dedupeKey: `usage-tool-round-${round}`,
      recordedAt: new Date().toISOString(),
    }));
    service.completeGeneration(base.generationId, "completed", undefined, usageRecords);
    const workItem = tools.listWorkItems(base.conversationId)[0];
    expect(workItem?.status).toBe("completed");
    if (workItem) {
      const detail = tools.workItemDetail(workItem.id);
      expect(detail.toolCalls[0]?.status).toBe("completed");
      expect(detail.run.usageRecords).toHaveLength(2);
      expect(detail.run.usageRecords.every(({ runId }) => runId === detail.run.id)).toBe(true);
    }
    chat.close();
    await service.close();
  });

  it("emits cancelling before the runtime-confirmed interrupted terminal state", async () => {
    const { chat, tools, service, events, base } = fixture();
    service.initialize();
    const projection = service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });

    service.requestCancellation(base.generationId);
    expect(tools.run(projection.run.id).status).toBe("cancelling");
    service.completeGeneration(base.generationId, "interrupted", "USER_ABORTED");

    const lifecycle = events.map(({ type }) => type);
    expect(lifecycle.indexOf("run.cancelling")).toBeGreaterThan(lifecycle.indexOf("run.started"));
    expect(lifecycle.indexOf("run.interrupted")).toBeGreaterThan(
      lifecycle.indexOf("run.cancelling"),
    );
    expect(tools.run(projection.run.id).status).toBe("interrupted");
    chat.close();
    await service.close();
  });

  it("persists model, safe reasoning, plan, compaction, and retry Items by Run", async () => {
    const { chat, tools, service, events, base } = fixture();
    service.initialize();
    const projection = service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "high",
    });
    const activity = (
      sequence: number,
      event: Omit<PiActivityEvent, "kind" | "generationId" | "eventId" | "sequence" | "occurredAt">,
    ): PiActivityEvent => ({
      kind: "pi.activity-event",
      generationId: base.generationId,
      eventId: crypto.randomUUID(),
      sequence,
      occurredAt: new Date().toISOString(),
      ...event,
    });
    service.handleActivity(
      activity(1, {
        type: "model.started",
        piItemRef: "model:1",
        modelRef: "platform/auto",
      }),
    );
    service.handleActivity(
      activity(2, {
        type: "reasoning.started",
        piItemRef: "reasoning:1:1",
        resultSummary: "PRIVATE_RAW_CHAIN_OF_THOUGHT",
      }),
    );
    service.handleActivity(
      activity(3, {
        type: "reasoning.completed",
        piItemRef: "reasoning:1:1",
        resultSummary: "PRIVATE_RAW_CHAIN_OF_THOUGHT",
        reasoningTokens: 21,
      }),
    );
    service.handleActivity(
      activity(4, {
        type: "plan.updated",
        piItemRef: "plan:1",
        explanation: "先实现再验证",
        planEntries: [
          { text: "实现", status: "completed" },
          { text: "验证", status: "in_progress" },
        ],
      }),
    );
    service.handleActivity(
      activity(5, {
        type: "run.compacting",
        piItemRef: "compaction:1",
        compactionReason: "threshold",
      }),
    );
    service.handleActivity(
      activity(6, {
        type: "run.compacted",
        piItemRef: "compaction:1",
        compactionReason: "threshold",
        tokensBefore: 10_000,
        tokensAfter: 4_000,
      }),
    );
    service.handleActivity(
      activity(7, {
        type: "run.retrying",
        piItemRef: "retry:1",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 500,
        resultSummary: "attempt 1/3",
      }),
    );
    service.handleActivity(
      activity(8, {
        type: "run.retry_completed",
        piItemRef: "retry:1",
        attempt: 1,
      }),
    );
    service.handleActivity(
      activity(9, {
        type: "model.completed",
        piItemRef: "model:1",
        modelRef: "platform/auto",
      }),
    );

    const detail = tools.workItemDetail(projection.workItem.id);
    expect(detail.items.map(({ content }) => content.type)).toEqual([
      "model",
      "reasoning",
      "plan",
      "compaction",
      "retry",
    ]);
    expect(detail.items.find(({ content }) => content.type === "reasoning")?.content).toEqual({
      type: "reasoning",
      summary: "模型推理已完成；Run 时间线仅保存安全摘要。",
      reasoningTokens: 21,
      contentRedacted: true,
    });
    expect(JSON.stringify(detail.items)).not.toContain("PRIVATE_RAW_CHAIN_OF_THOUGHT");
    expect(detail.run).toMatchObject({
      lastPiEventSequence: 9,
      compactionCount: 1,
      retryCount: 1,
    });
    expect(events.some(({ type }) => type === "run.progressed")).toBe(true);
    chat.close();
    await service.close();
  });

  it("keeps an unavailable grant from breaking preparation for a valid workspace", async () => {
    const { chat, service } = fixture();
    const validRoot = mkdtempSync(path.join(tmpdir(), "openerx-valid-workspace-"));
    const unavailableRoot = mkdtempSync(path.join(tmpdir(), "openerx-missing-workspace-"));
    directories.push(validRoot, unavailableRoot);
    mkdirSync(path.join(validRoot, "src"));
    const valid = service.grantWorkspace({
      rootPath: validRoot,
      conversationId: null,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    service.grantWorkspace({
      rootPath: unavailableRoot,
      conversationId: null,
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
    });
    rmSync(unavailableRoot, { recursive: true, force: true });

    const prepared = await service.prepareGeneration({
      conversationId: crypto.randomUUID(),
      prompt: "检查代码",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(prepared.workspaceGrants.map(({ id }) => id)).toEqual([valid.id]);
    expect(prepared.availableToolNames).toContain("openerx_workspace_read");
    expect(prepared.availableToolNames).toContain("openerx_update_plan");
    expect(prepared.initialToolNames).toContain("openerx_update_plan");
    chat.close();
    await service.close();
  });

  it("fails closed when Host and OS capabilities are unavailable and reports actionable readiness", async () => {
    const { chat, service, host, base, directory } = fixture({
      shellAvailability: () => ({
        availableToolNames: [],
        unavailableReasons: {
          openerx_shell: "SHELL_OS_SANDBOX_UNAVAILABLE",
          openerx_shell_process: "SHELL_OS_SANDBOX_UNAVAILABLE",
        },
      }),
    });
    host.availability.mockResolvedValue({
      availableToolNames: ["openerx_browser"],
      unavailableReasons: {
        openerx_desktop: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
      },
    });
    service.grantWorkspace({
      rootPath: directory,
      conversationId: null,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });

    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "在浏览器和桌面中运行测试命令",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(prepared.availableToolNames).toContain("openerx_browser");
    expect(prepared.availableToolNames).not.toContain("openerx_desktop");
    expect(prepared.availableToolNames).not.toContain("openerx_shell");
    expect(prepared.initialToolNames).toContain("openerx_browser");
    expect(prepared.initialToolNames).not.toContain("openerx_desktop");
    expect(prepared.initialToolNames).not.toContain("openerx_shell");

    const readiness = await service.listRuntimeReadiness({
      authenticated: false,
      platformConfigured: true,
    });
    expect(readiness.find(({ capability }) => capability === "browser")).toMatchObject({
      status: "available",
      reason: null,
    });
    expect(readiness.find(({ capability }) => capability === "desktop")).toMatchObject({
      status: "authorization_required",
      reason: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
    });
    expect(readiness.find(({ capability }) => capability === "shell")).toMatchObject({
      status: "unavailable",
      reason: "SHELL_OS_SANDBOX_UNAVAILABLE",
    });
    expect(readiness.find(({ capability }) => capability === "web.search")).toMatchObject({
      status: "authorization_required",
      reason: "AUTHENTICATION_REQUIRED",
    });
    expect(readiness.find(({ capability }) => capability === "mcp")).toMatchObject({
      status: "authorization_required",
      reason: "MCP_SERVER_CONFIGURATION_REQUIRED",
    });
    chat.close();
    await service.close();
  });

  it("removes Shell from runtime readiness and generation tools after workspace revocation", async () => {
    const { chat, service, base, directory } = fixture({
      shellAvailability: () => ({
        availableToolNames: ["openerx_shell", "openerx_shell_process"],
        unavailableReasons: {},
      }),
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: null,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    expect(
      (
        await service.listRuntimeReadiness({ authenticated: false, platformConfigured: false })
      ).find(({ capability }) => capability === "shell"),
    ).toMatchObject({ status: "available", reason: null });

    service.revokeWorkspace(grant.id);
    expect(
      (
        await service.listRuntimeReadiness({ authenticated: false, platformConfigured: false })
      ).find(({ capability }) => capability === "shell"),
    ).toMatchObject({
      status: "authorization_required",
      reason: "WORKSPACE_WRITE_GRANT_REQUIRED",
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "运行测试命令",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(prepared.availableToolNames).not.toContain("openerx_shell");
    expect(prepared.initialToolNames).not.toContain("openerx_shell");
    chat.close();
    await service.close();
  });
});
