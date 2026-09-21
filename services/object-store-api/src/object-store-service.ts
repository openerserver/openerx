import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type CloudObjectDescriptor,
  type CloudObjectIntentInput,
  type CloudObjectTransferIntent,
  cloudObjectDescriptorSchema,
  cloudObjectIntentInputSchema,
  cloudObjectTransferIntentSchema,
  type SyncPrincipal,
} from "@openerx/contracts";

type SqlRow = Record<string, unknown>;

export interface ObjectStoreServiceOptions {
  now?: () => Date;
  tokenFactory?: () => string;
  intentTtlMs?: number;
}

export class ObjectStoreService {
  readonly #database: DatabaseSync;
  readonly #root: string;
  readonly #now: () => Date;
  readonly #tokenFactory: () => string;
  readonly #intentTtlMs: number;

  constructor(
    databasePath: string,
    rootDirectory: string,
    options: ObjectStoreServiceOptions = {},
  ) {
    this.#database = new DatabaseSync(databasePath);
    this.#root = path.resolve(rootDirectory);
    this.#now = options.now ?? (() => new Date());
    this.#tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("hex"));
    this.#intentTtlMs = options.intentTtlMs ?? 5 * 60_000;
    mkdirSync(this.#root, { recursive: true });
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  createUploadIntent(
    principal: SyncPrincipal,
    input: CloudObjectIntentInput,
  ): CloudObjectTransferIntent {
    this.#assertPrincipal(principal);
    const parsed = cloudObjectIntentInputSchema.parse(input);
    return this.#createIntent(principal, "upload", parsed);
  }

  upload(principal: SyncPrincipal, token: string, bytes: Uint8Array): CloudObjectDescriptor {
    const ticket = this.#ticket(principal, token, "upload");
    if (bytes.byteLength !== Number(ticket.size_bytes)) throw new Error("OBJECT_SIZE_MISMATCH");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== ticket.checksum_sha256) throw new Error("OBJECT_CHECKSUM_MISMATCH");
    const storedPath = this.#objectPath(principal.accountId, checksum);
    mkdirSync(path.dirname(storedPath), { recursive: true });
    if (!existsSync(storedPath)) writeFileSync(storedPath, bytes, { flag: "wx" });
    const createdAt = this.#now().toISOString();
    const existing = this.#database
      .prepare("SELECT * FROM cloud_objects WHERE account_id = ? AND object_id = ?")
      .get(principal.accountId, String(ticket.object_id)) as SqlRow | undefined;
    if (existing && existing.checksum_sha256 !== checksum) throw new Error("OBJECT_ID_IMMUTABLE");
    this.#database
      .prepare(
        `INSERT INTO cloud_objects
         (account_id, object_id, checksum_sha256, size_bytes, media_type, stored_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, object_id) DO NOTHING`,
      )
      .run(
        principal.accountId,
        String(ticket.object_id),
        checksum,
        bytes.byteLength,
        String(ticket.media_type),
        storedPath,
        createdAt,
      );
    this.#consume(String(ticket.token_hash));
    return this.#descriptor(principal.accountId, String(ticket.object_id));
  }

  createDownloadIntent(principal: SyncPrincipal, objectId: string): CloudObjectTransferIntent {
    this.#assertPrincipal(principal);
    const descriptor = this.#descriptor(principal.accountId, objectId);
    return this.#createIntent(principal, "download", descriptor);
  }

  download(
    principal: SyncPrincipal,
    token: string,
  ): { descriptor: CloudObjectDescriptor; bytes: Uint8Array } {
    const ticket = this.#ticket(principal, token, "download");
    const descriptor = this.#descriptor(principal.accountId, String(ticket.object_id));
    const row = this.#database
      .prepare("SELECT stored_path FROM cloud_objects WHERE account_id = ? AND object_id = ?")
      .get(principal.accountId, descriptor.objectId) as { stored_path: string };
    const bytes = readFileSync(row.stored_path);
    if (createHash("sha256").update(bytes).digest("hex") !== descriptor.checksumSha256) {
      throw new Error("OBJECT_STORAGE_CORRUPT");
    }
    this.#consume(String(ticket.token_hash));
    return { descriptor, bytes };
  }

  revokeSession(sessionId: string): void {
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO revoked_object_sessions(session_id, revoked_at) VALUES (?, ?)",
      )
      .run(sessionId, this.#now().toISOString());
    this.#database
      .prepare("UPDATE object_transfer_intents SET consumed_at = ? WHERE session_id = ?")
      .run(this.#now().toISOString(), sessionId);
  }

  deleteAccountData(principal: SyncPrincipal): number {
    this.#assertPrincipal(principal);
    const result = this.#database
      .prepare("DELETE FROM cloud_objects WHERE account_id = ?")
      .run(principal.accountId);
    this.#database
      .prepare("DELETE FROM object_transfer_intents WHERE account_id = ?")
      .run(principal.accountId);
    const accountDirectory = path.join(this.#root, "accounts", principal.accountId);
    if (existsSync(accountDirectory)) rmSync(accountDirectory, { recursive: true, force: true });
    return Number(result.changes);
  }

  #createIntent(
    principal: SyncPrincipal,
    operation: "upload" | "download",
    input: CloudObjectIntentInput,
  ): CloudObjectTransferIntent {
    const token = this.#tokenFactory();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("OBJECT_TOKEN_FACTORY_INVALID");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(this.#now().getTime() + this.#intentTtlMs).toISOString();
    this.#database
      .prepare(
        `INSERT INTO object_transfer_intents
         (token_hash, account_id, session_id, device_id, operation, object_id,
          checksum_sha256, size_bytes, media_type, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        tokenHash,
        principal.accountId,
        principal.sessionId,
        principal.deviceId,
        operation,
        input.objectId,
        input.checksumSha256,
        input.sizeBytes,
        input.mediaType,
        expiresAt,
      );
    return cloudObjectTransferIntentSchema.parse({
      token,
      operation,
      objectId: input.objectId,
      expiresAt,
    });
  }

  #ticket(principal: SyncPrincipal, token: string, operation: "upload" | "download"): SqlRow {
    this.#assertPrincipal(principal);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("OBJECT_INTENT_INVALID");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = this.#database
      .prepare("SELECT * FROM object_transfer_intents WHERE token_hash = ?")
      .get(tokenHash) as SqlRow | undefined;
    if (!row) throw new Error("OBJECT_INTENT_INVALID");
    if (
      row.account_id !== principal.accountId ||
      row.session_id !== principal.sessionId ||
      row.device_id !== principal.deviceId
    ) {
      throw new Error("OBJECT_INTENT_SCOPE_VIOLATION");
    }
    if (row.operation !== operation) throw new Error("OBJECT_INTENT_OPERATION_MISMATCH");
    if (row.consumed_at !== null) throw new Error("OBJECT_INTENT_CONSUMED");
    if (Date.parse(String(row.expires_at)) <= this.#now().getTime()) {
      throw new Error("OBJECT_INTENT_EXPIRED");
    }
    return row;
  }

  #consume(tokenHash: string): void {
    this.#database
      .prepare("UPDATE object_transfer_intents SET consumed_at = ? WHERE token_hash = ?")
      .run(this.#now().toISOString(), tokenHash);
  }

  #descriptor(accountId: string, objectId: string): CloudObjectDescriptor {
    const row = this.#database
      .prepare("SELECT * FROM cloud_objects WHERE account_id = ? AND object_id = ?")
      .get(accountId, objectId) as SqlRow | undefined;
    if (!row) throw new Error("OBJECT_NOT_FOUND");
    return cloudObjectDescriptorSchema.parse({
      accountId: row.account_id,
      objectId: row.object_id,
      checksumSha256: row.checksum_sha256,
      sizeBytes: row.size_bytes,
      mediaType: row.media_type,
      createdAt: row.created_at,
    });
  }

  #objectPath(accountId: string, checksum: string): string {
    return path.join(this.#root, "accounts", accountId, "objects", checksum.slice(0, 2), checksum);
  }

  #assertPrincipal(principal: SyncPrincipal): void {
    const revoked = this.#database
      .prepare("SELECT 1 FROM revoked_object_sessions WHERE session_id = ?")
      .get(principal.sessionId);
    if (revoked) throw new Error("DEVICE_SESSION_REVOKED");
  }

  #migrate(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS cloud_objects (
        account_id TEXT NOT NULL,
        object_id TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        media_type TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(account_id, object_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS object_transfer_intents (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upload', 'download')),
        object_id TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        media_type TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS revoked_object_sessions (
        session_id TEXT PRIMARY KEY,
        revoked_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS object_intents_account_idx
        ON object_transfer_intents(account_id, expires_at);
    `);
  }
}
