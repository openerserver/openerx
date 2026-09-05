import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SyncChange, SyncOperation } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ChatRepository, migrateDatabase, ProjectRepository, ToolRepository } from "../src";

const temporaryDirectories: string[] = [];
const ownerProfileId = "local-default";
const deviceId = "30000000-0000-4000-8000-000000000001";
const now = "2026-09-04T00:00:00.000Z";

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-project-storage-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "project.sqlite");
}

function insertProjectWorkspaceGrant(
  file: string,
  workspaceGrantId: string,
  options: { owner?: string; access?: "read_only" | "read_write" } = {},
): void {
  const database = new DatabaseSync(file);
  migrateDatabase(database);
  database
    .prepare(
      `INSERT INTO workspace_grants
       (id, owner_profile_id, conversation_id, display_name, root_path, access, allow_network,
        expires_at, revoked_at, created_at)
       VALUES (?, ?, NULL, 'project workspace', 'C:\\project', ?, 0, NULL, NULL, ?)`,
    )
    .run(workspaceGrantId, options.owner ?? ownerProfileId, options.access ?? "read_write", now);
  database.close();
}

function pullFromOperations(
  operations: SyncOperation[],
  cursorOffset = 0,
): { changes: SyncChange[]; nextCursor: `cursor:${number}` } {
  const changes = operations.map((operation, index) => ({
    cursor: `cursor:${cursorOffset + index + 1}` as `cursor:${number}`,
    accountId: operation.accountId,
    objectType: operation.objectType,
    objectId: operation.objectId,
    revision: operation.baseRevision + 1,
    tombstone: operation.mutation === "delete",
    payloadVersion: 1 as const,
    payload: operation.payload,
    operationId: operation.operationId,
    changedAt: now,
    retainUntil: operation.mutation === "delete" ? "2026-10-04T00:00:00.000Z" : null,
  }));
  return {
    changes,
    nextCursor: `cursor:${cursorOffset + operations.length}` as `cursor:${number}`,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ProjectRepository", () => {
  it("creates folderless projects and enforces optimistic revisions with idempotent writes", () => {
    const repository = new ProjectRepository(databasePath(), {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const operationId = crypto.randomUUID();
    const project = repository.createProject({ operationId, name: "  客户报告  " });
    const replay = repository.createProject({ operationId, name: "不会创建第二个" });

    expect(project).toMatchObject({ name: "客户报告", instructions: "", revision: 1 });
    expect(replay).toEqual(project);
    expect(repository.getProject(project.id).directories).toEqual([]);
    expect(repository.listProjects()).toMatchObject([
      {
        id: project.id,
        directoryCount: 0,
        connectedDirectoryCount: 0,
        reconnectRequiredCount: 0,
      },
    ]);
    expect(() =>
      repository.updateProject({
        operationId: crypto.randomUUID(),
        projectId: project.id,
        expectedRevision: 2,
        name: "stale",
      }),
    ).toThrow("PROJECT_REVISION_CONFLICT");
    const updated = repository.updateProject({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedRevision: 1,
      instructions: "只使用批准的数据。",
      pinnedRank: 0,
    });
    expect(updated).toMatchObject({
      instructions: "只使用批准的数据。",
      pinnedRank: 0,
      revision: 2,
    });
    repository.close();
  });

  it("keeps one primary directory and supports device disconnect and reconnect", () => {
    const file = databasePath();
    const firstGrantId = crypto.randomUUID();
    const secondGrantId = crypto.randomUUID();
    const reconnectGrantId = crypto.randomUUID();
    insertProjectWorkspaceGrant(file, firstGrantId);
    insertProjectWorkspaceGrant(file, secondGrantId);
    insertProjectWorkspaceGrant(file, reconnectGrantId);
    const repository = new ProjectRepository(file, { ownerProfileId, deviceId, now: () => now });
    const project = repository.createProject({ operationId: crypto.randomUUID(), name: "代码库" });
    const first = repository.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 1,
      workspaceGrantId: firstGrantId,
      displayName: "主仓库",
    });
    const second = repository.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 2,
      workspaceGrantId: secondGrantId,
      displayName: "设计资料",
    });

    expect(first.directory.role).toBe("primary");
    expect(second.directory.role).toBe("additional");
    expect(
      repository.getProject(project.id).directories.map(({ directory }) => directory.role),
    ).toEqual(["primary", "additional"]);

    const switched = repository.setPrimaryDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      projectDirectoryId: second.directory.id,
      expectedProjectRevision: 3,
    });
    expect(switched.project.revision).toBe(4);
    expect(switched.directories[0]?.directory.id).toBe(second.directory.id);

    const disconnected = repository.disconnectDirectory({
      operationId: crypto.randomUUID(),
      projectDirectoryId: second.directory.id,
      expectedProjectRevision: 4,
    });
    expect(disconnected).toMatchObject({ binding: null, connectionState: "reconnect_required" });
    const connected = repository.connectDirectory({
      operationId: crypto.randomUUID(),
      projectDirectoryId: second.directory.id,
      expectedProjectRevision: 4,
      workspaceGrantId: reconnectGrantId,
    });
    expect(connected.connectionState).toBe("connected");
    expect(connected.binding?.workspaceGrantId).toBe(reconnectGrantId);
    expect(connected).not.toHaveProperty("rootPath");
    repository.close();
  });

  it("creates a Remote-safe project snapshot without device-local authority data", () => {
    const file = databasePath();
    const workspaceGrantId = crypto.randomUUID();
    insertProjectWorkspaceGrant(file, workspaceGrantId);
    const repository = new ProjectRepository(file, { ownerProfileId, deviceId, now: () => now });
    const project = repository.createProject({
      operationId: crypto.randomUUID(),
      name: "手机可见项目",
      instructions: "先读取项目说明。",
    });
    const directory = repository.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 1,
      workspaceGrantId,
      displayName: "逻辑目录",
    });
    repository.disconnectDirectory({
      operationId: crypto.randomUUID(),
      projectDirectoryId: directory.directory.id,
      expectedProjectRevision: 2,
    });

    const snapshot = repository.remoteSnapshot();
    expect(snapshot).toMatchObject({
      kind: "project.snapshot",
      generatedAt: now,
      projects: [
        {
          projectId: project.id,
          name: "手机可见项目",
          instructions: "先读取项目说明。",
          directories: [
            {
              projectDirectoryId: directory.directory.id,
              displayName: "逻辑目录",
              connectionState: "reconnect_required",
            },
          ],
        },
      ],
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("C:\\project");
    expect(serialized).not.toContain(workspaceGrantId);
    expect(serialized).not.toContain(directory.binding?.id);
    expect(serialized).not.toContain("rootPath");
    expect(serialized).not.toContain("workspaceGrantId");
    repository.close();
  });

  it("requires an explicit replacement before removing the primary directory", () => {
    const file = databasePath();
    const firstGrantId = crypto.randomUUID();
    const secondGrantId = crypto.randomUUID();
    insertProjectWorkspaceGrant(file, firstGrantId);
    insertProjectWorkspaceGrant(file, secondGrantId);
    const repository = new ProjectRepository(file, { ownerProfileId, deviceId, now: () => now });
    const project = repository.createProject({ operationId: crypto.randomUUID(), name: "多目录" });
    const first = repository.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 1,
      workspaceGrantId: firstGrantId,
      displayName: "第一目录",
    });
    const second = repository.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 2,
      workspaceGrantId: secondGrantId,
      displayName: "第二目录",
    });

    expect(() =>
      repository.removeDirectory({
        operationId: crypto.randomUUID(),
        projectId: project.id,
        projectDirectoryId: first.directory.id,
        expectedProjectRevision: 3,
      }),
    ).toThrow("PROJECT_PRIMARY_DIRECTORY_REQUIRED");
    const result = repository.removeDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      projectDirectoryId: first.directory.id,
      replacementPrimaryDirectoryId: second.directory.id,
      expectedProjectRevision: 3,
    });
    expect(result.project.revision).toBe(4);
    expect(result.directories).toHaveLength(1);
    expect(result.directories[0]?.directory).toMatchObject({
      id: second.directory.id,
      role: "primary",
    });
    repository.close();
  });

  it("moves only idle conversations and creates new chats directly inside active projects", () => {
    const file = databasePath();
    const projects = new ProjectRepository(file, { ownerProfileId, deviceId, now: () => now });
    const project = projects.createProject({ operationId: crypto.randomUUID(), name: "上下文" });
    const chats = new ChatRepository(file, { ownerProfileId, now: () => now });
    const draft = chats.createGeneration({
      text: "尚在运行",
      idempotencyKey: "project-move-chat-0001",
    });

    expect(() =>
      projects.moveConversationToProject({
        operationId: crypto.randomUUID(),
        conversationId: draft.receipt.conversationId,
        projectId: project.id,
        expectedConversationRevision: 2,
      }),
    ).toThrow("PROJECT_MOVE_BLOCKED_BY_ACTIVE_RUN");
    chats.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: now,
      type: "completed",
    });
    const current = chats.getConversation(draft.receipt.conversationId).conversation;
    const moved = projects.moveConversationToProject({
      operationId: crypto.randomUUID(),
      conversationId: current.id,
      projectId: project.id,
      expectedConversationRevision: current.revision,
    });
    expect(moved.projectId).toBe(project.id);

    const projectChat = chats.createGeneration({
      projectId: project.id,
      text: "项目内创建",
      idempotencyKey: "project-create-chat-0002",
    });
    expect(chats.getConversation(projectChat.receipt.conversationId).conversation.projectId).toBe(
      project.id,
    );
    chats.close();
    projects.close();
  });

  it("preserves project state and unlocks conversation moves after interrupted-run recovery", () => {
    const file = databasePath();
    const projects = new ProjectRepository(file, { ownerProfileId, deviceId, now: () => now });
    const project = projects.createProject({
      operationId: crypto.randomUUID(),
      name: "恢复项目",
      instructions: "恢复后仍保留。",
    });
    const chats = new ChatRepository(file, { ownerProfileId, now: () => now });
    const draft = chats.createGeneration({
      projectId: project.id,
      text: "模拟运行中崩溃",
      idempotencyKey: "project-interrupted-recovery-0001",
    });
    chats.close();
    projects.close();

    const recoveredChats = new ChatRepository(file, { ownerProfileId, now: () => now });
    const recoveryEvents = recoveredChats.recoverInterrupted();
    expect(recoveryEvents).toMatchObject([
      {
        type: "message.failed",
        conversationId: draft.receipt.conversationId,
        payload: { reason: "APP_SERVICE_RESTARTED" },
      },
    ]);
    const recoveredProjects = new ProjectRepository(file, {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    expect(recoveredProjects.getProject(project.id).project).toMatchObject({
      name: "恢复项目",
      instructions: "恢复后仍保留。",
    });
    const conversation = recoveredChats.getConversation(draft.receipt.conversationId).conversation;
    const moved = recoveredProjects.moveConversationToProject({
      operationId: crypto.randomUUID(),
      conversationId: conversation.id,
      projectId: null,
      expectedConversationRevision: conversation.revision,
    });
    expect(moved.projectId).toBeNull();
    expect(recoveredChats.getConversation(conversation.id).messages.at(-1)?.status).toBe("failed");
    recoveredProjects.close();
    recoveredChats.close();
  });

  it("rejects archived projects and grants outside the current account", () => {
    const file = databasePath();
    const foreignGrantId = crypto.randomUUID();
    insertProjectWorkspaceGrant(file, foreignGrantId, { owner: "another-account" });
    const repository = new ProjectRepository(file, { ownerProfileId, deviceId, now: () => now });
    const project = repository.createProject({ operationId: crypto.randomUUID(), name: "安全" });
    expect(() =>
      repository.addDirectory({
        operationId: crypto.randomUUID(),
        projectId: project.id,
        expectedProjectRevision: 1,
        workspaceGrantId: foreignGrantId,
        displayName: "越权目录",
      }),
    ).toThrow("PROJECT_SCOPE_MISMATCH");
    const archived = repository.setProjectArchived({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedRevision: 1,
      archived: true,
    });
    expect(() =>
      repository.connectDirectory({
        operationId: crypto.randomUUID(),
        projectDirectoryId: crypto.randomUUID(),
        expectedProjectRevision: archived.revision,
        workspaceGrantId: foreignGrantId,
      }),
    ).toThrow("PROJECT_DIRECTORY_UNAVAILABLE");
    const chats = new ChatRepository(file, { ownerProfileId });
    expect(() =>
      chats.createGeneration({
        projectId: project.id,
        text: "不应开始",
        idempotencyKey: "archived-project-chat-0001",
      }),
    ).toThrow("PROJECT_ARCHIVED");
    chats.close();
    repository.close();
  });

  it("projects device bindings into idempotent conversation-scoped workspace grants", () => {
    const file = databasePath();
    const tools = new ToolRepository(file, { ownerProfileId, now: () => now });
    const primaryGrant = tools.grantWorkspace({
      conversationId: null,
      displayName: "主目录",
      rootPath: "C:\\project-primary",
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const additionalGrant = tools.grantWorkspace({
      conversationId: null,
      displayName: "参考资料",
      rootPath: "C:\\project-reference",
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
    });
    const projects = new ProjectRepository(file, { ownerProfileId, deviceId, now: () => now });
    const project = projects.createProject({
      operationId: crypto.randomUUID(),
      name: "Generation 上下文",
      instructions: "优先使用主目录中的事实。",
    });
    projects.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 1,
      workspaceGrantId: primaryGrant.id,
      displayName: "主目录",
      desiredAccess: "read_write",
    });
    projects.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 2,
      workspaceGrantId: additionalGrant.id,
      displayName: "参考资料",
      desiredAccess: "read_only",
    });
    const chats = new ChatRepository(file, { ownerProfileId, now: () => now });
    const draft = chats.createGeneration({
      projectId: project.id,
      text: "读取项目",
      idempotencyKey: "project-generation-context-0001",
    });
    const context = projects.generationContext(draft.receipt.conversationId);
    expect(context).toMatchObject({
      projectId: project.id,
      projectRevision: 3,
      instructions: "优先使用主目录中的事实。",
      directories: [
        { role: "primary", sourceWorkspaceGrantId: primaryGrant.id },
        { role: "additional", sourceWorkspaceGrantId: additionalGrant.id },
      ],
    });
    if (!context) throw new Error("PROJECT_CONTEXT_REQUIRED");
    const first = tools.reconcileProjectWorkspaceBindings({
      conversationId: draft.receipt.conversationId,
      directories: context.directories,
    });
    const replay = tools.reconcileProjectWorkspaceBindings({
      conversationId: draft.receipt.conversationId,
      directories: context.directories,
    });
    expect(replay.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(first).toMatchObject([
      { conversationId: draft.receipt.conversationId, access: "read_write" },
      { conversationId: draft.receipt.conversationId, access: "read_only" },
    ]);
    expect(tools.listWorkspaceBindings(draft.receipt.conversationId)).toMatchObject([
      {
        workspaceGrantId: first[0]?.id,
        role: "primary",
        source: "project",
        projectDirectoryBindingId: context.directories[0]?.projectDirectoryBindingId,
      },
      {
        workspaceGrantId: first[1]?.id,
        role: "additional",
        source: "project",
        projectDirectoryBindingId: context.directories[1]?.projectDirectoryBindingId,
      },
    ]);

    tools.reconcileProjectWorkspaceBindings({
      conversationId: draft.receipt.conversationId,
      directories: [],
    });
    expect(
      tools
        .listWorkspaceGrants(draft.receipt.conversationId)
        .filter(({ conversationId }) => conversationId === draft.receipt.conversationId),
    ).toEqual([]);
    chats.close();
    projects.close();
    tools.close();
  });

  it("queues primary-directory switches in an order that remains valid on another device", () => {
    const sourceFile = databasePath();
    const targetFile = databasePath();
    const accountId = crypto.randomUUID();
    const sourceDeviceId = crypto.randomUUID();
    const targetDeviceId = crypto.randomUUID();
    const firstGrantId = crypto.randomUUID();
    const secondGrantId = crypto.randomUUID();
    insertProjectWorkspaceGrant(sourceFile, firstGrantId, { owner: accountId });
    insertProjectWorkspaceGrant(sourceFile, secondGrantId, { owner: accountId });
    const sourceProjects = new ProjectRepository(sourceFile, {
      ownerProfileId: accountId,
      deviceId: sourceDeviceId,
      now: () => now,
    });
    const sourceChat = new ChatRepository(sourceFile, {
      ownerProfileId: accountId,
      deviceId: sourceDeviceId,
      now: () => now,
    });
    const project = sourceProjects.createProject({
      operationId: crypto.randomUUID(),
      name: "主目录同步",
    });
    const first = sourceProjects.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 1,
      workspaceGrantId: firstGrantId,
      displayName: "目录 A",
    });
    const second = sourceProjects.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 2,
      workspaceGrantId: secondGrantId,
      displayName: "目录 B",
    });
    const initialOperations = sourceChat.pendingSyncOperations();
    const targetChat = new ChatRepository(targetFile, {
      ownerProfileId: accountId,
      deviceId: targetDeviceId,
      now: () => now,
    });
    const targetProjects = new ProjectRepository(targetFile, {
      ownerProfileId: accountId,
      deviceId: targetDeviceId,
      now: () => now,
    });
    targetChat.applySyncPull(pullFromOperations(initialOperations));
    initialOperations.forEach((operation, index) => {
      sourceChat.acknowledgeSync({
        status: "committed",
        operationId: operation.operationId,
        revision: operation.baseRevision + 1,
        cursor: `cursor:${index + 1}`,
        replayed: false,
      });
    });

    sourceProjects.setPrimaryDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      projectDirectoryId: second.directory.id,
      expectedProjectRevision: 3,
    });
    const switchOperations = sourceChat.pendingSyncOperations();
    expect(switchOperations).toMatchObject([
      {
        objectType: "project_directory",
        objectId: first.directory.id,
        payload: { role: "additional" },
      },
      {
        objectType: "project_directory",
        objectId: second.directory.id,
        payload: { role: "primary" },
      },
      { objectType: "project", objectId: project.id },
    ]);
    targetChat.applySyncPull(pullFromOperations(switchOperations, initialOperations.length));
    expect(
      targetProjects
        .getProject(project.id)
        .directories.map(({ directory }) => [directory.id, directory.role]),
    ).toEqual([
      [second.directory.id, "primary"],
      [first.directory.id, "additional"],
    ]);

    targetProjects.close();
    targetChat.close();
    sourceChat.close();
    sourceProjects.close();
  });

  it("syncs portable project placeholders across devices without leaking local paths or grants", () => {
    const sourceFile = databasePath();
    const targetFile = databasePath();
    const accountId = crypto.randomUUID();
    const sourceDeviceId = crypto.randomUUID();
    const targetDeviceId = crypto.randomUUID();
    const sourceGrantId = crypto.randomUUID();
    const sourcePathCanary = "C:\\private\\customer-alpha\\source-root";
    insertProjectWorkspaceGrant(sourceFile, sourceGrantId, { owner: accountId });
    const sourceDatabase = new DatabaseSync(sourceFile);
    sourceDatabase
      .prepare("UPDATE workspace_grants SET root_path = ? WHERE id = ?")
      .run(sourcePathCanary, sourceGrantId);
    sourceDatabase.close();

    const sourceProjects = new ProjectRepository(sourceFile, {
      ownerProfileId: accountId,
      deviceId: sourceDeviceId,
      now: () => now,
    });
    const sourceChat = new ChatRepository(sourceFile, {
      ownerProfileId: accountId,
      deviceId: sourceDeviceId,
      now: () => now,
    });
    const project = sourceProjects.createProject({
      operationId: crypto.randomUUID(),
      name: "跨设备交付",
      instructions: "只使用已经授权的项目资料。",
    });
    const sourceDirectory = sourceProjects.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 1,
      workspaceGrantId: sourceGrantId,
      displayName: "逻辑主目录",
      desiredAccess: "read_write",
    });
    const draft = sourceChat.createGeneration({
      projectId: project.id,
      text: "恢复这段项目对话",
      idempotencyKey: "project-sync-chat-0001",
    });
    sourceChat.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: now,
      type: "completed",
    });

    const initialOperations = sourceChat.pendingSyncOperations();
    expect(initialOperations.map(({ objectType }) => objectType)).toEqual(
      expect.arrayContaining(["project", "project_directory", "conversation"]),
    );
    const serialized = JSON.stringify(initialOperations);
    expect(serialized).not.toContain(sourcePathCanary);
    expect(serialized).not.toContain(sourceGrantId);
    expect(serialized).not.toContain(sourceDirectory.binding?.id);
    expect(serialized).not.toContain("rootPath");
    expect(serialized).not.toContain("workspaceGrantId");
    expect(serialized).not.toContain("projectDirectoryBindingId");

    const targetChat = new ChatRepository(targetFile, {
      ownerProfileId: accountId,
      deviceId: targetDeviceId,
      now: () => now,
    });
    const targetProjects = new ProjectRepository(targetFile, {
      ownerProfileId: accountId,
      deviceId: targetDeviceId,
      now: () => now,
    });
    const initialPull = pullFromOperations(initialOperations);
    targetChat.applySyncPull(initialPull);

    expect(targetProjects.getProject(project.id)).toMatchObject({
      project: {
        name: "跨设备交付",
        instructions: "只使用已经授权的项目资料。",
      },
      directories: [
        {
          directory: { id: sourceDirectory.directory.id, role: "primary" },
          binding: null,
          connectionState: "reconnect_required",
        },
      ],
    });
    expect(targetChat.getConversation(draft.receipt.conversationId).conversation.projectId).toBe(
      project.id,
    );

    initialOperations.forEach((operation, index) => {
      sourceChat.acknowledgeSync({
        status: "committed",
        operationId: operation.operationId,
        revision: operation.baseRevision + 1,
        cursor: `cursor:${index + 1}`,
        replayed: false,
      });
    });

    const targetTools = new ToolRepository(targetFile, {
      ownerProfileId: accountId,
      now: () => now,
    });
    const targetGrant = targetTools.grantWorkspace({
      conversationId: null,
      displayName: "目标设备目录",
      rootPath: "C:\\private\\target-device-root",
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    targetProjects.connectDirectory({
      operationId: crypto.randomUUID(),
      projectDirectoryId: sourceDirectory.directory.id,
      expectedProjectRevision: 2,
      workspaceGrantId: targetGrant.id,
    });

    sourceProjects.removeDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      projectDirectoryId: sourceDirectory.directory.id,
      expectedProjectRevision: 2,
    });
    const removalOperations = sourceChat.pendingSyncOperations();
    expect(removalOperations).toMatchObject([
      { objectType: "project_directory", mutation: "delete", payload: null },
      { objectType: "project", mutation: "upsert" },
    ]);
    const removalPull = pullFromOperations(removalOperations, initialOperations.length);
    targetChat.applySyncPull(removalPull);
    expect(targetProjects.getProject(project.id).directories).toEqual([]);
    expect(targetTools.listWorkspaceGrants()).toEqual([]);
    expect(targetTools.activeScopes("workspace")).toEqual([]);

    targetChat.clearLocalCache();
    expect(targetProjects.listProjects(true)).toEqual([]);
    targetChat.applySyncPull(initialPull);
    targetChat.applySyncPull(removalPull);
    expect(targetProjects.getProject(project.id)).toMatchObject({
      project: { name: "跨设备交付" },
      directories: [],
    });
    expect(targetChat.getConversation(draft.receipt.conversationId).conversation.projectId).toBe(
      project.id,
    );

    targetTools.close();
    targetProjects.close();
    targetChat.close();
    sourceChat.close();
    sourceProjects.close();
  });
});
