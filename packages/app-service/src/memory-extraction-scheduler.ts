import { randomUUID } from "node:crypto";
import type {
  AppServiceAuthorization,
  AutomaticMemoryExtractionOutput,
  ChatEvent,
  ConversationSnapshot,
  MemoryEntry,
  MemoryExtractionJob,
  PiMemoryExtractFrame,
} from "@openerx/contracts";
import { isByokModelRef } from "@openerx/contracts";
import type { ChatRepository, MemoryRepository } from "@openerx/storage";
import type { PiHostClient } from "./pi-host-client";

export interface MemoryByokConfiguration {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: {
    imageInput: boolean;
    functionCalling: boolean;
    reasoning: boolean;
  };
}

export interface MemoryExecutionContext {
  authorization?: AppServiceAuthorization;
  byok?: MemoryByokConfiguration;
}

export interface MemoryExtractionRequest {
  job: MemoryExtractionJob;
  snapshot: ConversationSnapshot;
  messages: Array<{ messageId: string; text: string }>;
  existingMemories: Array<{
    id: string;
    kind: MemoryEntry["kind"];
    content: string;
    conflictKey: string | null;
  }>;
}

export interface MemoryExtractor {
  extract(request: MemoryExtractionRequest): Promise<AutomaticMemoryExtractionOutput>;
}

export class PiMemoryExtractor implements MemoryExtractor {
  readonly #piHost: PiHostClient;
  readonly #executionContext: (
    modelRef?: string,
  ) => MemoryExecutionContext | Promise<MemoryExecutionContext>;

  constructor(
    piHost: PiHostClient,
    executionContext: (
      modelRef?: string,
    ) => MemoryExecutionContext | Promise<MemoryExecutionContext>,
  ) {
    this.#piHost = piHost;
    this.#executionContext = executionContext;
  }

  async extract(request: MemoryExtractionRequest): Promise<AutomaticMemoryExtractionOutput> {
    let context: MemoryExecutionContext;
    try {
      context = await this.#executionContext(request.snapshot.conversation.selectedModelRef);
    } catch {
      throw new Error("MEMORY_EXECUTION_CONTEXT_UNAVAILABLE");
    }
    const usesByok = isByokModelRef(request.snapshot.conversation.selectedModelRef);
    const authorization: AppServiceAuthorization | undefined = usesByok
      ? undefined
      : context.authorization;
    const byok: MemoryByokConfiguration | undefined = usesByok ? context.byok : undefined;
    if ((!usesByok && !authorization) || (usesByok && !byok)) {
      throw new Error("MEMORY_EXECUTION_CONTEXT_UNAVAILABLE");
    }
    const frame: PiMemoryExtractFrame = {
      kind: "pi.memory.extract",
      requestId: randomUUID(),
      jobId: request.job.id,
      conversationId: request.job.conversationId,
      sourceAssistantMessageId: request.job.sourceAssistantMessageId,
      selectedModelRef: request.snapshot.conversation.selectedModelRef,
      thinkingLevel: "medium",
      messages: request.messages,
      existingMemories: request.existingMemories,
      ...(authorization
        ? {
            platform: {
              accountId: authorization.accountId,
              accessToken: authorization.accessToken,
              platformBaseUrl: authorization.platformBaseUrl,
              selectedModelRef: request.snapshot.conversation.selectedModelRef,
              approvedFallbackModelRef: null,
              requestDedupeKey: `memory-extract:${request.job.id}`,
            },
          }
        : {}),
      ...(byok ? { byok } : {}),
    };
    if (!this.#piHost.extractMemories) throw new Error("MEMORY_EXTRACTOR_UNAVAILABLE");
    const result = await this.#piHost.extractMemories(frame);
    if (!result.ok) throw new Error(result.errorCode);
    return result.output;
  }
}

export interface MemoryExtractionSchedulerOptions {
  chatRepository: ChatRepository;
  memoryRepository: MemoryRepository;
  extractor: MemoryExtractor;
  intervalMs?: number;
  maxClaimsPerTick?: number;
  onMemoriesCreated?: (memories: MemoryEntry[], job: MemoryExtractionJob) => void;
  onError?: (error: unknown, job?: MemoryExtractionJob) => void;
}

const rejectedCandidateCodes = new Set([
  "MEMORY_SENSITIVE_CONTENT_REJECTED",
  "MEMORY_CANDIDATE_LOW_CONFIDENCE",
  "MEMORY_CANDIDATE_SOURCE_INVALID",
  "MEMORY_CANDIDATE_SOURCE_INELIGIBLE",
  "MEMORY_CANDIDATE_CONFLICTS_EXPLICIT",
  "MEMORY_CANDIDATE_RELATION_INVALID",
  "MEMORY_CANDIDATE_RELATION_LOW_CONFIDENCE",
]);

export class MemoryExtractionScheduler {
  readonly #chatRepository: ChatRepository;
  readonly #memoryRepository: MemoryRepository;
  readonly #extractor: MemoryExtractor;
  readonly #intervalMs: number;
  readonly #maxClaimsPerTick: number;
  readonly #onMemoriesCreated: NonNullable<MemoryExtractionSchedulerOptions["onMemoriesCreated"]>;
  readonly #onError: NonNullable<MemoryExtractionSchedulerOptions["onError"]>;
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking = false;

