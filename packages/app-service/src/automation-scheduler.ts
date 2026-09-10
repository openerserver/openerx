import type {
  AppServiceAuthorization,
  AppServiceByokConfiguration,
  AutomationDefinition,
  AutomationExecutionContext,
  AutomationRun,
  ChatCommandEnvelope,
  ChatEvent,
  GenerationReceipt,
} from "@openerx/contracts";
import type { AutomationDueOptions, AutomationRepository } from "@openerx/storage";

const transientRetryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000] as const;

export interface AutomationDispatchReceipt {
  conversationId: string;
  assistantMessageId: string;
  generationId?: string;
}

export interface AutomationDispatcher {
  dispatch(
    definition: AutomationDefinition,
    run: AutomationRun,
  ): Promise<AutomationDispatchReceipt>;
  cancel?(run: AutomationRun): Promise<void>;
}

export interface AutomationChatCommandTarget {
  handle(
    request: ChatCommandEnvelope,
    authorization?: AppServiceAuthorization,
    byok?: AppServiceByokConfiguration,
  ): Promise<unknown>;
}

export class ChatAutomationDispatcher implements AutomationDispatcher {
  readonly #target: AutomationChatCommandTarget;
  readonly #executionContext: (
    modelRef?: string,
  ) => AutomationExecutionContext | Promise<AutomationExecutionContext>;

  constructor(
    target: AutomationChatCommandTarget,
    executionContext: (
      modelRef?: string,
    ) => AutomationExecutionContext | Promise<AutomationExecutionContext> = () => ({}),
  ) {
    this.#target = target;
    this.#executionContext = executionContext;
  }

  async dispatch(
    definition: AutomationDefinition,
    run: AutomationRun,
  ): Promise<AutomationDispatchReceipt> {
    if (definition.kind === "heartbeat" && !definition.target.conversationId) {
      throw new Error("AUTOMATION_HEARTBEAT_TARGET_REQUIRED");
    }
    const context = await this.#executionContext(definition.execution.modelRef);
    const result = (await this.#target.handle(
      {
        command: "chat.send",
        input: {
          conversationId: definition.kind === "heartbeat" ? definition.target.conversationId : null,
          text: run.promptSnapshot,
          idempotencyKey: `automation-run:${run.id}`,
          modelRef: definition.execution.modelRef,
          thinkingLevel: definition.execution.thinkingLevel,
          ...(definition.execution.skillInstallationId
            ? { skillInstallationId: definition.execution.skillInstallationId }
            : {}),
        },
      },
      context.authorization,
      context.byok,
    )) as GenerationReceipt;
    if (!result?.conversationId || !result.assistantMessageId) {
      throw new Error("AUTOMATION_DISPATCH_RECEIPT_INVALID");
    }
    return {
      conversationId: result.conversationId,
      assistantMessageId: result.assistantMessageId,
    };
  }

  async cancel(run: AutomationRun): Promise<void> {
    if (!run.conversationId || !run.assistantMessageId) return;
    await this.#target.handle(
      {
        command: "chat.stop",
        input: {
          conversationId: run.conversationId,
          assistantMessageId: run.assistantMessageId,
        },
      },
      undefined,
      undefined,
    );
  }
}

export interface AutomationSchedulerOptions {
  repository: AutomationRepository;
  dispatcher: AutomationDispatcher;
  hostId: string;
  intervalMs?: number;
  maxClaimsPerTick?: number;
  onError?: (error: unknown, run?: AutomationRun) => void;
  onRunChanged?: (run: AutomationRun) => void;
}

export interface AutomationWakeWindow {
  suspendedAt: string | null;
  resumedAt: string;
}

export class AutomationScheduler {
  readonly #repository: AutomationRepository;
  readonly #dispatcher: AutomationDispatcher;
  readonly #hostId: string;
  readonly #intervalMs: number;
  readonly #maxClaimsPerTick: number;
  readonly #onError: (error: unknown, run?: AutomationRun) => void;
  readonly #onRunChanged: (run: AutomationRun) => void;
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking = false;
  #queuedTick: AutomationDueOptions | null = null;

  constructor(options: AutomationSchedulerOptions) {
    if (!options.hostId.trim()) throw new Error("AUTOMATION_HOST_REQUIRED");
    this.#repository = options.repository;
    this.#dispatcher = options.dispatcher;
    this.#hostId = options.hostId;
    this.#intervalMs = Math.max(1_000, options.intervalMs ?? 30_000);
    this.#maxClaimsPerTick = Math.max(1, options.maxClaimsPerTick ?? 20);
    this.#onError = options.onError ?? (() => undefined);
    this.#onRunChanged = options.onRunChanged ?? (() => undefined);
  }

