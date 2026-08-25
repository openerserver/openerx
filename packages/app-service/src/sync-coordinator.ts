import type {
  AppServiceAuthorization,
  SyncOperation,
  SyncPullResult,
  SyncPushResult,
  SyncStatus,
} from "@openerx/contracts";
import type { ChatRepository } from "@openerx/storage";

export interface AccountSyncTransport {
  push(operation: SyncOperation, authorization: AppServiceAuthorization): Promise<SyncPushResult>;
  pull(cursor: string | null, authorization: AppServiceAuthorization): Promise<SyncPullResult>;
}

export class HttpAccountSyncTransport implements AccountSyncTransport {
  async push(
    operation: SyncOperation,
    authorization: AppServiceAuthorization,
  ): Promise<SyncPushResult> {
    return (await this.#json("/api/v2/sync/push", authorization, {
      method: "POST",
      body: JSON.stringify(operation),
    })) as SyncPushResult;
  }

  async pull(
    cursor: string | null,
    authorization: AppServiceAuthorization,
  ): Promise<SyncPullResult> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return (await this.#json(`/api/v2/sync/pull${query}`, authorization, {
      method: "GET",
    })) as SyncPullResult;
  }

  async #json(
    pathname: string,
    authorization: AppServiceAuthorization,
    init: RequestInit,
  ): Promise<unknown> {
    const response = await fetch(`${authorization.platformBaseUrl.replace(/\/$/, "")}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
        "content-type": "application/json",
      },
    });
    const body = (await response.json()) as { error?: { code?: string } };
    if (!response.ok) throw new Error(body.error?.code ?? `SYNC_HTTP_${response.status}`);
    return body;
  }
}

export class SyncCoordinator {
  readonly #repository: ChatRepository;
  readonly #transport: AccountSyncTransport;
  #active: Promise<SyncStatus> | null = null;
  #rerunRequested = false;

  constructor(repository: ChatRepository, transport: AccountSyncTransport) {
    this.#repository = repository;
    this.#transport = transport;
  }

  async syncOnce(authorization: AppServiceAuthorization): Promise<SyncStatus> {
    if (this.#active) {
      this.#rerunRequested = true;
      return await this.#active;
    }
    this.#active = Promise.resolve()
      .then(async () => await this.#drain(authorization))
      .finally(() => {
        this.#active = null;
      });
    return await this.#active;
  }

  async #drain(authorization: AppServiceAuthorization): Promise<SyncStatus> {
    let latest: SyncStatus | null = null;
    let pushed = 0;
    let pulled = 0;
    do {
      this.#rerunRequested = false;
      const current = await this.#run(authorization);
      latest = current;
      pushed += current.pushed;
      pulled += current.pulled;
    } while (this.#rerunRequested || this.#repository.pendingSyncOperations().length > 0);
    if (!latest) throw new Error("SYNC_DRAIN_EMPTY");
    return { ...latest, pushed, pulled };
  }

  async #run(authorization: AppServiceAuthorization): Promise<SyncStatus> {
    let pushed = 0;
    for (const operation of this.#repository.pendingSyncOperations()) {
      const result = await this.#transport.push(operation, authorization);
      this.#repository.acknowledgeSync(result);
      pushed += 1;
    }
    const pull = await this.#transport.pull(this.#repository.syncCursor(), authorization);
    this.#repository.applySyncPull(pull);
    return {
      cursor: pull.nextCursor,
      pushed,
      pulled: pull.changes.length,
      pending: this.#repository.pendingSyncOperations().length,
      conflicts: this.#repository.syncConflicts().length,
    };
  }
}
