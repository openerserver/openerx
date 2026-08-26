import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type AccessPrincipal,
  type PushSubscription,
  pushSubscriptionSchema,
  type RemoteCommand,
  type RemoteCommandReceipt,
  type RemoteControlServicePort,
  type RemoteDevicePairing,
  type RemoteEventCursor,
  type RemoteEventPublishInput,
  type RemoteHost,
  type RemoteHostRegistrationInput,
  type RemotePairingAcceptInput,
  type RemotePairingChallenge,
  type RemoteProductEvent,
  type RemotePushEnvelope,
  remoteCommandReceiptSchema,
  remoteCommandSchema,
  remoteDevicePairingSchema,
  remoteEventCursorSchema,
  remoteHostSchema,
  remotePairingChallengeSchema,
  remoteProductEventSchema,
  remotePushEnvelopeSchema,
} from "@openerx/contracts";
import { verifyRemoteCommand, verifyRemotePairingProof } from "@openerx/remote-protocol";

type SqlRow = Record<string, unknown>;

interface GatewayOptions {
  now?: () => Date;
  idFactory?: () => string;
  nonceFactory?: () => string;
  pairingChallengeTtlMs?: number;
  pairingTtlMs?: number;
  commandMaxTtlMs?: number;
  eventMaxTtlMs?: number;
}

function error(code: string): never {
  throw new Error(code);
}

function cursorSequence(cursor: string | null): number {
  if (!cursor) return 0;
  const value = Number(cursor.slice("remote:".length));
  if (!Number.isSafeInteger(value) || value < 0) error("REMOTE_CURSOR_INVALID");
  return value;
}

export class RemoteControlGateway implements RemoteControlServicePort {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #nonceFactory: () => string;
  readonly #pairingChallengeTtlMs: number;
  readonly #pairingTtlMs: number;
  readonly #commandMaxTtlMs: number;
  readonly #eventMaxTtlMs: number;

  constructor(databasePath: string, options: GatewayOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString("base64url"));
    this.#pairingChallengeTtlMs = options.pairingChallengeTtlMs ?? 2 * 60_000;
    this.#pairingTtlMs = options.pairingTtlMs ?? 90 * 24 * 60 * 60_000;
    this.#commandMaxTtlMs = options.commandMaxTtlMs ?? 2 * 60_000;
    this.#eventMaxTtlMs = options.eventMaxTtlMs ?? 24 * 60 * 60_000;
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  registerHost(principal: AccessPrincipal, input: RemoteHostRegistrationInput): RemoteHost {
    if (input.hostDeviceId !== principal.deviceId) error("REMOTE_HOST_DEVICE_MISMATCH");
    const now = this.#now().toISOString();
    const existing = this.#hostRow(principal.accountId, input.hostDeviceId, false);
    const revision = existing ? Number(existing.revision) + 1 : 1;
    this.#database
      .prepare(
        `INSERT INTO remote_hosts
         (account_id, host_device_id, display_name, platform, arch, app_version, capabilities_json,
          presence, remote_enabled, revision, presence_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?)
         ON CONFLICT(account_id, host_device_id) DO UPDATE SET
           display_name = excluded.display_name, platform = excluded.platform, arch = excluded.arch,
           app_version = excluded.app_version, capabilities_json = excluded.capabilities_json,
           remote_enabled = excluded.remote_enabled, revision = excluded.revision,
           presence = CASE WHEN excluded.remote_enabled = 1 THEN remote_hosts.presence ELSE 'offline' END,
           presence_changed_at = CASE WHEN excluded.remote_enabled = 1 THEN remote_hosts.presence_changed_at ELSE excluded.presence_changed_at END`,
      )
      .run(
        principal.accountId,
        input.hostDeviceId,
        input.displayName,
        input.platform,
        input.arch,
        input.appVersion,
        JSON.stringify(input.capabilities),
        input.remoteEnabled ? 1 : 0,
        revision,
        now,
      );
    if (!input.remoteEnabled) this.#expirePendingCommands(input.hostDeviceId, "REMOTE_DISABLED");
    this.#audit(principal, "host.register", input.hostDeviceId, "OK");
    return this.#host(principal.accountId, input.hostDeviceId);
  }

