import { describe, expect, it } from "vitest";
import {
  appServiceRequestFrameSchema,
  chatSendInputSchema,
  conversationSchema,
  parseProjectCommandResult,
  projectCommandEnvelopeSchema,
  projectCreateInputSchema,
  projectDirectoryBindingSchema,
  projectDirectoryChooseInputSchema,
  projectDirectoryChoosePrivilegedInputSchema,
  projectDirectoryCreateInputSchema,
  projectDirectoryStateSchema,
  projectDirectorySyncPayloadSchema,
  projectSyncPayloadSchema,
  projectUpdateInputSchema,
  syncObjectTypeSchema,
} from "../src";

const now = "2026-09-04T00:00:00.000Z";

describe("personal project contracts", () => {
  it("accepts folderless projects and bounded updates", () => {
    expect(
      projectCreateInputSchema.parse({
        operationId: crypto.randomUUID(),
        name: "  客户报告  ",
      }),
    ).toMatchObject({ name: "客户报告", instructions: "" });

    expect(() =>
      projectUpdateInputSchema.parse({
        operationId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        expectedRevision: 1,
      }),
    ).toThrow();
  });

  it("keeps logical directories separate from device grants and paths", () => {
    const input = {
      operationId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      expectedProjectRevision: 1,
      workspaceGrantId: crypto.randomUUID(),
      displayName: "src",
    };
    expect(projectDirectoryCreateInputSchema.parse(input)).toMatchObject({
      displayName: "src",
      desiredAccess: "read_write",
    });
    expect(() =>
      projectDirectoryCreateInputSchema.parse({ ...input, rootPath: "C:\\secrets" }),
    ).toThrow();
    const chooseInput = {
      operationId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      expectedProjectRevision: 1,
    };
    expect(projectDirectoryChooseInputSchema.parse(chooseInput)).toMatchObject({
      projectDirectoryId: null,
      desiredAccess: "read_write",
    });
    expect(() =>
      projectDirectoryChooseInputSchema.parse({ ...chooseInput, rootPath: "C:\\secrets" }),
    ).toThrow();
    expect(
      projectDirectoryChoosePrivilegedInputSchema.parse({
        ...chooseInput,
        rootPath: "C:\\selected-by-main",
      }),
    ).toMatchObject({ rootPath: "C:\\selected-by-main" });

    expect(() =>
      projectDirectoryBindingSchema.parse({
        id: crypto.randomUUID(),
        ownerProfileId: "local-default",
        projectDirectoryId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        workspaceGrantId: crypto.randomUUID(),
        lastValidatedAt: now,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        revision: 1,
        rootPath: "C:\\must-not-cross-the-contract",
      }),
    ).toThrow();
  });

  it("requires connection states to agree with active bindings", () => {
    const directory = {
      id: crypto.randomUUID(),
      ownerProfileId: "local-default",
      projectId: crypto.randomUUID(),
      displayName: "workspace",
      role: "primary" as const,
      desiredAccess: "read_write" as const,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      revision: 1,
    };
    expect(
      projectDirectoryStateSchema.parse({
        directory,
        binding: null,
        connectionState: "reconnect_required",
      }),
    ).toMatchObject({ connectionState: "reconnect_required" });
    expect(() =>
      projectDirectoryStateSchema.parse({
        directory,
        binding: null,
        connectionState: "connected",
      }),
    ).toThrow();
  });

  it("adds project membership without making it a chat prerequisite", () => {
    const baseConversation = {
      id: crypto.randomUUID(),
      ownerProfileId: "local-default",
      title: "普通对话",
      activeBranchId: crypto.randomUUID(),
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium" as const,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      revision: 1,
    };
    expect(conversationSchema.parse(baseConversation).projectId).toBeNull();
    expect(
      chatSendInputSchema.parse({
        text: "项目内开始",
        projectId: crypto.randomUUID(),
        idempotencyKey: "project-chat-0001",
      }).projectId,
    ).toBeTypeOf("string");
    expect(syncObjectTypeSchema.parse("project")).toBe("project");
    expect(syncObjectTypeSchema.parse("project_directory")).toBe("project_directory");
  });

  it("whitelists only portable project sync fields", () => {
    const ownerProfileId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const project = {
      id: projectId,
      ownerProfileId,
      name: "跨设备项目",
      instructions: "保持同步，但不携带本机权限。",
      pinnedRank: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      revision: 1,
    };
    const directory = {
      id: crypto.randomUUID(),
      ownerProfileId,
      projectId,
      displayName: "逻辑主目录",
      role: "primary" as const,
      desiredAccess: "read_only" as const,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      revision: 1,
    };

    expect(projectSyncPayloadSchema.parse(project)).toEqual(project);
    expect(projectDirectorySyncPayloadSchema.parse(directory)).toEqual(directory);
    expect(() =>
      projectDirectorySyncPayloadSchema.parse({
        ...directory,
        rootPath: "C:\\must-stay-local",
      }),
    ).toThrow();
    expect(() =>
      projectDirectorySyncPayloadSchema.parse({
        ...directory,
        workspaceGrantId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      projectDirectorySyncPayloadSchema.parse({ ...directory, deletedAt: now }),
    ).toThrow();
  });

  it("round-trips project commands through the App Service transport", () => {
    const operationId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const command = projectCommandEnvelopeSchema.parse({
      command: "project.create",
      input: { operationId, name: "年度规划" },
    });
    expect(command.input).toMatchObject({ operationId, instructions: "" });
    expect(
      appServiceRequestFrameSchema.parse({
        kind: "app-service.request",
        requestId,
        request: command,
      }).request.command,
    ).toBe("project.create");

    expect(
      parseProjectCommandResult("project.create", {
        id: crypto.randomUUID(),
        ownerProfileId: "local-default",
        name: "年度规划",
        instructions: "",
        pinnedRank: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        revision: 1,
      }),
    ).toMatchObject({ name: "年度规划", revision: 1 });
  });
});
