import { randomUUID } from "node:crypto";
import type {
  AppServiceAuthorization,
  SyncOperation,
  SyncPullResult,
  SyncPushResult,
} from "@openerx/contracts";
import type { ChatRepository } from "@openerx/storage";
import { describe, expect, it } from "vitest";
import { type AccountSyncTransport, SyncCoordinator } from "../src/sync-coordinator";

const accountId = randomUUID();
const deviceId = randomUUID();
const authorization: AppServiceAuthorization = {
  accountId,
  accessToken: "access-token-for-sync-coordinator-test-0001",
  accessTokenExpiresAt: "2026-08-25T20:00:00.000Z",
  platformBaseUrl: "https://platform.example.test",
};

function operation(): SyncOperation {
  const operationId = randomUUID();
  return {
    operationId,
    accountId,
    deviceId,
    objectType: "message",
    objectId: randomUUID(),
    mutation: "upsert",
    baseRevision: 0,
    payloadVersion: 1,
    payload: { status: "pending" },
    idempotencyKey: `sync:${operationId}`,
    createdAt: "2026-08-25T10:00:00.000Z",
  };
}

describe("SyncCoordinator", () => {
  it("drains writes queued while an earlier sync pass is active", async () => {
    const pending = [operation()];
    let cursor = "cursor:0";
    let pullCount = 0;
    const repository = {
      pendingSyncOperations: () => [...pending],
      acknowledgeSync: (result: SyncPushResult) => {
        const index = pending.findIndex(({ operationId }) => operationId === result.operationId);
        if (index >= 0) pending.splice(index, 1);
      },
      syncCursor: () => cursor,
      applySyncPull: (result: SyncPullResult) => {
        cursor = result.nextCursor;
      },
      syncConflicts: () => [],
    } as unknown as ChatRepository;
    let coordinator: SyncCoordinator;
    let pushCount = 0;
    const transport: AccountSyncTransport = {
      async push(input) {
        pushCount += 1;
        if (pushCount === 1) {
          pending.push(operation());
          void coordinator.syncOnce(authorization);
        }
        return {
          status: "committed",
          operationId: input.operationId,
          revision: 1,
          cursor: `cursor:${pushCount}`,
          replayed: false,
        };
      },
      async pull() {
        pullCount += 1;
        return { changes: [], nextCursor: `cursor:${pullCount}` };
      },
      async resolveConflict() {
        throw new Error("not used");
      },
      async uploadObject() {
        throw new Error("not used");
      },
      async downloadObject() {
        throw new Error("not used");
      },
    };
    coordinator = new SyncCoordinator(repository, transport);

    const result = await coordinator.syncOnce(authorization);

    expect(pushCount).toBe(2);
    expect(result.pushed).toBe(2);
    expect(result.pending).toBe(0);
    expect(pullCount).toBeGreaterThanOrEqual(2);
  });
});
