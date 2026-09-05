import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type AccountIdentity,
  accountIdentitySchema,
  type DeviceDescriptor,
  type DeviceSession,
  type DeviceSessionGrant,
  deviceDescriptorSchema,
  deviceSessionGrantSchema,
  deviceSessionSchema,
  type EmailChallenge,
  emailChallengeSchema,
} from "@openerx/contracts";

type SqlRow = Record<string, unknown>;

export interface ChallengeMailer {
  deliver(input: { email: string; code: string; expiresAt: string }): Promise<void>;
}

export interface IdentityServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
  codeFactory?: () => string;
  challengeTtlMs?: number;
  accessTokenTtlMs?: number;
  challengeCooldownMs?: number;
  mailer: ChallengeMailer;
}

export interface AccessPrincipal {
  accountId: string;
  sessionId: string;
  deviceId: string;
  sessionVersion: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function matchesDigest(value: string, expectedHex: unknown): boolean {
  if (typeof expectedHex !== "string" || !/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  return timingSafeEqual(digest(value), Buffer.from(expectedHex, "hex"));
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export class IdentityService {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #tokenFactory: () => string;
  readonly #codeFactory: () => string;
  readonly #challengeTtlMs: number;
  readonly #accessTokenTtlMs: number;
  readonly #challengeCooldownMs: number;
  readonly #mailer: ChallengeMailer;

  constructor(databasePath: string, options: IdentityServiceOptions) {
    this.#database = new DatabaseSync(databasePath);
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.#codeFactory =
      options.codeFactory ?? (() => randomInt(0, 1_000_000).toString().padStart(6, "0"));
    this.#challengeTtlMs = options.challengeTtlMs ?? 10 * 60_000;
    this.#accessTokenTtlMs = options.accessTokenTtlMs ?? 5 * 60_000;
    this.#challengeCooldownMs = options.challengeCooldownMs ?? 30_000;
    this.#mailer = options.mailer;
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  async requestChallenge(emailInput: string): Promise<EmailChallenge> {
    const email = normalizedEmail(emailInput);
    const now = this.#now();
    const recent = this.#database
      .prepare(
        `SELECT created_at FROM identity_challenges
         WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(email) as SqlRow | undefined;
    if (
      recent &&
      now.getTime() - new Date(String(recent.created_at)).getTime() < this.#challengeCooldownMs
    ) {
      throw new Error("CHALLENGE_RATE_LIMITED");
    }
    const challengeId = this.#idFactory();
    const code = this.#codeFactory();
    if (!/^\d{6}$/.test(code)) throw new Error("Challenge code factory returned an invalid code");
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.#challengeTtlMs).toISOString();
    this.#database
      .prepare(
        `INSERT INTO identity_challenges
         (challenge_id, email, code_hash, created_at, expires_at, consumed_at, attempts)
         VALUES (?, ?, ?, ?, ?, NULL, 0)`,
      )
      .run(challengeId, email, digest(code).toString("hex"), createdAt, expiresAt);
    try {
      await this.#mailer.deliver({ email, code, expiresAt });
    } catch (error) {
      this.#database
        .prepare("DELETE FROM identity_challenges WHERE challenge_id = ?")
        .run(challengeId);
      throw error;
    }
    return emailChallengeSchema.parse({ challengeId, email, expiresAt });
  }

  verifyChallenge(input: {
    challengeId: string;
    code: string;
    device: DeviceDescriptor;
  }): DeviceSessionGrant {
    const device = deviceDescriptorSchema.parse(input.device);
    return this.#transaction(() => {
      const challenge = this.#database
        .prepare("SELECT * FROM identity_challenges WHERE challenge_id = ?")
        .get(input.challengeId) as SqlRow | undefined;
      if (!challenge) throw new Error("CHALLENGE_INVALID");
      if (challenge.consumed_at !== null) throw new Error("CHALLENGE_CONSUMED");
      const now = this.#now();
      if (new Date(String(challenge.expires_at)).getTime() <= now.getTime()) {
        throw new Error("CHALLENGE_EXPIRED");
      }
      const attempts = Number(challenge.attempts);
      if (attempts >= 5) throw new Error("CHALLENGE_ATTEMPTS_EXCEEDED");
      if (!matchesDigest(input.code, challenge.code_hash)) {
        this.#database
          .prepare("UPDATE identity_challenges SET attempts = attempts + 1 WHERE challenge_id = ?")
          .run(input.challengeId);
        throw new Error("CHALLENGE_CODE_INVALID");
      }
      const email = String(challenge.email);
      const nowIso = now.toISOString();
      let account = this.#accountByEmail(email);
      if (!account) {
        const accountId = this.#idFactory();
        const displayName = email.split("@")[0] || "OpenERX User";
        this.#database
          .prepare(
            `INSERT INTO accounts(account_id, email, display_name, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(accountId, email, displayName, nowIso);
        account = this.#account(accountId);
      }
      this.#database
        .prepare("UPDATE identity_challenges SET consumed_at = ? WHERE challenge_id = ?")
        .run(nowIso, input.challengeId);
      const sessionId = this.#idFactory();
      const refreshCredential = this.#tokenFactory();
      this.#database
        .prepare(
          `INSERT INTO device_sessions
           (session_id, account_id, device_id, device_name, platform, arch, session_version,
            refresh_hash, previous_refresh_hash, created_at, last_active_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, NULL)`,
        )
        .run(
          sessionId,
          account.accountId,
          device.deviceId,
          device.name,
          device.platform,
          device.arch,
          digest(refreshCredential).toString("hex"),
          nowIso,
          nowIso,
        );
      return this.#grant(account, this.#session(sessionId), refreshCredential, now);
    });
  }

  refresh(sessionId: string, refreshCredential: string): DeviceSessionGrant {
    const result = this.#transaction<DeviceSessionGrant | "replayed">(() => {
      const row = this.#sessionRow(sessionId);
      if (row.revoked_at !== null) throw new Error("DEVICE_SESSION_REVOKED");
      if (matchesDigest(refreshCredential, row.previous_refresh_hash)) {
        this.#revokeSession(sessionId, this.#now().toISOString());
        return "replayed";
      }
      if (!matchesDigest(refreshCredential, row.refresh_hash)) {
        throw new Error("REFRESH_CREDENTIAL_INVALID");
      }
      const now = this.#now();
      const nextCredential = this.#tokenFactory();
      this.#database
        .prepare(
          `UPDATE device_sessions
           SET previous_refresh_hash = refresh_hash, refresh_hash = ?,
               session_version = session_version + 1, last_active_at = ?
           WHERE session_id = ?`,
        )
        .run(digest(nextCredential).toString("hex"), now.toISOString(), sessionId);
      this.#database.prepare("DELETE FROM access_tokens WHERE session_id = ?").run(sessionId);
      const session = this.#session(sessionId);
      return this.#grant(this.#account(session.accountId), session, nextCredential, now);
    });
    if (result === "replayed") throw new Error("REFRESH_REPLAY_REVOKED");
    return result;
  }

  authenticate(accessToken: string): AccessPrincipal {
    const row = this.#database
      .prepare(
        `SELECT t.*, s.account_id, s.device_id, s.session_version, s.revoked_at
         FROM access_tokens t JOIN device_sessions s ON s.session_id = t.session_id
         WHERE t.token_hash = ?`,
      )
      .get(digest(accessToken).toString("hex")) as SqlRow | undefined;
    if (!row) throw new Error("ACCESS_TOKEN_INVALID");
    if (row.revoked_at !== null) throw new Error("DEVICE_SESSION_REVOKED");
    if (new Date(String(row.expires_at)).getTime() <= this.#now().getTime()) {
      throw new Error("ACCESS_TOKEN_EXPIRED");
    }
    if (Number(row.session_version) !== Number(row.issued_session_version)) {
      throw new Error("ACCESS_TOKEN_SUPERSEDED");
    }
    return {
      accountId: String(row.account_id),
      sessionId: String(row.session_id),
      deviceId: String(row.device_id),
      sessionVersion: Number(row.session_version),
    };
  }

  revokeDevice(principal: AccessPrincipal, sessionId: string): DeviceSession {
    return this.#transaction(() => {
      const target = this.#session(sessionId);
      if (target.accountId !== principal.accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
      if (!target.revokedAt) this.#revokeSession(sessionId, this.#now().toISOString());
      return this.#session(sessionId);
    });
  }

