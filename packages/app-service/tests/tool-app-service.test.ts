import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type BrokeredBashOperation,
  type BrokeredBashRunnerMode,
  type ChatEvent,
  defaultLocalWebSearchPolicy,
  type HostToolAvailability,
  type LocalWebSearchPolicy,
  type PiActivityEvent,
  type PiToolRequestFrame,
  toolRuntimeReadinessSchema,
} from "@openerx/contracts";
import {
  ChatRepository,
  ProjectRepository,
  type ProjectWorkspaceBindingInput,
  ToolRepository,
} from "@openerx/storage";
import {
  type BrokeredBashLogArtifactWriter,
  type LocalSearchProvider,
  MacOSSandboxExecEngine,
  PLATFORM_SANDBOX_ENGINE_VERSION,
  type PlatformSandboxCapability,
  type PlatformSandboxEngine,
  type PlatformSandboxExecutionRequest,
} from "@openerx/tool-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolAppService } from "../src";

const directories: string[] = [];
const liveMacOSSandbox =
  process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && existsSync("/bin/bash");

function fixture(
  options: {
    now?: () => string;
    shellAvailability?: () => HostToolAvailability;
    brokeredBashV1?: boolean;
    brokeredBashRunnerMode?: BrokeredBashRunnerMode;
    platformSandboxEngine?: PlatformSandboxEngine;
    writeBrokeredBashLogArtifact?: BrokeredBashLogArtifactWriter;
    localWebSearchV2?: boolean;
    localWebSearchPolicy?: LocalWebSearchPolicy;
    localWebSearchProviders?: LocalSearchProvider[];
  } = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-tool-service-"));
  directories.push(directory);
  const databasePath = path.join(directory, "openerx.sqlite");
  const chat = new ChatRepository(databasePath, {
    ownerProfileId: "profile-a",
  });
  const tools = new ToolRepository(databasePath, {
    ownerProfileId: "profile-a",
    ...(options.now ? { now: options.now } : {}),
  });
  const defaultWorkspaceDirectory = path.join(directory, "OpenERX Workspace");
  const generation = chat.createGeneration({
    text: "打开网页",
    idempotencyKey: "chat-tool-service-0001",
  });
  const events: ChatEvent[] = [];
  const host = {
    availability: vi.fn(
      async (): Promise<HostToolAvailability> => ({
        availableToolNames: ["openerx_browser", "openerx_desktop"],
        unavailableReasons: {},
      }),
    ),
    execute: vi.fn(async () => ({
      summary: "host operation completed",
      content: [{ type: "text" as const, text: "host operation completed" }],
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
    defaultWorkspaceDirectory,
    host,
    resolveUploadPath: (fileId) => path.join(directory, "content", fileId),
    ingestDownload: async (downloadPath) => ({
      fileId: crypto.randomUUID(),
      displayName: path.basename(downloadPath),
    }),
    selectedModelRef: () => "platform/auto",
    emit: (event) => events.push(event),
    ...(options.shellAvailability ? { shellAvailability: options.shellAvailability } : {}),
    brokeredBashV1: options.brokeredBashV1 ?? false,
    localWebSearchV2: options.localWebSearchV2 ?? false,
    ...(options.localWebSearchPolicy ? { localWebSearchPolicy: options.localWebSearchPolicy } : {}),
    ...(options.localWebSearchProviders
      ? { localWebSearchProviders: options.localWebSearchProviders }
      : {}),
    ...(options.brokeredBashRunnerMode
      ? { brokeredBashRunnerMode: options.brokeredBashRunnerMode }
      : {}),
    ...(options.platformSandboxEngine
      ? { platformSandboxEngine: options.platformSandboxEngine }
      : {}),
    ...(options.writeBrokeredBashLogArtifact
      ? { writeBrokeredBashLogArtifact: options.writeBrokeredBashLogArtifact }
      : {}),
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
  return {
    chat,
    tools,
    service,
    host,
    events,
    base,
    directory,
    defaultWorkspaceDirectory,
  };
}

function projectDirectoryFixture(
  directory: string,
  sourceWorkspaceGrantId: string,
): ProjectWorkspaceBindingInput[] {
  const projects = new ProjectRepository(path.join(directory, "openerx.sqlite"), {
    ownerProfileId: "profile-a",
    deviceId: crypto.randomUUID(),
  });
  try {
    const project = projects.createProject({
      operationId: crypto.randomUUID(),
      name: "Workspace fixture",
      instructions: "",
    });
    const state = projects.addDirectory({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      expectedProjectRevision: 1,
      workspaceGrantId: sourceWorkspaceGrantId,
      displayName: "project-root",
      desiredAccess: "read_write",
    });
    if (!state.binding) throw new Error("Expected project directory binding");
    return [
      {
        projectDirectoryBindingId: state.binding.id,
        sourceWorkspaceGrantId,
        sourceRevision: state.binding.revision,
        displayName: "project-root",
        role: "primary",
        desiredAccess: "read_write",
      },
    ];
  } finally {
    projects.close();
  }
}

function platformEngine(available = true) {
  const probe = vi.fn(
    async (): Promise<PlatformSandboxCapability> => ({
      available,
      reason: available ? null : "BROKERED_BASH_CAPABILITY_PROBE_FAILED",
      engineVersion: PLATFORM_SANDBOX_ENGINE_VERSION,
      backendId: "test_macos_sandbox",
      backendVersion: "test",
      policyVersion: "macos-seatbelt-v1",
      platform: "darwin" as const,
      platformRelease: "test-build",
      supportedProfiles: available ? ["read_only", "workspace_write"] : [],
      environmentPolicyIds: available
        ? ["environment-none-v1", "environment-core-v1", "environment-all-v1"]
        : [],
      networkPolicyIds: available ? ["network-deny-v1", "network-controlled-egress-v1"] : [],
      capabilities: {
        filesystemBoundary: available,
        hardlinkBoundary: available,
        readOnlyRoots: available,
        writableRoots: available,
        networkDeny: available,
        sanitizedEnvironment: available,
        processGroupCleanup: available,
        descendantSandboxInheritance: available,
        pty: false,
      },
    }),
  );
  const execute = vi.fn(async (request: PlatformSandboxExecutionRequest) => {
    request.onOutput?.({ sequence: 1, delta: "real-", truncated: false });
    request.onOutput?.({ sequence: 2, delta: "broker-ok", truncated: false });
    return {
      exitCode: 0,
      signal: null,
      stdout: "real-broker-ok",
      stderr: "",
      output: "real-broker-ok",
      outputTruncated: false,
      timedOut: false,
      cancelled: false,
      durationMs: 2,
      destructionStatus: "clean" as const,
      changedPathManifestStatus: "not_collected" as const,
      workspaceChanges: null,
      proof: {
        engineVersion: PLATFORM_SANDBOX_ENGINE_VERSION,
        backendId: "test_macos_sandbox",
        backendVersion: "test",
        policyVersion: "macos-seatbelt-v1",
        platform: "darwin" as const,
        platformRelease: "test-build",
        executionProfile: request.executionProfile,
        environmentPolicyId: request.environmentPolicyId,
        environmentDigest: `sha256:${"0".repeat(64)}`,
        networkPolicyId: request.networkPolicyId,
        networkPolicyDigest: request.networkPolicyDigest ?? `sha256:${"0".repeat(64)}`,
        controlledEgress: request.networkPolicy?.mode === "controlled_egress",
        filesystemBoundary: true as const,
        hardlinkBoundary: true as const,
        environmentSanitized: true as const,
        networkDenied: true as const,
        processGroupOwned: true as const,
      },
    };
  });
  const stopAll = vi.fn(async () => undefined);
  const engine: PlatformSandboxEngine = {
    engineVersion: PLATFORM_SANDBOX_ENGINE_VERSION,
    backendId: "test_macos_sandbox",
    policyVersion: "macos-seatbelt-v1",
    probe,
    execute,
    stopAll,
  };
  return { engine, execute, probe, stopAll };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("ToolAppService", () => {
  it("creates an isolated default writable workspace for every projectless conversation", async () => {
    const { chat, tools, service, base, defaultWorkspaceDirectory } = fixture();
    const second = chat.createGeneration({
      text: "第二个无项目对话",
      idempotencyKey: "chat-default-workspace-0002",
    });

    const firstWorkspace = service.ensureConversationWorkspace(base.conversationId);
    const secondWorkspace = service.ensureConversationWorkspace(second.receipt.conversationId);

    expect(firstWorkspace).toMatchObject({
      conversationId: base.conversationId,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
      bindingRole: "primary",
      bindingSource: "default",
    });
    expect(secondWorkspace.conversationId).toBe(second.receipt.conversationId);
    expect(firstWorkspace.rootPath).not.toBe(secondWorkspace.rootPath);
    expect(firstWorkspace.rootPath).toBe(
      realpathSync(path.join(defaultWorkspaceDirectory, "conversations", base.conversationId)),
    );
    expect(secondWorkspace.rootPath).toBe(
      realpathSync(
        path.join(defaultWorkspaceDirectory, "conversations", second.receipt.conversationId),
      ),
    );
    expect(existsSync(firstWorkspace.rootPath)).toBe(true);
    expect(existsSync(secondWorkspace.rootPath)).toBe(true);
    expect(tools.listWorkspaceBindings(base.conversationId)).toEqual([
      expect.objectContaining({
        workspaceGrantId: firstWorkspace.id,
        role: "primary",
        source: "default",
      }),
    ]);
    chat.close();
    await service.close();
  });

  it("replaces the default primary workspace when the conversation selects a project", async () => {
    const { chat, tools, service, base } = fixture();
    const project = mkdtempSync(path.join(tmpdir(), "openerx-project-workspace-"));
    directories.push(project);
    const defaultWorkspace = service.ensureConversationWorkspace(base.conversationId);

    const selected = service.grantWorkspace({
      rootPath: project,
      conversationId: base.conversationId,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });

    expect(tools.workspaceGrant(defaultWorkspace.id).revokedAt).not.toBeNull();
    expect(tools.primaryWorkspaceGrant(base.conversationId)?.id).toBe(selected.id);
    expect(selected).toMatchObject({ bindingRole: "primary", bindingSource: "user_added" });
    expect(tools.listWorkspaceBindings(base.conversationId)).toEqual([
      expect.objectContaining({
        workspaceGrantId: selected.id,
        role: "primary",
        source: "user_added",
      }),
    ]);
    expect(service.listWorkspaces(base.conversationId).map(({ id }) => id)).toEqual([selected.id]);
    chat.close();
    await service.close();
  });

  it("adds a reference directory without moving the current working directory", async () => {
    const { chat, tools, service, base, directory } = fixture();
    const primary = service.ensureConversationWorkspace(base.conversationId);
    const additional = service.grantWorkspace({
      conversationId: base.conversationId,
      rootPath: directory,
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
      role: "additional",
    });
    expect(tools.primaryWorkspaceGrant(base.conversationId)?.id).toBe(primary.id);
    expect(tools.workspaceGrant(primary.id).revokedAt).toBeNull();
    expect(service.listWorkspaces(base.conversationId)).toMatchObject([
      { id: primary.id, bindingRole: "primary" },
      { id: additional.id, bindingRole: "additional", access: "read_only" },
    ]);
    chat.close();
    await service.close();
  });

  it("reuses a directory and retires its old authorization when permissions change", async () => {
    const { chat, tools, service, base, directory } = fixture();
    const input = {
      conversationId: base.conversationId,
      rootPath: directory,
      access: "read_write" as const,
      allowNetwork: true,
      expiresAt: null,
    };
    const first = service.grantWorkspace(input);
    const replay = service.grantWorkspace({ ...input, role: "additional" });
    expect(replay.id).toBe(first.id);
    expect(replay.bindingRole).toBe("primary");
    const limited = service.grantWorkspace({
      ...input,
      access: "read_only",
      allowNetwork: false,
      role: "additional",
    });
    expect(limited.id).not.toBe(first.id);
    expect(limited).toMatchObject({
      bindingRole: "primary",
      access: "read_only",
      allowNetwork: false,
    });
    expect(service.listWorkspaces(base.conversationId)).toEqual([limited]);
    expect(tools.workspaceGrant(first.id).revokedAt).not.toBeNull();
    expect(tools.activeScopes().filter(({ resource }) => resource === first.id)).toEqual([]);
    expect(tools.activeScopes().filter(({ resource }) => resource === limited.id)).toMatchObject([
      { capability: "workspace", actions: ["read", "search"] },
    ]);
    chat.close();
    await service.close();
  });

  it("shows one effective directory for legacy overlapping grants without combining permissions", async () => {
    const { chat, tools, service, base, directory } = fixture();
    const source = service.grantWorkspace({
      conversationId: null,
      rootPath: directory,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
      projectOperationId: crypto.randomUUID(),
    });
    const projectDirectories = projectDirectoryFixture(directory, source.id);
    service.reconcileProjectWorkspaces({
      conversationId: base.conversationId,
      directories: projectDirectories,
    });
    const inherited = tools.primaryWorkspaceGrant(base.conversationId);
    if (!inherited) throw new Error("Expected inherited primary directory");
    // Older clients stored an independent authorization for the same path.
    const selected = tools.grantWorkspace({
      conversationId: base.conversationId,
      rootPath: source.rootPath,
      displayName: "selected-root",
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
      binding: { source: "user_added", role: "primary" },
    });
    expect(tools.listWorkspaceGrants(base.conversationId)).toHaveLength(3);
    expect(service.listWorkspaces(base.conversationId)).toEqual([selected]);
    const execution = service.reconcileProjectWorkspaces({
      conversationId: base.conversationId,
      directories: projectDirectories,
    });
    expect(execution).toEqual({
      activeExecutionGrantId: selected.id,
      additionalExecutionGrantIds: [],
    });
    expect(tools.primaryWorkspaceGrant(base.conversationId)?.id).toBe(selected.id);
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "读取资料",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      ...execution,
    });
    expect(prepared.workspaceGrants).toEqual([selected]);
    expect(tools.workspaceGrant(source.id).revokedAt).toBeNull();
    expect(tools.workspaceGrant(inherited.id).revokedAt).toBeNull();
    // Removing a local override restores the project directory without deleting files.
    service.revokeWorkspace(selected.id);
    service.reconcileProjectWorkspaces({
      conversationId: base.conversationId,
      directories: projectDirectories,
    });
    expect(service.listWorkspaces(base.conversationId)).toMatchObject([
      { id: inherited.id, bindingSource: "project", bindingRole: "primary" },
    ]);
    expect(existsSync(directory)).toBe(true);
    chat.close();
    await service.close();
  });

  it("keeps a project directory primary when reselected through Add with narrower access", async () => {
    const { chat, tools, service, base, directory } = fixture();
    const source = service.grantWorkspace({
      conversationId: null,
      rootPath: directory,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
      projectOperationId: crypto.randomUUID(),
    });
    const projectDirectories = projectDirectoryFixture(directory, source.id);
    service.reconcileProjectWorkspaces({
      conversationId: base.conversationId,
      directories: projectDirectories,
    });
    const selected = service.grantWorkspace({
      conversationId: base.conversationId,
      rootPath: directory,
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
      role: "additional",
    });
    service.reconcileProjectWorkspaces({
      conversationId: base.conversationId,
      directories: projectDirectories,
    });
    expect(tools.primaryWorkspaceGrant(base.conversationId)?.id).toBe(selected.id);
    expect(service.listWorkspaces(base.conversationId)).toMatchObject([
      { id: selected.id, access: "read_only", allowNetwork: false },
    ]);
    chat.close();
    await service.close();
  });

  it("switches to an existing directory with unchanged permissions and rejects foreign grants", async () => {
    const { chat, service, base, directory } = fixture();
    const initial = service.ensureConversationWorkspace(base.conversationId);
    const additional = service.grantWorkspace({
      conversationId: base.conversationId,
      rootPath: directory,
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
      role: "additional",
    });
    const selected = service.setPrimaryWorkspace({
      conversationId: base.conversationId,
      workspaceGrantId: additional.id,
    });
    expect(selected).toMatchObject({
      id: additional.id,
      access: "read_only",
      allowNetwork: false,
      bindingRole: "primary",
    });
    expect(service.listWorkspaces(base.conversationId).map(({ id }) => id)).toEqual([selected.id]);
    expect(existsSync(initial.rootPath)).toBe(true);
    expect(() =>
      service.setPrimaryWorkspace({
        conversationId: crypto.randomUUID(),
        workspaceGrantId: additional.id,
      }),
    ).toThrow("WORKSPACE_GRANT_CONVERSATION_MISMATCH");
    const global = service.grantWorkspace({
      conversationId: null,
      rootPath: directory,
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
    });
    expect(() =>
      service.setPrimaryWorkspace({
        conversationId: base.conversationId,
        workspaceGrantId: global.id,
      }),
    ).toThrow("WORKSPACE_BINDING_CONVERSATION_REQUIRED");
    service.revokeWorkspace(selected.id);
    expect(() =>
      service.setPrimaryWorkspace({
        conversationId: base.conversationId,
        workspaceGrantId: selected.id,
      }),
    ).toThrow("WORKSPACE_GRANT_INACTIVE");
    chat.close();
    await service.close();
  });

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
      piToolCallId: "pi-desktop-call",
      toolName: "openerx_desktop",
      operation: {
        operation: "desktop",
        action: "screenshot",
        application: "Notes",
        idempotencyKey: "desktop-capture-scope-0001",
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

    await expect(pending).resolves.toMatchObject({
      summary: "host operation completed",
    });
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

  it("full access releases pending calls only in its conversation and can be revoked", async () => {
    let permissionTime = Date.now();
    const { chat, tools, service, host, events, base } = fixture({
      now: () => new Date(permissionTime).toISOString(),
    });
    service.initialize();
    const other = chat.createGeneration({
      text: "其他对话",
      idempotencyKey: "other-full-access-chat",
    });
    const otherBase = {
      ...base,
      generationId: crypto.randomUUID(),
      conversationId: other.receipt.conversationId,
      branchId: other.receipt.branchId,
      assistantMessageId: other.receipt.assistantMessageId,
    };
    for (const target of [base, otherBase]) {
      service.startGeneration({
        ...target,
        selectedModelRef: "platform/auto",
        thinkingLevel: "high",
      });
    }
    const call = (target: typeof base, suffix: string) =>
      service.handleRequest({
        ...target,
        requestId: crypto.randomUUID(),
        piToolCallId: `desktop-${suffix}`,
        toolName: "openerx_desktop",
        operation: {
          operation: "desktop",
          action: "submit",
          application: "Notes",
          idempotencyKey: `full-access-submit-${suffix}`,
        },
      });
    const pending = [call(base, "first"), call(base, "second")];
    const otherPending = call(otherBase, "other");
    await vi.waitFor(() => expect(tools.listPermissions("pending")).toHaveLength(3));
    expect(host.execute).not.toHaveBeenCalled();
    permissionTime += 6 * 60_000;
    const expiredOther = tools
      .listPermissions("pending")
      .find(
        (permission) =>
          tools.workItem(permission.workItemId).conversationId === otherBase.conversationId,
      );
    if (!expiredOther) throw new Error("other permission missing");
    expect(() =>
      service.resolvePermission({
        permissionRequestId: expiredOther.id,
        payloadDigest: expiredOther.payloadDigest,
        decision: "once",
      }),
    ).toThrow("PERMISSION_EXPIRED");
    const state = service.setPermissionMode({
      conversationId: base.conversationId,
      mode: "full_access",
    });
    expect(state.mode).toBe("full_access");
    expect(
      service.setPermissionMode({ conversationId: base.conversationId, mode: "full_access" }),
    ).toEqual(state);
    await Promise.all(pending);
    expect(host.execute).toHaveBeenCalledTimes(2);
    expect(tools.listPermissions("pending")).toHaveLength(1);
    expect(tools.permissionMode(otherBase.conversationId).mode).toBe("ask");
    expect(events.filter(({ type }) => type === "permission.resolved")).toHaveLength(2);
    await call(base, "later");
    expect(host.execute).toHaveBeenCalledTimes(3);
    service.setPermissionMode({ conversationId: base.conversationId, mode: "ask" });
    const afterRevoke = call(base, "revoked");
    await vi.waitFor(() => expect(tools.listPermissions("pending")).toHaveLength(2));
    expect(host.execute).toHaveBeenCalledTimes(3);
    permissionTime -= 6 * 60_000;
    for (const permission of tools.listPermissions("pending")) {
      service.resolvePermission({
        permissionRequestId: permission.id,
        payloadDigest: permission.payloadDigest,
        decision: "once",
      });
    }
    await Promise.all([otherPending, afterRevoke]);
    expect(host.execute).toHaveBeenCalledTimes(5);
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

  it("routes every homepage capability showcase to the required built-in tools", async () => {
    const { chat, service, base } = fixture();
    const prepare = (prompt: string) =>
      service.prepareGeneration({
        conversationId: base.conversationId,
        prompt,
        hasFiles: false,
        skillInstallationIds: [],
        authenticated: true,
      });

    try {
      const research = await prepare(
        "搜索网络：先制定覆盖不同角度的检索计划，再调研最近一周 AI 行业的重要动态，核实信息并附上来源",
      );
      expect(research.initialToolNames).toContain("openerx_web_search");

      const fileReview = await prepare("检查我选择的文件或文件夹，找出问题并给出可验证的改进方案");
      expect(fileReview.initialToolNames).toEqual(
        expect.arrayContaining(["openerx_file_list", "openerx_file_search", "openerx_file_read"]),
      );

      const deliverables = await prepare(
        "搜索最新资料，制作一份 AI 工具选型报告，同时生成对比表格、DOCX 和汇报 PPT",
      );
      expect(deliverables.initialToolNames).toEqual(
        expect.arrayContaining([
          "openerx_web_search",
          "openerx_office_artifact",
          "openerx_calculate",
          "openerx_structured_data",
        ]),
      );

      const financialModel = await prepare(
        "计算一家月营收 100 万元、成本 65 万元公司的三种增长情景，并生成可下载的 Excel 分析表",
      );
      expect(financialModel.initialToolNames).toEqual(
        expect.arrayContaining([
          "openerx_office_artifact",
          "openerx_calculate",
          "openerx_structured_data",
        ]),
      );
    } finally {
      chat.close();
      await service.close();
    }
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

  it("preserves both missing system permissions through readiness and clears them after authorization", async () => {
    const { chat, service, host } = fixture();
    try {
      host.availability.mockResolvedValue({
        availableToolNames: [],
        unavailableReasons: {
          openerx_browser: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
          openerx_desktop: "DESKTOP_SCREEN_CAPTURE_PERMISSION_REQUIRED",
        },
        missingPermissions: {
          openerx_browser: ["screen_capture", "accessibility"],
          openerx_desktop: ["screen_capture", "accessibility"],
        },
      });
      const pending = toolRuntimeReadinessSchema.array().parse(
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        }),
      );
      for (const capability of ["browser", "desktop"]) {
        expect(pending.find((entry) => entry.capability === capability)).toMatchObject({
          status: "authorization_required",
          missingPermissions: ["screen_capture", "accessibility"],
          availableToolNames: [],
        });
      }
      host.availability.mockResolvedValue({
        availableToolNames: ["openerx_browser", "openerx_desktop"],
        unavailableReasons: {},
      });
      const ready = await service.listRuntimeReadiness({
        authenticated: false,
        platformConfigured: false,
      });
      for (const capability of ["browser", "desktop"]) {
        const entry = ready.find((entry) => entry.capability === capability);
        expect(entry?.status).toBe("available");
        expect(entry?.missingPermissions).toBeUndefined();
      }
    } finally {
      chat.close();
      await service.close();
    }
  });

  it("freezes and executes local Web Search without account authentication", async () => {
    const search = vi.fn<LocalSearchProvider["search"]>(async () => ({
      providerId: "direct:baidu-json",
      candidates: [
        {
          title: "OpenERX local search",
          url: "https://example.com/openerx#overview",
          excerpt: "Lightweight local source",
          publishedAt: null,
        },
      ],
      recencyApplied: false,
      executionPerformed: true,
      responseBytes: 512,
      durationMs: 12,
    }));
    const provider: LocalSearchProvider = {
      descriptor: {
        providerId: "direct:baidu-json",
        displayName: "Fixture Baidu JSON",
        transport: "json",
        stability: "unofficial",
        releaseEligible: false,
        requiresDailyProbe: true,
      },
      search,
    };
    const { chat, service, base } = fixture({
      localWebSearchV2: true,
      localWebSearchProviders: [provider],
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "搜索网络上的 OpenERX 最新信息",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(prepared.availableToolNames).toContain("openerx_web_search");
    expect(prepared.initialToolNames).toContain("openerx_web_search");
    expect(prepared.initialToolNames).toContain("openerx_browser");
    expect(prepared.localWebSearchConfiguration).toMatchObject({
      policy: {
        providerOrder: ["direct:baidu-json", "direct:bing-html"],
        allowProviderFallback: true,
      },
      policyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(
      (
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        })
      ).find(({ capability }) => capability === "web.search"),
    ).toMatchObject({
      status: "available",
      reason: null,
      availableToolNames: ["openerx_web_search"],
      details: expect.arrayContaining([
        "阶段：Desktop Local Alpha",
        "执行：本机 App Service",
        "Provider 顺序：direct:baidu-json → direct:bing-html",
        "Provider 自动降级：开启",
        "浏览器兜底：可用",
      ]),
    });

    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });
    if (!prepared.localWebSearchConfiguration) throw new Error("local search policy missing");
    service.freezeGenerationConfiguration(base.generationId, {
      initialToolNames: prepared.initialToolNames,
      availableToolNames: prepared.availableToolNames,
      skillInstallationIds: [],
      instructionSources: prepared.instructionSources,
      localWebSearchConfiguration: prepared.localWebSearchConfiguration,
    });
    const result = await service.handleRequest({
      ...base,
      piToolCallId: "pi-local-search-call",
      toolName: "openerx_web_search",
      operation: {
        operation: "web_search",
        query: "OpenERX",
        idempotencyKey: "local-web-search-app-service-0001",
      },
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.sources).toEqual([
      {
        title: "OpenERX local search",
        url: "https://example.com/openerx",
        excerpt: "Lightweight local source",
        publishedAt: null,
        retrievedAt: expect.any(String),
      },
    ]);
    expect(result.content).toEqual(
      expect.arrayContaining([{ type: "source", source: result.sources[0] }]),
    );
    expect(result.data).toMatchObject({
      executionPerformed: true,
      providerId: "direct:baidu-json",
    });
    service.completeGeneration(base.generationId, "completed");
    chat.close();
    await service.close();
  });

  it("registers Bing locally only when the trusted policy explicitly selects it", async () => {
    const { chat, service, base } = fixture({
      localWebSearchV2: true,
      localWebSearchPolicy: {
        ...defaultLocalWebSearchPolicy(),
        providerOrder: ["direct:bing-html"],
        allowProviderFallback: false,
        locale: "zh-CN",
      },
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "使用 Bing 搜索 OpenERX",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(prepared.availableToolNames).toContain("openerx_web_search");
    expect(prepared.localWebSearchConfiguration).toMatchObject({
      policy: {
        providerOrder: ["direct:bing-html"],
        allowProviderFallback: false,
        locale: "zh-CN",
      },
    });
    expect(
      (
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        })
      ).find(({ capability }) => capability === "web.search"),
    ).toMatchObject({
      status: "available",
      reason: null,
      details: expect.arrayContaining([
        "Provider 顺序：direct:bing-html",
        "Provider 自动降级：关闭",
        "浏览器兜底：可用",
      ]),
    });
    chat.close();
    await service.close();
  });

  it("persists trusted search settings while keeping prepared Generation policy frozen", async () => {
    const { chat, tools, service, base } = fixture({ localWebSearchV2: true });
    const before = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "搜索 OpenERX",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(service.localWebSearchSettings()).toMatchObject({
      providerId: "direct:baidu-json",
      locale: "zh-CN",
      safeSearch: "moderate",
      featureEnabled: true,
      allowProviderFallback: true,
      cacheMode: "turn",
    });

    const updated = service.updateLocalWebSearchSettings({
      providerId: "direct:bing-html",
      locale: "en-US",
      safeSearch: "strict",
    });
    expect(updated).toMatchObject({
      providerId: "direct:bing-html",
      locale: "en-US",
      safeSearch: "strict",
      updatedAt: expect.any(String),
    });
    expect(tools.localWebSearchSettings()).toMatchObject({
      providerId: "direct:bing-html",
      locale: "en-US",
      safeSearch: "strict",
    });
    expect(before.localWebSearchConfiguration?.policy).toMatchObject({
      providerOrder: ["direct:baidu-json", "direct:bing-html"],
      allowProviderFallback: true,
      locale: "zh-CN",
      safeSearch: "moderate",
    });

    const after = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "搜索 OpenERX",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(after.localWebSearchConfiguration?.policy).toMatchObject({
      providerOrder: ["direct:bing-html", "direct:baidu-json"],
      allowProviderFallback: true,
      locale: "en-US",
      safeSearch: "strict",
      cacheMode: "turn",
    });
    expect(after.localWebSearchConfiguration?.policyDigest).not.toBe(
      before.localWebSearchConfiguration?.policyDigest,
    );

    chat.close();
    await service.close();
  });

  it("fails local Web Search closed before a Generation policy is frozen", async () => {
    const provider: LocalSearchProvider = {
      descriptor: {
        providerId: "direct:baidu-json",
        displayName: "Fixture Baidu JSON",
        transport: "json",
        stability: "unofficial",
        releaseEligible: false,
        requiresDailyProbe: true,
      },
      search: vi.fn(async () => ({
        providerId: "direct:baidu-json" as const,
        candidates: [],
        recencyApplied: false,
        executionPerformed: true,
        responseBytes: 0,
        durationMs: 0,
      })),
    };
    const { chat, service, base } = fixture({
      localWebSearchV2: true,
      localWebSearchProviders: [provider],
    });
    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });
    await expect(
      service.handleRequest({
        ...base,
        piToolCallId: "pi-local-search-unfrozen",
        toolName: "openerx_web_search",
        operation: {
          operation: "web_search",
          query: "OpenERX",
          idempotencyKey: "local-web-search-unfrozen-0001",
        },
      }),
    ).rejects.toMatchObject({ code: "LOCAL_SEARCH_POLICY_MISMATCH" });
    expect(provider.search).not.toHaveBeenCalled();
    service.completeGeneration(base.generationId, "failed", "LOCAL_SEARCH_POLICY_MISMATCH");
    chat.close();
    await service.close();
  });

  it("restores Shell through the default workspace after a project workspace is revoked", async () => {
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
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        })
      ).find(({ capability }) => capability === "shell"),
    ).toMatchObject({
      status: "available",
      reason: null,
      availableToolNames: ["openerx_shell", "openerx_shell_process"],
      details:
        process.platform === "win32"
          ? expect.arrayContaining([
              "Backend：Codex Windows restricted token",
              "隔离：受限账户 / ACL / Job Object / WFP",
              "命令：argv 直传；网络默认拒绝",
              expect.stringContaining("默认工作区："),
            ])
          : ["回滚路径：openerx_shell", "同一会话不会同时暴露 brokered bash"],
    });

    service.revokeWorkspace(grant.id);
    expect(
      (
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        })
      ).find(({ capability }) => capability === "shell"),
    ).toMatchObject({
      status: "available",
      reason: null,
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "运行测试命令",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(prepared.availableToolNames).toContain("openerx_shell");
    expect(prepared.initialToolNames).toContain("openerx_shell");
    chat.close();
    await service.close();
  });

  it("exposes only brokered bash when the default-off PBASH-001 flag is enabled", async () => {
    const { chat, service, base, directory } = fixture({
      brokeredBashV1: true,
      shellAvailability: () => ({
        availableToolNames: ["openerx_shell", "openerx_shell_process"],
        unavailableReasons: {},
      }),
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: null,
      access: "read_write",
      allowNetwork: true,
      expiresAt: null,
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "运行构建和测试命令",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });

    expect(prepared.availableToolNames).toContain("bash");
    expect(prepared.availableToolNames).not.toContain("openerx_shell");
    expect(prepared.availableToolNames).not.toContain("openerx_shell_process");
    expect(prepared.initialToolNames).toContain("bash");
    expect(prepared.brokeredBashExecution).toMatchObject({
      activeExecutionGrantId: grant.id,
      additionalExecutionGrantIds: [],
      executionProfile: "workspace_write",
      workspaceWriteMode: "direct_workspace",
      networkPolicyId: "network-deny-v1",
      sandboxPolicyVersion: "pbash-fake-v1",
    });
    expect(
      (
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        })
      ).find(({ capability }) => capability === "shell"),
    ).toMatchObject({
      status: "degraded",
      reason: "BROKERED_BASH_FAKE_RUNNER_ONLY",
      availableToolNames: ["bash"],
      details: expect.arrayContaining([
        "阶段：Local Alpha",
        "Runner：fake",
        "Backend：deterministic_fake",
        "平台：test-only",
        "环境：core（Secret 过滤）",
        "网络：默认拒绝",
      ]),
    });
    chat.close();
    await service.close();
  });

  it("routes unattended remote and high-isolation writes to a non-degrading change-set mode", async () => {
    const { chat, service, base, directory } = fixture({
      brokeredBashV1: true,
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: base.conversationId,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const remote = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "无人值守执行写入",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
      executionOrigin: "remote_unattended",
    });
    expect(remote.brokeredBashExecution).toMatchObject({
      executionProfile: "workspace_write",
      workspaceWriteMode: "isolated_change_set",
    });
    const highRisk = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "隔离运行后审阅",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
      requiresHighIsolation: true,
    });
    expect(highRisk.brokeredBashExecution?.workspaceWriteMode).toBe("isolated_change_set");
    chat.close();
    await service.close();
  });

  it("freezes trusted environment and egress policies while refusing all and Remote egress", async () => {
    const platform = platformEngine();
    const { chat, service, base, directory } = fixture({
      brokeredBashV1: true,
      brokeredBashRunnerMode: "macos",
      platformSandboxEngine: platform.engine,
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: base.conversationId,
      access: "read_write",
      allowNetwork: true,
      expiresAt: null,
    });
    const local = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "使用受控网络运行命令",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
      environmentPolicy: {
        mode: "none",
        include: ["SAFE_BUILD_FLAG"],
        exclude: [],
        set: { BUILD_MODE: "verification" },
      },
      networkPolicy: {
        mode: "controlled_egress",
        allowedDomains: ["registry.npmjs.org"],
      },
    });
    expect(local.brokeredBashExecution).toMatchObject({
      environmentPolicyId: "environment-none-v1",
      environmentPolicyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      networkPolicyId: "network-controlled-egress-v1",
      networkPolicyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });

    const remote = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "远程使用受控网络",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
      executionOrigin: "remote_attended",
      networkPolicy: {
        mode: "controlled_egress",
        allowedDomains: ["registry.npmjs.org"],
      },
    });
    expect(remote.brokeredBashExecution).toBeUndefined();
    expect(remote.availableToolNames).not.toContain("bash");

    const all = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "继承全部环境",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
      environmentPolicy: { mode: "all", include: [], exclude: [], set: {} },
    });
    expect(all.brokeredBashExecution).toBeUndefined();
    expect(all.availableToolNames).not.toContain("bash");
    chat.close();
    await service.close();
  });

  it("projects and executes real brokered Bash only after the platform capability probe passes", async () => {
    const platform = platformEngine();
    const writeLog = vi.fn(async () => "99999999-9999-4999-8999-999999999999");
    const progress: Array<[string, boolean]> = [];
    const { chat, service, base, directory } = fixture({
      brokeredBashV1: true,
      brokeredBashRunnerMode: "macos",
      platformSandboxEngine: platform.engine,
      writeBrokeredBashLogArtifact: writeLog,
      shellAvailability: () => ({
        availableToolNames: ["openerx_shell", "openerx_shell_process"],
        unavailableReasons: {},
      }),
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: base.conversationId,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "运行真实 Broker 测试命令",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
    });
    const execution = prepared.brokeredBashExecution;
    if (!execution) throw new Error("platform execution context missing");
    expect(prepared.availableToolNames).toContain("bash");
    expect(prepared.availableToolNames).not.toContain("openerx_shell");
    expect(execution).toMatchObject({
      sandboxPolicyVersion: "macos-seatbelt-v1",
      networkPolicyId: "network-deny-v1",
    });
    expect(
      (
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        })
      ).find(({ capability }) => capability === "shell"),
    ).toMatchObject({
      status: "available",
      reason: null,
      availableToolNames: ["bash"],
      details: expect.arrayContaining([
        "Backend：test_macos_sandbox",
        "平台：darwin test-build",
        "Sandbox：macos-seatbelt-v1",
      ]),
    });

    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });
    service.freezeGenerationConfiguration(base.generationId, {
      initialToolNames: prepared.initialToolNames,
      availableToolNames: prepared.availableToolNames,
      skillInstallationIds: [],
      instructionSources: prepared.instructionSources,
      brokeredBashExecution: execution,
    });
    const frame: PiToolRequestFrame = {
      ...base,
      piToolCallId: "pi-platform-bash-call",
      toolName: "bash",
      operation: {
        operation: "shell_command_execute",
        idempotencyKey: "pbash-platform-app-service-0001",
        ...execution,
        shell: "bash",
        command: "npm test",
        timeoutMs: 120_000,
      },
    };
    await expect(
      service.handleRequest(frame, undefined, (delta, truncated) =>
        progress.push([delta, truncated]),
      ),
    ).resolves.toMatchObject({
      summary: "real-broker-ok",
      sideEffectCommitted: true,
      artifacts: ["99999999-9999-4999-8999-999999999999"],
      data: {
        executionPerformed: true,
        runner: "platform_sandbox",
        destructionStatus: "clean",
      },
    });
    expect(progress).toEqual([
      ["real-", false],
      ["broker-ok", false],
    ]);
    expect(writeLog).toHaveBeenCalledWith(
      expect.objectContaining({ content: "real-broker-ok", truncated: false }),
    );
    expect(platform.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRoot: expect.objectContaining({
          grantId: grant.id,
          rootPath: grant.rootPath,
        }),
        command: "npm test",
      }),
    );
    chat.close();
    await service.close();
    expect(platform.stopAll).toHaveBeenCalledOnce();
  });

  it("executes the full AppService to Broker path through the live macOS sandbox", async () => {
    if (!liveMacOSSandbox) return;
    const platformSandboxEngine = new MacOSSandboxExecEngine();
    await expect(platformSandboxEngine.probe()).resolves.toMatchObject({
      available: true,
    });
    const { chat, service, base, directory } = fixture({
      brokeredBashV1: true,
      brokeredBashRunnerMode: "macos",
      platformSandboxEngine,
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: base.conversationId,
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "输出沙盒存活标记",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
    });
    const execution = prepared.brokeredBashExecution;
    if (!execution) throw new Error("live platform execution context missing");
    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });
    service.freezeGenerationConfiguration(base.generationId, {
      initialToolNames: prepared.initialToolNames,
      availableToolNames: prepared.availableToolNames,
      skillInstallationIds: [],
      instructionSources: prepared.instructionSources,
      brokeredBashExecution: execution,
    });
    await expect(
      service.handleRequest({
        ...base,
        piToolCallId: "pi-live-macos-bash-call",
        toolName: "bash",
        operation: {
          operation: "shell_command_execute",
          idempotencyKey: "pbash-live-app-service-0001",
          ...execution,
          shell: "bash",
          command: "printf pbash-app-service-live",
          timeoutMs: 5_000,
        },
      }),
    ).resolves.toMatchObject({
      summary: "pbash-app-service-live",
      sideEffectCommitted: false,
      data: {
        executionPerformed: true,
        runner: "platform_sandbox",
        sandboxPolicyVersion: "macos-seatbelt-v1",
        proof: {
          backendId: "macos_sandbox_exec",
          filesystemBoundary: true,
          hardlinkBoundary: true,
          environmentSanitized: true,
          networkDenied: true,
          processGroupOwned: true,
        },
      },
    });
    chat.close();
    await service.close();
  });

  it("persists a live isolated Bash change set without mutating the host workspace", async () => {
    if (!liveMacOSSandbox) return;
    const platformSandboxEngine = new MacOSSandboxExecEngine();
    const { chat, service, base, directory, events } = fixture({
      brokeredBashV1: true,
      brokeredBashRunnerMode: "macos",
      platformSandboxEngine,
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: base.conversationId,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "隔离生成文件后审阅",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
      requiresHighIsolation: true,
    });
    const execution = prepared.brokeredBashExecution;
    if (!execution) throw new Error("isolated execution context missing");
    expect(execution.workspaceWriteMode).toBe("isolated_change_set");
    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });
    service.freezeGenerationConfiguration(base.generationId, {
      initialToolNames: prepared.initialToolNames,
      availableToolNames: prepared.availableToolNames,
      skillInstallationIds: [],
      instructionSources: prepared.instructionSources,
      brokeredBashExecution: execution,
    });
    const result = await service.handleRequest({
      ...base,
      piToolCallId: "pi-live-isolated-bash-call",
      toolName: "bash",
      operation: {
        operation: "shell_command_execute",
        idempotencyKey: "pbash-live-isolated-app-service-0001",
        ...execution,
        shell: "bash",
        command: "printf isolated-result > isolated-result.txt",
        timeoutMs: 5_000,
      },
    });
    expect(existsSync(path.join(directory, "isolated-result.txt"))).toBe(false);
    expect(result).toMatchObject({
      sideEffectCommitted: true,
      data: {
        workspaceChanges: {
          mode: "ISOLATED_CHANGE_SET",
          hostWorkspaceMutated: false,
        },
        workspaceChangeSet: { status: "pending_review" },
      },
    });
    const sets = service.repository().listWorkspaceChangeSets(grant.id);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      status: "pending_review",
      workspaceGrantId: grant.id,
    });
    expect(sets[0]?.entries[0]).toMatchObject({
      relativePath: "isolated-result.txt",
      kind: "created",
      afterText: "isolated-result",
      applySupported: true,
    });
    expect(events.find(({ type }) => type === "tool.completed")?.payload.reconciliation).toEqual([
      {
        kind: "workspace_change_set",
        targetId: sets[0]?.id,
        status: "pending_review",
        actionRequired: true,
      },
    ]);
    chat.close();
    await service.close();
  });

  it("keeps Bash unavailable when the selected platform backend fails its probe", async () => {
    const platform = platformEngine(false);
    const { chat, service, base, directory } = fixture({
      brokeredBashV1: true,
      brokeredBashRunnerMode: "macos",
      platformSandboxEngine: platform.engine,
      shellAvailability: () => ({
        availableToolNames: ["openerx_shell", "openerx_shell_process"],
        unavailableReasons: {},
      }),
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
      prompt: "运行测试",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(prepared.availableToolNames).not.toContain("bash");
    expect(prepared.availableToolNames).not.toContain("openerx_shell");
    expect(prepared.brokeredBashExecution).toBeUndefined();
    expect(
      (
        await service.listRuntimeReadiness({
          authenticated: false,
          platformConfigured: false,
        })
      ).find(({ capability }) => capability === "shell"),
    ).toMatchObject({
      status: "unavailable",
      reason: "BROKERED_BASH_CAPABILITY_PROBE_FAILED",
      availableToolNames: [],
      details: expect.arrayContaining([
        "阶段：Local Alpha",
        "Runner：macos",
        "Backend：test_macos_sandbox",
        "平台：darwin test-build",
        "Sandbox：unavailable",
      ]),
    });
    expect(platform.execute).not.toHaveBeenCalled();
    chat.close();
    await service.close();
  });

  it("projects active runs as interrupted and stops runners when Pi Host disconnects", async () => {
    const platform = platformEngine();
    const { chat, service, base, events } = fixture({
      brokeredBashV1: true,
      brokeredBashRunnerMode: "macos",
      platformSandboxEngine: platform.engine,
    });
    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });
    await service.handleHostDisconnect();
    expect(platform.stopAll).toHaveBeenCalledOnce();
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["run.cancelling", "run.interrupted"]),
    );
    chat.close();
    await service.close();
  });

  it("requires an explicit active execution grant when multiple workspaces exist", async () => {
    const { chat, service, base, directory } = fixture({
      brokeredBashV1: true,
      shellAvailability: () => ({
        availableToolNames: ["openerx_shell", "openerx_shell_process"],
        unavailableReasons: {},
      }),
    });
    const secondRoot = mkdtempSync(path.join(tmpdir(), "openerx-pbash-second-"));
    directories.push(secondRoot);
    const active = service.grantWorkspace({
      rootPath: directory,
      conversationId: null,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const additional = service.grantWorkspace({
      rootPath: secondRoot,
      conversationId: null,
      access: "read_only",
      allowNetwork: false,
      expiresAt: null,
    });
    const ambiguous = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "运行测试",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
    });
    expect(ambiguous.availableToolNames).not.toContain("bash");
    expect(ambiguous.availableToolNames).not.toContain("openerx_shell");
    expect(ambiguous.availableToolNames).not.toContain("openerx_shell_process");
    expect(ambiguous.brokeredBashExecution).toBeUndefined();

    const selected = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "运行测试",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: active.id,
      additionalExecutionGrantIds: [additional.id],
    });
    expect(selected.availableToolNames).toContain("bash");
    expect(selected.brokeredBashExecution).toMatchObject({
      activeExecutionGrantId: active.id,
      additionalExecutionGrantIds: [additional.id],
    });
    expect(selected.availableToolNames).not.toContain("openerx_shell");
    expect(selected.availableToolNames).not.toContain("openerx_shell_process");
    chat.close();
    await service.close();
  });

  it("runs the complete Broker path through a deterministic fake without touching the filesystem", async () => {
    const { chat, tools, service, base, directory } = fixture({
      brokeredBashV1: true,
    });
    const grant = service.grantWorkspace({
      rootPath: directory,
      conversationId: base.conversationId,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const prepared = await service.prepareGeneration({
      conversationId: base.conversationId,
      prompt: "运行测试命令",
      hasFiles: false,
      skillInstallationIds: [],
      authenticated: false,
      activeExecutionGrantId: grant.id,
    });
    const execution = prepared.brokeredBashExecution;
    if (!execution) throw new Error("brokered Bash execution context missing");
    service.startGeneration({
      generationId: base.generationId,
      conversationId: base.conversationId,
      branchId: base.branchId,
      assistantMessageId: base.assistantMessageId,
      selectedModelRef: "platform/auto",
      thinkingLevel: "medium",
    });
    service.freezeGenerationConfiguration(base.generationId, {
      initialToolNames: prepared.initialToolNames,
      availableToolNames: prepared.availableToolNames,
      skillInstallationIds: [],
      instructionSources: prepared.instructionSources,
      brokeredBashExecution: execution,
    });
    expect(() =>
      service.freezeGenerationConfiguration(base.generationId, {
        initialToolNames: prepared.initialToolNames,
        availableToolNames: prepared.availableToolNames,
        skillInstallationIds: [],
        instructionSources: prepared.instructionSources,
        brokeredBashExecution: {
          ...execution,
          sandboxPolicyVersion: "pbash-fake-v2",
        },
      }),
    ).toThrow("RUN_CONFIGURATION_ALREADY_FROZEN");
    const canaryPath = path.join(directory, "pbash-fake-must-not-exist");
    const frame: PiToolRequestFrame = {
      ...base,
      piToolCallId: "pi-brokered-bash-call",
      toolName: "bash",
      operation: {
        operation: "shell_command_execute",
        idempotencyKey: "pbash-app-service-fake-0001",
        ...execution,
        shell: "bash",
        command: `touch ${canaryPath}`,
        timeoutMs: 120_000,
      },
    };
    await expect(service.handleRequest(frame)).resolves.toMatchObject({
      sideEffectCommitted: false,
      data: { executionPerformed: false, runner: "deterministic_fake" },
    });
    expect(existsSync(canaryPath)).toBe(false);
    const workItem = tools.listWorkItems(base.conversationId)[0];
    if (!workItem?.activeRunId) throw new Error("active run missing");
    expect(tools.toolCallByPiRef(workItem.activeRunId, frame.piToolCallId)).toMatchObject({
      status: "completed",
      toolName: "bash",
      input: { operation: "shell_command_execute" },
    });

    await expect(
      service.handleRequest({
        ...frame,
        requestId: "77777777-7777-4777-8777-777777777777",
        piToolCallId: "pi-brokered-bash-tampered",
        operation: {
          ...(frame.operation as BrokeredBashOperation),
          idempotencyKey: "pbash-app-service-tampered-0001",
          sandboxPolicyVersion: "pbash-fake-v2",
        },
      }),
    ).rejects.toThrow("BROKERED_BASH_EXECUTION_CONTEXT_MISMATCH");

    service.revokeWorkspace(grant.id);
    await expect(
      service.handleRequest({
        ...frame,
        requestId: "88888888-8888-4888-8888-888888888888",
        piToolCallId: "pi-brokered-bash-revoked",
        operation: {
          ...(frame.operation as BrokeredBashOperation),
          idempotencyKey: "pbash-app-service-revoked-0001",
        },
      }),
    ).rejects.toThrow("BROKERED_BASH_WORKSPACE_GRANT_INVALID");
    expect(existsSync(canaryPath)).toBe(false);
    chat.close();
    await service.close();
  });
});