  listHosts(principal: AccessPrincipal): RemoteHost[] {
    return (
      this.#database
        .prepare("SELECT * FROM remote_hosts WHERE account_id = ? ORDER BY display_name")
        .all(principal.accountId) as SqlRow[]
    ).map((row) => this.#parseHost(row));
  }

  updatePresence(
    principal: AccessPrincipal,
    input: { hostDeviceId: string; presence: "online" | "degraded" | "offline"; revision: number },
  ): RemoteHost {
    if (input.hostDeviceId !== principal.deviceId) error("REMOTE_HOST_DEVICE_MISMATCH");
    const host = this.#host(principal.accountId, input.hostDeviceId);
    if (!host.remoteEnabled && input.presence !== "offline") error("REMOTE_DISABLED");
    if (input.revision !== host.revision) error("REMOTE_HOST_REVISION_CONFLICT");
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `UPDATE remote_hosts SET presence = ?, presence_changed_at = ?, revision = revision + 1
         WHERE account_id = ? AND host_device_id = ?`,
      )
      .run(input.presence, now, principal.accountId, input.hostDeviceId);
    if (input.presence === "offline")
      this.#expirePendingCommands(input.hostDeviceId, "HOST_OFFLINE");
    this.#audit(principal, "host.presence", input.hostDeviceId, input.presence.toUpperCase());
    return this.#host(principal.accountId, input.hostDeviceId);
  }