  revokeAllDevices(principal: AccessPrincipal): DeviceSession[] {
    return this.#transaction(() => {
      const revokedAt = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE device_sessions SET revoked_at = COALESCE(revoked_at, ?)
           WHERE account_id = ?`,
        )
        .run(revokedAt, principal.accountId);
      return this.listDevices(principal);
    });
  }

  listDevices(principal: AccessPrincipal): DeviceSession[] {
    return (
      this.#database
        .prepare("SELECT session_id FROM device_sessions WHERE account_id = ? ORDER BY created_at")
        .all(principal.accountId) as SqlRow[]
    ).map((row) => this.#session(String(row.session_id)));
  }

  #grant(
    account: AccountIdentity,
    session: DeviceSession,
    refreshCredential: string,
    now: Date,
  ): DeviceSessionGrant {
    const accessToken = this.#tokenFactory();
    const accessTokenExpiresAt = new Date(now.getTime() + this.#accessTokenTtlMs).toISOString();
    this.#database
      .prepare(
        `INSERT INTO access_tokens
         (token_hash, session_id, issued_session_version, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        digest(accessToken).toString("hex"),
        session.sessionId,
        session.sessionVersion,
        now.toISOString(),
        accessTokenExpiresAt,
      );
    return deviceSessionGrantSchema.parse({
      account,
      session,
      refreshCredential,
      accessToken,
      accessTokenExpiresAt,
    });
  }

