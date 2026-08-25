import { randomUUID } from "node:crypto";
import type { SyncOperation } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSyncService, type SyncPrincipal } from "../src/account-sync-service";

const services: AccountSyncService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function setup() {
  let now = Date.parse("2026-08-25T10:00:00.000Z");
  const service = new AccountSyncService(":memory:", { now: () => new Date(now) });
  services.push(service);
  return { service, tick: () => (now += 1_000) };
}

function principal(accountId = randomUUID(), deviceId = randomUUID()): SyncPrincipal {
  return { accountId, deviceId, sessionId: randomUUID() };
}

function operation(
  actor: SyncPrincipal,
  objectId: string,
  baseRevision: number,
  payload: Record<string, unknown> | null,
  mutation: "upsert" | "delete" = "upsert",
): SyncOperation {
  return {
    operationId: randomUUID(),
    accountId: actor.accountId,
    deviceId: actor.deviceId,
    objectType: "conversation",
    objectId,
    mutation,
    baseRevision,
    payloadVersion: 1,
    payload,
    idempotencyKey: `sync-${randomUUID()}`,
    createdAt: "2026-08-25T10:00:00.000Z",
  };
}

describe("AccountSyncService", () => {
  it("commits offline operations in order and replays idempotently", () => {
    const { service, tick } = setup();
    const actor = principal();
    const objectId = randomUUID();
    const first = operation(actor, objectId, 0, { id: objectId, title: "离线标题" });
    const result = service.push(actor, first);
    expect(result).toMatchObject({ status: "committed", revision: 1, replayed: false });
    expect(service.push(actor, first)).toMatchObject({
      status: "committed",
      revision: 1,
      replayed: true,
    });
    tick();
    const second = operation(actor, objectId, 1, { id: objectId, title: "联网标题" });
    expect(service.push(actor, second)).toMatchObject({ status: "committed", revision: 2 });
    const pull = service.pull(actor, null);
    expect(pull.changes.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(pull.nextCursor).toBe("cursor:2");
    expect(service.pull(actor, "cursor:2").changes).toEqual([]);
  });

  it("preserves both versions as a visible conflict", () => {
    const { service } = setup();
    const accountId = randomUUID();
    const firstDevice = principal(accountId);
    const secondDevice = principal(accountId);
    const objectId = randomUUID();
    service.push(firstDevice, operation(firstDevice, objectId, 0, { title: "初始" }));
    service.push(firstDevice, operation(firstDevice, objectId, 1, { title: "设备 A" }));
    const conflict = service.push(
      secondDevice,
      operation(secondDevice, objectId, 1, { title: "设备 B" }),
    );
    expect(conflict.status).toBe("conflict");
    if (conflict.status === "conflict") {
      expect(conflict.conflict.clientPayload).toEqual({ title: "设备 B" });
      expect(conflict.conflict.serverPayload).toEqual({ title: "设备 A" });
    }
    expect(service.listConflicts(firstDevice)).toHaveLength(1);
  });

  it("creates revisioned tombstones and separates account scopes", () => {
    const { service } = setup();
    const owner = principal();
    const stranger = principal();
    const objectId = randomUUID();
    service.push(owner, operation(owner, objectId, 0, { title: "私有" }));
    expect(service.pull(stranger, null).changes).toEqual([]);
    const deletion = operation(owner, objectId, 1, null, "delete");
    service.push(owner, deletion);
    expect(service.pull(owner, "cursor:1").changes[0]).toMatchObject({
      tombstone: true,
      revision: 2,
      payload: null,
    });
    const forged = {
      ...operation(owner, randomUUID(), 0, { title: "伪造" }),
      accountId: stranger.accountId,
    };
    expect(() => service.push(owner, forged)).toThrow("ACCOUNT_SCOPE_VIOLATION");
  });

  it("rejects device-private and credential fields recursively", () => {
    const { service } = setup();
    const actor = principal();
    expect(() =>
      service.push(
        actor,
        operation(actor, randomUUID(), 0, {
          title: "unsafe",
          nested: { refreshCredential: "must-not-sync" },
        }),
      ),
    ).toThrow("SYNC_FORBIDDEN_FIELD");
  });
});
