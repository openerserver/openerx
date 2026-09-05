import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type Artifact,
  type ArtifactVersion,
  type Attachment,
  artifactSchema,
  artifactSyncPayloadSchema,
  artifactVersionSchema,
  artifactVersionSyncPayloadSchema,
  attachmentSchema,
  attachmentSyncPayloadSchema,
  type FileCitation,
  type FileParseErrorCode,
  type FileScope,
  type FileSearchResult,
  fileCitationSchema,
  fileScopeSchema,
  fileSearchResultSchema,
  type PersonalFile,
  personalFileSchema,
  personalFileSyncPayloadSchema,
  type SourceLocator,
  type SupportedFileFormat,
  type SyncChange,
  type SyncOperation,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

export interface FileRepositoryOptions {
  ownerProfileId?: string;
  deviceId?: string;
  now?: () => string;
  idFactory?: () => string;
}

export interface StoredScope extends FileScope {
  rootPath: string;
}

export interface PersonalFileDraft {
  displayName: string;
  format: SupportedFileFormat;
  mediaType: string;
  sizeBytes: number;
  checksumSha256: string;
  objectRef: string;
  sourceScopeId: string;
  sourceRelativePath: string;
}

export interface ParsedFileDraft {
  text: string;
  citations: Array<{
    locator: SourceLocator;
    excerpt: string;
    confidence: number;
  }>;
}

export interface ArtifactVersionDraft {
  sizeBytes: number;
  checksumSha256: string;
  objectRef: string;
  sourcePersonalFileId?: string | null;
}

