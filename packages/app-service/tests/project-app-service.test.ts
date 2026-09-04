import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  chatCommandEnvelopeSchema,
  conversationSchema,
  generationReceiptSchema,
  type PiActivityEvent,
  type PiFileToolRequestFrame,
  type PiHostEventFrame,
  type PiPromptFrame,
  type PiSessionControlFrame,
  type PiToolRequestFrame,
  projectDetailSchema,
  projectDirectoryStateSchema,
  projectSchema,
  projectSummarySchema,
} from "@openerx/contracts";
import { ChatRepository, ProjectRepository, ToolRepository } from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAppService, type PiHostClient, ProjectAppService, ToolAppService } from "../src";

const temporaryDirectories: string[] = [];
const ownerProfileId = "account-a";
const deviceId = "30000000-0000-4000-8000-000000000001";
const now = "2026-09-04T01:00:00.000Z";

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-project-service-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "project-service.sqlite");
}

function directoryAuthorizer(
  file: string,
  brokeredBashV1 = false,
): {
  repository: ToolRepository;
  service: ToolAppService;
} {
  const directory = path.dirname(file);
  const workspaceDirectory = path.join(directory, "tool-runtime");
  mkdirSync(workspaceDirectory, { recursive: true });
  const repository = new ToolRepository(file, { ownerProfileId, now: () => now });
  const service = new ToolAppService({
    repository,
    workspaceDirectory,
    defaultWorkspaceDirectory: path.join(directory, "default-workspaces"),
    host: {
      availability: async () => ({ availableToolNames: [], unavailableReasons: {} }),
      execute: async () => {
        throw new Error("HOST_OPERATION_NOT_EXPECTED");
      },
      resolve: async () => {
        throw new Error("CREDENTIAL_RESOLUTION_NOT_EXPECTED");
      },
      clear: async () => undefined,
    },
    resolveUploadPath: (fileId) => path.join(directory, "uploads", fileId),
    ingestDownload: async (downloadPath) => ({
      fileId: crypto.randomUUID(),
      displayName: path.basename(downloadPath),
    }),
    selectedModelRef: () => "platform/auto",
    emit: () => undefined,
    brokeredBashV1,
    ...(brokeredBashV1 ? { brokeredBashRunnerMode: "fake" as const } : {}),
  });
  return { repository, service };
}

class CapturingPiHostClient implements PiHostClient {
  readonly prompts: PiPromptFrame[] = [];

  async prompt(frame: PiPromptFrame): Promise<void> {
    this.prompts.push(frame);
  }

  async abort(_generationId: string): Promise<void> {}

  async control(_frame: PiSessionControlFrame): Promise<void> {}

  onEvent(_listener: (frame: PiHostEventFrame) => void): () => void {
    return () => undefined;
  }

  onFileToolRequest(_listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }

