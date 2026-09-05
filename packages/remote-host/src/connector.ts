import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type RemoteApplyCommandResponseFrame,
  type RemoteCommand,
  type RemoteCommandPayload,
  type RemoteCommandReceipt,
  type RemoteDevicePairing,
  type RemoteEventPublishInput,
  type RemoteHost,
  type RemoteHostRegistrationInput,
  type RemoteProductEvent,
  remoteCommandReceiptSchema,
  remoteProjectSnapshotPayloadSchema,
} from "@openerx/contracts";
import {
  commandCipherContext,
  decryptRemotePayload,
  encryptRemotePayload,
  verifyRemoteCommand,
} from "@openerx/remote-protocol";

type SqlRow = Record<string, unknown>;

export interface RemoteGatewayTransport {
  registerHost(input: RemoteHostRegistrationInput): Promise<RemoteHost>;
  updatePresence(input: {
    hostDeviceId: string;
    presence: "online" | "degraded" | "offline";
    revision: number;
  }): Promise<RemoteHost>;
  listPairings(): Promise<RemoteDevicePairing[]>;
  pullCommands(hostDeviceId: string, limit: number): Promise<RemoteCommand[]>;
  recordReceipt(receipt: RemoteCommandReceipt): Promise<RemoteCommandReceipt>;
  publishEvent(input: RemoteEventPublishInput): Promise<RemoteProductEvent>;
}

export interface RemoteCommandApplier {
  currentRevision(conversationId: string | null): Promise<number>;
  apply(
    command: RemoteCommand,
    payload: RemoteCommandPayload,
  ): Promise<RemoteApplyCommandResponseFrame>;
}

export interface RemoteHostConnectorOptions {
  databasePath: string;
  host: RemoteHostRegistrationInput;
  hostPrivateKey: string;
  transport: RemoteGatewayTransport;
  applier: RemoteCommandApplier;
  now?: () => Date;
  idFactory?: () => string;
  pollIntervalMs?: number;
}

function commandDigest(command: RemoteCommand): string {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "REMOTE_COMMAND_APPLY_FAILED";
  const code = error.message.split(":", 1)[0] ?? "REMOTE_COMMAND_APPLY_FAILED";
  return /^[A-Z][A-Z0-9_]*$/u.test(code) ? code : "REMOTE_COMMAND_APPLY_FAILED";
}

export class RemoteHostConnector {
  readonly #database: DatabaseSync;
  readonly #host: RemoteHostRegistrationInput;
  readonly #hostPrivateKey: string;
  readonly #transport: RemoteGatewayTransport;
  readonly #applier: RemoteCommandApplier;
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #pollIntervalMs: number;
  #hostState: RemoteHost | null = null;
  #pairings = new Map<string, RemoteDevicePairing>();
  #running = false;

  constructor(options: RemoteHostConnectorOptions) {
    this.#database = new DatabaseSync(options.databasePath);
    this.#host = options.host;
    this.#hostPrivateKey = options.hostPrivateKey;
    this.#transport = options.transport;
    this.#applier = options.applier;
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#migrate();
  }

