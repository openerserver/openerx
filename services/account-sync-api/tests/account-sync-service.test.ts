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

function principal(
  accountId: string = randomUUID(),
  deviceId: string = randomUUID(),
): SyncPrincipal {
  return { accountId, deviceId, sessionId: randomUUID() };
}

function operation(
  actor: SyncPrincipal,
  objectId: string,
  baseRevision: number,
  payload: Record<string, unknown> | null,
  mutation: "upsert" | "delete" = "upsert",
  objectType: SyncOperation["objectType"] = "conversation",
): SyncOperation {
  return {
    operationId: randomUUID(),
    accountId: actor.accountId,
    deviceId: actor.deviceId,
    objectType,
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
    if (conflict.status === "conflict") {
      expect(
        service.resolveConflict(firstDevice, conflict.conflict.conflictId).resolvedAt,
      ).not.toBe(null);
    }
    expect(service.listConflicts(firstDevice)).toEqual([]);
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
          nested: {
            refreshCredential: "must-not-sync",
            sourceScopeId: randomUUID(),
            objectRef: "objects/sha256/local-only",
          },
        }),
      ),
    ).toThrow("SYNC_FORBIDDEN_FIELD");
  });

  it("accepts portable project payloads and rejects project-local authority", () => {
    const { service } = setup();
    const actor = principal();
    const projectId = randomUUID();
    const projectPayload = {
      id: projectId,
      ownerProfileId: actor.accountId,
      name: "跨设备项目",
      instructions: "保持逻辑上下文。",
      pinnedRank: null,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
      archivedAt: null,
      revision: 1,
    };
    expect(
      service.push(actor, operation(actor, projectId, 0, projectPayload, "upsert", "project")),
    ).toMatchObject({ status: "committed", revision: 1 });
    const otherDevice = principal(actor.accountId);
    service.push(
      actor,
      operation(
        actor,
        projectId,
        1,
        { ...projectPayload, name: "设备 A", revision: 2 },
        "upsert",
        "project",
      ),
    );
    const projectConflict = service.push(
      otherDevice,
      operation(
        otherDevice,
        projectId,
        1,
        { ...projectPayload, name: "设备 B", revision: 2 },
        "upsert",
        "project",
      ),
    );
    expect(projectConflict).toMatchObject({
      status: "conflict",
      conflict: {
        clientPayload: { name: "设备 B" },
        serverPayload: { name: "设备 A" },
      },
    });

    const directoryId = randomUUID();
    const directoryPayload = {
      id: directoryId,
      ownerProfileId: actor.accountId,
      projectId,
      displayName: "逻辑主目录",
      role: "primary",
      desiredAccess: "read_write",
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
      deletedAt: null,
      revision: 1,
    };
    expect(
      service.push(
        actor,
        operation(actor, directoryId, 0, directoryPayload, "upsert", "project_directory"),
      ),
    ).toMatchObject({ status: "committed", revision: 1 });

    expect(() =>
      service.push(
        actor,
        operation(
          actor,
          randomUUID(),
          0,
          { ...directoryPayload, id: randomUUID(), workspaceGrantId: randomUUID() },
          "upsert",
          "project_directory",
        ),
      ),
    ).toThrow("SYNC_FORBIDDEN_FIELD");
    expect(() =>
      service.push(
        actor,
        operation(
          actor,
          projectId,
          1,
          { ...projectPayload, ownerProfileId: randomUUID() },
          "upsert",
          "project",
        ),
      ),
    ).toThrow("ACCOUNT_SCOPE_VIOLATION");
  });

  it("deletes every active cloud object with retained tombstones and account isolation", () => {
    const { service } = setup();
    const owner = principal();
    const stranger = principal();
    service.push(owner, operation(owner, randomUUID(), 0, { title: "One" }));
    service.push(owner, operation(owner, randomUUID(), 0, { title: "Two" }));
    service.push(stranger, operation(stranger, randomUUID(), 0, { title: "Private" }));
    const result = service.deleteAccountData(owner);
    expect(result).toMatchObject({ deletedObjects: 2, cursor: "cursor:4" });
    expect(service.pull(owner, "cursor:2").changes).toHaveLength(2);
    expect(service.pull(owner, "cursor:2").changes.every(({ tombstone }) => tombstone)).toBe(true);
    expect(service.pull(stranger, null).changes).toHaveLength(1);
    expect(service.deleteAccountData(owner).deletedObjects).toBe(0);
  });
});
