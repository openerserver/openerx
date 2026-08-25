import { randomUUID } from "node:crypto";
import type {
  AppServiceAuthorization,
  ChatCommandEnvelope,
  ChatEvent,
  PiActivityEvent,
  PiFileToolRequestFrame,
  PiHostEventFrame,
  PiPromptFrame,
  PiToolRequestFrame,
} from "@openerx/contracts";
import type { FileAppService } from "@openerx/file-service";
import type { ChatRepository, GenerationDraft } from "@openerx/storage";
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
  readonly #authorizationByGeneration = new Map<string, AppServiceAuthorization>();
  readonly #sync: SyncCoordinator | null;
  readonly #files: FileAppService | null;
  readonly #tools: ToolAppService | null;

  constructor(
    repository: ChatRepository,
    piHost: PiHostClient,
    sync: SyncCoordinator | null = null,
    files: FileAppService | null = null,
    tools: ToolAppService | null = null,
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
        return this.#repository.getConversation(request.input.conversationId);
      case "chat.send": {
        const draft = this.#repository.createGeneration(request.input);
        await this.#launch(draft, authorization);
        await this.#syncIfAuthorized(authorization);
        return draft.receipt;
      }
      case "chat.stop": {
        const result = this.#repository.stopMessage(
          request.input.conversationId,
          request.input.assistantMessageId,
        );
        if (result.event) this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        const generationId = this.#generationByMessage.get(request.input.assistantMessageId);
        if (generationId) {
          this.#tools?.cancelGeneration(generationId);
          this.#forgetGeneration(generationId);
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
      case "chat.search":
        return this.#repository.search(request.input.query, request.input.includeArchived ?? false);
      case "chat.activateBranch": {
        const result = this.#repository.activateBranch(
          request.input.conversationId,
          request.input.branchId,
        );
        this.#emit(result.event);
        await this.#syncIfAuthorized(authorization);
        return result.snapshot;
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
      case "tool.workItem.get":
        return this.#requiredToolsRepository().workItemDetail(request.input.workItemId);
      case "tool.permissions.list":
        return this.#requiredToolsRepository().listPermissions(request.input.status);
      case "tool.permission.resolve":
        return this.#requiredTools().resolvePermission(request.input);
      case "tool.scopes.list":
        return this.#requiredToolsRepository().activeScopes();
      case "tool.scope.revoke":
        return this.#requiredToolsRepository().revokeScope(request.input.scopeId);
      case "mcp.servers.list":
        return this.#requiredToolsRepository().listMcpServers();
      case "mcp.server.upsert":
        return this.#requiredTools().upsertMcpServer(request.input.config);
      case "mcp.server.remove":
        return await this.#requiredTools().removeMcpServer(request.input.serverId);
    }
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

  async #launch(draft: GenerationDraft, authorization?: AppServiceAuthorization): Promise<void> {
    for (const event of draft.events) this.#emit(event);
    if (!draft.created) return;
    const generationId = randomUUID();
    const frame: PiPromptFrame = {
      kind: "pi.session.prompt",
      generationId,
      conversationId: draft.receipt.conversationId,
      assistantMessageId: draft.receipt.assistantMessageId,
      history: this.#repository.piHistory(draft.receipt.assistantMessageId),
      files: this.#files?.attachedFiles(draft.receipt.conversationId).map((file) => ({
        personalFileId: file.id,
        displayName: file.displayName,
        format: file.format,
      })),
      ...(authorization
        ? {
            platform: {
              accountId: authorization.accountId,
              accessToken: authorization.accessToken,
              platformBaseUrl: authorization.platformBaseUrl,
              selectedModelRef: this.#repository.selectedModelForMessage(
                draft.receipt.assistantMessageId,
              ),
              approvedFallbackModelRef: null,
              requestDedupeKey: `model-call:${draft.receipt.assistantMessageId}:1`,
            },
          }
        : {}),
    };
    this.#generationByMessage.set(draft.receipt.assistantMessageId, generationId);
    this.#messageByGeneration.set(generationId, draft.receipt.assistantMessageId);
    this.#conversationByGeneration.set(generationId, draft.receipt.conversationId);
    if (authorization) this.#authorizationByGeneration.set(generationId, authorization);
    try {
      await this.#piHost.prompt(frame);
    } catch {
      const event = this.#repository.appendPiEvent(draft.receipt.assistantMessageId, {
        eventId: randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "failed",
        errorCode: "PI_HOST_UNAVAILABLE",
      });
      this.#forgetGeneration(generationId);
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
    if (this.#conversationByGeneration.get(frame.generationId) !== frame.conversationId) {
      throw new Error("GENERATION_NOT_ACTIVE");
    }
    const files = this.#requiredFiles();
    const attached = files.attachedFiles(frame.conversationId);
    const allowedIds = new Set(attached.map(({ id }) => id));
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
    }
  }

  async #handleToolRequest(frame: PiToolRequestFrame): Promise<unknown> {
    if (
      this.#conversationByGeneration.get(frame.generationId) !== frame.conversationId ||
      this.#messageByGeneration.get(frame.generationId) !== frame.assistantMessageId
    ) {
      throw new Error("GENERATION_NOT_ACTIVE");
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