  createPairingChallenge(
    principal: AccessPrincipal,
    input: { hostDeviceId: string; hostPublicKey: string },
  ): RemotePairingChallenge {
    if (input.hostDeviceId !== principal.deviceId) error("REMOTE_HOST_DEVICE_MISMATCH");
    const host = this.#host(principal.accountId, input.hostDeviceId);
    if (!host.remoteEnabled) error("REMOTE_DISABLED");
    const createdAt = this.#now();
    const challenge = remotePairingChallengeSchema.parse({
      version: 1,
      challengeId: this.#idFactory(),
      accountId: principal.accountId,
      hostDeviceId: input.hostDeviceId,
      oneTimeNonce: this.#nonceFactory(),
      hostPublicKey: input.hostPublicKey,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.#pairingChallengeTtlMs).toISOString(),
    });
    this.#database
      .prepare(
        `INSERT INTO remote_pairing_challenges
         (challenge_id, account_id, host_device_id, nonce, host_public_key, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        challenge.challengeId,
        challenge.accountId,
        challenge.hostDeviceId,
        challenge.oneTimeNonce,
        challenge.hostPublicKey,
        challenge.createdAt,
        challenge.expiresAt,
      );
    this.#audit(principal, "pairing.challenge", challenge.challengeId, "CREATED");
    return challenge;
  }

  acceptPairing(principal: AccessPrincipal, input: RemotePairingAcceptInput): RemoteDevicePairing {
    if (principal.deviceId !== input.controllerDeviceId) error("REMOTE_CONTROLLER_DEVICE_MISMATCH");
    return this.#transaction(() => {
      const row = this.#database
        .prepare("SELECT * FROM remote_pairing_challenges WHERE challenge_id = ?")
        .get(input.challengeId) as SqlRow | undefined;
      if (!row) error("REMOTE_PAIRING_CHALLENGE_NOT_FOUND");
      if (String(row.account_id) !== principal.accountId) error("ACCOUNT_SCOPE_VIOLATION");
      if (row.consumed_at !== null) error("REMOTE_PAIRING_CHALLENGE_REPLAYED");
      if (Date.parse(String(row.expires_at)) <= this.#now().getTime()) {
        error("REMOTE_PAIRING_CHALLENGE_EXPIRED");
      }
      if (String(row.nonce) !== input.oneTimeNonce) error("REMOTE_PAIRING_NONCE_INVALID");
      if (
        !verifyRemotePairingProof(
          input.challengeId,
          input.oneTimeNonce,
          input.controllerDeviceId,
          input.controllerPublicKey,
          input.proof,
        )
      ) {
        error("REMOTE_PAIRING_PROOF_INVALID");
      }
      const createdAt = this.#now();
      const pairing = remoteDevicePairingSchema.parse({
        version: 1,
        pairingId: this.#idFactory(),
        accountId: principal.accountId,
        controllerDeviceId: input.controllerDeviceId,
        hostDeviceId: row.host_device_id,
        controllerPublicKey: input.controllerPublicKey,
        hostPublicKey: row.host_public_key,
        status: "active",
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + this.#pairingTtlMs).toISOString(),
        revokedAt: null,
      });
      this.#database
        .prepare(
          `INSERT INTO remote_pairings
           (pairing_id, account_id, controller_device_id, host_device_id, controller_public_key,
            host_public_key, status, created_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
        )
        .run(
          pairing.pairingId,
          pairing.accountId,
          pairing.controllerDeviceId,
          pairing.hostDeviceId,
          pairing.controllerPublicKey,
          pairing.hostPublicKey,
          pairing.createdAt,
          pairing.expiresAt,
        );
      this.#database
        .prepare("UPDATE remote_pairing_challenges SET consumed_at = ? WHERE challenge_id = ?")
        .run(createdAt.toISOString(), input.challengeId);
      this.#audit(principal, "pairing.accept", pairing.pairingId, "ACTIVE");
      return pairing;
    });
  }

  listPairings(principal: AccessPrincipal): RemoteDevicePairing[] {
    this.#expirePairings();
    return (
      this.#database
        .prepare("SELECT * FROM remote_pairings WHERE account_id = ? ORDER BY created_at DESC")
        .all(principal.accountId) as SqlRow[]
    ).map((row) => this.#parsePairing(row));
  }

  revokePairing(principal: AccessPrincipal, pairingId: string): RemoteDevicePairing {
    const pairing = this.#pairing(pairingId);
    if (pairing.accountId !== principal.accountId) error("ACCOUNT_SCOPE_VIOLATION");
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `UPDATE remote_pairings SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?)
         WHERE pairing_id = ?`,
      )
      .run(now, pairingId);
    this.#database
      .prepare(
        `UPDATE remote_commands SET status = 'expired', result_code = 'PAIRING_REVOKED', updated_at = ?
         WHERE pairing_id = ? AND status IN ('submitted', 'accepted')`,
      )
      .run(now, pairingId);
    this.#audit(principal, "pairing.revoke", pairingId, "REVOKED");
    return this.#pairing(pairingId);
  }

  submitCommand(principal: AccessPrincipal, commandInput: RemoteCommand): RemoteCommandReceipt {
    const command = remoteCommandSchema.parse(commandInput);
    if (command.accountId !== principal.accountId) error("ACCOUNT_SCOPE_VIOLATION");
    if (command.controllerDeviceId !== principal.deviceId)
      error("REMOTE_CONTROLLER_DEVICE_MISMATCH");
    const pairing = this.#pairing(command.pairingId);
    this.#assertActivePairing(pairing);
    if (
      pairing.accountId !== command.accountId ||
      pairing.controllerDeviceId !== command.controllerDeviceId ||
      pairing.hostDeviceId !== command.hostDeviceId
    ) {
      error("REMOTE_PAIRING_SCOPE_VIOLATION");
    }
    const host = this.#host(command.accountId, command.hostDeviceId);
    if (!host.remoteEnabled || host.presence === "offline" || host.presence === "revoked") {
      error("REMOTE_HOST_OFFLINE");
    }
    const nowMs = this.#now().getTime();
    const issuedAt = Date.parse(command.issuedAt);
    const expiresAt = Date.parse(command.expiresAt);
    if (expiresAt <= nowMs) error("REMOTE_COMMAND_EXPIRED");
    if (issuedAt > nowMs + 30_000) error("REMOTE_COMMAND_FROM_FUTURE");
    if (expiresAt - issuedAt > this.#commandMaxTtlMs) error("REMOTE_COMMAND_TTL_EXCEEDED");
    if (!verifyRemoteCommand(command, pairing.controllerPublicKey)) {
      error("REMOTE_COMMAND_SIGNATURE_INVALID");
    }

    const existing = this.#database
      .prepare("SELECT command_json FROM remote_commands WHERE command_id = ?")
      .get(command.commandId) as { command_json: string } | undefined;
    if (existing) {
      if (existing.command_json !== JSON.stringify(command))
        error("REMOTE_COMMAND_REPLAY_CONFLICT");
      return this.#receipt(command.commandId);
    }
    const sameIdempotency = this.#database
      .prepare(
        "SELECT command_id, command_json FROM remote_commands WHERE pairing_id = ? AND idempotency_key = ?",
      )
      .get(command.pairingId, command.idempotencyKey) as
      | { command_id: string; command_json: string }
      | undefined;
    if (sameIdempotency) {
      if (sameIdempotency.command_json !== JSON.stringify(command)) {
        error("REMOTE_IDEMPOTENCY_CONFLICT");
      }
      return this.#receipt(sameIdempotency.command_id);
    }
    const sessionKey = command.conversationId ?? command.generationId ?? "host";
    const lastSequence = this.#database
      .prepare(
        "SELECT MAX(session_sequence) AS value FROM remote_commands WHERE pairing_id = ? AND session_key = ?",
      )
      .get(command.pairingId, sessionKey) as { value: number | null };
    if (lastSequence.value !== null && command.sessionSequence <= Number(lastSequence.value)) {
      error("REMOTE_SEQUENCE_OUT_OF_ORDER");
    }
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `INSERT INTO remote_commands
         (command_id, account_id, pairing_id, controller_device_id, host_device_id, session_key,
          session_sequence, idempotency_key, command_json, status, result_code, applied_revision,
          received_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', NULL, NULL, ?, ?, ?)`,
      )
      .run(
        command.commandId,
        command.accountId,
        command.pairingId,
        command.controllerDeviceId,
        command.hostDeviceId,
        sessionKey,
        command.sessionSequence,
        command.idempotencyKey,
        JSON.stringify(command),
        now,
        now,
        command.expiresAt,
      );
    this.#audit(principal, "command.submit", command.commandId, "SUBMITTED", command);
    return this.#receipt(command.commandId);
  }

  pullHostCommands(principal: AccessPrincipal, hostDeviceId: string, limit = 20): RemoteCommand[] {
    if (principal.deviceId !== hostDeviceId) error("REMOTE_HOST_DEVICE_MISMATCH");
    const host = this.#host(principal.accountId, hostDeviceId);
    if (!host.remoteEnabled || host.presence === "offline") error("REMOTE_HOST_OFFLINE");
    this.#expireCommands();
    return (
      this.#database
        .prepare(
          `SELECT command_json FROM remote_commands
           WHERE account_id = ? AND host_device_id = ? AND status IN ('submitted', 'accepted')
           ORDER BY received_at LIMIT ?`,
        )
        .all(principal.accountId, hostDeviceId, Math.max(1, Math.min(limit, 100))) as Array<{
        command_json: string;
      }>
    ).map(({ command_json }) => remoteCommandSchema.parse(JSON.parse(command_json)));
  }

  recordReceipt(
    principal: AccessPrincipal,
    receiptInput: RemoteCommandReceipt,
  ): RemoteCommandReceipt {
    const receipt = remoteCommandReceiptSchema.parse(receiptInput);
    const command = this.#command(receipt.commandId);
    if (
      command.accountId !== principal.accountId ||
      command.hostDeviceId !== principal.deviceId ||
      receipt.accountId !== principal.accountId ||
      receipt.hostDeviceId !== principal.deviceId ||
      receipt.pairingId !== command.pairingId
    ) {
      error("REMOTE_RECEIPT_SCOPE_VIOLATION");
    }
    const current = this.#receipt(receipt.commandId);
    const transitions: Record<RemoteCommandReceipt["status"], RemoteCommandReceipt["status"][]> = {
      submitted: ["accepted", "rejected", "expired"],
      accepted: ["applied", "rejected", "expired"],
      applied: [],
      rejected: [],
      expired: [],
    };
    if (current.status === receipt.status) return current;
    if (!transitions[current.status].includes(receipt.status))
      error("REMOTE_RECEIPT_TRANSITION_INVALID");
    this.#database
      .prepare(
        `UPDATE remote_commands SET status = ?, result_code = ?, applied_revision = ?, updated_at = ?
         WHERE command_id = ?`,
      )
      .run(
        receipt.status,
        receipt.resultCode,
        receipt.appliedRevision,
        receipt.updatedAt,
        receipt.commandId,
      );
    this.#audit(
      principal,
      "command.receipt",
      receipt.commandId,
      receipt.status.toUpperCase(),
      command,
    );
    return this.#receipt(receipt.commandId);
  }

  publishEvent(principal: AccessPrincipal, input: RemoteEventPublishInput): RemoteProductEvent {
    if (
      input.event.accountId !== principal.accountId ||
      input.event.hostDeviceId !== principal.deviceId
    ) {
      error("REMOTE_EVENT_SCOPE_VIOLATION");
    }
    const pairing = this.#pairing(input.pairingId);
    this.#assertActivePairing(pairing);
    if (
      pairing.accountId !== principal.accountId ||
      pairing.hostDeviceId !== principal.deviceId ||
      pairing.controllerDeviceId !== input.controllerDeviceId
    ) {
      error("REMOTE_EVENT_PAIRING_VIOLATION");
    }
    const nowMs = this.#now().getTime();
    const expiresAt = Date.parse(input.expiresAt);
    if (expiresAt <= nowMs || expiresAt - nowMs > this.#eventMaxTtlMs) {
      error("REMOTE_EVENT_TTL_INVALID");
    }
    const duplicate = this.#database
      .prepare("SELECT sequence FROM remote_events WHERE event_id = ?")
      .get(input.event.eventId) as { sequence: number } | undefined;
    if (duplicate) return this.#event(duplicate.sequence);
    const result = this.#database
      .prepare(
        `INSERT INTO remote_events
         (event_id, account_id, pairing_id, controller_device_id, host_device_id, conversation_id,
          kind, occurred_at, encrypted_payload, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.event.eventId,
        input.event.accountId,
        input.pairingId,
        input.controllerDeviceId,
        input.event.hostDeviceId,
        input.event.conversationId,
        input.event.kind,
        input.event.occurredAt,
        input.event.encryptedPayload,
        input.expiresAt,
      );
    const event = this.#event(Number(result.lastInsertRowid));
    this.#audit(principal, "event.publish", event.eventId, "ROUTED");
    return event;
  }

  listEvents(
    principal: AccessPrincipal,
    input: {
      hostDeviceId: string;
      conversationId?: string | null;
      afterCursor: string | null;
      limit?: number;
    },
  ): RemoteProductEvent[] {
    const pairings = this.listPairings(principal).filter(
      (pairing) =>
        pairing.controllerDeviceId === principal.deviceId &&
        pairing.hostDeviceId === input.hostDeviceId &&
        pairing.status === "active",
    );
    if (pairings.length === 0) error("REMOTE_PAIRING_NOT_ACTIVE");
    const pairingIds = new Set(pairings.map(({ pairingId }) => pairingId));
    const rows = this.#database
      .prepare(
        `SELECT * FROM remote_events WHERE account_id = ? AND controller_device_id = ?
         AND host_device_id = ? AND sequence > ? AND expires_at > ?
         AND (? IS NULL OR conversation_id = ?) ORDER BY sequence LIMIT ?`,
      )
      .all(
        principal.accountId,
        principal.deviceId,
        input.hostDeviceId,
        cursorSequence(input.afterCursor),
        this.#now().toISOString(),
        input.conversationId ?? null,
        input.conversationId ?? null,
        Math.max(1, Math.min(input.limit ?? 100, 500)),
      ) as SqlRow[];
    return rows
      .filter((row) => pairingIds.has(String(row.pairing_id)))
      .map((row) => this.#parseEvent(row));
  }

  acknowledgeCursor(
    principal: AccessPrincipal,
    input: { hostDeviceId: string; conversationId: string | null; cursor: string },
  ): RemoteEventCursor {
    const latestVisible = this.listEvents(principal, {
      hostDeviceId: input.hostDeviceId,
      conversationId: input.conversationId,
      afterCursor: null,
      limit: 500,
    }).at(-1);
    if (!latestVisible || cursorSequence(input.cursor) > cursorSequence(latestVisible.cursor)) {
      error("REMOTE_CURSOR_NOT_VISIBLE");
    }
    const now = this.#now().toISOString();
    const conversationKey = input.conversationId ?? "";
    this.#database
      .prepare(
        `INSERT INTO remote_event_cursors
         (account_id, controller_device_id, host_device_id, conversation_key, cursor, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, controller_device_id, host_device_id, conversation_key)
         DO UPDATE SET cursor = CASE
           WHEN CAST(SUBSTR(excluded.cursor, 8) AS INTEGER) > CAST(SUBSTR(remote_event_cursors.cursor, 8) AS INTEGER)
           THEN excluded.cursor ELSE remote_event_cursors.cursor END,
           updated_at = excluded.updated_at`,
      )
      .run(
        principal.accountId,
        principal.deviceId,
        input.hostDeviceId,
        conversationKey,
        input.cursor,
        now,
      );
    const row = this.#database
      .prepare(
        `SELECT * FROM remote_event_cursors WHERE account_id = ? AND controller_device_id = ?
         AND host_device_id = ? AND conversation_key = ?`,
      )
      .get(principal.accountId, principal.deviceId, input.hostDeviceId, conversationKey) as SqlRow;
    return remoteEventCursorSchema.parse({
      version: 1,
      accountId: row.account_id,
      controllerDeviceId: row.controller_device_id,
      hostDeviceId: row.host_device_id,
      conversationId: conversationKey || null,
      cursor: row.cursor,
      updatedAt: row.updated_at,
    });
  }

  upsertPushSubscription(principal: AccessPrincipal, input: PushSubscription): PushSubscription {
    const subscription = pushSubscriptionSchema.parse(input);
    if (
      subscription.accountId !== principal.accountId ||
      subscription.deviceId !== principal.deviceId
    ) {
      error("REMOTE_PUSH_SCOPE_VIOLATION");
    }
    this.#database
      .prepare(
        `INSERT INTO remote_push_subscriptions
         (subscription_id, account_id, device_id, platform, push_token_ref, status, rotated_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subscription_id) DO UPDATE SET push_token_ref = excluded.push_token_ref,
           status = excluded.status, rotated_at = excluded.rotated_at, revoked_at = excluded.revoked_at`,
      )
      .run(
        subscription.subscriptionId,
        subscription.accountId,
        subscription.deviceId,
        subscription.platform,
        subscription.pushTokenRef,
        subscription.status,
        subscription.rotatedAt,
        subscription.revokedAt,
      );
    return subscription;
  }

  createPushEnvelope(input: RemotePushEnvelope): RemotePushEnvelope {
    return remotePushEnvelopeSchema.parse(input);
  }

  auditRows(): SqlRow[] {
    return this.#database.prepare("SELECT * FROM remote_audit ORDER BY id").all() as SqlRow[];
  }

  #migrate(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS remote_hosts (
        account_id TEXT NOT NULL, host_device_id TEXT NOT NULL, display_name TEXT NOT NULL,
        platform TEXT NOT NULL, arch TEXT NOT NULL, app_version TEXT NOT NULL,
        capabilities_json TEXT NOT NULL, presence TEXT NOT NULL, remote_enabled INTEGER NOT NULL,
        revision INTEGER NOT NULL, presence_changed_at TEXT NOT NULL,
        PRIMARY KEY(account_id, host_device_id)
      );
      CREATE TABLE IF NOT EXISTS remote_pairing_challenges (
        challenge_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, host_device_id TEXT NOT NULL,
        nonce TEXT NOT NULL UNIQUE, host_public_key TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS remote_pairings (
        pairing_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, controller_device_id TEXT NOT NULL,
        host_device_id TEXT NOT NULL, controller_public_key TEXT NOT NULL, host_public_key TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_remote_pairings_account ON remote_pairings(account_id);
      CREATE TABLE IF NOT EXISTS remote_commands (
        command_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, pairing_id TEXT NOT NULL,
        controller_device_id TEXT NOT NULL, host_device_id TEXT NOT NULL, session_key TEXT NOT NULL,
        session_sequence INTEGER NOT NULL, idempotency_key TEXT NOT NULL, command_json TEXT NOT NULL,
        status TEXT NOT NULL, result_code TEXT, applied_revision INTEGER, received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        UNIQUE(pairing_id, idempotency_key), UNIQUE(pairing_id, session_key, session_sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_remote_commands_host ON remote_commands(account_id, host_device_id, status);
      CREATE TABLE IF NOT EXISTS remote_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL,
        pairing_id TEXT NOT NULL, controller_device_id TEXT NOT NULL, host_device_id TEXT NOT NULL,
        conversation_id TEXT, kind TEXT NOT NULL, occurred_at TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remote_events_controller
        ON remote_events(account_id, controller_device_id, host_device_id, sequence);
      CREATE TABLE IF NOT EXISTS remote_event_cursors (
        account_id TEXT NOT NULL, controller_device_id TEXT NOT NULL, host_device_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL, cursor TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(account_id, controller_device_id, host_device_id, conversation_key)
      );
      CREATE TABLE IF NOT EXISTS remote_push_subscriptions (
        subscription_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, device_id TEXT NOT NULL,
        platform TEXT NOT NULL, push_token_ref TEXT NOT NULL, status TEXT NOT NULL,
        rotated_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS remote_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, actor_device_id TEXT NOT NULL,
        action TEXT NOT NULL, target_id TEXT NOT NULL, result_code TEXT NOT NULL,
        host_device_id TEXT, controller_device_id TEXT, pairing_id TEXT, command_id TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  #host(accountId: string, hostDeviceId: string): RemoteHost {
    const row = this.#hostRow(accountId, hostDeviceId, true);
    if (!row) error("REMOTE_HOST_NOT_FOUND");
    return this.#parseHost(row);
  }

  #hostRow(accountId: string, hostDeviceId: string, required: boolean): SqlRow | undefined {
    const row = this.#database
      .prepare("SELECT * FROM remote_hosts WHERE account_id = ? AND host_device_id = ?")
      .get(accountId, hostDeviceId) as SqlRow | undefined;
    if (!row && required) error("REMOTE_HOST_NOT_FOUND");
    return row;
  }

  #parseHost(row: SqlRow): RemoteHost {
    return remoteHostSchema.parse({
      version: 1,
      accountId: row.account_id,
      hostDeviceId: row.host_device_id,
      displayName: row.display_name,
      platform: row.platform,
      arch: row.arch,
      appVersion: row.app_version,
      capabilities: JSON.parse(String(row.capabilities_json)),
      presence: row.presence,
      remoteEnabled: Boolean(row.remote_enabled),
      revision: row.revision,
      presenceChangedAt: row.presence_changed_at,
    });
  }

  #pairing(pairingId: string): RemoteDevicePairing {
    this.#expirePairings();
    const row = this.#database
      .prepare("SELECT * FROM remote_pairings WHERE pairing_id = ?")
      .get(pairingId) as SqlRow | undefined;
    if (!row) error("REMOTE_PAIRING_NOT_FOUND");
    return this.#parsePairing(row);
  }

  #parsePairing(row: SqlRow): RemoteDevicePairing {
    return remoteDevicePairingSchema.parse({
      version: 1,
      pairingId: row.pairing_id,
      accountId: row.account_id,
      controllerDeviceId: row.controller_device_id,
      hostDeviceId: row.host_device_id,
      controllerPublicKey: row.controller_public_key,
      hostPublicKey: row.host_public_key,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    });
  }

  #assertActivePairing(pairing: RemoteDevicePairing): void {
    if (pairing.status !== "active") error("REMOTE_PAIRING_NOT_ACTIVE");
  }

  #command(commandId: string): RemoteCommand {
    const row = this.#database
      .prepare("SELECT command_json FROM remote_commands WHERE command_id = ?")
      .get(commandId) as { command_json: string } | undefined;
    if (!row) error("REMOTE_COMMAND_NOT_FOUND");
    return remoteCommandSchema.parse(JSON.parse(row.command_json));
  }

  #receipt(commandId: string): RemoteCommandReceipt {
    const row = this.#database
      .prepare("SELECT * FROM remote_commands WHERE command_id = ?")
      .get(commandId) as SqlRow | undefined;
    if (!row) error("REMOTE_COMMAND_NOT_FOUND");
    return remoteCommandReceiptSchema.parse({
      version: 1,
      commandId: row.command_id,
      accountId: row.account_id,
      pairingId: row.pairing_id,
      hostDeviceId: row.host_device_id,
      status: row.status,
      resultCode: row.result_code,
      appliedRevision: row.applied_revision,
      receivedAt: row.received_at,
      updatedAt: row.updated_at,
    });
  }

  #event(sequence: number): RemoteProductEvent {
    const row = this.#database
      .prepare("SELECT * FROM remote_events WHERE sequence = ?")
      .get(sequence) as SqlRow | undefined;
    if (!row) error("REMOTE_EVENT_NOT_FOUND");
    return this.#parseEvent(row);
  }

  #parseEvent(row: SqlRow): RemoteProductEvent {
    return remoteProductEventSchema.parse({
      version: 1,
      eventId: row.event_id,
      accountId: row.account_id,
      hostDeviceId: row.host_device_id,
      conversationId: row.conversation_id,
      cursor: `remote:${row.sequence}`,
      kind: row.kind,
      occurredAt: row.occurred_at,
      encryptedPayload: row.encrypted_payload,
    });
  }

  #expirePairings(): void {
    this.#database
      .prepare(
        `UPDATE remote_pairings SET status = 'expired'
         WHERE status = 'active' AND expires_at <= ?`,
      )
      .run(this.#now().toISOString());
  }

  #expireCommands(): void {
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `UPDATE remote_commands SET status = 'expired', result_code = 'REMOTE_COMMAND_EXPIRED', updated_at = ?
         WHERE status IN ('submitted', 'accepted') AND expires_at <= ?`,
      )
      .run(now, now);
  }

  #expirePendingCommands(hostDeviceId: string, resultCode: string): void {
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `UPDATE remote_commands SET status = 'expired', result_code = ?, updated_at = ?
         WHERE host_device_id = ? AND status IN ('submitted', 'accepted')`,
      )
      .run(resultCode, now, hostDeviceId);
  }

  #audit(
    principal: AccessPrincipal,
    action: string,
    targetId: string,
    resultCode: string,
    command?: RemoteCommand,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO remote_audit
         (account_id, actor_device_id, action, target_id, result_code, host_device_id,
          controller_device_id, pairing_id, command_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        principal.accountId,
        principal.deviceId,
        action,
        targetId,
        resultCode,
        command?.hostDeviceId ?? null,
        command?.controllerDeviceId ?? null,
        command?.pairingId ?? null,
        command?.commandId ?? null,
        this.#now().toISOString(),
      );
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (caught) {
      this.#database.exec("ROLLBACK");
      throw caught;
    }
  }
}