export class FileRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #deviceId: string | null;

  constructor(databasePath: string, options: FileRepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#deviceId = options.deviceId ?? null;
    migrateDatabase(this.#database);
  }

  close(): void {
    this.#database.close();
  }

  createScope(input: {
    kind: "file" | "directory";
    displayName: string;
    rootPath: string;
    access?: "read" | "read_write";
    expiresAt?: string | null;
  }): StoredScope {
    const id = this.#idFactory();
    const createdAt = this.#now();
    this.#database
      .prepare(
        `INSERT INTO file_scopes
         (id, kind, display_name, root_path, access, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        input.kind,
        input.displayName,
        input.rootPath,
        input.access ?? "read",
        input.expiresAt ?? null,
        createdAt,
      );
    return this.scope(id);
  }

  scope(id: string): StoredScope {
    const row = this.#database.prepare("SELECT * FROM file_scopes WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("FILE_SCOPE_NOT_FOUND");
    return {
      ...fileScopeSchema.parse({
        id: row.id,
        kind: row.kind,
        displayName: row.display_name,
        access: row.access,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
      }),
      rootPath: String(row.root_path),
    };
  }

  revokeScope(id: string): FileScope {
    const now = this.#now();
    const result = this.#database
      .prepare("UPDATE file_scopes SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(now, id);
    if (result.changes !== 1) throw new Error("FILE_SCOPE_NOT_FOUND");
    const { rootPath: _rootPath, ...scope } = this.scope(id);
    return scope;
  }

  upsertPersonalFile(draft: PersonalFileDraft): PersonalFile {
    const existing = this.#database
      .prepare(
        `SELECT id FROM personal_files
         WHERE owner_profile_id = ? AND checksum_sha256 = ?
           AND source_scope_id = ? AND source_relative_path = ?`,
      )
      .get(
        this.#ownerProfileId,
        draft.checksumSha256,
        draft.sourceScopeId,
        draft.sourceRelativePath,
      ) as { id: string } | undefined;
    if (existing) return this.personalFile(existing.id);
    const id = this.#idFactory();
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO personal_files
         (id, owner_profile_id, display_name, format, media_type, size_bytes, checksum_sha256,
          object_ref, source_scope_id, source_relative_path, parse_status, parse_error_code,
          parsed_text, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?, 1)`,
      )
      .run(
        id,
        this.#ownerProfileId,
        draft.displayName,
        draft.format,
        draft.mediaType,
        draft.sizeBytes,
        draft.checksumSha256,
        draft.objectRef,
        draft.sourceScopeId,
        draft.sourceRelativePath,
        now,
        now,
      );
    return this.personalFile(id);
  }

  completeParse(personalFileId: string, draft: ParsedFileDraft): PersonalFile {
    return this.#transaction(() => {
      const now = this.#now();
      const result = this.#database
        .prepare(
          `UPDATE personal_files
           SET parse_status = 'ready', parse_error_code = NULL, parsed_text = ?, updated_at = ?,
               revision = revision + 1
           WHERE id = ?`,
        )
        .run(draft.text, now, personalFileId);
      if (result.changes !== 1) throw new Error("FILE_NOT_FOUND");
      this.#database
        .prepare("DELETE FROM file_citations WHERE personal_file_id = ?")
        .run(personalFileId);
      const insert = this.#database.prepare(
        `INSERT INTO file_citations
         (id, personal_file_id, locator_json, excerpt, confidence, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      draft.citations.forEach((citation, index) => {
        insert.run(
          this.#idFactory(),
          personalFileId,
          JSON.stringify(citation.locator),
          citation.excerpt,
          citation.confidence,
          index + 1,
        );
      });
      const file = this.personalFile(personalFileId);
      this.#queuePersonalFile(file);
      return file;
    });
  }

  failParse(personalFileId: string, code: FileParseErrorCode): PersonalFile {
    const result = this.#database
      .prepare(
        `UPDATE personal_files
         SET parse_status = 'failed', parse_error_code = ?, updated_at = ?, revision = revision + 1
         WHERE id = ?`,
      )
      .run(code, this.#now(), personalFileId);
    if (result.changes !== 1) throw new Error("FILE_NOT_FOUND");
    const file = this.personalFile(personalFileId);
    this.#queuePersonalFile(file);
    return file;
  }

  personalFile(id: string): PersonalFile {
    const row = this.#database.prepare("SELECT * FROM personal_files WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("FILE_NOT_FOUND");
    return this.#personalFile(row);
  }

  listFiles(conversationId?: string | null): PersonalFile[] {
    const rows = conversationId
      ? (this.#database
          .prepare(
            `SELECT DISTINCT f.* FROM personal_files f
             JOIN attachments a ON a.personal_file_id = f.id
             WHERE a.conversation_id = ? AND f.owner_profile_id = ?
             ORDER BY f.updated_at DESC, f.id`,
          )
          .all(conversationId, this.#ownerProfileId) as SqlRow[])
      : (this.#database
          .prepare(
            `SELECT * FROM personal_files WHERE owner_profile_id = ?
             ORDER BY updated_at DESC, id`,
          )
          .all(this.#ownerProfileId) as SqlRow[]);
    return rows.map((row) => this.#personalFile(row));
  }

  attachments(conversationId: string): Attachment[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM attachments
         WHERE conversation_id = ?
         ORDER BY created_at, id`,
      )
      .all(conversationId) as SqlRow[];
    return rows.map((row) => this.#attachment(row));
  }

  citations(personalFileId: string): FileCitation[] {
    const rows = this.#database
      .prepare("SELECT * FROM file_citations WHERE personal_file_id = ? ORDER BY position, id")
      .all(personalFileId) as SqlRow[];
    return rows.map((row) =>
      fileCitationSchema.parse({
        id: row.id,
        personalFileId: row.personal_file_id,
        locator: JSON.parse(String(row.locator_json)),
        excerpt: row.excerpt,
        confidence: row.confidence,
      }),
    );
  }

  parsedText(personalFileId: string): string {
    const row = this.#database
      .prepare("SELECT parsed_text FROM personal_files WHERE id = ?")
      .get(personalFileId) as { parsed_text: string } | undefined;
    if (!row) throw new Error("FILE_NOT_FOUND");
    return row.parsed_text;
  }

  attachedFileIds(conversationId: string): string[] {
    return (
      this.#database
        .prepare(
          `SELECT DISTINCT personal_file_id FROM attachments
           WHERE conversation_id = ? ORDER BY personal_file_id`,
        )
        .all(conversationId) as Array<{ personal_file_id: string }>
    ).map(({ personal_file_id }) => personal_file_id);
  }

  attachedFileIdsForMessages(conversationId: string, messageIds: string[]): string[] {
    const uniqueMessageIds = [...new Set(messageIds)];
    const placeholders = uniqueMessageIds.map(() => "?").join(", ");
    const rows = this.#database
      .prepare(
        `SELECT DISTINCT personal_file_id FROM attachments
         WHERE conversation_id = ?
           AND (message_id IS NULL${
             uniqueMessageIds.length > 0 ? ` OR message_id IN (${placeholders})` : ""
})
         ORDER BY personal_file_id`,
      )
      .all(conversationId, ...uniqueMessageIds) as Array<{ personal_file_id: string }>;
    return rows.map(({ personal_file_id }) => personal_file_id);
  }

  attachedFileIdsForMessage(messageId: string): string[] {
    return (
      this.#database
        .prepare(
          `SELECT DISTINCT personal_file_id FROM attachments
           WHERE message_id = ? ORDER BY personal_file_id`,
        )
        .all(messageId) as Array<{ personal_file_id: string }>
    ).map(({ personal_file_id }) => personal_file_id);
  }

  search(query: string, fileIds?: string[]): FileSearchResult[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return this.listFiles()
      .filter((file) => !fileIds || fileIds.includes(file.id))
      .map((file) => {
        const row = this.#database
          .prepare("SELECT parsed_text FROM personal_files WHERE id = ?")
          .get(file.id) as { parsed_text: string };
        const matching = this.citations(file.id).filter((citation) =>
          citation.excerpt.toLocaleLowerCase().includes(normalized),
        );
        if (
          !file.displayName.toLocaleLowerCase().includes(normalized) &&
          !String(row.parsed_text).toLocaleLowerCase().includes(normalized) &&
          matching.length === 0
        ) {
          return null;
        }
        return fileSearchResultSchema.parse({
          file,
          citations: matching.length > 0 ? matching : this.citations(file.id).slice(0, 3),
        });
      })
      .filter((result): result is FileSearchResult => result !== null);
  }

  attach(
    conversationId: string,
    personalFileId: string,
    messageId: string | null = null,
  ): Attachment {
    this.personalFile(personalFileId);
    const conversation = this.#database
      .prepare("SELECT id FROM conversations WHERE id = ? AND deleted_at IS NULL")
      .get(conversationId);
    if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
    const existing = this.#database
      .prepare(
        `SELECT * FROM attachments WHERE conversation_id = ? AND message_id IS ?
         AND personal_file_id = ?`,
      )
      .get(conversationId, messageId, personalFileId) as SqlRow | undefined;
    if (existing) return this.#attachment(existing);
    const id = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO attachments
         (id, conversation_id, message_id, personal_file_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, conversationId, messageId, personalFileId, this.#now());
    const attachment = this.attachment(id);
    this.#queueSync(
      "attachment",
      attachment.id,
      JSON.parse(JSON.stringify(attachment)),
      attachment.createdAt,
    );
    return attachment;
  }

  attachment(id: string): Attachment {
    const row = this.#database.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("ATTACHMENT_NOT_FOUND");
    return this.#attachment(row);
  }

  createArtifact(input: {
    displayName: string;
    format: SupportedFileFormat;
    mediaType: string;
    version: ArtifactVersionDraft;
  }): Artifact {
    return this.#transaction(() => {
      const id = this.#idFactory();
      const now = this.#now();
      this.#database
        .prepare(
          `INSERT INTO artifacts
           (id, owner_profile_id, display_name, format, media_type, current_version,
            created_at, updated_at, revision)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1)`,
        )
        .run(id, this.#ownerProfileId, input.displayName, input.format, input.mediaType, now, now);
      const versionId = this.#insertArtifactVersion(id, 1, input.version, now);
      const artifact = this.artifact(id);
      this.#queueArtifact(artifact, versionId);
      return artifact;
    });
  }

  addArtifactVersion(artifactId: string, version: ArtifactVersionDraft): Artifact {
    return this.#transaction(() => {
      const artifact = this.artifact(artifactId);
      const next = artifact.currentVersion + 1;
      const now = this.#now();
      const versionId = this.#insertArtifactVersion(artifactId, next, version, now);
      this.#database
        .prepare(
          `UPDATE artifacts SET current_version = ?, updated_at = ?, revision = revision + 1
           WHERE id = ?`,
        )
        .run(next, now, artifactId);
      const updated = this.artifact(artifactId);
      this.#queueArtifact(updated, versionId);
      return updated;
    });
  }

  artifact(id: string): Artifact {
    const row = this.#database.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("ARTIFACT_NOT_FOUND");
    const versions = this.#database
      .prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version")
      .all(id) as SqlRow[];
    return artifactSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      displayName: row.display_name,
      format: row.format,
      mediaType: row.media_type,
      currentVersion: row.current_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      versions: versions.map((version) => ({
        id: version.id,
        artifactId: version.artifact_id,
        version: version.version,
        sizeBytes: version.size_bytes,
        checksumSha256: version.checksum_sha256,
        objectRef: version.object_ref,
        sourcePersonalFileId: version.source_personal_file_id,
        createdAt: version.created_at,
      })),
    });
  }

  listArtifacts(): Artifact[] {
    const rows = this.#database
      .prepare("SELECT id FROM artifacts WHERE owner_profile_id = ? ORDER BY updated_at DESC, id")
      .all(this.#ownerProfileId) as Array<{ id: string }>;
    return rows.map(({ id }) => this.artifact(id));
  }

  deleteArtifacts(artifactIds: string[]): string[] {
    const uniqueIds = [...new Set(artifactIds)];
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    return this.#transaction(() => {
      const versions = this.#database
        .prepare(
          `SELECT av.id, av.object_ref
           FROM artifact_versions av
           JOIN artifacts a ON a.id = av.artifact_id
           WHERE a.owner_profile_id = ? AND a.id IN (${placeholders})`,
        )
        .all(this.#ownerProfileId, ...uniqueIds) as Array<{ id: string; object_ref: string }>;
      const ownedIds = (
        this.#database
          .prepare(
            `SELECT id FROM artifacts WHERE owner_profile_id = ? AND id IN (${placeholders})`,
          )
          .all(this.#ownerProfileId, ...uniqueIds) as Array<{ id: string }>
      ).map(({ id }) => id);
      if (ownedIds.length === 0) return [];
      const ownedPlaceholders = ownedIds.map(() => "?").join(", ");
      for (const { id } of versions) this.#queueSyncDelete("artifact_version", id, this.#now());
      for (const artifactId of ownedIds) this.#queueSyncDelete("artifact", artifactId, this.#now());
      this.#database
        .prepare(
          `DELETE FROM artifacts WHERE owner_profile_id = ? AND id IN (${ownedPlaceholders})`,
        )
        .run(this.#ownerProfileId, ...ownedIds);
      return [...new Set(versions.map(({ object_ref }) => object_ref))];
    });
  }

  objectReferenceCount(objectRef: string): number {
    const row = this.#database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM personal_files WHERE object_ref = ?) +
           (SELECT COUNT(*) FROM artifact_versions WHERE object_ref = ?) AS reference_count`,
      )
      .get(objectRef, objectRef) as { reference_count: number };
    return Number(row.reference_count);
  }

  syncObject(operation: SyncOperation): {
    objectId: string;
    checksumSha256: string;
    sizeBytes: number;
    mediaType: string;
    objectRef: string;
  } | null {
    if (operation.objectType === "personal_file") {
      const file = this.personalFile(operation.objectId);
      return {
        objectId: file.id,
        checksumSha256: file.checksumSha256,
        sizeBytes: file.sizeBytes,
        mediaType: file.mediaType,
        objectRef: file.objectRef,
      };
    }
    if (operation.objectType === "artifact_version") {
      const version = this.#artifactVersion(operation.objectId);
      const artifact = this.artifact(version.artifactId);
      return {
        objectId: version.id,
        checksumSha256: version.checksumSha256,
        sizeBytes: version.sizeBytes,
        mediaType: artifact.mediaType,
        objectRef: version.objectRef,
      };
    }
    return null;
  }

  applySyncChange(change: SyncChange, objectRef?: string): void {
    if (change.accountId !== this.#ownerProfileId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
    if (this.#hasPendingWrite(change.objectType, change.objectId)) return;
    this.#transaction(() => {
      if (change.tombstone) {
        this.#applySyncDelete(change.objectType, change.objectId);
        return;
      }
      if (!change.payload) throw new Error("SYNC_PAYLOAD_MISSING");
      if (change.objectType === "personal_file") {
        if (!objectRef) throw new Error("SYNC_OBJECT_REF_MISSING");
        const file = personalFileSyncPayloadSchema.parse(change.payload);
        if (file.ownerProfileId !== this.#ownerProfileId || file.id !== change.objectId) {
          throw new Error("ACCOUNT_SCOPE_VIOLATION");
        }
        this.#database
          .prepare(
            `INSERT INTO personal_files
             (id, owner_profile_id, display_name, format, media_type, size_bytes,
              checksum_sha256, object_ref, source_scope_id, source_relative_path,
              parse_status, parse_error_code, parsed_text, created_at, updated_at, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               display_name = excluded.display_name,
               format = excluded.format,
               media_type = excluded.media_type,
               size_bytes = excluded.size_bytes,
               checksum_sha256 = excluded.checksum_sha256,
               object_ref = excluded.object_ref,
               source_scope_id = personal_files.source_scope_id,
               source_relative_path = personal_files.source_relative_path,
               parse_status = excluded.parse_status,
               parse_error_code = excluded.parse_error_code,
               parsed_text = excluded.parsed_text,
               updated_at = excluded.updated_at,
               revision = excluded.revision`,
          )
          .run(
            file.id,
            file.ownerProfileId,
            file.displayName,
            file.format,
            file.mediaType,
            file.sizeBytes,
            file.checksumSha256,
            objectRef,
            file.displayName,
            file.parseStatus,
            file.parseErrorCode,
            file.parsedText,
            file.createdAt,
            file.updatedAt,
            file.revision,
          );
        this.#database
          .prepare("DELETE FROM file_citations WHERE personal_file_id = ?")
          .run(file.id);
        const insert = this.#database.prepare(
          `INSERT INTO file_citations
           (id, personal_file_id, locator_json, excerpt, confidence, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        file.citations.forEach((citation, index) => {
          insert.run(
            citation.id,
            file.id,
            JSON.stringify(citation.locator),
            citation.excerpt,
            citation.confidence,
            index + 1,
          );
        });
        return;
      }
      if (change.objectType === "attachment") {
        const attachment = attachmentSyncPayloadSchema.parse(change.payload);
        this.#database
          .prepare(
            `INSERT INTO attachments
             (id, conversation_id, message_id, personal_file_id, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               conversation_id = excluded.conversation_id,
               message_id = excluded.message_id,
               personal_file_id = excluded.personal_file_id`,
          )
          .run(
            attachment.id,
            attachment.conversationId,
            attachment.messageId,
            attachment.personalFileId,
            attachment.createdAt,
          );
        return;
      }
      if (change.objectType === "artifact") {
        const artifact = artifactSyncPayloadSchema.parse(change.payload);
        if (artifact.ownerProfileId !== this.#ownerProfileId || artifact.id !== change.objectId) {
          throw new Error("ACCOUNT_SCOPE_VIOLATION");
        }
        this.#database
          .prepare(
            `INSERT INTO artifacts
             (id, owner_profile_id, display_name, format, media_type, current_version,
              created_at, updated_at, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               display_name = excluded.display_name,
               format = excluded.format,
               media_type = excluded.media_type,
               current_version = excluded.current_version,
               updated_at = excluded.updated_at,
               revision = excluded.revision`,
          )
          .run(
            artifact.id,
            artifact.ownerProfileId,
            artifact.displayName,
            artifact.format,
            artifact.mediaType,
            artifact.currentVersion,
            artifact.createdAt,
            artifact.updatedAt,
            artifact.revision,
          );
        return;
      }
      if (change.objectType === "artifact_version") {
        if (!objectRef) throw new Error("SYNC_OBJECT_REF_MISSING");
        const version = artifactVersionSyncPayloadSchema.parse(change.payload);
        const sourcePersonalFileId =
          version.sourcePersonalFileId && this.#personalFileExists(version.sourcePersonalFileId)
            ? version.sourcePersonalFileId
            : null;
        this.#database
          .prepare(
            `INSERT INTO artifact_versions
             (id, artifact_id, version, size_bytes, checksum_sha256, object_ref,
              source_personal_file_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET object_ref = excluded.object_ref`,
          )
          .run(
            version.id,
            version.artifactId,
            version.version,
            version.sizeBytes,
            version.checksumSha256,
            objectRef,
            sourcePersonalFileId,
            version.createdAt,
          );
      }
    });
  }

  #insertArtifactVersion(
    artifactId: string,
    version: number,
    draft: ArtifactVersionDraft,
    now: string,
  ): string {
    if (draft.sourcePersonalFileId) this.personalFile(draft.sourcePersonalFileId);
    const id = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO artifact_versions
         (id, artifact_id, version, size_bytes, checksum_sha256, object_ref,
          source_personal_file_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        artifactId,
        version,
        draft.sizeBytes,
        draft.checksumSha256,
        draft.objectRef,
        draft.sourcePersonalFileId ?? null,
        now,
      );
    return id;
  }

  #artifactVersion(id: string): ArtifactVersion {
    const version = this.#database
      .prepare("SELECT * FROM artifact_versions WHERE id = ?")
      .get(id) as SqlRow | undefined;
    if (!version) throw new Error("ARTIFACT_VERSION_NOT_FOUND");
    return artifactVersionSchema.parse({
      id: version.id,
      artifactId: version.artifact_id,
      version: version.version,
      sizeBytes: version.size_bytes,
      checksumSha256: version.checksum_sha256,
      objectRef: version.object_ref,
      sourcePersonalFileId: version.source_personal_file_id,
      createdAt: version.created_at,
    });
  }

  #queuePersonalFile(file: PersonalFile): void {
    const {
      objectRef: _objectRef,
      sourceScopeId: _sourceScopeId,
      sourceRelativePath: _sourceRelativePath,
      ...metadata
    } = file;
    const payload = personalFileSyncPayloadSchema.parse({
      ...metadata,
      cloudObjectId: file.id,
      parsedText: this.parsedText(file.id),
      citations: this.citations(file.id).map(
        ({ personalFileId: _personalFileId, ...citation }) => citation,
      ),
    });
    this.#queueSync("personal_file", file.id, payload, file.updatedAt);
  }

  #queueArtifact(artifact: Artifact, versionId: string): void {
    const { versions: _versions, ...metadata } = artifact;
    this.#queueSync("artifact", artifact.id, metadata, artifact.updatedAt);
    const version = artifact.versions.find(({ id }) => id === versionId);
    if (!version) throw new Error("ARTIFACT_VERSION_NOT_FOUND");
    const { objectRef: _objectRef, ...versionMetadata } = version;
    this.#queueSync(
      "artifact_version",
      version.id,
      artifactVersionSyncPayloadSchema.parse({ ...versionMetadata, cloudObjectId: version.id }),
      version.createdAt,
    );
  }

  #queueSync(
    objectType: SyncOperation["objectType"],
    objectId: string,
    payload: Record<string, unknown>,
    createdAt: string,
  ): void {
    if (!this.#syncEnabled() || !this.#deviceId) return;
    const state = this.#database
      .prepare(
        `SELECT cloud_revision FROM sync_object_state
         WHERE account_id = ? AND object_type = ? AND object_id = ?`,
      )
      .get(this.#ownerProfileId, objectType, objectId) as SqlRow | undefined;
    const pending = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM sync_outbox
         WHERE account_id = ? AND object_type = ? AND object_id = ? AND status = 'pending'`,
      )
      .get(this.#ownerProfileId, objectType, objectId) as { count: number };
    const operationId = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO sync_outbox
         (operation_id, account_id, device_id, object_type, object_id, mutation,
          base_revision, payload_version, payload_json, idempotency_key, created_at, status)
         VALUES (?, ?, ?, ?, ?, 'upsert', ?, 1, ?, ?, ?, 'pending')`,
      )
      .run(
        operationId,
        this.#ownerProfileId,
        this.#deviceId,
        objectType,
        objectId,
        Number(state?.cloud_revision ?? 0) + Number(pending.count),
        JSON.stringify(payload),
        `sync:${operationId}`,
        createdAt,
      );
  }

  #queueSyncDelete(
    objectType: "artifact" | "artifact_version",
    objectId: string,
    createdAt: string,
  ): void {
    if (!this.#syncEnabled() || !this.#deviceId) return;
    this.#database
      .prepare(
        `DELETE FROM sync_outbox
         WHERE account_id = ? AND object_type = ? AND object_id = ? AND status = 'pending'`,
      )
      .run(this.#ownerProfileId, objectType, objectId);
    const state = this.#database
      .prepare(
        `SELECT cloud_revision FROM sync_object_state
         WHERE account_id = ? AND object_type = ? AND object_id = ?`,
      )
      .get(this.#ownerProfileId, objectType, objectId) as SqlRow | undefined;
    const operationId = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO sync_outbox
         (operation_id, account_id, device_id, object_type, object_id, mutation,
          base_revision, payload_version, payload_json, idempotency_key, created_at, status)
         VALUES (?, ?, ?, ?, ?, 'delete', ?, 1, NULL, ?, ?, 'pending')`,
      )
      .run(
        operationId,
        this.#ownerProfileId,
        this.#deviceId,
        objectType,
        objectId,
        Number(state?.cloud_revision ?? 0),
        `sync:${operationId}`,
        createdAt,
      );
  }

  #syncEnabled(): boolean {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuid.test(this.#ownerProfileId) && this.#deviceId !== null && uuid.test(this.#deviceId);
  }

  #hasPendingWrite(objectType: string, objectId: string): boolean {
    if (!this.#syncEnabled()) return false;
    return Boolean(
      this.#database
        .prepare(
          `SELECT 1 FROM sync_outbox
           WHERE account_id = ? AND object_type = ? AND object_id = ?
             AND status IN ('pending', 'conflict') LIMIT 1`,
        )
        .get(this.#ownerProfileId, objectType, objectId),
    );
  }

  #personalFileExists(id: string): boolean {
    return Boolean(this.#database.prepare("SELECT 1 FROM personal_files WHERE id = ?").get(id));
  }

  #applySyncDelete(objectType: string, objectId: string): void {
    if (objectType === "attachment") {
      this.#database.prepare("DELETE FROM attachments WHERE id = ?").run(objectId);
    } else if (objectType === "artifact_version") {
      this.#database.prepare("DELETE FROM artifact_versions WHERE id = ?").run(objectId);
    } else if (objectType === "artifact") {
      this.#database.prepare("DELETE FROM artifacts WHERE id = ?").run(objectId);
    } else if (objectType === "personal_file") {
      this.#database.prepare("DELETE FROM attachments WHERE personal_file_id = ?").run(objectId);
      this.#database.prepare("DELETE FROM personal_files WHERE id = ?").run(objectId);
    }
  }

  #personalFile(row: SqlRow): PersonalFile {
    return personalFileSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      displayName: row.display_name,
      format: row.format,
      mediaType: row.media_type,
      sizeBytes: row.size_bytes,
      checksumSha256: row.checksum_sha256,
      objectRef: row.object_ref,
      sourceScopeId: row.source_scope_id,
      sourceRelativePath: row.source_relative_path,
      parseStatus: row.parse_status,
      parseErrorCode: row.parse_error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
    });
  }

  #attachment(row: SqlRow): Attachment {
    return attachmentSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      personalFileId: row.personal_file_id,
      createdAt: row.created_at,
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
}
