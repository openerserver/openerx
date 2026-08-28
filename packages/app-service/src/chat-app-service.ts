import { randomUUID } from "node:crypto";
import type {
  AppServiceAuthorization,
  ChatCommandEnvelope,
  ChatEvent,
  ConversationSnapshot,
  PiActivityEvent,
  PiFileToolRequestFrame,
  PiHostEventFrame,
  PiPromptFrame,
  PiToolRequestFrame,
  RemoteApplyCommandResponseFrame,
  RemoteCommand,
  RemoteCommandPayload,
} from "@openerx/contracts";
import { type FileAppService, FileServiceError } from "@openerx/file-service";
import type { SkillPackageService } from "@openerx/skills";
import type { ChatRepository, GenerationDraft, RemoteRepository } from "@openerx/storage";
import type { PiHostClient } from "./pi-host-client";
import type { SyncCoordinator } from "./sync-coordinator";
import type { ToolAppService } from "./tool-app-service";

export class ChatAppService {
  readonly #repository: ChatRepository;
  readonly #piHost: PiHostClient;
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #generationByMessage = new Map<string, string>();
  readonly #messageByGeneration = new Map<string, string>();
  readonly #conversationByGeneration = new Map<string, string>();
  readonly #branchByGeneration = new Map<string, string>();
  readonly #authorizationByGeneration = new Map<string, AppServiceAuthorization>();
  readonly #sync: SyncCoordinator | null;
  readonly #files: FileAppService | null;
  readonly #tools: ToolAppService | null;
  readonly #remote: RemoteRepository | null;
  readonly #skills: SkillPackageService | null;
  readonly #remoteApplications = new Map<string, Promise<RemoteApplyCommandResponseFrame>>();

  constructor(
    repository: ChatRepository,
    piHost: PiHostClient,
    sync: SyncCoordinator | null = null,
    files: FileAppService | null = null,
    tools: ToolAppService | null = null,
    remote: RemoteRepository | null = null,
    skills: SkillPackageService | null = null,
  ) {
    this.#repository = repository;
    this.#piHost = piHost;
    this.#piHost.onEvent((event) => this.#handlePiEvent(event));
    this.#piHost.onFileToolRequest((request) => this.#handleFileToolRequest(request));
    this.#piHost.onToolRequest((request) => this.#handleToolRequest(request));
    this.#piHost.onActivity((event) => this.#handlePiActivity(event));
    this.#sync = sync;
    this.#files = files;
    this.#tools = tools;
    this.#remote = remote;
    this.#skills = skills;
  }

  initialize(): ChatEvent[] {
    const recovered = this.#repository.recoverInterrupted();
    this.#tools?.initialize();
    for (const event of recovered) this.#emit(event);
    return recovered;
  }

  close(): void {
    this.#repository.close();
    this.#files?.close();
    void this.#tools?.close();
    this.#remote?.close();
    this.#skills?.close();
  }

