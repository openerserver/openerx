import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import type { ConversationSnapshot, ConversationSummary } from "@openerx/contracts";
import { PersonalDataExporter } from "@openerx/observability";
import { ChatRepository } from "@openerx/storage";

/** The upgrade-era guest database only; never starts workers or follows account profiles. */
export class LegacyPersonalDataReader {
  readonly #databasePath: string;
  readonly #objectDirectory: string;
  constructor(baseProfileDirectory: string) {
    this.#databasePath = path.join(baseProfileDirectory, "openerx-v2.sqlite");
    this.#objectDirectory = path.join(baseProfileDirectory, "objects");
  }
  #assertFixedDatabase(): void {
    if (existsSync(this.#databasePath) && lstatSync(this.#databasePath).isSymbolicLink())
      throw new Error("LEGACY_DATABASE_PATH_INVALID");
  }
  summary() {
    this.#assertFixedDatabase();
    return new PersonalDataExporter(this.#databasePath).summary();
  }
  export(destinationPath: string) {
    this.#assertFixedDatabase();
    if (existsSync(this.#objectDirectory) && lstatSync(this.#objectDirectory).isSymbolicLink())
      throw new Error("LEGACY_OBJECT_PATH_INVALID");
    return new PersonalDataExporter(this.#databasePath, undefined, this.#objectDirectory).export(
      destinationPath,
    );
  }
  list(includeArchived = false): ConversationSummary[] {
    this.#assertFixedDatabase();
    if (!existsSync(this.#databasePath)) return [];
    const repository = new ChatRepository(this.#databasePath, { readOnly: true });
    try {
      return repository
        .listConversations(includeArchived)
        .filter((conversation) => conversation.ownerProfileId === "local-default");
    } finally {
      repository.close();
    }
  }
  get(conversationId: string): ConversationSnapshot {
    this.#assertFixedDatabase();
    if (!existsSync(this.#databasePath)) throw new Error("Conversation not found");
    const repository = new ChatRepository(this.#databasePath, { readOnly: true });
    try {
      const snapshot = repository.getConversation(conversationId);
      if (snapshot.conversation.ownerProfileId !== "local-default")
        throw new Error("Conversation not found");
      return snapshot;
    } finally {
      repository.close();
    }
  }
}