  onToolRequest(_listener: (frame: PiToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }

  onActivity(_listener: (frame: PiActivityEvent) => void): () => void {
    return () => undefined;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ProjectAppService", () => {
  it("dispatches idempotent CRUD, pinning, archive and restore commands", () => {
    const repository = new ProjectRepository(databasePath(), {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const service = new ProjectAppService(repository);
    const operationId = crypto.randomUUID();
    const created = projectSchema.parse(
      service.handle({
        command: "project.create",
        input: { operationId, name: "客户计划", instructions: "只使用项目资料" },
      }),
    );
    expect(
      service.handle({
        command: "project.create",
        input: { operationId, name: "重复请求不会创建第二个项目", instructions: "" },
      }),
    ).toEqual(created);
    expect(
      projectSummarySchema.array().parse(service.handle({ command: "project.list", input: {} })),
    ).toMatchObject([{ id: created.id, conversationCount: 0 }]);
    expect(
      projectDetailSchema.parse(
        service.handle({ command: "project.get", input: { projectId: created.id } }),
      ).directories,
    ).toEqual([]);

    const updated = projectSchema.parse(
      service.handle({
        command: "project.update",
        input: {
          operationId: crypto.randomUUID(),
          projectId: created.id,
          expectedRevision: 1,
          pinnedRank: 0,
        },
      }),
    );
    expect(updated).toMatchObject({ pinnedRank: 0, revision: 2 });
    const archived = projectSchema.parse(
      service.handle({
        command: "project.archive",
        input: {
          operationId: crypto.randomUUID(),
          projectId: created.id,
          expectedRevision: 2,
        },
      }),
    );
    expect(archived.archivedAt).toBe(now);
    expect(service.handle({ command: "project.list", input: {} })).toEqual([]);
    const restored = projectSchema.parse(
      service.handle({
        command: "project.restore",
        input: {
          operationId: crypto.randomUUID(),
          projectId: created.id,
          expectedRevision: 3,
        },
      }),
    );
    expect(restored).toMatchObject({ archivedAt: null, revision: 4 });
    repository.close();
  });

  it("routes directory bindings and idle conversation moves", () => {
    const file = databasePath();
    const projects = new ProjectRepository(file, {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const service = new ProjectAppService(projects);
    const tools = new ToolRepository(file, { ownerProfileId, now: () => now });
    const grant = tools.grantWorkspace({
      conversationId: null,
      displayName: "项目根目录",
      rootPath: "C:\\project-root",
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const project = projectSchema.parse(
      service.handle({
        command: "project.create",
        input: { operationId: crypto.randomUUID(), name: "代码库", instructions: "" },
      }),
    );
    const directory = projectDirectoryStateSchema.parse(
      service.handle({
        command: "project.directory.create",
        input: {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          expectedProjectRevision: 1,
          workspaceGrantId: grant.id,
          displayName: "项目根目录",
          desiredAccess: "read_write",
        },
      }),
    );
    expect(directory).toMatchObject({
      connectionState: "connected",
      directory: { role: "primary" },
    });

    const chats = new ChatRepository(file, { ownerProfileId, now: () => now });
    const draft = chats.createGeneration({
      text: "稍后移动",
      idempotencyKey: "project-service-chat-0001",
    });
    expect(() =>
      service.handle({
        command: "conversation.moveToProject",
        input: {
          operationId: crypto.randomUUID(),
          conversationId: draft.receipt.conversationId,
          projectId: project.id,
          expectedConversationRevision: 2,
        },
      }),
    ).toThrow("PROJECT_MOVE_BLOCKED_BY_ACTIVE_RUN");
    chats.appendPiEvent(draft.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: now,
      type: "completed",
    });
    const conversation = chats.getConversation(draft.receipt.conversationId).conversation;
    const moved = conversationSchema.parse(
      service.handle({
        command: "conversation.moveToProject",
        input: {
          operationId: crypto.randomUUID(),
          conversationId: conversation.id,
          projectId: project.id,
          expectedConversationRevision: conversation.revision,
        },
      }),
    );
    expect(moved.projectId).toBe(project.id);
    chats.close();
    tools.close();
    projects.close();
  });

  it("authorizes, redacts, disconnects and reconnects a system-selected directory", async () => {
    const file = databasePath();
    const selectedRoot = path.join(path.dirname(file), "selected-project-root");
    mkdirSync(selectedRoot, { recursive: true });
    const projects = new ProjectRepository(file, {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const tools = directoryAuthorizer(file);
    const service = new ProjectAppService(projects, tools.service);
    const project = projectSchema.parse(
      service.handle({
        command: "project.create",
        input: { operationId: crypto.randomUUID(), name: "本地目录", instructions: "" },
      }),
    );
    const operationId = crypto.randomUUID();
    const connected = projectDirectoryStateSchema.parse(
      service.handle({
        command: "project.directory.choose",
        input: {
          operationId,
          projectId: project.id,
          projectDirectoryId: null,
          expectedProjectRevision: 1,
          desiredAccess: "read_write",
          rootPath: selectedRoot,
        },
      }),
    );
    expect(connected).toMatchObject({
      connectionState: "connected",
      directory: { displayName: "selected-project-root", role: "primary" },
    });
    expect(JSON.stringify(connected)).not.toContain(selectedRoot);
    expect(
      tools.repository.workspaceGrant(connected.binding?.workspaceGrantId ?? ""),
    ).toMatchObject({
      rootPath: realpathSync(selectedRoot),
      conversationId: null,
      access: "read_write",
      allowNetwork: false,
    });
    expect(
      service.handle({
        command: "project.directory.choose",
        input: {
          operationId,
          projectId: project.id,
          projectDirectoryId: null,
          expectedProjectRevision: 1,
          desiredAccess: "read_write",
          rootPath: selectedRoot,
        },
      }),
    ).toEqual(connected);
    expect(tools.repository.listWorkspaceGrants()).toHaveLength(1);

    const disconnected = projectDirectoryStateSchema.parse(
      service.handle({
        command: "project.directory.disconnect",
        input: {
          operationId: crypto.randomUUID(),
          projectDirectoryId: connected.directory.id,
          expectedProjectRevision: 2,
        },
      }),
    );
    expect(disconnected).toMatchObject({
      connectionState: "reconnect_required",
      binding: null,
    });
    expect(tools.repository.listWorkspaceGrants()).toEqual([]);
    expect(tools.repository.activeScopes("workspace")).toEqual([]);

    const reconnected = projectDirectoryStateSchema.parse(
      service.handle({
        command: "project.directory.choose",
        input: {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          projectDirectoryId: connected.directory.id,
          expectedProjectRevision: 2,
          desiredAccess: "read_only",
          rootPath: selectedRoot,
        },
      }),
    );
    expect(reconnected.binding?.workspaceGrantId).not.toBe(connected.binding?.workspaceGrantId);
    expect(
      tools.repository.workspaceGrant(reconnected.binding?.workspaceGrantId ?? "").access,
    ).toBe("read_write");

    const invalidPath = path.join(path.dirname(file), "not-a-directory.txt");
    writeFileSync(invalidPath, "not a directory", "utf8");
    expect(() =>
      service.handle({
        command: "project.directory.choose",
        input: {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          projectDirectoryId: null,
          expectedProjectRevision: 2,
          desiredAccess: "read_only",
          rootPath: invalidPath,
        },
      }),
    ).toThrow("PROJECT_DIRECTORY_UNAVAILABLE");
    expect(tools.repository.listWorkspaceGrants()).toHaveLength(1);
    await tools.service.close();
    projects.close();
  });

  it("replays a directory authorization after restart without leaking its orphan grant", async () => {
    const file = databasePath();
    const selectedRoot = path.join(path.dirname(file), "crash-window-project-root");
    mkdirSync(selectedRoot, { recursive: true });
    const operationId = crypto.randomUUID();
    const projects = new ProjectRepository(file, {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const project = projects.createProject({
      operationId: crypto.randomUUID(),
      name: "崩溃恢复项目",
    });
    const firstTools = directoryAuthorizer(file);

    const interruptedGrant = firstTools.service.grantWorkspace({
      rootPath: selectedRoot,
      conversationId: null,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
      projectOperationId: operationId,
    });
    expect(firstTools.repository.isProjectSourceWorkspaceGrant(interruptedGrant.id)).toBe(true);
    const chats = new ChatRepository(file, { ownerProfileId, now: () => now });
    const unrelated = chats.createGeneration({
      text: "普通对话",
      idempotencyKey: "project-crash-window-chat-0001",
    });
    const unrelatedWorkspace = firstTools.service.ensureConversationWorkspace(
      unrelated.receipt.conversationId,
    );
    expect(unrelatedWorkspace.id).not.toBe(interruptedGrant.id);
    expect(unrelatedWorkspace.rootPath).not.toBe(realpathSync(selectedRoot));
    chats.close();
    await firstTools.service.close();
    projects.close();

    const recoveredProjects = new ProjectRepository(file, {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const recoveredTools = directoryAuthorizer(file);
    const recoveredService = new ProjectAppService(recoveredProjects, recoveredTools.service);
    const input = {
      operationId,
      projectId: project.id,
      projectDirectoryId: null,
      expectedProjectRevision: 1,
      desiredAccess: "read_write" as const,
      rootPath: selectedRoot,
    };
    const connected = projectDirectoryStateSchema.parse(
      recoveredService.handle({ command: "project.directory.choose", input }),
    );
    expect(connected).toMatchObject({
      connectionState: "connected",
      binding: { workspaceGrantId: interruptedGrant.id },
      directory: { role: "primary" },
    });
    expect(
      recoveredTools.repository
        .listWorkspaceGrants()
        .filter((grant) => grant.rootPath === realpathSync(selectedRoot)),
    ).toHaveLength(1);
    await recoveredTools.service.close();
    recoveredProjects.close();

    const replayedProjects = new ProjectRepository(file, {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const replayedService = new ProjectAppService(replayedProjects);
    expect(replayedService.handle({ command: "project.directory.choose", input })).toEqual(
      connected,
    );
    replayedProjects.close();
  });

  it("freezes project instructions and primary/additional grants into each Generation", async () => {
    const file = databasePath();
    const primaryRoot = path.join(path.dirname(file), "primary-root");
    const additionalRoot = path.join(path.dirname(file), "additional-root");
    mkdirSync(primaryRoot, { recursive: true });
    mkdirSync(additionalRoot, { recursive: true });
    const projects = new ProjectRepository(file, {
      ownerProfileId,
      deviceId,
      now: () => now,
    });
    const tools = directoryAuthorizer(file, true);
    const projectService = new ProjectAppService(projects, tools.service);
    const project = projectSchema.parse(
      projectService.handle({
        command: "project.create",
        input: {
          operationId: crypto.randomUUID(),
          name: "双目录项目",
          instructions: "回答前先读取项目资料。",
        },
      }),
    );
    const primary = projectDirectoryStateSchema.parse(
      projectService.handle({
        command: "project.directory.choose",
        input: {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          projectDirectoryId: null,
          expectedProjectRevision: 1,
          desiredAccess: "read_write",
          rootPath: primaryRoot,
        },
      }),
    );
    projectDirectoryStateSchema.parse(
      projectService.handle({
        command: "project.directory.choose",
        input: {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          projectDirectoryId: null,
          expectedProjectRevision: 2,
          desiredAccess: "read_only",
          rootPath: additionalRoot,
        },
      }),
    );

    const pi = new CapturingPiHostClient();
    const chat = new ChatAppService(
      new ChatRepository(file, { ownerProfileId, now: () => now }),
      pi,
      null,
      null,
      tools.service,
      null,
      null,
      null,
      projects,
    );
    const receipt = generationReceiptSchema.parse(
      await chat.handle(
        chatCommandEnvelopeSchema.parse({
          command: "chat.send",
          input: {
            projectId: project.id,
            text: "汇总两个目录",
            idempotencyKey: "project-generation-chat-0001",
          },
        }),
      ),
    );
    await vi.waitFor(() => expect(pi.prompts).toHaveLength(1));
    const projectPrompt = pi.prompts[0];
    expect(projectPrompt?.history.at(-1)?.text).toBe("汇总两个目录");
    expect(projectPrompt?.history.find(({ role }) => role === "system")?.text).toContain(
      "回答前先读取项目资料。",
    );
    expect(projectPrompt?.workspace?.grants).toHaveLength(2);
    expect(projectPrompt?.workspace?.grants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: primary.binding?.workspaceGrantId })]),
    );
    const bindings = tools.repository.listWorkspaceBindings(receipt.conversationId);
    const primaryBinding = bindings.find(({ role }) => role === "primary");
    const additionalBindings = bindings.filter(({ role }) => role === "additional");
    expect(projectPrompt?.workspace?.execution?.activeExecutionGrantId).toBe(
      primaryBinding?.workspaceGrantId,
    );
    expect(projectPrompt?.workspace?.execution?.additionalExecutionGrantIds).toEqual(
      additionalBindings.map(({ workspaceGrantId }) => workspaceGrantId),
    );

    await chat.handle(
      chatCommandEnvelopeSchema.parse({
        command: "chat.send",
        input: {
          text: "普通对话",
          idempotencyKey: "projectless-generation-chat-0002",
        },
      }),
    );
    await vi.waitFor(() => expect(pi.prompts).toHaveLength(2));
    const projectlessPrompt = pi.prompts[1];
    expect(projectlessPrompt?.history.some(({ role }) => role === "system")).toBe(false);
    expect(projectlessPrompt?.workspace?.grants).toHaveLength(1);
    expect(projectlessPrompt?.workspace?.grants[0]?.id).not.toBe(
      projectPrompt?.workspace?.grants[0]?.id,
    );
    chat.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    projects.close();
  });

  it("keeps stale and cross-account commands fail closed", () => {
    const file = databasePath();
    const ownerRepository = new ProjectRepository(file, { ownerProfileId, deviceId });
    const ownerService = new ProjectAppService(ownerRepository);
    const project = projectSchema.parse(
      ownerService.handle({
        command: "project.create",
        input: { operationId: crypto.randomUUID(), name: "私有项目", instructions: "" },
      }),
    );
    expect(() =>
      ownerService.handle({
        command: "project.update",
        input: {
          operationId: crypto.randomUUID(),
          projectId: project.id,
          expectedRevision: 2,
          name: "过期写入",
        },
      }),
    ).toThrow("PROJECT_REVISION_CONFLICT");

    const foreignRepository = new ProjectRepository(file, {
      ownerProfileId: "account-b",
      deviceId,
    });
    const foreignService = new ProjectAppService(foreignRepository);
    expect(() =>
      foreignService.handle({ command: "project.get", input: { projectId: project.id } }),
    ).toThrow("PROJECT_NOT_FOUND");
    foreignRepository.close();
    ownerRepository.close();
  });
});
