import {
  type AppServiceAuthorization,
  type CloudObjectIntentInput,
  cloudObjectDescriptorSchema,
  cloudObjectTransferIntentSchema,
  type SyncChange,
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
  uploadObject(
    input: CloudObjectIntentInput,
    bytes: Uint8Array,
    authorization: AppServiceAuthorization,
  ): Promise<void>;
  downloadObject(objectId: string, authorization: AppServiceAuthorization): Promise<Uint8Array>;
}

export interface FileSyncAdapter {
  prepareSyncPush(
    operation: SyncOperation,
    upload: (input: CloudObjectIntentInput, bytes: Uint8Array) => Promise<void>,
  ): Promise<void>;
  applySyncPull(
    changes: SyncChange[],
    download: (objectId: string) => Promise<Uint8Array>,
  ): Promise<void>;
  applySyncConflict(
    conflict: SyncConflict,
    resolution: SyncConflictResolution,
    download: (objectId: string) => Promise<Uint8Array>,
  ): Promise<void>;
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

  async uploadObject(
    input: CloudObjectIntentInput,
    bytes: Uint8Array,
    authorization: AppServiceAuthorization,
  ): Promise<void> {
    const intent = cloudObjectTransferIntentSchema.parse(
      await this.#json("/api/v2/objects/upload-intents", authorization, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    const response = await fetch(
      `${authorization.platformBaseUrl.replace(/\/$/, "")}/api/v2/objects/transfers/${intent.token}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${authorization.accessToken}`,
          "content-type": "application/octet-stream",
        },
        body: Buffer.from(bytes),
      },
    );
    const body = (await response.json()) as unknown;
    if (!response.ok) throw new Error(httpError(body, response.status));
    cloudObjectDescriptorSchema.parse(body);
  }

  async downloadObject(
    objectId: string,
    authorization: AppServiceAuthorization,
  ): Promise<Uint8Array> {
    const intent = cloudObjectTransferIntentSchema.parse(
      await this.#json(
        `/api/v2/objects/${encodeURIComponent(objectId)}/download-intents`,
        authorization,
        { method: "POST", body: JSON.stringify({}) },
      ),
    );
    const response = await fetch(
      `${authorization.platformBaseUrl.replace(/\/$/, "")}/api/v2/objects/transfers/${intent.token}`,
      { headers: { authorization: `Bearer ${authorization.accessToken}` } },
    );
    if (!response.ok) {
      const body = (await response.json()) as unknown;
      throw new Error(httpError(body, response.status));
    }
    return new Uint8Array(await response.arrayBuffer());
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
    const body = (await response.json()) as unknown;
    if (!response.ok) throw new Error(httpError(body, response.status));
    return body;
  }
}

export class SyncCoordinator {
  readonly #repository: ChatRepository;
  readonly #transport: AccountSyncTransport;
  readonly #files: FileSyncAdapter | null;
  readonly #now: () => string;
  #active: Promise<SyncStatus> | null = null;
  #rerunRequested = false;

  constructor(
    repository: ChatRepository,
    transport: AccountSyncTransport,
    files: FileSyncAdapter | null = null,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#transport = transport;
    this.#files = files;
    this.#now = now;
  }

  async resolveConflict(
    conflictId: string,
    resolution: SyncConflictResolution,
    authorization: AppServiceAuthorization,
  ): Promise<SyncStatus> {
    await this.#transport.resolveConflict(conflictId, resolution, authorization);
    const conflict = this.#repository.resolveSyncConflict(conflictId, resolution);
    await this.#files?.applySyncConflict(
      conflict,
      resolution,
      async (objectId) => await this.#transport.downloadObject(objectId, authorization),
    );
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
      await this.#files?.prepareSyncPush(
        operation,
        async (input, bytes) => await this.#transport.uploadObject(input, bytes, authorization),
      );
      const result = await this.#transport.push(operation, authorization);
      this.#repository.acknowledgeSync(result);
      pushed += 1;
    }
    const pull = await this.#transport.pull(this.#repository.syncCursor(), authorization);
    await this.#files?.applySyncPull(
      pull.changes.filter(({ objectType }) => objectType !== "attachment"),
      async (objectId) => await this.#transport.downloadObject(objectId, authorization),
    );
    this.#repository.applySyncPull(pull);
    await this.#files?.applySyncPull(
      pull.changes.filter(({ objectType }) => objectType === "attachment"),
      async (objectId) => await this.#transport.downloadObject(objectId, authorization),
    );
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

function httpError(body: unknown, status: number): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return `SYNC_HTTP_${status}`;
  }
  const error = body.error;
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return `SYNC_HTTP_${status}`;
  }
  return typeof error.code === "string" ? error.code : `SYNC_HTTP_${status}`;
}
