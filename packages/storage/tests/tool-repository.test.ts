import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatRepository, ToolRepository } from "../src";

const temporaryDirectories: string[] = [];

function fixture(): { databasePath: string; chat: ChatRepository; tools: ToolRepository } {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-tool-repository-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "openerx.sqlite");
  return {
    databasePath,
    chat: new ChatRepository(databasePath, { ownerProfileId: "profile-a" }),
    tools: new ToolRepository(databasePath, { ownerProfileId: "profile-a" }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ToolRepository", () => {
  it("keeps only current deliverables and marks intermediate or superseded artifacts disposable", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "生成报告",
      idempotencyKey: "chat-artifact-retention-0001",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "生成报告",
      selectedModelRef: "platform/auto",
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.4",
      piHostContractVersion: 10,
    });
    const recordArtifact = (
      piCallRef: string,
      artifactId: string,
      displayName: string,
      purpose?: "deliverable" | "intermediate",
    ): void => {
      const { toolCall } = tools.createToolCall({
        runId: projection.run.id,
        piCallRef,
        toolName: "openerx_artifact_write",
        source: "openerx",
        risk: "L3",
        idempotencyKey: `artifact-retention-${piCallRef}`,
        input: {
          operation: "artifact.write",
          input: {
            displayName,
            ...(purpose ? { purpose } : {}),
            format: "markdown",
            mediaType: "text/markdown",
            content: displayName,
          },
        },
        inputSummary: displayName,
        targetSummary: "新成果",
      });
      tools.markToolCall(toolCall.id, "completed", {
        resultSummary: displayName,
        resultContent: [{ type: "artifact", artifactId }],
      });
    };
    const deliverableId = "10000000-0000-4000-8000-000000000001";
    const intermediateId = "10000000-0000-4000-8000-000000000002";
    const legacyPingId = "10000000-0000-4000-8000-000000000003";
    recordArtifact("deliverable", deliverableId, "report.md", "deliverable");
    recordArtifact("intermediate", intermediateId, "layout-draft.md", "intermediate");
    recordArtifact("legacy-ping", legacyPingId, "ping11.md");

    expect(tools.artifactRetention(generation.receipt.conversationId)).toEqual({
      deliverableIds: [deliverableId],
      disposableIds: expect.arrayContaining([intermediateId, legacyPingId]),
    });
    chat.close();
    tools.close();
  });

  it("persists trusted local Web Search settings per profile", () => {
    const { databasePath, chat, tools } = fixture();
    expect(tools.localWebSearchSettings()).toBeNull();
    expect(
      tools.saveLocalWebSearchSettings({
        providerId: "direct:bing-html",
        locale: "en-US",
        safeSearch: "strict",
      }),
    ).toMatchObject({
      providerId: "direct:bing-html",
      locale: "en-US",
      safeSearch: "strict",
    });
    tools.close();

    const reopened = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
    expect(reopened.localWebSearchSettings()).toMatchObject({
      providerId: "direct:bing-html",
      locale: "en-US",
      safeSearch: "strict",
    });
    const otherProfile = new ToolRepository(databasePath, { ownerProfileId: "profile-b" });
    expect(otherProfile.localWebSearchSettings()).toBeNull();

    otherProfile.close();
    reopened.close();
    chat.close();
  });

  it("persists Skill-origin tool calls and the matching policy vocabulary", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "运行 Skill",
      idempotencyKey: "chat-skill-tool-0001",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "运行 Skill",
      selectedModelRef: "platform/auto",
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    const { toolCall } = tools.createToolCall({
      runId: projection.run.id,
      piCallRef: "pi-call-skill",
      toolName: "openerx_skill_script",
      source: "skill",
      risk: "L5",
      idempotencyKey: "skill-tool-side-effect-0001",
      inputSummary: "scripts/render.mjs",
      targetSummary: "e2e-report",
    });
    const scope = tools.createScope({
      capability: "skill",
      resourceType: "skill",
      resource: "e2e-report:scripts/render.mjs",
      actions: ["execute"],
      maxRisk: "L5",
      sessionOnly: true,
      expiresAt: null,
    });

    expect(toolCall.source).toBe("skill");
    expect(scope).toMatchObject({ capability: "skill", resourceType: "skill" });
    chat.close();
    tools.close();
  });

  it("persists the Pi projection, exact once permission, and idempotent side effect", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "运行工具",
      idempotencyKey: "chat-tool-0001",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "运行工具",
      selectedModelRef: "platform/auto",
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
      piSessionRef: "session-a",
    });
    const { toolCall } = tools.createToolCall({
      runId: projection.run.id,
      piCallRef: "pi-call-1",
      toolName: "openerx_shell",
      source: "openerx",
      risk: "L5",
      idempotencyKey: "tool-side-effect-0001",
      inputSummary: "pwd",
      targetSummary: "/workspace",
    });
    const request = tools.createPermission({
      workItemId: projection.workItem.id,
      runId: projection.run.id,
      toolCallId: toolCall.id,
      capability: "shell",
      risk: "L5",
      resourceType: "workspace",
      resource: "/workspace",
      actions: ["execute"],
      reason: "执行本地命令",
      payloadDigest: "a".repeat(64),
    });

    expect(tools.workItem(projection.workItem.id).status).toBe("waiting_for_permission");
    expect(() =>
      tools.resolvePermission({
        permissionRequestId: request.id,
        decision: "once",
        payloadDigest: "b".repeat(64),
      }),
    ).toThrow("PERMISSION_PAYLOAD_CHANGED");
    expect(() =>
      tools.resolvePermission({
        permissionRequestId: request.id,
        decision: "persistent",
        payloadDigest: request.payloadDigest,
      }),
    ).toThrow("PERMISSION_DECISION_NOT_ALLOWED");

    const resolved = tools.resolvePermission({
      permissionRequestId: request.id,
      decision: "once",
      payloadDigest: request.payloadDigest,
    });
    expect(resolved.permission.status).toBe("approved");
    expect(resolved.scope).toBeNull();
    expect(tools.activeScopes("shell")).toEqual([]);
    expect(
      tools.listRunItems(projection.run.id).find(({ content }) => content.type === "approval"),
    ).toMatchObject({ status: "completed" });

    tools.markToolCall(toolCall.id, "running");
    const result = {
      summary: "ok",
      content: [{ type: "text" as const, text: "ok" }],
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 3,
    };
    tools.commitSideEffect(toolCall.idempotencyKey, toolCall.id, result);
    tools.markToolCall(toolCall.id, "completed", { resultSummary: result.summary });
    expect(tools.sideEffect(toolCall.idempotencyKey)).toEqual(result);

    tools.completeRun(projection.run.id, "completed");
    expect(tools.workItem(projection.workItem.id).status).toBe("completed");
    chat.close();
    tools.close();
  });

  it("replays typed tool input, command output, sources, diffs, and selectable Runs", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "运行命令并展示结果",
      idempotencyKey: "chat-rich-items-0001",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "丰富 Item",
      selectedModelRef: generation.selectedModelRef,
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    const operation = {
      operation: "shell_execute" as const,
      idempotencyKey: "rich-shell-operation-0001",
      cwd: "/workspace",
      command: "npm",
      args: ["test"],
      timeoutMs: 30_000,
      background: false,
      allowNetwork: false,
    };
    const { toolCall } = tools.createToolCall({
      runId: projection.run.id,
      piCallRef: "pi-rich-shell",
      toolName: "openerx_shell",
      source: "openerx",
      risk: "L3",
      idempotencyKey: operation.idempotencyKey,
      input: operation,
      inputSummary: "npm test",
      targetSummary: "/workspace",
    });
    const workspaceChangeId = crypto.randomUUID();
    const processId = crypto.randomUUID();
    tools.markToolCall(toolCall.id, "running");
    tools.markToolCall(toolCall.id, "completed", {
      resultSummary: "all tests passed",
      resultContent: [
        { type: "text", text: "12 tests passed" },
        {
          type: "source",
          source: {
            title: "Vitest documentation",
            url: "https://vitest.dev/",
            publishedAt: null,
            retrievedAt: new Date().toISOString(),
            excerpt: "Test runner reference",
          },
        },
        {
          type: "diff",
          workspaceChangeId,
          relativePath: "src/index.ts",
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
      resultData: { processId, exitCode: 0, outputTruncated: false },
    });

    const detail = tools.workItemDetail(projection.workItem.id, projection.run.id);
    expect(detail.runs.map(({ id }) => id)).toEqual([projection.run.id]);
    expect(detail.toolCalls[0]?.input).toEqual(operation);
    expect(detail.items.map(({ content }) => content.type)).toEqual([
      "tool",
      "source",
      "diff",
      "command",
    ]);
    expect(detail.items.find(({ content }) => content.type === "command")?.content).toMatchObject({
      type: "command",
      command: "npm",
      args: ["test"],
      processId,
      exitCode: 0,
      output: "12 tests passed",
    });
    expect(detail.items.find(({ content }) => content.type === "diff")?.content).toMatchObject({
      workspaceChangeId,
      relativePath: "src/index.ts",
    });
    chat.close();
    tools.close();
  });

  it("fails interrupted runs and revokes temporary grants on recovery", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({ text: "长任务", idempotencyKey: "chat-tool-0002" });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "长任务",
      selectedModelRef: "platform/auto",
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    tools.createScope({
      capability: "browser",
      resourceType: "domain",
      resource: "example.com",
      actions: ["navigate"],
      maxRisk: "L2",
      sessionOnly: true,
      expiresAt: null,
    });
    const { toolCall } = tools.createToolCall({
      runId: projection.run.id,
      piCallRef: "pi-call-long",
      toolName: "openerx_browser",
      source: "openerx",
      risk: "L2",
      idempotencyKey: "tool-side-effect-0002",
      inputSummary: "open",
      targetSummary: "example.com",
    });
    tools.markToolCall(toolCall.id, "running");

    expect(tools.recoverInterrupted()).toEqual({
      toolCalls: 1,
      runs: 1,
      scopes: 1,
      permissions: 0,
    });
    expect(tools.toolCall(toolCall.id)).toMatchObject({
      status: "failed",
      errorCode: "TOOL_HOST_INTERRUPTED",
    });
    expect(tools.activeScopes()).toHaveLength(0);
    chat.close();
    tools.close();
  });

  it("recovers an in-flight external side effect as outcome_unknown", () => {
    const { databasePath, chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "提交外部动作",
      idempotencyKey: "chat-side-effect-crash-0001",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "提交外部动作",
      selectedModelRef: generation.selectedModelRef,
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    const { toolCall } = tools.createToolCall({
      runId: projection.run.id,
      piCallRef: "pi-call-crash",
      toolName: "openerx_browser",
      source: "openerx",
      risk: "L4",
      idempotencyKey: "tool-side-effect-crash-0001",
      inputSummary: "submit",
      targetSummary: "example.com",
    });
    tools.beginSideEffectAttempt(toolCall.idempotencyKey, toolCall.id);
    tools.close();
    chat.close();

    const recovered = new ToolRepository(databasePath, { ownerProfileId: "profile-a" });
    recovered.recoverInterrupted();
    expect(recovered.sideEffectAttempt(toolCall.idempotencyKey)?.status).toBe("outcome_unknown");
    recovered.close();
  });

  it("projects cancellation as cancelling until the runtime confirms interruption", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "停止运行",
      idempotencyKey: "chat-run-cancellation-0001",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "停止运行",
      selectedModelRef: generation.selectedModelRef,
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });

    expect(tools.requestRunCancellation(projection.run.id).status).toBe("cancelling");
    expect(tools.workItem(projection.workItem.id).status).toBe("cancelling");

    tools.completeRun(projection.run.id, "interrupted");
    expect(tools.run(projection.run.id).status).toBe("interrupted");
    expect(tools.workItem(projection.workItem.id).status).toBe("interrupted");
    chat.close();
    tools.close();
  });

  it("persists only MCP configuration and credential references", () => {
    const { chat, tools } = fixture();
    const server = tools.upsertMcpServer({
      id: "00000000-0000-4000-8000-000000000609",
      name: "remote",
      transport: "streamable_http",
      url: "https://mcp.example.com/mcp",
      auth: "bearer",
      credentialRef: "mcp:00000000-0000-4000-8000-000000000609",
      enabled: true,
      enabledTools: ["search"],
    });
    expect(tools.listMcpServers()).toEqual([server]);
    expect(tools.removeMcpServer(server.id)).toEqual({ serverId: server.id, removed: true });
    expect(tools.listMcpServers()).toEqual([]);
    chat.close();
    tools.close();
  });

  it("freezes the per-Turn model, tools, skills, and instruction snapshot", () => {
    const { chat, tools } = fixture();
    const generation = chat.createGeneration({
      text: "冻结本轮配置",
      idempotencyKey: "turn-snapshot-freeze-0001",
      thinkingLevel: "high",
    });
    const projection = tools.createProjection({
      conversationId: generation.receipt.conversationId,
      messageId: generation.receipt.assistantMessageId,
      branchId: generation.receipt.branchId,
      title: "冻结本轮配置",
      selectedModelRef: generation.selectedModelRef,
      thinkingLevel: generation.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    const skillId = crypto.randomUUID();
    const source = {
      kind: "project" as const,
      workspaceGrantId: crypto.randomUUID(),
      relativePath: "AGENTS.md",
      appliesTo: ".",
      digest: "a".repeat(64),
      content: "project instruction",
    };
    const frozen = tools.freezeRunConfiguration(projection.run.id, {
      initialToolNames: ["openerx_tool_search"],
      availableToolNames: ["openerx_tool_search", "openerx_workspace_read"],
      skillInstallationIds: [skillId],
      instructionSources: [source],
    });
    expect(frozen).toMatchObject({
      selectedModelRef: generation.selectedModelRef,
      thinkingLevel: "high",
      initialToolNames: ["openerx_tool_search"],
      availableToolNames: ["openerx_tool_search", "openerx_workspace_read"],
      skillInstallationIds: [skillId],
      instructionSources: [source],
    });
    chat.selectConversationModel(generation.receipt.conversationId, "platform/another");
    chat.selectConversationThinkingLevel(generation.receipt.conversationId, "low");
    const secondGeneration = chat.createGeneration({
      conversationId: generation.receipt.conversationId,
      text: "使用新的默认配置",
      idempotencyKey: "turn-snapshot-freeze-0002",
    });
    const secondProjection = tools.createProjection({
      conversationId: secondGeneration.receipt.conversationId,
      messageId: secondGeneration.receipt.assistantMessageId,
      branchId: secondGeneration.receipt.branchId,
      title: "第二轮配置",
      selectedModelRef: secondGeneration.selectedModelRef,
      thinkingLevel: secondGeneration.thinkingLevel,
      piPackageVersion: "0.84.3",
      piHostContractVersion: 2,
    });
    expect(tools.run(projection.run.id)).toMatchObject({
      selectedModelRef: generation.selectedModelRef,
      thinkingLevel: "high",
      initialToolNames: ["openerx_tool_search"],
    });
    expect(tools.run(secondProjection.run.id)).toMatchObject({
      selectedModelRef: "platform/another",
      thinkingLevel: "low",
    });
    expect(() =>
      tools.freezeRunConfiguration(projection.run.id, {
        initialToolNames: [],
        availableToolNames: [],
        skillInstallationIds: [],
        instructionSources: [],
      }),
    ).toThrow("RUN_CONFIGURATION_ALREADY_FROZEN");
    chat.close();
    tools.close();
  });
});
