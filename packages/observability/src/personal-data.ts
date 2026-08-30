import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type LocalExportResult,
  localExportResultSchema,
  type PersonalDataSummary,
  personalDataSummarySchema,
} from "@openerx/contracts";
import { strToU8, zipSync } from "fflate";

type SqlRecord = Record<string, unknown>;

function openReadOnly(databasePath: string): DatabaseSync | null {
  return existsSync(databasePath) ? new DatabaseSync(databasePath, { readOnly: true }) : null;
}

function count(database: DatabaseSync, table: string, where = ""): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as {
    count: number;
  };
  return Number(row.count);
}

function rows(database: DatabaseSync, sql: string): SqlRecord[] {
  return database.prepare(sql).all() as SqlRecord[];
}

function atomicBufferExport(
  destinationPath: string,
  kind: LocalExportResult["kind"],
  bytes: Uint8Array,
  now: () => Date,
): LocalExportResult {
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, bytes, { mode: 0o600 });
  if (existsSync(destinationPath)) rmSync(destinationPath);
  renameSync(temporaryPath, destinationPath);
  return localExportResultSchema.parse({
    kind,
    fileName: path.basename(destinationPath),
    bytes: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    exportedAt: now().toISOString(),
  });
}

function atomicJsonExport(
  destinationPath: string,
  kind: LocalExportResult["kind"],
  payload: unknown,
  now: () => Date,
): LocalExportResult {
  return atomicBufferExport(
    destinationPath,
    kind,
    Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    now,
  );
}

export class PersonalDataExporter {
  readonly #databasePath: string;
  readonly #now: () => Date;

  constructor(databasePath: string, now: () => Date = () => new Date()) {
    this.#databasePath = databasePath;
    this.#now = now;
  }

