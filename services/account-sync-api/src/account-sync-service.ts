import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type CloudDataDeletionResult,
  cloudDataDeletionResultSchema,
  projectDirectorySyncPayloadSchema,
  projectSyncPayloadSchema,
  type SyncChange,
  type SyncConflict,
  type SyncOperation,
  type SyncPullResult,
  type SyncPushResult,
  syncChangeSchema,
  syncConflictSchema,
  syncOperationSchema,
  syncPullResultSchema,
  syncPushResultSchema,
} from "@openerx/contracts";

type SqlRow = Record<string, unknown>;

export interface SyncPrincipal {
  accountId: string;
  sessionId: string;
  deviceId: string;
}

export interface AccountSyncServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
  tombstoneRetentionMs?: number;
}

const forbiddenPayloadKeys = new Set([
  "accesscredential",
  "accesstoken",
  "absolutepath",
  "cookie",
  "canonicalpath",
  "canonicalpathhash",
  "credential",
  "directoryhandle",
  "devicecredential",
  "filegrant",
  "localpath",
  "objectref",
  "permissiongrant",
  "pisession",
  "providerapikey",
  "refreshcredential",
  "refreshtoken",
  "rootpath",
  "shellhistory",
  "sourcerelativepath",
  "sourcescopeid",
  "workspacegrant",
  "workspacegrantid",
  "projectdirectorybinding",
  "projectdirectorybindingid",
]);

function canonicalKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function assertSyncSafe(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertSyncSafe(entry, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenPayloadKeys.has(canonicalKey(key))) {
      throw new Error(`SYNC_FORBIDDEN_FIELD:${path}.${key}`);
    }
    assertSyncSafe(entry, `${path}.${key}`);
  }
}

