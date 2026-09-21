import type { AppServiceAuthorization } from "@openerx/contracts";

export class RemoteAuthorizationRefresh {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;

  constructor(
    private readonly load: () => Promise<AppServiceAuthorization>,
    private readonly update: (authorization: AppServiceAuthorization) => void,
  ) {}

  start(authorization: AppServiceAuthorization): void {
    this.stop();
    this.#schedule(authorization, this.#generation);
  }

  stop(): void {
    this.#generation += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(authorization: AppServiceAuthorization, generation: number, retryDelay?: number): void {
    const delay =
      retryDelay ??
      Math.max(1_000, Date.parse(authorization.accessTokenExpiresAt) - Date.now() - 30_000);
    this.#timer = setTimeout(() => void this.#refresh(authorization, generation), delay);
    this.#timer.unref();
  }

  async #refresh(previous: AppServiceAuthorization, generation: number): Promise<void> {
    try {
      const next = await this.load();
      if (generation !== this.#generation) return;
      if (
        next.accountId !== previous.accountId ||
        next.platformBaseUrl !== previous.platformBaseUrl
      ) {
        this.stop();
        return;
      }
      this.update(next);
      this.#schedule(next, generation);
    } catch {
      if (generation === this.#generation) this.#schedule(previous, generation, 10_000);
    }
  }
}