  #accountByEmail(email: string): AccountIdentity | null {
    const row = this.#database
      .prepare("SELECT account_id FROM accounts WHERE email = ?")
      .get(email) as SqlRow | undefined;
    return row ? this.#account(String(row.account_id)) : null;
  }

  #account(accountId: string): AccountIdentity {
    const row = this.#database
      .prepare("SELECT * FROM accounts WHERE account_id = ?")
      .get(accountId) as SqlRow | undefined;
    if (!row) throw new Error("ACCOUNT_NOT_FOUND");
    return accountIdentitySchema.parse({
      accountId: row.account_id,
      email: row.email,
      displayName: row.display_name,
      createdAt: row.created_at,
    });
  }

  #sessionRow(sessionId: string): SqlRow {
    const row = this.#database
      .prepare("SELECT * FROM device_sessions WHERE session_id = ?")
      .get(sessionId) as SqlRow | undefined;
    if (!row) throw new Error("DEVICE_SESSION_NOT_FOUND");
    return row;
  }

  #session(sessionId: string): DeviceSession {
    const row = this.#sessionRow(sessionId);
    return deviceSessionSchema.parse({
      sessionId: row.session_id,
      accountId: row.account_id,
      device: {
        deviceId: row.device_id,
        name: row.device_name,
        platform: row.platform,
        arch: row.arch,
      },
      sessionVersion: row.session_version,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      revokedAt: row.revoked_at,
    });
  }

  #revokeSession(sessionId: string, revokedAt: string): void {
    this.#database
      .prepare("UPDATE device_sessions SET revoked_at = ? WHERE session_id = ?")
      .run(revokedAt, sessionId);
    this.#database.prepare("DELETE FROM access_tokens WHERE session_id = ?").run(sessionId);
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
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS identity_challenges (
        challenge_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        attempts INTEGER NOT NULL CHECK (attempts >= 0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS device_sessions (
        session_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(account_id),
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('darwin', 'win32', 'ios', 'android')),
        arch TEXT NOT NULL CHECK (arch IN ('arm64', 'x64')),
        session_version INTEGER NOT NULL CHECK (session_version > 0),
        refresh_hash TEXT NOT NULL,
        previous_refresh_hash TEXT,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS access_tokens (
        token_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES device_sessions(session_id),
        issued_session_version INTEGER NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS challenge_email_idx
        ON identity_challenges(email, created_at DESC);
      CREATE INDEX IF NOT EXISTS sessions_account_idx
        ON device_sessions(account_id, created_at);
    `);
    const sessionTable = this.#database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'device_sessions'")
      .get() as { sql: string } | undefined;
    if (sessionTable && !sessionTable.sql.includes("'ios'")) this.#migrateMobileDevicePlatforms();
  }

  #migrateMobileDevicePlatforms(): void {
    this.#database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.#database.exec(`
        BEGIN IMMEDIATE;
      CREATE TABLE device_sessions_next (
        session_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(account_id),
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('darwin', 'win32', 'ios', 'android')),
        arch TEXT NOT NULL CHECK (arch IN ('arm64', 'x64')),
        session_version INTEGER NOT NULL CHECK (session_version > 0),
        refresh_hash TEXT NOT NULL,
        previous_refresh_hash TEXT,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
      INSERT INTO device_sessions_next SELECT * FROM device_sessions;
      CREATE TABLE access_tokens_next AS SELECT * FROM access_tokens;
      DROP TABLE access_tokens;
      DROP TABLE device_sessions;
      ALTER TABLE device_sessions_next RENAME TO device_sessions;
      CREATE TABLE access_tokens (
        token_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES device_sessions(session_id),
        issued_session_version INTEGER NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO access_tokens SELECT * FROM access_tokens_next;
      DROP TABLE access_tokens_next;
      CREATE INDEX IF NOT EXISTS sessions_account_idx
        ON device_sessions(account_id, created_at);
        COMMIT;
      `);
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // SQLite already rolled back the failed migration statement.
      }
      throw error;
    } finally {
      this.#database.exec("PRAGMA foreign_keys = ON");
    }
  }
}
