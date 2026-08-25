import { randomUUID } from "node:crypto";
import type {
  ChatCommandEnvelope,
  ChatEvent,
  RuntimeEventFrame,
  RuntimeStartFrame,
} from "@openerx/contracts";
import type { ChatRepository, GenerationDraft } from "@openerx/storage";
import type { RuntimeClient } from "./runtime-client";

export class ChatAppService {
  readonly #repository: ChatRepository;
  readonly #runtime: RuntimeClient;
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #generationByMessage = new Map<string, string>();
  readonly #messageByGeneration = new Map<string, string>();

  constructor(repository: ChatRepository, runtime: RuntimeClient) {
    this.#repository = repository;
    this.#runtime = runtime;
    this.#runtime.onEvent((event) => this.#handleRuntimeEvent(event));
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

  async handle(request: ChatCommandEnvelope): Promise<unknown> {
    switch (request.command) {
      case "chat.list":
        return this.#repository.listConversations(request.input.includeArchived ?? false);
      case "chat.get":
        return this.#repository.getConversation(request.input.conversationId);
      case "chat.send": {
        const draft = this.#repository.createGeneration(request.input);
        await this.#launch(draft);
        return draft.receipt;
      }
      case "chat.stop": {
        const result = this.#repository.stopMessage(
          request.input.conversationId,
          request.input.assistantMessageId,
        );
        if (result.event) this.#emit(result.event);
        const generationId = this.#generationByMessage.get(request.input.assistantMessageId);
        if (generationId) {
          this.#forgetGeneration(generationId);
          await this.#runtime.stop(generationId);
        }
        return result.message;
      }
      case "chat.regenerate": {
        const draft = this.#repository.regenerateGeneration(request.input);
        await this.#launch(draft);
        return draft.receipt;
      }
      case "chat.edit": {
        const draft = this.#repository.editGeneration(request.input);
        await this.#launch(draft);
        return draft.receipt;
      }
      case "chat.rename": {
        const result = this.#repository.renameConversation(
          request.input.conversationId,
          request.input.title,
        );
        this.#emit(result.event);
        return result.conversation;
      }
      case "chat.archive": {
        const result = this.#repository.setConversationArchived(
          request.input.conversationId,
          request.input.archived,
        );
        this.#emit(result.event);
        return result.conversation;
      }
      case "chat.delete": {
        const result = this.#repository.deleteConversation(request.input.conversationId);
        if (result.event) this.#emit(result.event);
        return { conversationId: result.conversationId, deletedAt: result.deletedAt };
      }
      case "chat.search":
        return this.#repository.search(request.input.query, request.input.includeArchived ?? false);
      case "chat.activateBranch": {
        const result = this.#repository.activateBranch(
          request.input.conversationId,
          request.input.branchId,
        );
        this.#emit(result.event);
        return result.snapshot;
      }
      case "chat.events":
        return this.#repository.listEvents(
          request.input.conversationId,
          request.input.afterSequence,
        );
    }
  }

  async #launch(draft: GenerationDraft): Promise<void> {
    for (const event of draft.events) this.#emit(event);
    if (!draft.created) return;
    const generationId = randomUUID();
    const frame: RuntimeStartFrame = {
      kind: "runtime.start",
      generationId,
      conversationId: draft.receipt.conversationId,
      assistantMessageId: draft.receipt.assistantMessageId,
      history: this.#repository.runtimeHistory(draft.receipt.assistantMessageId),
    };
    this.#generationByMessage.set(draft.receipt.assistantMessageId, generationId);
    this.#messageByGeneration.set(generationId, draft.receipt.assistantMessageId);
    try {
      await this.#runtime.start(frame);
    } catch {
      const event = this.#repository.appendRuntimeEvent(draft.receipt.assistantMessageId, {
        eventId: randomUUID(),
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "failed",
        errorCode: "RUNTIME_UNAVAILABLE",
      });
      this.#forgetGeneration(generationId);
      if (event) this.#emit(event);
    }
  }

  #handleRuntimeEvent(frame: RuntimeEventFrame): void {
    const assistantMessageId = this.#messageByGeneration.get(frame.generationId);
    if (!assistantMessageId) return;
    const event = this.#repository.appendRuntimeEvent(assistantMessageId, {
      eventId: frame.eventId,
      sequence: frame.sequence,
      occurredAt: frame.occurredAt,
      type: frame.type,
      ...(frame.delta === undefined ? {} : { delta: frame.delta }),
      ...(frame.errorCode === undefined ? {} : { errorCode: frame.errorCode }),
    });
    if (frame.type !== "delta") this.#forgetGeneration(frame.generationId);
    if (event) this.#emit(event);
  }

  #forgetGeneration(generationId: string): void {
    const messageId = this.#messageByGeneration.get(generationId);
    this.#messageByGeneration.delete(generationId);
    if (messageId) this.#generationByMessage.delete(messageId);
  }

  #emit(event: ChatEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
