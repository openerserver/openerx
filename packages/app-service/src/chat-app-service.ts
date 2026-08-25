import { randomUUID } from "node:crypto";
import type {
  AppServiceAuthorization,
  ChatCommandEnvelope,
  ChatEvent,
  PiHostEventFrame,
  PiPromptFrame,
} from "@openerx/contracts";
import type { ChatRepository, GenerationDraft } from "@openerx/storage";
import type { PiHostClient } from "./pi-host-client";
import type { SyncCoordinator } from "./sync-coordinator";

export class ChatAppService {
  readonly #repository: ChatRepository;
  readonly #piHost: PiHostClient;
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #generationByMessage = new Map<string, string>();
  readonly #messageByGeneration = new Map<string, string>();
  readonly #authorizationByGeneration = new Map<string, AppServiceAuthorization>();
  readonly #sync: SyncCoordinator | null;

  constructor(
    repository: ChatRepository,
    piHost: PiHostClient,
    sync: SyncCoordinator | null = null,
  ) {
    this.#repository = repository;
    this.#piHost = piHost;
    this.#piHost.onEvent((event) => this.#handlePiEvent(event));
    this.#sync = sync;
  }

  initialize(): ChatEvent[] {
    const recovered = this.#repository.recoverInterrupted();
    for (const event of recovered) this.#emit(event);
    return recovered;
  }

  close(): void {
    this.#repository.close();
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
    }
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
      this.#forgetGeneration(frame.generationId);
      void this.#syncIfAuthorized(authorization);
    }
    if (event) this.#emit(event);
  }

  #forgetGeneration(generationId: string): void {
    const messageId = this.#messageByGeneration.get(generationId);
    this.#messageByGeneration.delete(generationId);
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
