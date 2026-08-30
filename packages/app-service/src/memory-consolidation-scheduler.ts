import type { MemoryConsolidationRun } from "@openerx/contracts";
import type { MemoryRepository } from "@openerx/storage";

export interface MemoryConsolidationSchedulerOptions {
  repository: MemoryRepository;
  intervalMs?: number;
  consolidationIntervalMs?: number;
  activeLimit?: number;
  staleAfterMs?: number;
  onRunChanged?: (run: MemoryConsolidationRun) => void;
  onError?: (error: unknown, run: MemoryConsolidationRun) => void;
}

export class MemoryConsolidationScheduler {
  readonly #repository: MemoryRepository;
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