  constructor(options: MemoryExtractionSchedulerOptions) {
    this.#chatRepository = options.chatRepository;
    this.#memoryRepository = options.memoryRepository;
    this.#extractor = options.extractor;
    this.#intervalMs = Math.max(1_000, options.intervalMs ?? 30_000);
    this.#maxClaimsPerTick = Math.max(1, options.maxClaimsPerTick ?? 4);
    this.#onMemoriesCreated = options.onMemoriesCreated ?? (() => undefined);
    this.#onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (this.#timer) return;
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  handleChatEvent(event: ChatEvent): MemoryExtractionJob | null {
    if (event.type !== "message.completed" || !event.conversationId || !event.messageId) {
      return null;
    }
    const conversationId = event.conversationId;
    const messageId = event.messageId;
    try {
      const snapshot = this.#chatRepository.getConversation(conversationId);
      const message = snapshot.messages.find(({ id }) => id === messageId);
      if (message?.role !== "assistant") return null;
      return this.#memoryRepository.scheduleExtraction(conversationId, messageId);
    } catch (error) {
      const code = this.#errorCode(error);
      if (code !== "MEMORY_GENERATION_DISABLED") this.#onError(error);
      return null;
    }
  }

  async tick(): Promise<MemoryExtractionJob[]> {
    if (this.#ticking) return [];
    this.#ticking = true;
    const processed: MemoryExtractionJob[] = [];
    try {
      for (let index = 0; index < this.#maxClaimsPerTick; index += 1) {
        const job = this.#memoryRepository.claimDueExtractionJob();
        if (!job) break;
        processed.push(await this.#process(job));
      }
      return processed;
    } finally {
      this.#ticking = false;
    }
  }

  async #process(job: MemoryExtractionJob): Promise<MemoryExtractionJob> {
    try {
      const settings = this.#memoryRepository.settings();
      if (!settings.memoriesEnabled) {
        return this.#memoryRepository.skipExtractionJob(job.id, "memory_disabled");
      }
      if (!settings.generateMemories) {
        return this.#memoryRepository.skipExtractionJob(job.id, "generation_disabled");
      }
      if (
        this.#memoryRepository.conversationSettings(job.conversationId).generateMemories === false
      ) {
        return this.#memoryRepository.skipExtractionJob(job.id, "conversation_disabled");
      }
      if (this.#chatRepository.hasActiveGeneration(job.conversationId)) {
        return this.#memoryRepository.deferExtractionJob(job.id);
      }
      let snapshot: ConversationSnapshot;
      try {
        snapshot = this.#chatRepository.getConversation(job.conversationId);
      } catch {
        return this.#memoryRepository.skipExtractionJob(job.id, "conversation_deleted");
      }
      const messages = snapshot.messages
        .filter(({ role, status }) => role === "user" && status === "completed")
        .map((message) => ({
          messageId: message.id,
          text: message.parts
            .map(({ text }) => text)
            .join("\n")
            .trim(),
        }))
        .filter(({ text }) => text.length > 0);
      const totalText = messages.reduce((total, { text }) => total + text.length, 0);
      if (messages.length < 2 || totalText < 80) {
        return this.#memoryRepository.skipExtractionJob(job.id, "conversation_too_short");
      }
      if (
        settings.disableOnExternalContext &&
        this.#memoryRepository.hasExternalContext(job.conversationId)
      ) {
        return this.#memoryRepository.skipExtractionJob(job.id, "external_context");
      }
      const existingMemories = this.#memoryRepository
        .list({ status: "active", limit: 50 })
        .map((memory) => ({
          id: memory.id,
          kind: memory.kind,
          content: memory.content.slice(0, 500),
          conflictKey: memory.conflictKey,
        }));
      const output = await this.#extractor.extract({ job, snapshot, messages, existingMemories });
      const createdById = new Map<string, MemoryEntry>();
      for (const candidate of output.candidates) {
        try {
          const { memory } = this.#memoryRepository.ingestAutomaticCandidate({
            candidate,
            conversationId: job.conversationId,
            jobId: job.id,
          });
          if (
            memory &&
            memory.origin === "automatic" &&
            memory.sourceConversationId === job.conversationId
          ) {
            createdById.set(memory.id, memory);
          }
        } catch (error) {
          if (!rejectedCandidateCodes.has(this.#errorCode(error))) throw error;
        }
      }
      const created = [...createdById.keys()]
        .map((memoryId) => this.#memoryRepository.get(memoryId))
        .filter(
          (memory) =>
            memory.status === "active" &&
            memory.origin === "automatic" &&
            memory.sourceConversationId === job.conversationId,
        );
      const completed = this.#memoryRepository.completeExtractionJob(job.id, created.length);
      if (created.length > 0) this.#onMemoriesCreated(created, completed);
      return completed;
    } catch (error) {
      const code = this.#errorCode(error);
      if (code === "MEMORY_EXECUTION_CONTEXT_UNAVAILABLE") {
        return this.#memoryRepository.skipExtractionJob(job.id, "execution_context_unavailable");
      }
      this.#onError(error, job);
      return this.#memoryRepository.failExtractionJob(job.id, code);
    }
  }

  #errorCode(error: unknown): string {
    const candidate = error instanceof Error ? error.message.split(":", 1)[0] : "";
    return candidate && /^[A-Z][A-Z0-9_]*$/u.test(candidate)
      ? candidate
      : "MEMORY_EXTRACTION_FAILED";
  }
}