  onEvent(listener: (event: ChatEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async handle(
    request: ChatCommandEnvelope,
    authorization?: AppServiceAuthorization,
  ): Promise<unknown> {
    switch (request.command) {
      case "sync.now":
        if (!authorization || !this.#sync) throw new Error("AUTHENTICATION_REQUIRED");
        return await this.#sync.syncOnce(authorization);
      case "sync.conflicts":
        return this.#repository.syncConflicts();
      case "sync.resolve":
        if (!authorization || !this.#sync) throw new Error("AUTHENTICATION_REQUIRED");
        return await this.#sync.resolveConflict(
          request.input.conflictId,
          request.input.resolution,
          authorization,
        );
      case "cache.clear": {
        this.#repository.clearLocalCache();
        return { clearedAt: new Date().toISOString() };
      }
      case "chat.list":
        return this.#repository.listConversations(request.input.includeArchived ?? false);
      case "chat.get":
        return this.#withAttachments(
          this.#repository.getConversation(request.input.conversationId),
        );
      case "chat.send": {
        const mounts = this.#skills?.mounts("default", request.input.skillInstallationId) ?? [];
        const draft = this.#repository.createGeneration(request.input);
        await this.#launch(
          draft,
          authorization,
          mounts,
          request.input.skillInstallationId,
          request.input.personalFileIds,
        );
        await this.#syncIfAuthorized(authorization);
        return draft.receipt;
      }
      case "chat.stop": {
        const result = this.#repository.requestStopMessage(
          request.input.conversationId,
          request.input.assistantMessageId,
        );
        if (result.event) this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        const generationId = this.#generationByMessage.get(request.input.assistantMessageId);
        if (generationId) {
          this.#tools?.requestCancellation(generationId);
          await this.#piHost.abort(generationId);
        }
        return result.message;
      }
      case "chat.regenerate": {
        const draft = this.#repository.regenerateGeneration(request.input);
        await this.#launch(draft, authorization);
        await this.#syncIfAuthorized(authorization);
        return draft.receipt;
      }
      case "chat.edit": {
        const draft = this.#repository.editGeneration(request.input);
        await this.#launch(draft, authorization);
        await this.#syncIfAuthorized(authorization);
        return draft.receipt;
      }
      case "chat.rename": {
        const result = this.#repository.renameConversation(
          request.input.conversationId,
          request.input.title,
        );
        this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        return result.conversation;
      }
      case "chat.archive": {
        const result = this.#repository.setConversationArchived(
          request.input.conversationId,
          request.input.archived,
        );
        this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        return result.conversation;
      }
      case "chat.delete": {
        const result = this.#repository.deleteConversation(request.input.conversationId);
        if (result.event) this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        return { conversationId: result.conversationId, deletedAt: result.deletedAt };
      }
      case "chat.selectModel": {
        const result = this.#repository.selectConversationModel(
          request.input.conversationId,
          request.input.modelRef,
        );
        this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        return result.conversation;
      }
      case "chat.selectThinkingLevel": {
        const result = this.#repository.selectConversationThinkingLevel(
          request.input.conversationId,
          request.input.thinkingLevel,
        );
        this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        return result.conversation;
      }
      case "chat.search":
        return this.#repository.search(request.input.query, request.input.includeArchived ?? false);
      case "chat.activateBranch": {
        const result = this.#repository.activateBranch(
          request.input.conversationId,
          request.input.branchId,
        );
        this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        return this.#withAttachments(result.snapshot);
      }
      case "chat.events":
        return this.#repository.listEvents(
          request.input.conversationId,
          request.input.afterSequence,
        );
      case "file.import":
        return await this.#requiredFiles().importPaths(
          request.input.localPaths,
          request.input.conversationId,
        );
      case "file.list":
        return this.#requiredFiles().listFiles(request.input.conversationId);
      case "file.search":
        return this.#requiredFiles().search(request.input.query, request.input.fileIds);
      case "file.preview":
        return this.#requiredFiles().previewFile(request.input.personalFileId);
      case "file.scope.revoke":
        return this.#requiredFiles().revokeScope(request.input.scopeId);
      case "file.attach":
        return this.#requiredFiles().attach(
          request.input.conversationId,
          request.input.personalFileId,
        );
      case "artifact.create":
        return this.#requiredFiles().createArtifact(request.input);
      case "artifact.newVersion":
        return this.#requiredFiles().addArtifactVersion(request.input);
      case "artifact.list":
        return this.#requiredFiles().listArtifacts();
      case "artifact.get":
        return this.#requiredFiles().artifact(request.input.artifactId);
      case "artifact.preview":
        return this.#requiredFiles().previewArtifact(request.input.artifactId);
      case "artifact.export":
        return this.#requiredFiles().exportArtifact(
          request.input.artifactId,
          request.input.destinationPath,
        );
      case "tool.workItems.list":
        return this.#requiredToolsRepository().listWorkItems(
          request.input.conversationId,
          request.input.limit,
        );
      case "tool.runtime.readiness":
        return await this.#requiredTools().listRuntimeReadiness(request.input);
      case "tool.workItem.get":
        return this.#requiredToolsRepository().workItemDetail(
          request.input.workItemId,
          request.input.runId,
        );
      case "tool.permissions.list":
        return this.#requiredToolsRepository().listPermissions(request.input.status);
      case "tool.permission.resolve":
        return this.#requiredTools().resolvePermission(request.input);
      case "tool.scopes.list":
        return this.#requiredToolsRepository().activeScopes();
      case "tool.scope.revoke":
        return this.#requiredToolsRepository().revokeScope(request.input.scopeId);
      case "workspace.grant":
        return this.#requiredTools().grantWorkspace(request.input);
      case "workspace.list":
        return this.#requiredTools().listWorkspaces(request.input.conversationId);
      case "workspace.revoke":
        return this.#requiredTools().revokeWorkspace(request.input.workspaceGrantId);
      case "mcp.servers.list":
        return this.#requiredToolsRepository().listMcpServers();
      case "mcp.servers.authorization":
        return await this.#requiredTools().listMcpServerAuthorizationStates();
      case "mcp.server.authorize":
        return await this.#requiredTools().authorizeMcpServer(request.input.serverId);
      case "mcp.server.upsert":
        return this.#requiredTools().upsertMcpServer(request.input.config);
      case "mcp.server.remove":
        return await this.#requiredTools().removeMcpServer(request.input.serverId);
      case "skill.list":
        return this.#requiredSkills().list(request.input);
      case "skill.get":
        return this.#requiredSkills().get(request.input.installationId);
      case "skill.install": {
        const result = this.#requiredSkills().install(request.input);
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.update": {
        const result = this.#requiredSkills().update(request.input);
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.enable": {
        const result = this.#requiredSkills().setEnabled(
          request.input.installationId,
          request.input.enabled,
        );
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.autoInvoke": {
        const result = this.#requiredSkills().setAutoInvoke(
          request.input.installationId,
          request.input.autoInvoke,
        );
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.permissions.approve": {
        const result = this.#requiredSkills().approvePermissions(
          request.input.installationId,
          request.input.permissionDigest,
        );
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.permissions.reset": {
        const result = this.#requiredSkills().resetPermissions(request.input.installationId);
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.rollback": {
        const result = this.#requiredSkills().rollback(
          request.input.installationId,
          request.input.version,
        );
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.uninstall": {
        const result = this.#requiredSkills().uninstall(request.input.installationId);
        await this.#syncIfAuthorized(authorization);
        return result;
      }
      case "skill.invocations.list":
        return this.#requiredSkills().listInvocations(request.input);
    }
  }

  currentRemoteRevision(conversationId: string | null): number {
    return this.#repository.conversationRevision(conversationId);
  }

  async applyRemoteCommand(
    command: RemoteCommand,
    payload: RemoteCommandPayload,
    authorization: AppServiceAuthorization,
  ): Promise<RemoteApplyCommandResponseFrame> {
    const running = this.#remoteApplications.get(command.commandId);
    if (running) return await running;
    const application = this.#applyRemoteCommand(command, payload, authorization).finally(() => {
      this.#remoteApplications.delete(command.commandId);
    });
    this.#remoteApplications.set(command.commandId, application);
    return await application;
  }

  #requiredFiles(): FileAppService {
    if (!this.#files) throw new Error("FILE_SERVICE_UNAVAILABLE");
    return this.#files;
  }

  #requiredTools(): ToolAppService {
    if (!this.#tools) throw new Error("TOOL_SERVICE_UNAVAILABLE");
    return this.#tools;
  }

  #requiredToolsRepository() {
    return this.#requiredTools().repository();
  }

  #requiredSkills(): SkillPackageService {
    if (!this.#skills) throw new Error("SKILL_SERVICE_UNAVAILABLE");
    return this.#skills;
  }

  async #applyRemoteCommand(
    command: RemoteCommand,
    payload: RemoteCommandPayload,
    authorization: AppServiceAuthorization,
  ): Promise<RemoteApplyCommandResponseFrame> {
    const remote = this.#remote;
    if (!remote) throw new Error("REMOTE_SERVICE_UNAVAILABLE");
    if (authorization.accountId !== command.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
    const existing = remote.begin(command, payload);
    if (existing.result) return existing.result;
    let response: RemoteApplyCommandResponseFrame;
    try {
      const result = await this.#executeRemoteCommand(command, payload, authorization);
      response = {
        kind: "remote.command.result",
        requestId: command.commandId,
        ok: true,
        appliedRevision: this.#repository.conversationRevision(command.conversationId),
        ...(result === undefined ? {} : { result }),
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "REMOTE_COMMAND_APPLY_FAILED";
      const candidate = message.split(":", 1)[0] ?? "REMOTE_COMMAND_APPLY_FAILED";
      response = {
        kind: "remote.command.result",
        requestId: command.commandId,
        ok: false,
        errorCode: /^[A-Z][A-Z0-9_]*$/u.test(candidate) ? candidate : "REMOTE_COMMAND_APPLY_FAILED",
        currentRevision: this.#safeConversationRevision(command.conversationId),
      };
    }
    return remote.complete(command.commandId, response);
  }

  async #executeRemoteCommand(
    command: RemoteCommand,
    payload: RemoteCommandPayload,
    authorization: AppServiceAuthorization,
  ): Promise<unknown> {
    if (this.#safeConversationRevision(command.conversationId) !== command.baseRevision) {
      throw new Error("REMOTE_BASE_REVISION_CONFLICT");
    }
    switch (payload.kind) {
      case "task.start":
      case "session.prompt":
        return await this.handle(
          {
            command: "chat.send",
            input: {
              conversationId: command.conversationId,
              text: payload.text,
              idempotencyKey: command.commandId,
            },
          },
          authorization,
        );
      case "session.steer":
        await this.#remotePiControl(command, "steer", payload.text);
        return { action: "steer" };
      case "session.follow_up":
        await this.#remotePiControl(command, "follow_up", payload.text);
        return { action: "follow_up" };
      case "session.abort": {
        const generationId = this.#requireRemoteGeneration(command);
        const messageId = this.#messageByGeneration.get(generationId);
        const conversationId = this.#conversationByGeneration.get(generationId);
        if (messageId !== payload.assistantMessageId || conversationId !== command.conversationId) {
          throw new Error("REMOTE_GENERATION_SCOPE_VIOLATION");
        }
        const stopping = this.#repository.requestStopMessage(conversationId, messageId);
        if (stopping.event) this.#emit(stopping.event);
        this.#tools?.requestCancellation(generationId);
        await this.#piHost.control({
          kind: "pi.session.control",
          requestId: command.commandId,
          generationId,
          action: "abort",
        });
        await this.#syncIfAuthorized(authorization);
        return stopping.message;
      }
      case "permission.decide": {
        if (payload.attentionRequestId !== payload.permissionRequestId) {
          throw new Error("REMOTE_ATTENTION_SCOPE_VIOLATION");
        }
        const permission = this.#requiredToolsRepository().permission(payload.permissionRequestId);
        const workItem = this.#requiredToolsRepository().workItem(permission.workItemId);
        if (workItem.conversationId !== command.conversationId) {
          throw new Error("REMOTE_PERMISSION_SCOPE_VIOLATION");
        }
        const risk = Number(permission.risk.slice(1));
        if (risk >= 3 && !payload.deviceUnlocked) throw new Error("REMOTE_DEVICE_UNLOCK_REQUIRED");
        const reauthenticatedAt = Date.parse(payload.reauthenticatedAt);
        const age = Date.now() - reauthenticatedAt;
        if (reauthenticatedAt > Date.now() + 15_000 || age > 60_000) {
          throw new Error("REMOTE_REAUTHENTICATION_EXPIRED");
        }
        if (permission.risk === "L5" && !payload.biometricVerified) {
          throw new Error("REMOTE_BIOMETRIC_REQUIRED");
        }
        if (permission.risk === "L5" && payload.decision === "session") {
          throw new Error("REMOTE_PERMISSION_DECISION_NOT_ALLOWED");
        }
        return this.#requiredTools().resolvePermission({
          permissionRequestId: payload.permissionRequestId,
          decision: payload.decision,
          payloadDigest: payload.payloadDigest,
          scopeConversationId: payload.decision === "session" ? command.conversationId : null,
        });
      }
      case "attention.respond":
        if (payload.delivery === "prompt") {
          return await this.handle(
            {
              command: "chat.send",
              input: {
                conversationId: command.conversationId,
                text: payload.response,
                idempotencyKey: command.commandId,
              },
            },
            authorization,
          );
        }
        await this.#remotePiControl(
          command,
          payload.delivery === "steer" ? "steer" : "follow_up",
          payload.response,
        );
        return { action: payload.delivery, attentionRequestId: payload.attentionRequestId };
    }
  }

  async #remotePiControl(
    command: RemoteCommand,
    action: "steer" | "follow_up",
    text: string,
  ): Promise<void> {
    const generationId = this.#requireRemoteGeneration(command);
    if (this.#conversationByGeneration.get(generationId) !== command.conversationId) {
      throw new Error("REMOTE_GENERATION_SCOPE_VIOLATION");
    }
    await this.#piHost.control({
      kind: "pi.session.control",
      requestId: command.commandId,
      generationId,
      action,
      text,
    });
  }

  #requireRemoteGeneration(command: RemoteCommand): string {
    const generationId =
      command.generationId ??
      [...this.#conversationByGeneration.entries()].find(
        ([, conversationId]) => conversationId === command.conversationId,
      )?.[0];
    if (!generationId) throw new Error("REMOTE_GENERATION_NOT_ACTIVE");
    if (!this.#messageByGeneration.has(generationId)) {
      throw new Error("REMOTE_GENERATION_NOT_ACTIVE");
    }
    return generationId;
  }

  #safeConversationRevision(conversationId: string | null): number {
    try {
      return this.#repository.conversationRevision(conversationId);
    } catch {
      return 0;
    }
  }

  #withAttachments(snapshot: ConversationSnapshot): ConversationSnapshot {
    return {
      ...snapshot,
      attachments: this.#files?.attachments(snapshot.conversation.id) ?? [],
    };
  }

  async #launch(
    draft: GenerationDraft,
    authorization?: AppServiceAuthorization,
    skillMounts = this.#skills?.mounts("default") ?? [],
    selectedSkillInstallationId?: string,
    personalFileIds: string[] = [],
  ): Promise<void> {
    for (const event of draft.events) this.#emit(event);
    if (!draft.created) return;
    const generationId = randomUUID();
    const history = this.#repository.piHistory(draft.receipt.assistantMessageId);
    if (selectedSkillInstallationId) {
      const selected = skillMounts.find(
        ({ installationId }) => installationId === selectedSkillInstallationId,
      );
      if (!selected) throw new Error("SKILL_NOT_ENABLED");
      const prompt = history.at(-1);
      if (prompt?.role !== "user") throw new Error("SKILL_PROMPT_NOT_FOUND");
      history[history.length - 1] = {
        ...prompt,
        text: `/skill:${selected.name} ${prompt.text}`,
      };
      this.#skills?.beginInvocation({
        installationId: selected.installationId,
        generationId,
        conversationId: draft.receipt.conversationId,
        trigger: "explicit",
        reason: "Selected from the composer",
        loaded: true,
      });
    }
    this.#generationByMessage.set(draft.receipt.assistantMessageId, generationId);
    this.#messageByGeneration.set(generationId, draft.receipt.assistantMessageId);
    this.#conversationByGeneration.set(generationId, draft.receipt.conversationId);
    this.#branchByGeneration.set(generationId, draft.receipt.branchId);
    if (authorization) this.#authorizationByGeneration.set(generationId, authorization);
    try {
      this.#tools?.startGeneration({
        generationId,
        conversationId: draft.receipt.conversationId,
        branchId: draft.receipt.branchId,
        assistantMessageId: draft.receipt.assistantMessageId,
        selectedModelRef: draft.selectedModelRef,
        thinkingLevel: draft.thinkingLevel,
      });
      if (personalFileIds.length > 0) {
        const userMessageId = draft.receipt.userMessageId;
        if (!userMessageId) throw new Error("CHAT_USER_MESSAGE_REQUIRED");
        const files = this.#requiredFiles();
        for (const personalFileId of personalFileIds) {
          files.attach(draft.receipt.conversationId, personalFileId, userMessageId);
        }
      }
      const branchMessageIds = this.#repository.branchMessageIds(draft.receipt.assistantMessageId);
      const attachedFiles = this.#files?.attachedFilesForMessages(
        draft.receipt.conversationId,
        branchMessageIds,
      );
      const preparedTools = this.#tools
        ? await this.#tools.prepareGeneration({
            conversationId: draft.receipt.conversationId,
            prompt: history.at(-1)?.text ?? "",
            hasFiles: (attachedFiles?.length ?? 0) > 0,
            skillInstallationIds: skillMounts.map(({ installationId }) => installationId),
            authenticated: Boolean(authorization),
          })
        : undefined;
      if (preparedTools) {
        this.#tools?.freezeGenerationConfiguration(generationId, {
          initialToolNames: preparedTools.initialToolNames,
          availableToolNames: preparedTools.availableToolNames,
          skillInstallationIds: skillMounts.map(({ installationId }) => installationId),
          instructionSources: preparedTools.instructionSources,
          brokeredBashExecution: preparedTools.brokeredBashExecution,
        });
      }
      const currentUserMessageId = draft.receipt.userMessageId ?? history.at(-1)?.messageId;
      for (let index = 0; index < history.length - 1; index += 1) {
        const message = history[index];
        if (message?.role !== "user" || !message.messageId) continue;
        const messageImages = this.#files?.modelImagesForMessage(message.messageId) ?? [];
        if (messageImages.length > 0) history[index] = { ...message, images: messageImages };
      }
      const images = currentUserMessageId
        ? this.#files?.modelImagesForMessage(currentUserMessageId)
        : undefined;
      const frame: PiPromptFrame = {
        kind: "pi.session.prompt",
        generationId,
        conversationId: draft.receipt.conversationId,
        branchId: draft.receipt.branchId,
        assistantMessageId: draft.receipt.assistantMessageId,
        thinkingLevel: draft.thinkingLevel,
        history,
        ...(skillMounts.length > 0 ? { skills: skillMounts } : {}),
        ...(selectedSkillInstallationId ? { selectedSkillInstallationId } : {}),
        ...(preparedTools
          ? {
              workspace: {
                grants: preparedTools.workspaceGrants.map((grant) => ({
                  id: grant.id,
                  displayName: grant.displayName,
                  access: grant.access,
                  allowNetwork: grant.allowNetwork,
                  expiresAt: grant.expiresAt,
                })),
                instructionSources: preparedTools.instructionSources,
                ...(preparedTools.brokeredBashExecution
                  ? { execution: preparedTools.brokeredBashExecution }
                  : {}),
              },
              mcpTools: preparedTools.mcpTools,
              initialToolNames: preparedTools.initialToolNames,
              availableToolNames: preparedTools.availableToolNames,
            }
          : {}),
        files: attachedFiles?.map((file) => ({
          personalFileId: file.id,
          displayName: file.displayName,
          format: file.format,
        })),
        ...(images && images.length > 0 ? { images } : {}),
        ...(authorization
          ? {
              platform: {
                accountId: authorization.accountId,
                accessToken: authorization.accessToken,
                platformBaseUrl: authorization.platformBaseUrl,
                selectedModelRef: draft.selectedModelRef,
                approvedFallbackModelRef: null,
                requestDedupeKey: `model-call:${draft.receipt.assistantMessageId}:1`,
              },
            }
          : {}),
      };
      await this.#piHost.prompt(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const launchErrorCode =
        error instanceof FileServiceError
          ? error.code
          : /^FILE_[A-Z0-9_]+$/u.test(message)
            ? message
            : "PI_HOST_UNAVAILABLE";
      const event = this.#repository.appendPiEvent(draft.receipt.assistantMessageId, {
        eventId: randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "failed",
        errorCode: launchErrorCode,
      });
      this.#tools?.completeGeneration(generationId, "failed", launchErrorCode);
      this.#forgetGeneration(generationId);
      this.#skills?.completeGeneration(generationId, "failed", launchErrorCode);
      if (event) this.#emit(event);
    }
  }

  #handlePiEvent(frame: PiHostEventFrame): void {
    const assistantMessageId = this.#messageByGeneration.get(frame.generationId);
    if (!assistantMessageId) return;
    const event = this.#repository.appendPiEvent(assistantMessageId, {
      eventId: frame.eventId,
      sequence: frame.sequence,
      occurredAt: frame.occurredAt,
      type: frame.type,
      ...(frame.delta === undefined ? {} : { delta: frame.delta }),
      ...(frame.errorCode === undefined ? {} : { errorCode: frame.errorCode }),
    });
    const authorization = this.#authorizationByGeneration.get(frame.generationId);
    if (frame.type !== "delta") {
      this.#tools?.completeGeneration(
        frame.generationId,
        frame.type === "completed"
          ? "completed"
          : frame.type === "stopped"
            ? "interrupted"
            : "failed",
        frame.errorCode,
        frame.usageRecords ?? [],
      );
      this.#skills?.completeGeneration(
        frame.generationId,
        frame.type === "completed"
          ? "completed"
          : frame.type === "stopped"
            ? "cancelled"
            : "failed",
        frame.errorCode,
      );
      this.#forgetGeneration(frame.generationId);
      void this.#syncIfAuthorized(authorization);
    }
    if (event) this.#emit(event);
  }

  async #handleFileToolRequest(frame: PiFileToolRequestFrame): Promise<unknown> {
    if (
      this.#conversationByGeneration.get(frame.generationId) !== frame.conversationId ||
      this.#branchByGeneration.get(frame.generationId) !== frame.branchId
    ) {
      throw new Error("GENERATION_NOT_ACTIVE");
    }
    const files = this.#requiredFiles();
    const assistantMessageId = this.#messageByGeneration.get(frame.generationId);
    if (!assistantMessageId || assistantMessageId !== frame.assistantMessageId) {
      throw new Error("GENERATION_NOT_ACTIVE");
    }
    const attached = files.attachedFilesForMessages(
      frame.conversationId,
      this.#repository.branchMessageIds(assistantMessageId),
    );
    const allowedIds = new Set(attached.map(({ id }) => id));
    return await this.#requiredTools().handleFileRequest(frame, () => {
      switch (frame.request.operation) {
        case "list":
          return attached;
        case "search":
          return files.search(frame.request.input.query, [...allowedIds]);
        case "read":
          if (!allowedIds.has(frame.request.input.personalFileId)) {
            throw new Error("FILE_NOT_ATTACHED");
          }
          return files.readParsedFile(frame.request.input.personalFileId);
        case "artifact.write": {
          const input = frame.request.input;
          const bytesBase64 = Buffer.from(input.content, "utf8").toString("base64");
          return input.artifactId
            ? files.addArtifactVersion({
                artifactId: input.artifactId,
                format: input.format,
                mediaType: input.mediaType,
                bytesBase64,
              })
            : files.createArtifact({
                displayName: input.displayName,
                format: input.format,
                mediaType: input.mediaType,
                bytesBase64,
              });
        }
        case "artifact.office.write": {
          const artifact = files.writeOfficeArtifact(frame.request.input);
          return { artifact, preview: files.previewArtifact(artifact.id) };
        }
      }
    });
  }

  async #handleToolRequest(frame: PiToolRequestFrame): Promise<unknown> {
    if (
      this.#conversationByGeneration.get(frame.generationId) !== frame.conversationId ||
      this.#branchByGeneration.get(frame.generationId) !== frame.branchId ||
      this.#messageByGeneration.get(frame.generationId) !== frame.assistantMessageId
    ) {
      throw new Error("GENERATION_NOT_ACTIVE");
    }
    if (
      frame.operation.operation === "skill_read" ||
      frame.operation.operation === "skill_script_execute"
    ) {
      this.#requiredSkills().beginInvocation({
        installationId: frame.operation.installationId,
        generationId: frame.generationId,
        conversationId: frame.conversationId,
        trigger: "automatic",
        reason:
          frame.operation.operation === "skill_read"
            ? `Pi loaded ${frame.operation.relativePath}`
            : `Pi executed ${frame.operation.relativePath}`,
        loaded: true,
      });
    }
    return await this.#requiredTools().handleRequest(
      frame,
      this.#authorizationByGeneration.get(frame.generationId),
    );
  }

  #handlePiActivity(frame: PiActivityEvent): void {
    this.#tools?.handleActivity(frame);
  }

  emitExternal(event: ChatEvent): void {
    this.#emit(event);
  }

  #forgetGeneration(generationId: string): void {
    const messageId = this.#messageByGeneration.get(generationId);
    this.#messageByGeneration.delete(generationId);
    this.#conversationByGeneration.delete(generationId);
    this.#branchByGeneration.delete(generationId);
    this.#authorizationByGeneration.delete(generationId);
    if (messageId) this.#generationByMessage.delete(messageId);
  }

  async #syncIfAuthorized(authorization: AppServiceAuthorization | undefined): Promise<void> {
    if (!authorization || !this.#sync) return;
    try {
      await this.#sync.syncOnce(authorization);
    } catch {
      // Local data and its transactional outbox remain valid while offline. The explicit
      // sync.now command still reports transport errors to the caller.
    }
  }

  #emit(event: ChatEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