  start(): void {
    if (this.#timer) return;
    void this.tick().catch((error: unknown) => this.#onError(error));
    this.#timer = setInterval(
      () => void this.tick().catch((error: unknown) => this.#onError(error)),
      this.#intervalMs,
    );
    this.#timer.unref?.();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async reconcileAfterWake(window: AutomationWakeWindow): Promise<AutomationRun[]> {
    const resumedAtMs = Date.parse(window.resumedAt);
    const suspendedAtMs = window.suspendedAt === null ? null : Date.parse(window.suspendedAt);
    if (
      Number.isNaN(resumedAtMs) ||
      (suspendedAtMs !== null && (Number.isNaN(suspendedAtMs) || suspendedAtMs > resumedAtMs))
    ) {
      throw new Error("AUTOMATION_WAKE_WINDOW_INVALID");
    }
    return await this.tick({ now: window.resumedAt, forceMissed: true });
  }

  async tick(options: AutomationDueOptions = {}): Promise<AutomationRun[]> {
    if (this.#ticking) {
      this.#queuedTick = {
        ...this.#queuedTick,
        ...options,
        forceMissed: this.#queuedTick?.forceMissed === true || options.forceMissed === true,
      };
      return [];
    }
    this.#ticking = true;
    const dispatched: AutomationRun[] = [];
    try {
      for (const run of this.#repository.enqueueDue(options)) {
        if (run.status === "missed" || run.status === "skipped_overlap") this.#notify(run);
      }
      for (let index = 0; index < this.#maxClaimsPerTick; index += 1) {
        const run = this.#repository.claimNext(this.#hostId);
        if (!run) break;
        this.#notify(run);
        const definition = this.#repository.get(run.automationId);
        try {
          const receipt = await this.#dispatcher.dispatch(definition, run);
          const started = this.#repository.markStarted(run.id, {
            conversationId: receipt.conversationId,
            assistantMessageId: receipt.assistantMessageId,
            ...(receipt.generationId ? { generationId: receipt.generationId } : {}),
          });
          dispatched.push(started);
          this.#notify(started);
        } catch (error) {
          const failureCode = this.#failureCode(error);
          const retryDelay = this.#retryDelay(definition, run, failureCode);
          const result =
            retryDelay === null
              ? this.#repository.markFinished(
                  run.id,
                  this.#requiresAttention(failureCode) ? "needs_attention" : "failed",
                  { failureCode },
                )
              : this.#repository.markRetryScheduled(run.id, retryDelay, failureCode);
          this.#notify(result);
          this.#onError(error, run);
        }
      }
      return dispatched;
    } finally {
      this.#ticking = false;
      const queued = this.#queuedTick;
      this.#queuedTick = null;
      if (queued) void this.tick(queued).catch((error: unknown) => this.#onError(error));
    }
  }

  completeRun(runId: string): AutomationRun {
    const run = this.#repository.markFinished(runId, "succeeded");
    this.#notify(run);
    return run;
  }

  failRun(runId: string, error: unknown): AutomationRun {
    const run = this.#repository.markFinished(runId, "failed", {
      failureCode: this.#failureCode(error),
    });
    this.#notify(run);
    return run;
  }

  async handleChatEvent(event: ChatEvent): Promise<AutomationRun | null> {
    if (!event.messageId) return null;
    const run = this.#repository.activeRunForAssistantMessage(event.messageId);
    if (!run) return null;
    let finished: AutomationRun | null;
    switch (event.type) {
      case "message.completed":
        finished = this.#repository.markFinished(run.id, "succeeded");
        break;
      case "message.stopped":
        finished = this.#repository.markFinished(run.id, "cancelled");
        break;
      case "message.interrupted":
        finished = this.#repository.markFinished(run.id, "interrupted", {
          failureCode: event.payload.reason ?? "AUTOMATION_RUN_INTERRUPTED",
        });
        break;
      case "message.failed":
        finished = this.#repository.markFinished(run.id, "failed", {
          failureCode: event.payload.reason ?? "AUTOMATION_RUN_FAILED",
        });
        break;
      case "permission.required":
        finished = this.#repository.markFinished(run.id, "needs_attention", {
          failureCode: "AUTOMATION_PERMISSION_REQUIRED",
        });
        break;
      default:
        return null;
    }
    this.#notify(finished);
    if (event.type === "permission.required" && this.#dispatcher.cancel) {
      try {
        await this.#dispatcher.cancel(finished);
      } catch (error) {
        this.#onError(error, finished);
      }
    }
    return finished;
  }

  #notify(run: AutomationRun): void {
    try {
      this.#onRunChanged(run);
    } catch (error) {
      this.#onError(error, run);
    }
  }

  #failureCode(error: unknown): string {
    const code = error instanceof Error ? error.message.split(":", 1)[0] : undefined;
    if (code && /^[A-Z][A-Z0-9_]*$/u.test(code)) {
      return code;
    }
    return "AUTOMATION_DISPATCH_FAILED";
  }

  #requiresAttention(code: string): boolean {
    return [
      "AUTHENTICATION_REQUIRED",
      "AUTOMATION_EXECUTION_CONTEXT_UNAVAILABLE",
      "BYOK_API_KEY_REQUIRED",
      "BYOK_NOT_CONFIGURED",
      "BILLING_TERMS_REQUIRED",
      "INSUFFICIENT_BALANCE",
      "MODEL_UNAVAILABLE",
      "PLATFORM_ENDPOINT_NOT_CONFIGURED",
    ].includes(code);
  }

  #retryDelay(definition: AutomationDefinition, run: AutomationRun, code: string): number | null {
    if (definition.execution.retryPolicy !== "transient_3") return null;
    if (!this.#isTransient(code)) return null;
    return transientRetryDelaysMs[run.attempt - 1] ?? null;
  }

  #isTransient(code: string): boolean {
    return (
      code.endsWith("_TIMEOUT") ||
      [
        "CONNECTION_RESET",
        "MODEL_RATE_LIMITED",
        "MODEL_SERVICE_UNAVAILABLE",
        "NETWORK_ERROR",
        "PI_HOST_UNAVAILABLE",
      ].includes(code)
    );
  }
}
