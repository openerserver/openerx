import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AppServiceAuthorization,
  PiActivityEvent,
  PiFileToolRequestFrame,
  PiHostEventFrame,
  PiPromptFrame,
  PiSessionControlFrame,
  PiToolRequestFrame,
  RemoteCommand,
  RemoteCommandPayload,
} from "@openerx/contracts";
import { remoteCommandSchema } from "@openerx/contracts";
import {
  ChatRepository,
  ProjectRepository,
  RemoteRepository,
  ToolRepository,
} from "@openerx/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAppService, type PiHostClient, ToolAppService } from "../src";

const directories: string[] = [];
const services: ChatAppService[] = [];

function trackedService(
  ...parameters: ConstructorParameters<typeof ChatAppService>
): ChatAppService {
  const service = new ChatAppService(...parameters);
  services.push(service);
  return service;
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

class RemotePiHostClient implements PiHostClient {
  readonly prompts: PiPromptFrame[] = [];
  readonly controls: PiSessionControlFrame[] = [];
  toolRequest:
    | ((
        frame: PiToolRequestFrame,
        onProgress?: (delta: string, truncated: boolean) => void,
      ) => Promise<unknown>)
    | null = null;
  prompt(frame: PiPromptFrame): Promise<void> {
    this.prompts.push(frame);
    return Promise.resolve();
  }
  abort(_generationId: string): Promise<void> {
    return Promise.resolve();
  }
  control(frame: PiSessionControlFrame): Promise<void> {
    this.controls.push(frame);
    return Promise.resolve();
  }
  onEvent(_listener: (frame: PiHostEventFrame) => void): () => void {
    return () => undefined;
  }
  onFileToolRequest(_listener: (frame: PiFileToolRequestFrame) => Promise<unknown>): () => void {
    return () => undefined;
  }
  onToolRequest(
    listener: (
      frame: PiToolRequestFrame,
      onProgress?: (delta: string, truncated: boolean) => void,
    ) => Promise<unknown>,
  ): () => void {
    this.toolRequest = listener;
    return () => {
      if (this.toolRequest === listener) this.toolRequest = null;
    };
  }
  onActivity(_listener: (frame: PiActivityEvent) => void): () => void {
    return () => undefined;
  }
}

const authorization: AppServiceAuthorization = {
  accountId: randomUUID(),
  accessToken: "a".repeat(48),
  accessTokenExpiresAt: "2026-08-26T12:00:00.000Z",
  platformBaseUrl: "https://platform.openerx.invalid",
};

function remoteCommand(
  payload: RemoteCommandPayload,
  input: {
    conversationId: string | null;
    generationId: string | null;
    baseRevision: number;
    sequence?: number;
    authority?: {
      pairingId: string;
      controllerDeviceId: string;
      hostDeviceId: string;
    };
  },
): RemoteCommand {
  return remoteCommandSchema.parse({
    version: 1,
    commandId: randomUUID(),
    accountId: authorization.accountId,
    pairingId: input.authority?.pairingId ?? randomUUID(),
    controllerDeviceId: input.authority?.controllerDeviceId ?? randomUUID(),
    hostDeviceId: input.authority?.hostDeviceId ?? randomUUID(),
    conversationId: input.conversationId,
    generationId: input.generationId,
    kind: payload.kind,
    baseRevision: input.baseRevision,
    sessionSequence: input.sequence ?? 1,
    issuedAt: "2026-08-26T10:00:00.000Z",
    expiresAt: "2026-08-26T10:01:00.000Z",
    idempotencyKey: `remote-app-${randomUUID()}`,
    encryptedPayload: "E".repeat(43),
    signature: "S".repeat(86),
  });
}

function toolEnabledService(directory: string, chat: ChatRepository) {
  const tools = new ToolRepository(path.join(directory, "profile.sqlite"));
  const workspace = path.join(directory, "workspace");
  mkdirSync(workspace);
  const service = new ToolAppService({
    repository: tools,
    workspaceDirectory: workspace,
    host: {
      availability: async () => ({ availableToolNames: [], unavailableReasons: {} }),
      execute: async () => {
        throw new Error("HOST_TOOL_NOT_EXPECTED");
      },
      resolve: async () => "unused",
      clear: async () => undefined,
    },
    resolveUploadPath: (fileId) => path.join(directory, "uploads", fileId),
    ingestDownload: async (downloadPath) => ({
      fileId: randomUUID(),
      displayName: path.basename(downloadPath),
    }),
    selectedModelRef: () => "platform/auto",
    emit: () => undefined,
    brokeredBashV1: true,
    brokeredBashRunnerMode: "fake",
  });
  return { tools, service, workspace, chat };
}

describe("ChatAppService remote Pi mapping", () => {
  it("maps steer directly to the active Pi session and replays the product command once", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = trackedService(chat, pi, null, null, null, remote);
    const receipt = (await service.handle(
      {
        command: "chat.send",
        input: { text: "long-running task", idempotencyKey: "local-seed-0001" },
      },
      authorization,
    )) as { conversationId: string };
    const prompt = pi.prompts[0];
    if (!prompt) throw new Error("prompt missing");
    const payload = { kind: "session.steer" as const, text: "先运行测试" };
    const command = remoteCommand(payload, {
      conversationId: receipt.conversationId,
      generationId: prompt.generationId,
      baseRevision: service.currentRemoteRevision(receipt.conversationId),
    });

    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: true,
    });
    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: true,
    });
    expect(pi.controls).toEqual([
      expect.objectContaining({
        requestId: command.commandId,
        generationId: prompt.generationId,
        action: "steer",
        text: payload.text,
      }),
    ]);
    service.close();
  });

  it("rejects a stale revision before any Pi control call", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = trackedService(chat, pi, null, null, null, remote);
    const receipt = (await service.handle(
      {
        command: "chat.send",
        input: { text: "active task", idempotencyKey: "local-seed-0002" },
      },
      authorization,
    )) as { conversationId: string };
    const prompt = pi.prompts[0];
    if (!prompt) throw new Error("prompt missing");
    const payload = { kind: "session.follow_up" as const, text: "完成后总结" };
    const command = remoteCommand(payload, {
      conversationId: receipt.conversationId,
      generationId: prompt.generationId,
      baseRevision: 0,
    });
    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: false,
      errorCode: "REMOTE_BASE_REVISION_CONFLICT",
    });
    expect(pi.controls).toHaveLength(0);
    service.close();
  });

  it("resolves the active Pi generation by conversation without exposing a Pi session id", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = trackedService(chat, pi, null, null, null, remote);
    const receipt = (await service.handle(
      {
        command: "chat.send",
        input: { text: "active task", idempotencyKey: "local-seed-0003" },
      },
      authorization,
    )) as { conversationId: string; assistantMessageId: string };
    const payload = {
      kind: "session.abort" as const,
      assistantMessageId: receipt.assistantMessageId,
    };
    const command = remoteCommand(payload, {
      conversationId: receipt.conversationId,
      generationId: null,
      baseRevision: service.currentRemoteRevision(receipt.conversationId),
    });

    expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
      ok: true,
    });
    expect(pi.controls).toEqual([
      expect.objectContaining({ requestId: command.commandId, action: "abort" }),
    ]);
    service.close();
  });

  it("starts a new Pi prompt through the existing chat idempotency path", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const service = trackedService(
      new ChatRepository(databasePath),
      new RemotePiHostClient(),
      null,
      null,
      null,
      new RemoteRepository(databasePath),
    );
    const payload = {
      kind: "task.start" as const,
      text: "检查项目并运行测试",
      clientOperationId: "mobile-task-0001",
    };
    const command = remoteCommand(payload, {
      conversationId: null,
      generationId: null,
      baseRevision: 0,
    });
    const result = await service.applyRemoteCommand(command, payload, authorization);
    expect(result).toMatchObject({ ok: true, appliedRevision: expect.any(Number) });
    expect(service.currentRemoteRevision(null)).toBe(0);
    service.close();
  });

  it("lists safe projects and starts a new task with the selected project instructions", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-project-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath, { ownerProfileId: authorization.accountId });
    const projects = new ProjectRepository(databasePath, {
      ownerProfileId: authorization.accountId,
    });
    const project = projects.createProject({
      operationId: randomUUID(),
      name: "手机项目",
      instructions: "先运行项目测试。",
    });
    const pi = new RemotePiHostClient();
    const service = trackedService(
      chat,
      pi,
      null,
      null,
      null,
      new RemoteRepository(databasePath),
      null,
      null,
      projects,
    );

    try {
      const listPayload = { kind: "project.list" as const, includeArchived: false };
      const listResult = await service.applyRemoteCommand(
        remoteCommand(listPayload, {
          conversationId: null,
          generationId: null,
          baseRevision: 0,
        }),
        listPayload,
        authorization,
      );
      expect(listResult).toMatchObject({
        ok: true,
        result: {
          kind: "project.snapshot",
          projects: [{ projectId: project.id, name: "手机项目", directories: [] }],
        },
      });

      const startPayload = {
        kind: "task.start" as const,
        text: "检查当前项目",
        clientOperationId: "mobile-project-task-0001",
        projectId: project.id,
      };
      const startResult = await service.applyRemoteCommand(
        remoteCommand(startPayload, {
          conversationId: null,
          generationId: null,
          baseRevision: 0,
        }),
        startPayload,
        authorization,
      );
      expect(startResult).toMatchObject({ ok: true });
      const receipt = startResult.ok
        ? (startResult.result as { conversationId: string } | undefined)
        : undefined;
      if (!receipt) throw new Error("Remote project receipt missing");
      expect(chat.getConversation(receipt.conversationId).conversation.projectId).toBe(project.id);
      expect(pi.prompts[0]?.history.find(({ role }) => role === "system")?.text).toContain(
        "先运行项目测试。",
      );
    } finally {
      service.close();
      projects.close();
    }
  });

  it("freezes attended and unattended Remote prompts into distinct Bash write modes", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const toolFixture = toolEnabledService(directory, chat);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = trackedService(chat, pi, null, null, toolFixture.service, remote);

    for (const [index, executionMode] of ["attended", "unattended"].entries()) {
      const seed = chat.createGeneration({
        text: `seed-${executionMode}`,
        idempotencyKey: `remote-mode-seed-${index}`,
      });
      toolFixture.service.grantWorkspace({
        rootPath: toolFixture.workspace,
        conversationId: seed.receipt.conversationId,
        access: "read_write",
        allowNetwork: false,
        expiresAt: null,
      });
      const payload = {
        kind: "session.prompt" as const,
        text: `run ${executionMode}`,
        clientOperationId: `mobile-mode-${index}`,
        executionMode: executionMode as "attended" | "unattended",
      };
      const command = remoteCommand(payload, {
        conversationId: seed.receipt.conversationId,
        generationId: null,
        baseRevision: service.currentRemoteRevision(seed.receipt.conversationId),
      });
      expect(await service.applyRemoteCommand(command, payload, authorization)).toMatchObject({
        ok: true,
      });
    }

    expect(pi.prompts.at(-2)?.workspace?.execution).toMatchObject({
      executionOrigin: "remote_attended",
      workspaceWriteMode: "direct_workspace",
      networkPolicyId: "network-deny-v1",
    });
    expect(pi.prompts.at(-1)?.workspace?.execution).toMatchObject({
      executionOrigin: "remote_unattended",
      workspaceWriteMode: "isolated_change_set",
      networkPolicyId: "network-deny-v1",
    });
    service.close();
  });

  it("allows only the originating Remote controller to resolve its Bash approval", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-app-"));
    directories.push(directory);
    const databasePath = path.join(directory, "profile.sqlite");
    const chat = new ChatRepository(databasePath);
    const toolFixture = toolEnabledService(directory, chat);
    const remote = new RemoteRepository(databasePath);
    const pi = new RemotePiHostClient();
    const service = trackedService(chat, pi, null, null, toolFixture.service, remote);
    const seed = chat.createGeneration({
      text: "seed attended Remote",
      idempotencyKey: "remote-approval-seed-0001",
    });
    const grant = toolFixture.service.grantWorkspace({
      rootPath: toolFixture.workspace,
      conversationId: seed.receipt.conversationId,
      access: "read_write",
      allowNetwork: false,
      expiresAt: null,
    });
    const authority = {
      pairingId: randomUUID(),
      controllerDeviceId: randomUUID(),
      hostDeviceId: randomUUID(),
    };
    const promptPayload = {
      kind: "session.prompt" as const,
      text: "write after approval",
      clientOperationId: "mobile-approval-prompt-0001",
      executionMode: "attended" as const,
    };
    const promptCommand = remoteCommand(promptPayload, {
      conversationId: seed.receipt.conversationId,
      generationId: null,
      baseRevision: service.currentRemoteRevision(seed.receipt.conversationId),
      authority,
    });
    await service.applyRemoteCommand(promptCommand, promptPayload, authorization);
    const prompt = pi.prompts.at(-1);
    const execution = prompt?.workspace?.execution;
    if (!prompt || !execution || !pi.toolRequest) throw new Error("Remote tool context missing");

    const toolExecution = pi.toolRequest({
      kind: "pi.tool.request",
      requestId: randomUUID(),
      generationId: prompt.generationId,
      conversationId: prompt.conversationId,
      branchId: prompt.branchId,
      assistantMessageId: prompt.assistantMessageId,
      piToolCallId: "remote-attended-bash-0001",
      toolName: "bash",
      operation: {
        operation: "shell_command_execute",
        idempotencyKey: "remote-attended-bash-effect-0001",
        ...execution,
        shell: "bash",
        command: "printf approved > result.txt",
        timeoutMs: 120_000,
      },
    });
    await vi.waitFor(() => expect(toolFixture.tools.listPermissions("pending")).toHaveLength(1));
    const permission = toolFixture.tools.listPermissions("pending")[0];
    if (!permission) throw new Error("Remote permission missing");
    const decisionPayload = {
      kind: "permission.decide" as const,
      attentionRequestId: permission.id,
      permissionRequestId: permission.id,
      payloadDigest: permission.payloadDigest,
      decision: "once" as const,
      deviceUnlocked: true,
      biometricVerified: true,
      reauthenticatedAt: new Date().toISOString(),
    };
    const wrongController = remoteCommand(decisionPayload, {
      conversationId: prompt.conversationId,
      generationId: prompt.generationId,
      baseRevision: service.currentRemoteRevision(prompt.conversationId),
      authority: { ...authority, controllerDeviceId: randomUUID() },
    });
    expect(
      await service.applyRemoteCommand(wrongController, decisionPayload, authorization),
    ).toMatchObject({ ok: false, errorCode: "REMOTE_PERMISSION_CONTROLLER_MISMATCH" });
    expect(toolFixture.tools.permission(permission.id).status).toBe("pending");

    const correctController = remoteCommand(decisionPayload, {
      conversationId: prompt.conversationId,
      generationId: prompt.generationId,
      baseRevision: service.currentRemoteRevision(prompt.conversationId),
      authority,
    });
    expect(
      await service.applyRemoteCommand(correctController, decisionPayload, authorization),
    ).toMatchObject({ ok: true });
    await expect(toolExecution).resolves.toMatchObject({ sideEffectCommitted: false });
    expect(toolFixture.tools.permission(permission.id).status).toBe("approved");
    expect(grant.id).toBe(execution.activeExecutionGrantId);
    service.close();
  });
});