function assertTypedPayload(operation: SyncOperation): void {
  if (operation.mutation === "delete" || operation.payload === null) return;
  if (operation.objectType === "project") {
    const project = projectSyncPayloadSchema.parse(operation.payload);
    if (project.id !== operation.objectId || project.ownerProfileId !== operation.accountId) {
      throw new Error("ACCOUNT_SCOPE_VIOLATION");
    }
  }
  if (operation.objectType === "project_directory") {
    const directory = projectDirectorySyncPayloadSchema.parse(operation.payload);
    if (directory.id !== operation.objectId || directory.ownerProfileId !== operation.accountId) {
      throw new Error("ACCOUNT_SCOPE_VIOLATION");
    }
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(operation: SyncOperation): string {
  return createHash("sha256").update(stableJson(operation), "utf8").digest("hex");
}

function cursor(sequence: number): string {
  return `cursor:${sequence}`;
}

function cursorSequence(value: string | null): number {
  if (value === null) return 0;
  const match = /^cursor:(\d+)$/.exec(value);
  if (!match) throw new Error("SYNC_CURSOR_INVALID");
  return Number(match[1]);
}

export class AccountSyncService {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #tombstoneRetentionMs: number;

  constructor(databasePath: string, options: AccountSyncServiceOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#tombstoneRetentionMs = options.tombstoneRetentionMs ?? 30 * 24 * 60 * 60_000;
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  push(principal: SyncPrincipal, input: SyncOperation): SyncPushResult {
    const operation = syncOperationSchema.parse(input);
    this.#assertScope(principal, operation);
    if (operation.payload) assertSyncSafe(operation.payload);
    assertTypedPayload(operation);
    const hash = requestHash(operation);
    const replay = this.#database
      .prepare("SELECT request_hash, result_json FROM sync_operations WHERE operation_id = ?")
      .get(operation.operationId) as SqlRow | undefined;
    if (replay) {
      if (replay.request_hash !== hash) throw new Error("SYNC_OPERATION_ID_REUSE");
      const result = syncPushResultSchema.parse(JSON.parse(String(replay.result_json)));
      return { ...result, replayed: true };
    }
    return this.#transaction(() => {
      const object = this.#database
        .prepare(
          `SELECT revision, tombstone, payload_json FROM sync_objects
           WHERE account_id = ? AND object_type = ? AND object_id = ?`,
        )
        .get(operation.accountId, operation.objectType, operation.objectId) as SqlRow | undefined;
      const serverRevision = Number(object?.revision ?? 0);
      const nextCursor = this.#advanceCursor(operation.accountId);
      let result: SyncPushResult;
      if (operation.baseRevision !== serverRevision) {
        const conflict = syncConflictSchema.parse({
          conflictId: this.#idFactory(),
          accountId: operation.accountId,
          objectType: operation.objectType,
          objectId: operation.objectId,
          operationId: operation.operationId,
          clientBaseRevision: operation.baseRevision,
          serverRevision,
          clientPayload: operation.payload,
          serverPayload:
            object?.payload_json === null || object?.payload_json === undefined
              ? null
              : JSON.parse(String(object.payload_json)),
          createdAt: this.#now().toISOString(),
          resolvedAt: null,
        });
        this.#database
          .prepare(
            `INSERT INTO sync_conflicts
             (conflict_id, account_id, object_type, object_id, operation_id,
              client_base_revision, server_revision, client_payload_json, server_payload_json,
              created_at, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            conflict.conflictId,
            conflict.accountId,
            conflict.objectType,
            conflict.objectId,
            conflict.operationId,
            conflict.clientBaseRevision,
            conflict.serverRevision,
            conflict.clientPayload === null ? null : JSON.stringify(conflict.clientPayload),
            conflict.serverPayload === null ? null : JSON.stringify(conflict.serverPayload),
            conflict.createdAt,
          );
        result = syncPushResultSchema.parse({
          status: "conflict",
          operationId: operation.operationId,
          conflict,
          cursor: cursor(nextCursor),
          replayed: false,
        });
      } else {
        const revision = serverRevision + 1;
        const changedAt = this.#now().toISOString();
        const tombstone = operation.mutation === "delete";
        const retainUntil = tombstone
          ? new Date(this.#now().getTime() + this.#tombstoneRetentionMs).toISOString()
          : null;
        this.#database
          .prepare(
            `INSERT INTO sync_objects
             (account_id, object_type, object_id, revision, tombstone, payload_version,
              payload_json, operation_id, changed_at, retain_until)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(account_id, object_type, object_id) DO UPDATE SET
               revision = excluded.revision,
               tombstone = excluded.tombstone,
               payload_version = excluded.payload_version,
               payload_json = excluded.payload_json,
               operation_id = excluded.operation_id,
               changed_at = excluded.changed_at,
               retain_until = excluded.retain_until`,
          )
          .run(
            operation.accountId,
            operation.objectType,
            operation.objectId,
            revision,
            tombstone ? 1 : 0,
            operation.payload === null ? null : JSON.stringify(operation.payload),
            operation.operationId,
            changedAt,
            retainUntil,
          );
        this.#database
          .prepare(
            `INSERT INTO sync_changes
             (account_id, cursor_sequence, object_type, object_id, revision, tombstone,
              payload_version, payload_json, operation_id, changed_at, retain_until)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          )
          .run(
            operation.accountId,
            nextCursor,
            operation.objectType,
            operation.objectId,
            revision,
            tombstone ? 1 : 0,
            operation.payload === null ? null : JSON.stringify(operation.payload),
            operation.operationId,
            changedAt,
            retainUntil,
          );
        result = syncPushResultSchema.parse({
          status: "committed",
          operationId: operation.operationId,
          revision,
          cursor: cursor(nextCursor),
          replayed: false,
        });
      }
      this.#database
        .prepare(
          `INSERT INTO sync_operations
           (operation_id, account_id, request_hash, result_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          operation.operationId,
          operation.accountId,
          hash,
          JSON.stringify(result),
          this.#now().toISOString(),
        );
      return result;
    });
  }

  pull(principal: SyncPrincipal, afterCursor: string | null): SyncPullResult {
    const after = cursorSequence(afterCursor);
    const current = this.#currentCursor(principal.accountId);
    if (after > current) throw new Error("SYNC_CURSOR_AHEAD");
    const rows = this.#database
      .prepare(
        `SELECT * FROM sync_changes
         WHERE account_id = ? AND cursor_sequence > ?
         ORDER BY cursor_sequence ASC`,
      )
      .all(principal.accountId, after) as SqlRow[];
    const changes = rows.map((row) => this.#change(row));
    return syncPullResultSchema.parse({ changes, nextCursor: cursor(current) });
  }

  listConflicts(principal: SyncPrincipal): SyncConflict[] {
    return (
      this.#database
        .prepare(
          `SELECT * FROM sync_conflicts
           WHERE account_id = ? AND resolved_at IS NULL ORDER BY created_at, conflict_id`,
        )
        .all(principal.accountId) as SqlRow[]
    ).map((row) => this.#conflict(row));
  }

  resolveConflict(principal: SyncPrincipal, conflictId: string): SyncConflict {
    return this.#transaction(() => {
      const row = this.#database
        .prepare("SELECT * FROM sync_conflicts WHERE conflict_id = ? AND account_id = ?")
        .get(conflictId, principal.accountId) as SqlRow | undefined;
      if (!row) throw new Error("SYNC_CONFLICT_NOT_FOUND");
      if (row.resolved_at === null) {
        this.#database
          .prepare("UPDATE sync_conflicts SET resolved_at = ? WHERE conflict_id = ?")
          .run(this.#now().toISOString(), conflictId);
      }
      const resolved = this.#database
        .prepare("SELECT * FROM sync_conflicts WHERE conflict_id = ?")
        .get(conflictId) as SqlRow;
      return this.#conflict(resolved);
    });
  }

  deleteAccountData(principal: SyncPrincipal): CloudDataDeletionResult {
    return this.#transaction(() => {
      const now = this.#now();
      const changedAt = now.toISOString();
      const retainUntil = new Date(now.getTime() + this.#tombstoneRetentionMs).toISOString();
      const rows = this.#database
        .prepare(
          `SELECT * FROM sync_objects
           WHERE account_id = ? AND tombstone = 0
           ORDER BY object_type, object_id`,
        )
        .all(principal.accountId) as SqlRow[];
      for (const row of rows) {
        const nextCursor = this.#advanceCursor(principal.accountId);
        const operationId = this.#idFactory();
        const revision = Number(row.revision) + 1;
        this.#database
          .prepare(
            `UPDATE sync_objects
             SET revision = ?, tombstone = 1, payload_json = NULL, operation_id = ?,
                 changed_at = ?, retain_until = ?
             WHERE account_id = ? AND object_type = ? AND object_id = ?`,
          )
          .run(
            revision,
            operationId,
            changedAt,
            retainUntil,
            principal.accountId,
            String(row.object_type),
            String(row.object_id),
          );
        this.#database
          .prepare(
            `INSERT INTO sync_changes
             (account_id, cursor_sequence, object_type, object_id, revision, tombstone,
              payload_version, payload_json, operation_id, changed_at, retain_until)
             VALUES (?, ?, ?, ?, ?, 1, 1, NULL, ?, ?, ?)`,
          )
          .run(
            principal.accountId,
            nextCursor,
            String(row.object_type),
            String(row.object_id),
            revision,
            operationId,
            changedAt,
            retainUntil,
          );
      }
      this.#database
        .prepare(
          `UPDATE sync_conflicts SET resolved_at = COALESCE(resolved_at, ?)
           WHERE account_id = ?`,
        )
        .run(changedAt, principal.accountId);
      return cloudDataDeletionResultSchema.parse({
        deletedObjects: rows.length,
        cursor: cursor(this.#currentCursor(principal.accountId)),
        retainUntil,
      });
    });
  }

  #assertScope(principal: SyncPrincipal, operation: SyncOperation): void {
    if (operation.accountId !== principal.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
    if (operation.deviceId !== principal.deviceId) throw new Error("DEVICE_SCOPE_VIOLATION");
  }

  #currentCursor(accountId: string): number {
    const row = this.#database
      .prepare("SELECT sequence FROM account_cursors WHERE account_id = ?")
      .get(accountId) as SqlRow | undefined;
    return Number(row?.sequence ?? 0);
  }

  #advanceCursor(accountId: string): number {
    this.#database
      .prepare(
        `INSERT INTO account_cursors(account_id, sequence) VALUES (?, 1)
         ON CONFLICT(account_id) DO UPDATE SET sequence = sequence + 1`,
      )
      .run(accountId);
    return this.#currentCursor(accountId);
  }

  #change(row: SqlRow): SyncChange {
    return syncChangeSchema.parse({
      cursor: cursor(Number(row.cursor_sequence)),
      accountId: row.account_id,
      objectType: row.object_type,
      objectId: row.object_id,
      revision: row.revision,
      tombstone: Boolean(row.tombstone),
      payloadVersion: row.payload_version,
      payload: row.payload_json === null ? null : JSON.parse(String(row.payload_json)),
      operationId: row.operation_id,
      changedAt: row.changed_at,
      retainUntil: row.retain_until,
    });
  }

  #conflict(row: SqlRow): SyncConflict {
    return syncConflictSchema.parse({
      conflictId: row.conflict_id,
      accountId: row.account_id,
      objectType: row.object_type,
      objectId: row.object_id,
      operationId: row.operation_id,
      clientBaseRevision: row.client_base_revision,
      serverRevision: row.server_revision,
      clientPayload:
        row.client_payload_json === null ? null : JSON.parse(String(row.client_payload_json)),
      serverPayload:
        row.server_payload_json === null ? null : JSON.parse(String(row.server_payload_json)),
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    });
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #migrate(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS account_cursors (
        account_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL CHECK (sequence >= 0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sync_objects (
        account_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
        payload_version INTEGER NOT NULL CHECK (payload_version = 1),
        payload_json TEXT,
        operation_id TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        retain_until TEXT,
        PRIMARY KEY(account_id, object_type, object_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sync_changes (
        account_id TEXT NOT NULL,
        cursor_sequence INTEGER NOT NULL CHECK (cursor_sequence > 0),
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        tombstone INTEGER NOT NULL CHECK (tombstone IN (0, 1)),
        payload_version INTEGER NOT NULL CHECK (payload_version = 1),
        payload_json TEXT,
        operation_id TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        retain_until TEXT,
        PRIMARY KEY(account_id, cursor_sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sync_operations (
        operation_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        conflict_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        client_base_revision INTEGER NOT NULL,
        server_revision INTEGER NOT NULL,
        client_payload_json TEXT,
        server_payload_json TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS sync_conflicts_account_idx
        ON sync_conflicts(account_id, resolved_at, created_at);
    `);
  }
}