  summary(): PersonalDataSummary {
    const database = openReadOnly(this.#databasePath);
    if (!database) return this.#emptySummary();
    try {
      return personalDataSummarySchema.parse({
        generatedAt: this.#now().toISOString(),
        conversations: count(database, "conversations", "WHERE deleted_at IS NULL"),
        messages: count(
          database,
          "messages",
          "WHERE conversation_id IN (SELECT id FROM conversations WHERE deleted_at IS NULL)",
        ),
        files: count(database, "personal_files"),
        artifacts: count(database, "artifacts"),
        workItems: count(database, "work_items"),
        skillInstallations: count(database, "skill_installations", "WHERE deleted_at IS NULL"),
        memories: count(database, "memory_entries", "WHERE status != 'deleted'"),
      });
    } finally {
      database.close();
    }
  }

  export(destinationPath: string): LocalExportResult {
    const database = openReadOnly(this.#databasePath);
    const exportedAt = this.#now().toISOString();
    const data = database ? this.#snapshot(database) : this.#emptySnapshot();
    const objects = database ? this.#objects(database) : [];
    database?.close();
    const objectEntries: Record<string, Uint8Array> = {};
    const profileRoot = path.dirname(this.#databasePath);
    for (const object of objects) {
      const objectPath = path.resolve(profileRoot, object.objectRef);
      if (
        !objectPath.startsWith(`${path.resolve(profileRoot)}${path.sep}`) ||
        !existsSync(objectPath)
      ) {
        continue;
      }
      objectEntries[object.archivePath] = readFileSync(objectPath);
    }
    const payload = {
      format: "openerx.personal-data.v1",
      exportedAt,
      scope: {
        localProfile: true,
        binaryObjectsIncluded: true,
        binaryObjectCount: Object.keys(objectEntries).length,
        serverBillingIncluded: false,
        note: "Token、报价、费用、余额和账单以服务端记录为准，不复制到本地数据导出。",
      },
      ...data,
    };
    const entries: Record<string, Uint8Array> = {
      "data.json": strToU8(`${JSON.stringify(payload, null, 2)}\n`),
      ...objectEntries,
    };
    return atomicBufferExport(
      destinationPath,
      "personal_data",
      zipSync(entries, { level: 6 }),
      this.#now,
    );
  }

  #snapshot(database: DatabaseSync): Record<string, SqlRecord[]> {
    return {
      conversations: rows(
        database,
        `SELECT id, title, active_branch_id AS activeBranchId,
                selected_model_ref AS selectedModelRef, created_at AS createdAt,
                updated_at AS updatedAt, archived_at AS archivedAt, revision
         FROM conversations WHERE deleted_at IS NULL ORDER BY created_at, id`,
      ),
      branches: rows(
        database,
        `SELECT id, conversation_id AS conversationId, parent_branch_id AS parentBranchId,
                forked_from_message_id AS forkedFromMessageId, label, created_at AS createdAt
         FROM branches WHERE conversation_id IN
           (SELECT id FROM conversations WHERE deleted_at IS NULL)
         ORDER BY created_at, id`,
      ),
      messages: rows(
        database,
        `SELECT m.id, m.conversation_id AS conversationId, m.branch_id AS branchId,
                m.parent_message_id AS parentMessageId, m.role, m.status, m.error_code AS errorCode,
                m.attempt, m.created_at AS createdAt, m.updated_at AS updatedAt, m.revision,
                m.position, p.text
         FROM messages m LEFT JOIN message_parts p ON p.message_id = m.id AND p.position = 1
         WHERE m.conversation_id IN (SELECT id FROM conversations WHERE deleted_at IS NULL)
         ORDER BY m.created_at, m.position, m.id`,
      ),
      files: rows(
        database,
        `SELECT id, display_name AS displayName, format, media_type AS mediaType,
                size_bytes AS sizeBytes, checksum_sha256 AS checksumSha256,
                parse_status AS parseStatus, parse_error_code AS parseErrorCode,
                parsed_text AS parsedText, created_at AS createdAt, updated_at AS updatedAt, revision
         FROM personal_files ORDER BY created_at, id`,
      ),
      artifacts: rows(
        database,
        `SELECT id, display_name AS displayName, format, media_type AS mediaType,
                current_version AS currentVersion, created_at AS createdAt,
                updated_at AS updatedAt, revision FROM artifacts ORDER BY created_at, id`,
      ),
      artifactVersions: rows(
        database,
        `SELECT id, artifact_id AS artifactId, version, size_bytes AS sizeBytes,
                checksum_sha256 AS checksumSha256,
                source_personal_file_id AS sourcePersonalFileId, created_at AS createdAt
         FROM artifact_versions ORDER BY artifact_id, version`,
      ),
      workItems: rows(
        database,
        `SELECT id, conversation_id AS conversationId, message_id AS messageId, title, status,
                created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt, revision
         FROM work_items ORDER BY created_at, id`,
      ),
      skillInstallations: rows(
        database,
        `SELECT id, name, display_name AS displayName, description, publisher, scope,
                workspace_id AS workspaceId, source_kind AS sourceKind, source_label AS sourceLabel,
                trust, enabled, auto_invoke AS autoInvoke, package_state AS packageState,
                selected_version AS selectedVersion, selected_checksum_sha256 AS selectedChecksumSha256,
                installed_at AS installedAt, updated_at AS updatedAt, last_used_at AS lastUsedAt, revision
         FROM skill_installations WHERE deleted_at IS NULL ORDER BY installed_at, id`,
      ),
      memorySettings: rows(
        database,
        `SELECT memories_enabled AS memoriesEnabled, use_memories AS useMemories,
                generate_memories AS generateMemories, sync_memories AS syncMemories,
                disable_on_external_context AS disableOnExternalContext,
                idle_delay_minutes AS idleDelayMinutes,
                min_rate_limit_remaining_percent AS minRateLimitRemainingPercent,
                updated_at AS updatedAt, revision
         FROM memory_settings ORDER BY owner_profile_id`,
      ),
      conversationMemorySettings: rows(
        database,
        `SELECT conversation_id AS conversationId, use_memories AS useMemories,
                generate_memories AS generateMemories, updated_at AS updatedAt, revision
         FROM memory_conversation_settings ORDER BY updated_at, conversation_id`,
      ),
      memoryExtractionJobs: rows(
        database,
        `SELECT id, conversation_id AS conversationId,
                source_assistant_message_id AS sourceAssistantMessageId,
                status, eligible_at AS eligibleAt, attempt,
                candidate_count AS candidateCount, skip_reason AS skipReason,
                last_error_code AS lastErrorCode, created_at AS createdAt,
                updated_at AS updatedAt, completed_at AS completedAt
         FROM memory_extraction_jobs ORDER BY created_at, id`,
      ),
      memoryConsolidationRuns: rows(
        database,
        `SELECT id, reason, status, active_count AS activeCount, expired_count AS expiredCount,
                repaired_count AS repairedCount, last_error_code AS lastErrorCode,
                started_at AS startedAt, updated_at AS updatedAt,
                completed_at AS completedAt
         FROM memory_consolidation_runs ORDER BY started_at, id`,
      ),
      memoryMergeReviews: rows(
        database,
        `SELECT id, kind, relation, target_memory_id AS targetMemoryId,
                target_content AS targetContent,
                target_revision AS targetRevision,
                proposal_memory_id AS proposalMemoryId,
                proposal_revision AS proposalRevision,
                proposed_content AS proposedContent,
                proposed_retrieval_keys_json AS proposedRetrievalKeys,
                proposed_conflict_key AS proposedConflictKey, confidence,
                source_conversation_id AS sourceConversationId,
                source_message_id AS sourceMessageId, status,
                result_memory_id AS resultMemoryId, created_at AS createdAt,
                updated_at AS updatedAt, resolved_at AS resolvedAt
         FROM memory_merge_reviews ORDER BY created_at, id`,
      ),
      memorySemanticClusterState: rows(
        database,
        `SELECT next_pair_index AS nextPairIndex, completed_cycles AS completedCycles,
                updated_at AS updatedAt, revision
         FROM memory_semantic_cluster_state ORDER BY owner_profile_id`,
      ),
      memoryConversationContext: rows(
        database,
        `SELECT conversation_id AS conversationId,
                external_context_used AS externalContextUsed, updated_at AS updatedAt
         FROM memory_conversation_context ORDER BY updated_at, conversation_id`,
      ),
      memorySourceLinks: rows(
        database,
        `SELECT memory_id AS memoryId, conversation_id AS conversationId,
                message_id AS messageId, origin, confidence, created_at AS createdAt
         FROM memory_source_links ORDER BY created_at, memory_id, conversation_id`,
      ),
      memories: rows(
        database,
        `SELECT id, kind, content, retrieval_keys_json AS retrievalKeys,
                canonical_key AS canonicalKey, conflict_key AS conflictKey,
                origin, confidence, status,
                source_conversation_id AS sourceConversationId,
                source_message_id AS sourceMessageId, supersedes_memory_id AS supersedesMemoryId,
                expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt, revision
         FROM memory_entries WHERE status != 'deleted' ORDER BY created_at, id`,
      ),
    };
  }

  #emptySummary(): PersonalDataSummary {
    return personalDataSummarySchema.parse({
      generatedAt: this.#now().toISOString(),
      conversations: 0,
      messages: 0,
      files: 0,
      artifacts: 0,
      workItems: 0,
      skillInstallations: 0,
      memories: 0,
    });
  }

  #emptySnapshot(): Record<string, SqlRecord[]> {
    return {
      conversations: [],
      branches: [],
      messages: [],
      files: [],
      artifacts: [],
      artifactVersions: [],
      workItems: [],
      skillInstallations: [],
      memorySettings: [],
      conversationMemorySettings: [],
      memoryExtractionJobs: [],
      memoryConsolidationRuns: [],
      memoryMergeReviews: [],
      memorySemanticClusterState: [],
      memoryConversationContext: [],
      memorySourceLinks: [],
      memories: [],
    };
  }

  #objects(database: DatabaseSync): Array<{ archivePath: string; objectRef: string }> {
    const safeName = (value: unknown): string =>
      String(value)
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}._-]+/gu, "_")
        .slice(0, 120);
    const files = rows(
      database,
      "SELECT id, display_name, object_ref FROM personal_files ORDER BY created_at, id",
    ).map((row) => ({
      archivePath: `files/${row.id}-${safeName(row.display_name)}`,
      objectRef: String(row.object_ref),
    }));
    const artifacts = rows(
      database,
      `SELECT v.id, v.version, v.object_ref, a.display_name
       FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
       ORDER BY v.artifact_id, v.version`,
    ).map((row) => ({
      archivePath: `artifacts/${row.id}-v${row.version}-${safeName(row.display_name)}`,
      objectRef: String(row.object_ref),
    }));
    return [...files, ...artifacts];
  }
}

export { atomicBufferExport, atomicJsonExport };
