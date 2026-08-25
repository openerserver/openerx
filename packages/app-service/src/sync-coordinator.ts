import {
  type AppServiceAuthorization,
  type SyncConflict,
  type SyncConflictResolution,
  type SyncOperation,
  type SyncPullResult,
  type SyncPushResult,
  type SyncStatus,
  syncConflictSchema,
  syncPullResultSchema,
  syncPushResultSchema,
} from "@openerx/contracts";
import type { ChatRepository } from "@openerx/storage";

export interface AccountSyncTransport {
  push(operation: SyncOperation, authorization: AppServiceAuthorization): Promise<SyncPushResult>;
  pull(cursor: string | null, authorization: AppServiceAuthorization): Promise<SyncPullResult>;
  resolveConflict(
    conflictId: string,
    resolution: SyncConflictResolution,
    authorization: AppServiceAuthorization,
  ): Promise<SyncConflict>;
}

export class HttpAccountSyncTransport implements AccountSyncTransport {
  async push(
    operation: SyncOperation,
    authorization: AppServiceAuthorization,
  ): Promise<SyncPushResult> {
    return syncPushResultSchema.parse(
      await this.#json("/api/v2/sync/push", authorization, {
        method: "POST",
        body: JSON.stringify(operation),
      }),
    );
  }

  async pull(
    cursor: string | null,
    authorization: AppServiceAuthorization,
  ): Promise<SyncPullResult> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return syncPullResultSchema.parse(
      await this.#json(`/api/v2/sync/pull${query}`, authorization, {
        method: "GET",
      }),
    );
  }

  async resolveConflict(
    conflictId: string,
    resolution: SyncConflictResolution,
    authorization: AppServiceAuthorization,
  ): Promise<SyncConflict> {
    return syncConflictSchema.parse(
      await this.#json(
        `/api/v2/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`,
        authorization,
        { method: "POST", body: JSON.stringify({ resolution }) },
      ),
    );
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
  readonly #now: () => string;
  #active: Promise<SyncStatus> | null = null;
  #rerunRequested = false;

  constructor(
    repository: ChatRepository,
    transport: AccountSyncTransport,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#transport = transport;
    this.#now = now;
  }

  async resolveConflict(
    conflictId: string,
    resolution: SyncConflictResolution,
    authorization: AppServiceAuthorization,
  ): Promise<SyncStatus> {
    await this.#transport.resolveConflict(conflictId, resolution, authorization);
    this.#repository.resolveSyncConflict(conflictId, resolution);
    return await this.syncOnce(authorization);
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
      syncedAt: this.#now(),
    };
  }
}