  async start(): Promise<RemoteHost> {
    if (this.#running && this.#hostState) return this.#hostState;
    this.#hostState = await this.#transport.registerHost(this.#host);
    this.#hostState = await this.#transport.updatePresence({
      hostDeviceId: this.#host.hostDeviceId,
      presence: "online",
      revision: this.#hostState.revision,
    });
    this.#running = true;
    await this.refreshPairings();
    return this.#hostState;
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.start();
    try {
      while (!signal.aborted) {
        try {
          await this.tick();
          if (this.#hostState?.presence === "degraded") {
            this.#hostState = await this.#transport.updatePresence({
              hostDeviceId: this.#host.hostDeviceId,
              presence: "online",
              revision: this.#hostState.revision,
            });
          }
        } catch {
          if (this.#hostState?.presence === "online") {
            try {
              this.#hostState = await this.#transport.updatePresence({
                hostDeviceId: this.#host.hostDeviceId,
                presence: "degraded",
                revision: this.#hostState.revision,
              });
            } catch {
              // The next outbound retry is the recovery path while the Relay is unreachable.
            }
          }
        }
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, this.#pollIntervalMs);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
      }
    } finally {
      await this.stop();
    }
  }

  async tick(): Promise<number> {
    if (!this.#running) await this.start();
    await this.refreshPairings();
    const commands = await this.#transport.pullCommands(this.#host.hostDeviceId, 20);
    for (const command of commands) await this.#process(command);
    return commands.length;
  }

  async refreshPairings(): Promise<RemoteDevicePairing[]> {
    const pairings = await this.#transport.listPairings();
    this.#pairings = new Map(
      pairings
        .filter(
          (pairing) =>
            pairing.hostDeviceId === this.#host.hostDeviceId && pairing.status === "active",
        )
        .map((pairing) => [pairing.pairingId, pairing]),
    );
    return pairings;
  }

  async publishEvent(input: {
    kind: RemoteProductEvent["kind"];
    conversationId: string | null;
    payload: Record<string, unknown>;
    occurredAt?: string;
    ttlMs?: number;
  }): Promise<RemoteProductEvent[]> {
    const events: RemoteProductEvent[] = [];
    for (const pairing of this.#pairings.values()) {
      const eventId = this.#idFactory();
      const occurredAt = input.occurredAt ?? this.#now().toISOString();
      const encryptedPayload = encryptRemotePayload(
        input.payload,
        this.#hostPrivateKey,
        pairing.controllerPublicKey,
        `event:${eventId}:${pairing.pairingId}`,
      );
      events.push(
        await this.#transport.publishEvent({
          pairingId: pairing.pairingId,
          controllerDeviceId: pairing.controllerDeviceId,
          event: {
            version: 1,
            eventId,
            accountId: pairing.accountId,
            hostDeviceId: pairing.hostDeviceId,
            conversationId: input.conversationId,
            kind: input.kind,
            occurredAt,
            encryptedPayload,
          },
          expiresAt: new Date(
            Date.parse(occurredAt) + Math.min(input.ttlMs ?? 15 * 60_000, 24 * 60 * 60_000),
          ).toISOString(),
        }),
      );
    }
    return events;
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#running = false;
    if (this.#hostState) {
      try {
        this.#hostState = await this.#transport.updatePresence({
          hostDeviceId: this.#host.hostDeviceId,
          presence: "offline",
          revision: this.#hostState.revision,
        });
      } catch {
        // Gateway expiry is authoritative if the final offline update cannot be delivered.
      }
    }
  }

  close(): void {
    this.#database.close();
  }

  async #process(command: RemoteCommand): Promise<void> {
    const digest = commandDigest(command);
    const existing = this.#database
      .prepare("SELECT * FROM connector_commands WHERE command_id = ?")
      .get(command.commandId) as SqlRow | undefined;
    if (existing) {
      if (String(existing.command_digest) !== digest) {
        await this.#reject(command, "REMOTE_COMMAND_REPLAY_CONFLICT", null);
        return;
      }
      if (["applied", "rejected", "expired"].includes(String(existing.status))) {
        await this.#replayReceipts(command, existing);
        return;
      }
    }

    const pairing = this.#pairings.get(command.pairingId);
    if (!pairing) {
      await this.#reject(command, "REMOTE_PAIRING_NOT_ACTIVE", existing);
      return;
    }
    if (!verifyRemoteCommand(command, pairing.controllerPublicKey)) {
      await this.#reject(command, "REMOTE_COMMAND_SIGNATURE_INVALID", existing);
      return;
    }
    if (Date.parse(command.expiresAt) <= this.#now().getTime()) {
      await this.#reject(command, "REMOTE_COMMAND_EXPIRED", existing, "expired");
      return;
    }
    let payload: RemoteCommandPayload;
    try {
      payload = decryptRemotePayload(
        command.encryptedPayload,
        this.#hostPrivateKey,
        pairing.controllerPublicKey,
        commandCipherContext(command),
      );
    } catch (caught) {
      await this.#reject(command, errorCode(caught), existing);
      return;
    }
    if (payload.kind !== command.kind) {
      await this.#reject(command, "REMOTE_COMMAND_KIND_MISMATCH", existing);
      return;
    }
    const currentRevision = await this.#applier.currentRevision(command.conversationId);
    if (currentRevision !== command.baseRevision) {
      await this.#reject(
        command,
        "REMOTE_BASE_REVISION_CONFLICT",
        existing,
        "rejected",
        currentRevision,
      );
      return;
    }
    const sessionKey = command.conversationId ?? command.generationId ?? "host";
    const lastSequence = this.#database
      .prepare(
        "SELECT MAX(session_sequence) AS value FROM connector_commands WHERE pairing_id = ? AND session_key = ?",
      )
      .get(command.pairingId, sessionKey) as { value: number | null };
    if (!existing && lastSequence.value !== null && command.sessionSequence <= lastSequence.value) {
      await this.#reject(command, "REMOTE_SEQUENCE_OUT_OF_ORDER", null);
      return;
    }
    if (!existing) this.#insert(command, digest, sessionKey, "accepted", null, null);
    const accepted = this.#receipt(command, "accepted", null, null);
    await this.#transport.recordReceipt(accepted);
    try {
      const result = await this.#applier.apply(command, payload);
      if (!result.ok) {
        if (result.errorCode === "REMOTE_COMMAND_OUTCOME_UNKNOWN") {
          await this.publishEvent({
            kind: "review.available",
            conversationId: command.conversationId,
            payload: {
              reconciliation: [
                {
                  kind: "remote_command",
                  targetId: command.commandId,
                  status: "outcome_unknown",
                  actionRequired: true,
                },
              ],
            },
          });
        }
        this.#mark(command.commandId, "rejected", result.errorCode, result.currentRevision);
        await this.#transport.recordReceipt(
          this.#receipt(command, "rejected", result.errorCode, result.currentRevision),
        );
        return;
      }
      if (payload.kind === "project.list") {
        await this.publishEvent({
          kind: "project.snapshot",
          conversationId: null,
          payload: remoteProjectSnapshotPayloadSchema.parse(result.result),
          ttlMs: 24 * 60 * 60_000,
        });
      }
      this.#mark(command.commandId, "applied", "OK", result.appliedRevision);
      await this.#transport.recordReceipt(
        this.#receipt(command, "applied", "OK", result.appliedRevision),
      );
    } catch (caught) {
      const code = errorCode(caught);
      throw new Error(code);
    }
  }

  async #reject(
    command: RemoteCommand,
    code: string,
    existing: SqlRow | null | undefined,
    status: "rejected" | "expired" = "rejected",
    revision: number | null = null,
  ): Promise<void> {
    if (!existing) {
      const sessionKey = command.conversationId ?? command.generationId ?? "host";
      try {
        this.#insert(command, commandDigest(command), sessionKey, status, code, revision);
      } catch {
        // A verified concurrent duplicate owns the durable result and will be replayed next tick.
      }
    } else {
      this.#mark(command.commandId, status, code, revision);
    }
    await this.#transport.recordReceipt(this.#receipt(command, status, code, revision));
  }

  async #replayReceipts(command: RemoteCommand, row: SqlRow): Promise<void> {
    try {
      await this.#transport.recordReceipt(this.#receipt(command, "accepted", null, null));
    } catch {
      // The Relay may already hold the terminal receipt.
    }
    await this.#transport.recordReceipt(
      this.#receipt(
        command,
        String(row.status) as "applied" | "rejected" | "expired",
        row.result_code === null ? null : String(row.result_code),
        row.applied_revision === null ? null : Number(row.applied_revision),
      ),
    );
  }

  #insert(
    command: RemoteCommand,
    digest: string,
    sessionKey: string,
    status: string,
    resultCode: string | null,
    appliedRevision: number | null,
  ): void {
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `INSERT INTO connector_commands
         (command_id, pairing_id, session_key, session_sequence, command_digest, status,
          result_code, applied_revision, received_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        command.commandId,
        command.pairingId,
        sessionKey,
        command.sessionSequence,
        digest,
        status,
        resultCode,
        appliedRevision,
        now,
        now,
      );
  }

  #mark(
    commandId: string,
    status: string,
    resultCode: string | null,
    appliedRevision: number | null,
  ): void {
    this.#database
      .prepare(
        `UPDATE connector_commands SET status = ?, result_code = ?, applied_revision = ?, updated_at = ?
         WHERE command_id = ?`,
      )
      .run(status, resultCode, appliedRevision, this.#now().toISOString(), commandId);
  }

  #receipt(
    command: RemoteCommand,
    status: RemoteCommandReceipt["status"],
    resultCode: string | null,
    appliedRevision: number | null,
  ): RemoteCommandReceipt {
    const row = this.#database
      .prepare("SELECT received_at FROM connector_commands WHERE command_id = ?")
      .get(command.commandId) as { received_at: string } | undefined;
    const now = this.#now().toISOString();
    return remoteCommandReceiptSchema.parse({
      version: 1,
      commandId: command.commandId,
      accountId: command.accountId,
      pairingId: command.pairingId,
      hostDeviceId: command.hostDeviceId,
      status,
      resultCode,
      appliedRevision,
      receivedAt: row?.received_at ?? now,
      updatedAt: now,
    });
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS connector_commands (
        command_id TEXT PRIMARY KEY, pairing_id TEXT NOT NULL, session_key TEXT NOT NULL,
        session_sequence INTEGER NOT NULL, command_digest TEXT NOT NULL, status TEXT NOT NULL,
        result_code TEXT, applied_revision INTEGER, received_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(pairing_id, session_key, session_sequence)
      );
    `);
  }
}
