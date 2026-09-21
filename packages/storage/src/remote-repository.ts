import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type RemoteApplyCommandResponseFrame,
  type RemoteCommand,
  type RemoteCommandPayload,
  remoteApplyCommandResponseFrameSchema,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

interface RemoteRepositoryOptions {
  now?: () => string;
}

function digest(command: RemoteCommand, payload: RemoteCommandPayload): string {
  return createHash("sha256").update(JSON.stringify({ command, payload })).digest("hex");
}

export class RemoteRepository {
  readonly #database: DatabaseSync;
  readonly #now: () => string;

  constructor(databasePath: string, options: RemoteRepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#now = options.now ?? (() => new Date().toISOString());
    migrateDatabase(this.#database);
    this.#database
      .prepare(
        `UPDATE remote_command_applications SET status = 'outcome_unknown', updated_at = ?
         WHERE status = 'applying' AND result_json IS NULL`,
      )
      .run(this.#now());
  }

  close(): void {
    this.#database.close();
  }

  begin(
    command: RemoteCommand,
    payload: RemoteCommandPayload,
  ): { replayed: boolean; result: RemoteApplyCommandResponseFrame | null } {
    const commandDigest = digest(command, payload);
    const row = this.#database
      .prepare(
        "SELECT command_digest, status, result_json FROM remote_command_applications WHERE command_id = ?",
      )
      .get(command.commandId) as
      | { command_digest: string; status: string; result_json: string | null }
      | undefined;
    if (row) {
      if (row.command_digest !== commandDigest) throw new Error("REMOTE_COMMAND_REPLAY_CONFLICT");
      if (row.status === "outcome_unknown") throw new Error("REMOTE_COMMAND_OUTCOME_UNKNOWN");
      if (row.result_json) {
        return {
          replayed: true,
          result: remoteApplyCommandResponseFrameSchema.parse(JSON.parse(row.result_json)),
        };
      }
      return { replayed: false, result: null };
    }
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO remote_command_applications
         (command_id, command_digest, status, result_json, created_at, updated_at)
         VALUES (?, ?, 'applying', NULL, ?, ?)`,
      )
      .run(command.commandId, commandDigest, now, now);
    return { replayed: false, result: null };
  }

  complete(
    commandId: string,
    response: RemoteApplyCommandResponseFrame,
  ): RemoteApplyCommandResponseFrame {
    const parsed = remoteApplyCommandResponseFrameSchema.parse(response);
    const result = this.#database
      .prepare(
        `UPDATE remote_command_applications SET status = ?, result_json = ?, updated_at = ?
         WHERE command_id = ?`,
      )
      .run(parsed.ok ? "applied" : "rejected", JSON.stringify(parsed), this.#now(), commandId);
    if (result.changes !== 1) throw new Error("REMOTE_COMMAND_APPLICATION_NOT_FOUND");
    return parsed;
  }
}
