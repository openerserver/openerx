import { randomUUID } from "node:crypto";
import type {
  AppServiceAuthorization,
  MemoryConsolidationRun,
  MemoryEntry,
  MemorySemanticClusterOutput,
  PiMemoryClusterFrame,
} from "@openerx/contracts";
import type { MemoryRepository } from "@openerx/storage";
import type {
  MemoryByokConfiguration,
  MemoryExecutionContext,
} from "./memory-extraction-scheduler";
import type { PiHostClient } from "./pi-host-client";

export interface MemoryClusterRequest {
  run: MemoryConsolidationRun;
  memories: Array<Pick<MemoryEntry, "id" | "kind" | "content">>;
}

export interface MemoryClusterer {
  cluster(request: MemoryClusterRequest): Promise<MemorySemanticClusterOutput>;
}

export class PiMemoryClusterer implements MemoryClusterer {
  readonly #piHost: PiHostClient;
  readonly #executionContext: () => MemoryExecutionContext | Promise<MemoryExecutionContext>;

  constructor(
    piHost: PiHostClient,
    executionContext: () => MemoryExecutionContext | Promise<MemoryExecutionContext>,
  ) {
    this.#piHost = piHost;
    this.#executionContext = executionContext;
  }

  async cluster(request: MemoryClusterRequest): Promise<MemorySemanticClusterOutput> {
    let context: MemoryExecutionContext;
    try {
      context = await this.#executionContext();
    } catch {
      throw new Error("MEMORY_EXECUTION_CONTEXT_UNAVAILABLE");
    }
    const authorization: AppServiceAuthorization | undefined = context.authorization;
    const byok: MemoryByokConfiguration | undefined = authorization ? undefined : context.byok;
    if (!authorization && !byok) throw new Error("MEMORY_EXECUTION_CONTEXT_UNAVAILABLE");
    if (!this.#piHost.clusterMemories) throw new Error("MEMORY_CLUSTERER_UNAVAILABLE");
    const frame: PiMemoryClusterFrame = {
      kind: "pi.memory.cluster",
      requestId: randomUUID(),
      runId: request.run.id,
      thinkingLevel: "low",
      memories: request.memories,
      ...(authorization
        ? {
            platform: {
              accountId: authorization.accountId,
              accessToken: authorization.accessToken,
              platformBaseUrl: authorization.platformBaseUrl,
              selectedModelRef: "platform/auto",
              approvedFallbackModelRef: null,
              requestDedupeKey: `memory-cluster:${request.run.id}`,
            },
          }
        : {}),
      ...(byok ? { byok } : {}),
    };
    const result = await this.#piHost.clusterMemories(frame);
    if (!result.ok) throw new Error(result.errorCode);
    return result.output;
  }
}

export interface MemoryConsolidationSchedulerOptions {
  repository: MemoryRepository;
  clusterer?: MemoryClusterer;
  intervalMs?: number;
  consolidationIntervalMs?: number;
  activeLimit?: number;
  staleAfterMs?: number;
  onRunChanged?: (run: MemoryConsolidationRun) => void;
  onError?: (error: unknown, run: MemoryConsolidationRun) => void;
}

export class MemoryConsolidationScheduler {
  readonly #repository: MemoryRepository;
  readonly #clusterer: MemoryClusterer | null;
  readonly #intervalMs: number;
  readonly #consolidationIntervalMs: number;
  readonly #activeLimit: number;
  readonly #staleAfterMs: number;
  readonly #onRunChanged: NonNullable<MemoryConsolidationSchedulerOptions["onRunChanged"]>;
  readonly #onError: NonNullable<MemoryConsolidationSchedulerOptions["onError"]>;
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking = false;

  constructor(options: MemoryConsolidationSchedulerOptions) {
    this.#repository = options.repository;
    this.#clusterer = options.clusterer ?? null;
    this.#intervalMs = Math.max(1_000, options.intervalMs ?? 60 * 60_000);
    this.#consolidationIntervalMs = Math.max(
      60_000,
      options.consolidationIntervalMs ?? 24 * 60 * 60_000,
    );
    this.#activeLimit = Math.max(1, options.activeLimit ?? 200);
    this.#staleAfterMs = Math.max(60_000, options.staleAfterMs ?? 10 * 60_000);
    this.#onRunChanged = options.onRunChanged ?? (() => undefined);
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

  async tick(): Promise<MemoryConsolidationRun | null> {
    if (this.#ticking) return null;
    this.#ticking = true;
    let run: MemoryConsolidationRun | null = null;
    try {
      run = this.#repository.claimConsolidationRun({
        intervalMs: this.#consolidationIntervalMs,
        activeLimit: this.#activeLimit,
        staleAfterMs: this.#staleAfterMs,
      });
      if (!run) return null;
      this.#onRunChanged(run);
      const completed = this.#repository.runConsolidation(run.id);
      this.#onRunChanged(completed);
      if (this.#clusterer && this.#repository.settings().memoriesEnabled) {
        const memories = this.#repository
          .list({ status: "active", limit: 40 })
          .filter(({ conflictKey }) => conflictKey === null)
          .map(({ id, kind, content }) => ({ id, kind, content }));
        if (memories.length >= 2) {
          try {
            const output = await this.#clusterer.cluster({ run: completed, memories });
            this.#repository.stageHistoricalMergeReviews(output.proposals);
          } catch (error) {
            this.#onError(error, completed);
          }
        }
      }
      return completed;
    } catch (error) {
      if (!run) throw error;
      const failed = this.#repository.failConsolidationRun(run.id, this.#errorCode(error));
      this.#onRunChanged(failed);
      this.#onError(error, failed);
      return failed;
    } finally {
      this.#ticking = false;
    }
  }

  #errorCode(error: unknown): string {
    if (error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)) {
      return error.message;
    }
    return "MEMORY_CONSOLIDATION_FAILED";
  }
}
