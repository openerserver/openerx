import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type ByokUsageRecord,
  byokUsageQueryResultSchema,
  byokUsageRecordSchema,
  type CapabilityAction,
  type CapabilityScope,
  capabilityScopeSchema,
  type ExecutionRun,
  executionRunSchema,
  type LocalWebSearchSettingsSelection,
  localWebSearchSettingsSelectionSchema,
  type McpServerConfig,
  mcpServerConfigSchema,
  modelUsageRecordSchema,
  type NormalizedToolResult,
  normalizedToolResultSchema,
  type PermissionRequest,
  permissionRequestSchema,
  type RunItem,
  type RunItemContent,
  type RunStep,
  runItemSchema,
  runStepSchema,
  type ThinkingLevel,
  type ToolCall,
  type ToolCapability,
  type ToolInput,
  type ToolPermissionMode,
  type ToolPermissionModeState,
  type ToolRisk,
  toolCallSchema,
  type UsageRecord,
  type WorkItem,
  type WorkspaceChange,
  type WorkspaceChangeSet,
  type WorkspaceChangeSetEntry,
  type WorkspaceChangeSetStatus,
  type WorkspaceGrant,
  type WorkspaceInstructionSource,
  workItemSchema,
  workspaceChangeSchema,
  workspaceChangeSetSchema,
  workspaceGrantSchema,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

export interface ToolRepositoryOptions {
  ownerProfileId?: string;
  now?: () => string;
  idFactory?: () => string;
}

export interface ArtifactRetention {
  deliverableIds: string[];
  disposableIds: string[];
}

function legacyTransientArtifactName(displayName: string): boolean {
  const normalized = displayName.trim().toLowerCase();
  return /^(?:ping(?:[-_. ]*\d+)?|(?:tmp|temp|scratch|probe|health-?check)(?:[-_. ]|\d|$)|test(?:[-_. ]|\d))/u.test(
    normalized,
  );
}

export interface ToolProjection {
  workItem: WorkItem;
  run: ExecutionRun;
}

export interface ToolCallDraft {
  runId: string;
  piCallRef: string;
  toolName: string;
  source: ToolCall["source"];
  risk: ToolRisk;
  idempotencyKey: string;
  input?: ToolInput | null;
  inputSummary: string;
  targetSummary: string;
}

export interface SideEffectAttempt {
  idempotencyKey: string;
  toolCallId: string;
  operationDigest: string;
  status: "executing" | "committed" | "outcome_unknown";
  result: NormalizedToolResult | null;
  startedAt: string;
  updatedAt: string;
}

export interface WorkspaceChangeRecord extends WorkspaceChange {
  beforeText: string | null;
  afterText: string;
}

export interface WorkspaceOutputCandidate {
  conversationId: string;
  workspaceGrantId: string;
  workspaceRootPath: string;
  relativePath: string;
  afterSha256: string | null;
  sourceRevision: string;
  updatedAt: string;
}

export type WorkspaceBindingRole = "primary" | "additional";
export type WorkspaceBindingSource = "default" | "project" | "user_added";

export interface WorkspaceBinding {
  workspaceGrantId: string;
  ownerProfileId: string;
  conversationId: string;
  role: WorkspaceBindingRole;
  source: WorkspaceBindingSource;
  projectDirectoryBindingId?: string;
  sourceRevision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkspaceBindingInput {
  projectDirectoryBindingId: string;
  sourceWorkspaceGrantId: string;
  sourceRevision: number;
  displayName: string;
  role: WorkspaceBindingRole;
  desiredAccess: WorkspaceGrant["access"];
}

export type WorkspaceChangeSetRecord = WorkspaceChangeSet;

export type StoredLocalWebSearchSettings = LocalWebSearchSettingsSelection & {
  updatedAt: string;
};

export class ToolRepository {
  readonly #database: DatabaseSync;
  readonly #ownerProfileId: string;
  readonly #now: () => string;
  readonly #idFactory: () => string;

  constructor(databasePath: string, options: ToolRepositoryOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#ownerProfileId = options.ownerProfileId ?? "local-default";
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    migrateDatabase(this.#database);
  }

  close(): void {
    this.#database.close();
  }

  createProjection(input: {
    conversationId: string;
    messageId: string;
    branchId: string;
    title: string;
    selectedModelRef: string;
    thinkingLevel: ThinkingLevel;
    piPackageVersion: string;
    piHostContractVersion: number;
    piSessionRef?: string | null;
    initialToolNames?: string[];
    availableToolNames?: string[];
    skillInstallationIds?: string[];
    instructionSources?: WorkspaceInstructionSource[];
  }): ToolProjection {
    const existing = this.#database
      .prepare(
        "SELECT id, active_run_id FROM work_items WHERE owner_profile_id = ? AND message_id = ?",
      )
      .get(this.#ownerProfileId, input.messageId) as
      | { id: string; active_run_id: string }
      | undefined;
    if (existing) {
      return { workItem: this.workItem(existing.id), run: this.run(existing.active_run_id) };
    }
    return this.#transaction(() => {
      const now = this.#now();
      const workItemId = this.#idFactory();
      const runId = this.#idFactory();
      this.#database
        .prepare(
          `INSERT INTO work_items
           (id, owner_profile_id, conversation_id, message_id, title, status, active_run_id,
            created_at, updated_at, completed_at, revision)
           VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL, 1)`,
        )
        .run(
          workItemId,
          this.#ownerProfileId,
          input.conversationId,
          input.messageId,
          input.title,
          runId,
          now,
          now,
        );
      this.#database
        .prepare(
          `INSERT INTO execution_runs
           (id, work_item_id, attempt, status, pi_package_version, pi_host_contract_version,
            selected_model_ref, effective_model_ref, branch_id, thinking_level, pi_session_ref,
            usage_records_json, cancellation_requested_at, last_pi_event_sequence,
            retry_count, compaction_count, error_code, created_at, started_at, completed_at, updated_at,
            fallback_reason, initial_tool_names_json, available_tool_names_json,
            skill_installation_ids_json, instruction_sources_json)
           VALUES (?, ?, 1, 'running', ?, ?, ?, NULL, ?, ?, ?, '[]', NULL, 0, 0, 0, NULL, ?, ?, NULL, ?,
                   NULL, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          workItemId,
          input.piPackageVersion,
          input.piHostContractVersion,
          input.selectedModelRef,
          input.branchId,
          input.thinkingLevel,
          input.piSessionRef ?? null,
          now,
          now,
          now,
          JSON.stringify(input.initialToolNames ?? []),
          JSON.stringify(input.availableToolNames ?? []),
          JSON.stringify(input.skillInstallationIds ?? []),
          JSON.stringify(input.instructionSources ?? []),
        );
      return { workItem: this.workItem(workItemId), run: this.run(runId) };
    });
  }

  createToolCall(draft: ToolCallDraft): { step: RunStep; toolCall: ToolCall } {
    const existing = this.#database
      .prepare("SELECT id, step_id FROM tool_calls WHERE run_id = ? AND pi_call_ref = ?")
      .get(draft.runId, draft.piCallRef) as { id: string; step_id: string } | undefined;
    if (existing)
      return { step: this.step(existing.step_id), toolCall: this.toolCall(existing.id) };
    return this.#transaction(() => {
      const now = this.#now();
      const stepId = this.#idFactory();
      const toolCallId = this.#idFactory();
      const nextSequence = Number(
        (
          this.#database
            .prepare(
              "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_steps WHERE run_id = ?",
            )
            .get(draft.runId) as { sequence: number }
        ).sequence,
      );
      this.#database
        .prepare(
          `INSERT INTO run_steps
           (id, run_id, pi_step_ref, kind, title, status, sequence, started_at, completed_at, error_code)
           VALUES (?, ?, ?, 'tool', ?, 'running', ?, ?, NULL, NULL)`,
        )
        .run(stepId, draft.runId, `tool:${draft.piCallRef}`, draft.toolName, nextSequence, now);
      this.#database
        .prepare(
          `INSERT INTO tool_calls
           (id, run_id, step_id, pi_call_ref, tool_name, source, status, risk, idempotency_key,
            input_summary, target_summary, result_summary, error_code, started_at, completed_at,
            updated_at, input_json)
           VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          toolCallId,
          draft.runId,
          stepId,
          draft.piCallRef,
          draft.toolName,
          draft.source,
          draft.risk,
          draft.idempotencyKey,
          draft.inputSummary,
          draft.targetSummary,
          now,
          draft.input ? JSON.stringify(draft.input) : null,
        );
      this.upsertRunItem({
        runId: draft.runId,
        piItemRef: `tool:${draft.piCallRef}`,
        status: "running",
        content: {
          type: "tool",
          toolCallId,
          toolName: draft.toolName,
          input: draft.input ?? null,
          inputSummary: draft.inputSummary,
          targetSummary: draft.targetSummary,
        },
        startedAt: now,
      });
      return { step: this.step(stepId), toolCall: this.toolCall(toolCallId) };
    });
  }

  upsertRunItem(input: {
    runId: string;
    piItemRef: string;
    status: RunItem["status"];
    content: RunItemContent;
    startedAt?: string | null;
    completedAt?: string | null;
    errorCode?: string | null;
  }): RunItem {
    const now = this.#now();
    const existing = this.#database
      .prepare("SELECT id FROM run_items WHERE run_id = ? AND pi_item_ref = ?")
      .get(input.runId, input.piItemRef) as { id: string } | undefined;
    const terminal = ["completed", "failed", "cancelled"].includes(input.status);
    if (existing) {
      this.#database
        .prepare(
          `UPDATE run_items
           SET status = ?, content_json = ?,
               started_at = COALESCE(started_at, ?),
               completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END,
               error_code = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.status,
          JSON.stringify(input.content),
          input.startedAt ?? now,
          terminal ? 1 : 0,
          input.completedAt ?? now,
          input.errorCode ?? null,
          now,
          existing.id,
        );
      return this.runItem(existing.id);
    }
    const id = this.#idFactory();
    const sequence = Number(
      (
        this.#database
          .prepare(
            "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_items WHERE run_id = ?",
          )
          .get(input.runId) as { sequence: number }
      ).sequence,
    );
    const startedAt = input.startedAt ?? now;
    this.#database
      .prepare(
        `INSERT INTO run_items
         (id, run_id, sequence, pi_item_ref, status, content_json, started_at,
          completed_at, error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        sequence,
        input.piItemRef,
        input.status,
        JSON.stringify(input.content),
        startedAt,
        terminal ? (input.completedAt ?? now) : null,
        input.errorCode ?? null,
        now,
        now,
      );
    return this.runItem(id);
  }

  markToolCall(
    toolCallId: string,
    status: ToolCall["status"],
    input: {
      resultSummary?: string | null;
      resultContent?: NormalizedToolResult["content"];
      resultData?: unknown;
      errorCode?: string | null;
    } = {},
  ): ToolCall {
    const now = this.#now();
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    const result = this.#database
      .prepare(
        `UPDATE tool_calls
         SET status = ?, result_summary = COALESCE(?, result_summary), error_code = ?,
             result_content_json = COALESCE(?, result_content_json),
             started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
             completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        input.resultSummary ?? null,
        input.errorCode ?? null,
        input.resultContent === undefined ? null : JSON.stringify(input.resultContent),
        status,
        now,
        terminal ? 1 : 0,
        now,
        now,
        toolCallId,
      );
    if (result.changes !== 1) throw new Error("TOOL_CALL_NOT_FOUND");
    const call = this.toolCall(toolCallId);
    this.#updateToolRunItem(call, status, input.errorCode ?? null, now);
    if (terminal) {
      this.#database
        .prepare(`UPDATE run_steps SET status = ?, completed_at = ?, error_code = ? WHERE id = ?`)
        .run(
          status === "completed" ? "completed" : status,
          now,
          input.errorCode ?? null,
          call.stepId,
        );
      this.#projectToolResultItems(call, input.resultContent ?? [], input.resultData, status, now);
    }
    return call;
  }

  recordByokUsage(input: ByokUsageRecord, runId?: string): void {
    const record = byokUsageRecordSchema.parse({ ...input, runId: runId ?? null });
    this.#transaction(() => {
      if (record.conversationId !== null) {
        // A cancellation may report usage after its conversation was soft deleted.
        // Keep ownership validation; queries continue to hide deleted conversations.
        const scope = this.#database
          .prepare("SELECT id FROM conversations WHERE id = ? AND owner_profile_id = ?")
          .get(record.conversationId, this.#ownerProfileId);
        if (!scope) throw new Error("BYOK_USAGE_SCOPE_INVALID");
      }
      if (record.messageId !== null) {
        const scope = this.#database
          .prepare("SELECT id FROM messages WHERE id = ? AND conversation_id = ?")
          .get(record.messageId, record.conversationId);
        if (!scope) throw new Error("BYOK_USAGE_SCOPE_INVALID");
      }
      const existing = this.#database
        .prepare("SELECT owner_profile_id, record_json FROM byok_usage_records WHERE usage_id = ?")
        .get(record.usageId) as { owner_profile_id: string; record_json: string } | undefined;
      if (existing) {
        const stored = byokUsageRecordSchema.parse(JSON.parse(existing.record_json));
        if (
          existing.owner_profile_id !== this.#ownerProfileId ||
          JSON.stringify({ ...stored, runId: null }) !== JSON.stringify({ ...record, runId: null })
        ) {
          throw new Error("BYOK_USAGE_DEDUPE_CONFLICT");
        }
        return;
      }
      if (runId) {
        const run = this.#database
          .prepare(
            `SELECT er.usage_records_json FROM execution_runs er JOIN work_items wi ON wi.id = er.work_item_id
           WHERE er.id = ? AND wi.owner_profile_id = ? AND wi.conversation_id = ? AND wi.message_id = ?`,
          )
          .get(runId, this.#ownerProfileId, record.conversationId, record.messageId) as
          | { usage_records_json: string }
          | undefined;
        if (!run) throw new Error("BYOK_USAGE_RUN_INVALID");
        const records = modelUsageRecordSchema.array().parse(JSON.parse(run.usage_records_json));
        if (!records.some(({ usageId }) => usageId === record.usageId)) records.push(record);
        this.#database
          .prepare(
            "UPDATE execution_runs SET usage_records_json = ?, effective_model_ref = ? WHERE id = ?",
          )
          .run(JSON.stringify(records), record.effectiveModelRef, runId);
      }
      this.#database
        .prepare(
          `INSERT INTO byok_usage_records (usage_id, owner_profile_id, conversation_id, message_id, operation_id, recorded_at, record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.usageId,
          this.#ownerProfileId,
          record.conversationId,
          record.messageId,
          record.operationId,
          record.recordedAt,
          JSON.stringify(record),
        );
    });
  }

  byokUsage(query: { conversationId?: string; messageId?: string } = {}) {
    const conditions = [
      "u.owner_profile_id = ?",
      "(u.conversation_id IS NULL OR c.deleted_at IS NULL)",
    ];
    const args = [this.#ownerProfileId];
    if (query.conversationId) {
      conditions.push("u.conversation_id = ?");
      args.push(query.conversationId);
    }
    if (query.messageId) {
      conditions.push("u.message_id = ?");
      args.push(query.messageId);
    }
    const rows = this.#database
      .prepare(
        `SELECT u.record_json FROM byok_usage_records u LEFT JOIN conversations c ON c.id = u.conversation_id
       WHERE ${conditions.join(" AND ")} ORDER BY u.recorded_at, u.usage_id`,
      )
      .all(...args) as { record_json: string }[];
    const selected = query.messageId
      ? this.#database
          .prepare(
            `SELECT COALESCE(m.selected_model_ref, c.selected_model_ref) AS model_ref FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = ? AND c.owner_profile_id = ? AND c.deleted_at IS NULL AND (? IS NULL OR c.id = ?)`,
          )
          .get(
            query.messageId,
            this.#ownerProfileId,
            query.conversationId ?? null,
            query.conversationId ?? null,
          )
      : query.conversationId
        ? this.#database
            .prepare(
              "SELECT selected_model_ref AS model_ref FROM conversations WHERE id = ? AND owner_profile_id = ? AND deleted_at IS NULL",
            )
            .get(query.conversationId, this.#ownerProfileId)
        : undefined;
    return byokUsageQueryResultSchema.parse({
      selectedModelRef: (selected as { model_ref: string } | undefined)?.model_ref ?? null,
      records: rows.map((row) => JSON.parse(row.record_json)),
    });
  }

  completeRun(
    runId: string,
    status: "completed" | "failed" | "interrupted",
    errorCode?: string,
    usageRecords: UsageRecord[] = [],
  ): void {
    const now = this.#now();
    this.#transaction(() => {
      const runRow = this.#database
        .prepare("SELECT work_item_id, usage_records_json FROM execution_runs WHERE id = ?")
        .get(runId) as { work_item_id: string; usage_records_json: string } | undefined;
      if (!runRow) throw new Error("RUN_NOT_FOUND");
      const combinedUsage = [
        ...new Map(
          [
            ...modelUsageRecordSchema.array().parse(JSON.parse(runRow.usage_records_json)),
            ...usageRecords,
          ].map((record) => [record.usageId, record]),
        ).values(),
      ];
      if (status === "interrupted") {
        this.#database
          .prepare(
            `UPDATE execution_runs
             SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?)
             WHERE id = ?`,
          )
          .run(now, runId);
      }
      const storedStatus = status === "interrupted" ? "cancelled" : status;
      this.#database
        .prepare(
          `UPDATE execution_runs
           SET status = ?, error_code = ?, usage_records_json = ?,
               effective_model_ref = COALESCE(?, effective_model_ref),
               fallback_reason = COALESCE(?, fallback_reason),
               completed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          storedStatus,
          errorCode ?? null,
          JSON.stringify(combinedUsage),
          combinedUsage.at(-1)?.effectiveModelRef ?? null,
          combinedUsage.at(-1)?.fallbackReason ?? null,
          now,
          now,
          runId,
        );
      this.#database
        .prepare(
          `UPDATE run_items
           SET status = ?, completed_at = COALESCE(completed_at, ?),
               error_code = CASE WHEN ? IS NULL THEN error_code ELSE COALESCE(error_code, ?) END,
               updated_at = ?
           WHERE run_id = ? AND status IN ('queued', 'running')`,
        )
        .run(
          status === "completed" ? "completed" : status === "interrupted" ? "cancelled" : "failed",
          now,
          errorCode ?? null,
          errorCode ?? null,
          now,
          runId,
        );
      this.#database
        .prepare(
          `UPDATE work_items SET status = ?, completed_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(storedStatus, now, now, runRow.work_item_id);
    });
  }

  requestRunCancellation(runId: string): ExecutionRun {
    const now = this.#now();
    return this.#transaction(() => {
      const row = this.#database
        .prepare("SELECT work_item_id FROM execution_runs WHERE id = ?")
        .get(runId) as { work_item_id: string } | undefined;
      if (!row) throw new Error("RUN_NOT_FOUND");
      const result = this.#database
        .prepare(
          `UPDATE execution_runs
           SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?), updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running', 'waiting_for_user', 'waiting_for_permission')`,
        )
        .run(now, now, runId);
      if (result.changes === 1) {
        this.#database
          .prepare("UPDATE work_items SET updated_at = ?, revision = revision + 1 WHERE id = ?")
          .run(now, row.work_item_id);
      }
      return this.run(runId);
    });
  }

  setWaitingForPermission(runId: string, waiting: boolean): void {
    const run = this.run(runId);
    const status = waiting ? "waiting_for_permission" : "running";
    const now = this.#now();
    this.#transaction(() => {
      this.#database
        .prepare("UPDATE execution_runs SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, now, runId);
      this.#database
        .prepare(
          "UPDATE work_items SET status = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
        )
        .run(status, now, run.workItemId);
    });
  }

  recordPiProjection(
    runId: string,
    sequence: number,
    kind: "compaction" | "retry",
    completed: boolean,
  ): void {
    const now = this.#now();
    const counter = kind === "compaction" ? "compaction_count" : "retry_count";
    this.#database
      .prepare(
        `UPDATE execution_runs SET last_pi_event_sequence = MAX(last_pi_event_sequence, ?),
         ${counter} = ${counter} + ?, updated_at = ? WHERE id = ?`,
      )
      .run(sequence, completed ? 1 : 0, now, runId);
  }

  recordPiEventSequence(runId: string, sequence: number): void {
    this.#database
      .prepare(
        `UPDATE execution_runs
         SET last_pi_event_sequence = MAX(last_pi_event_sequence, ?), updated_at = ?
         WHERE id = ?`,
      )
      .run(sequence, this.#now(), runId);
  }

  createPermission(input: {
    workItemId: string;
    runId: string;
    toolCallId: string;
    capability: ToolCapability;
    risk: ToolRisk;
    resourceType: CapabilityScope["resourceType"];
    resource: string;
    actions: CapabilityAction[];
    reason: string;
    payloadDigest: string;
    ttlMs?: number;
  }): PermissionRequest {
    const duplicate = this.#database
      .prepare("SELECT id FROM permission_requests WHERE tool_call_id = ? AND payload_digest = ?")
      .get(input.toolCallId, input.payloadDigest) as { id: string } | undefined;
    if (duplicate) return this.permission(duplicate.id);
    const id = this.#idFactory();
    const requestedAt = this.#now();
    const expiresAt = new Date(Date.parse(requestedAt) + (input.ttlMs ?? 5 * 60_000)).toISOString();
    this.#database
      .prepare(
        `INSERT INTO permission_requests
         (id, owner_profile_id, work_item_id, run_id, tool_call_id, capability, risk,
          resource_type, resource, actions_json, reason, payload_digest, status, requested_at,
          expires_at, resolved_at, resolution, scope_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL)`,
      )
      .run(
        id,
        this.#ownerProfileId,
        input.workItemId,
        input.runId,
        input.toolCallId,
        input.capability,
        input.risk,
        input.resourceType,
        input.resource,
        JSON.stringify(input.actions),
        input.reason,
        input.payloadDigest,
        requestedAt,
        expiresAt,
      );
    this.markToolCall(input.toolCallId, "waiting_for_permission");
    this.upsertRunItem({
      runId: input.runId,
      piItemRef: `approval:${id}`,
      status: "running",
      content: {
        type: "approval",
        permissionRequestId: id,
        toolCallId: input.toolCallId,
        capability: input.capability,
        risk: input.risk,
        resource: input.resource,
        reason: input.reason,
      },
      startedAt: requestedAt,
    });
    this.setWaitingForPermission(input.runId, true);
    return this.permission(id);
  }

  resolvePermission(input: {
    permissionRequestId: string;
    decision: "once" | "session" | "persistent" | "deny";
    payloadDigest: string;
    scopeConversationId?: string | null;
  }): { permission: PermissionRequest; scope: CapabilityScope | null } {
    return this.#transaction(() => {
      const request = this.permission(input.permissionRequestId);
      if (request.status !== "pending") throw new Error("PERMISSION_ALREADY_RESOLVED");
      if (request.payloadDigest !== input.payloadDigest)
        throw new Error("PERMISSION_PAYLOAD_CHANGED");
      if (
        (request.risk === "L4" || request.risk === "L5") &&
        (input.decision === "session" || input.decision === "persistent")
      ) {
        throw new Error("PERMISSION_DECISION_NOT_ALLOWED");
      }
      // A current full-access scope authorizes the waiting operation even if its old
      // per-call prompt expired. The payload digest must still match above.
      const authorizedByFullAccess =
        input.decision === "once" &&
        this.permissionMode(this.workItem(request.workItemId).conversationId).mode ===
          "full_access";
      if (Date.parse(request.expiresAt) <= Date.parse(this.#now()) && !authorizedByFullAccess) {
        this.#database
          .prepare(
            "UPDATE permission_requests SET status = 'expired', resolved_at = ? WHERE id = ?",
          )
          .run(this.#now(), request.id);
        throw new Error("PERMISSION_EXPIRED");
      }
      let scope: CapabilityScope | null = null;
      const now = this.#now();
      if (input.decision === "session" || input.decision === "persistent") {
        const expiresAt =
          input.decision === "persistent"
            ? null
            : new Date(Date.parse(now) + 8 * 60 * 60_000).toISOString();
        scope = this.createScope({
          capability: request.capability,
          resourceType: request.resourceType,
          resource: request.resource,
          actions: request.actions,
          maxRisk: request.risk,
          conversationId: input.scopeConversationId ?? null,
          sessionOnly: input.decision === "session",
          expiresAt,
        });
      }
      this.#database
        .prepare(
          `UPDATE permission_requests
           SET status = ?, resolved_at = ?, resolution = ?, scope_id = ? WHERE id = ?`,
        )
        .run(
          input.decision === "deny" ? "denied" : "approved",
          now,
          input.decision,
          scope?.id ?? null,
          request.id,
        );
      this.upsertRunItem({
        runId: request.runId,
        piItemRef: `approval:${request.id}`,
        status: input.decision === "deny" ? "failed" : "completed",
        content: {
          type: "approval",
          permissionRequestId: request.id,
          toolCallId: request.toolCallId,
          capability: request.capability,
          risk: request.risk,
          resource: request.resource,
          reason: request.reason,
        },
        startedAt: request.requestedAt,
        completedAt: now,
        errorCode: input.decision === "deny" ? "PERMISSION_DENIED" : null,
      });
      if (input.decision === "deny") {
        this.markToolCall(request.toolCallId, "failed", { errorCode: "PERMISSION_DENIED" });
      } else {
        this.markToolCall(request.toolCallId, "requested");
      }
      const run = this.run(request.runId);
      this.#database
        .prepare("UPDATE execution_runs SET status = 'running', updated_at = ? WHERE id = ?")
        .run(now, request.runId);
      this.#database
        .prepare(
          "UPDATE work_items SET status = 'running', updated_at = ?, revision = revision + 1 WHERE id = ?",
        )
        .run(now, run.workItemId);
      return { permission: this.permission(request.id), scope };
    });
  }

  createScope(input: {
    capability: ToolCapability;
    resourceType: CapabilityScope["resourceType"];
    resource: string;
    actions: CapabilityAction[];
    maxRisk: ToolRisk;
    conversationId?: string | null;
    sessionOnly: boolean;
    expiresAt: string | null;
  }): CapabilityScope {
    const id = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO capability_scopes
         (id, owner_profile_id, capability, resource_type, resource, actions_json, max_risk,
          conversation_id, session_only, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        this.#ownerProfileId,
        input.capability,
        input.resourceType,
        input.resource,
        JSON.stringify(input.actions),
        input.maxRisk,
        input.conversationId ?? null,
        input.sessionOnly ? 1 : 0,
        input.expiresAt,
        this.#now(),
      );
    return this.scope(id);
  }

  activeScopes(capability?: ToolCapability): CapabilityScope[] {
    const now = this.#now();
    const rows = capability
      ? this.#database
          .prepare(
            `SELECT * FROM capability_scopes WHERE owner_profile_id = ? AND capability = ?
             AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at`,
          )
          .all(this.#ownerProfileId, capability, now)
      : this.#database
          .prepare(
            `SELECT * FROM capability_scopes WHERE owner_profile_id = ?
             AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at`,
          )
          .all(this.#ownerProfileId, now);
    return (rows as SqlRow[]).map((row) => this.#scope(row));
  }

  permissionMode(conversationId: string): ToolPermissionModeState {
    const scope = this.activeScopes("full_access").find(
      (candidate) => candidate.conversationId === conversationId,
    );
    return {
      conversationId,
      mode: scope ? "full_access" : "ask",
      scopeId: scope?.id ?? null,
    };
  }

  setPermissionMode(input: {
    conversationId: string;
    mode: ToolPermissionMode;
  }): ToolPermissionModeState {
    return this.#transaction(() => {
      const active = this.activeScopes("full_access").filter(
        (scope) => scope.conversationId === input.conversationId,
      );
      if (input.mode === "ask") {
        for (const scope of active) this.revokeScope(scope.id);
        return { conversationId: input.conversationId, mode: "ask", scopeId: null };
      }
      const existing = active[0];
      if (existing) {
        return {
          conversationId: input.conversationId,
          mode: "full_access",
          scopeId: existing.id,
        };
      }
      const scope = this.createScope({
        capability: "full_access",
        resourceType: "builtin",
        resource: "conversation",
        actions: ["high_impact"],
        maxRisk: "L5",
        conversationId: input.conversationId,
        sessionOnly: false,
        expiresAt: null,
      });
      return {
        conversationId: input.conversationId,
        mode: "full_access",
        scopeId: scope.id,
      };
    });
  }

  revokeScope(scopeId: string): CapabilityScope {
    const result = this.#database
      .prepare(
        "UPDATE capability_scopes SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND owner_profile_id = ?",
      )
      .run(this.#now(), scopeId, this.#ownerProfileId);
    if (result.changes !== 1) throw new Error("CAPABILITY_SCOPE_NOT_FOUND");
    return this.scope(scopeId);
  }

  grantWorkspace(input: {
    conversationId: string | null;
    displayName: string;
    rootPath: string;
    access: WorkspaceGrant["access"];
    allowNetwork: boolean;
    expiresAt: string | null;
    projectOperationId?: string;
    binding?: {
      role: WorkspaceBindingRole;
      source: WorkspaceBindingSource;
      projectDirectoryBindingId?: string;
      sourceRevision?: number;
    };
  }): WorkspaceGrant {
    return this.#transaction(() => {
      if (input.projectOperationId) {
        const existing = this.#database
          .prepare(
            `SELECT * FROM workspace_grants
             WHERE owner_profile_id = ? AND project_operation_id = ?`,
          )
          .get(this.#ownerProfileId, input.projectOperationId) as SqlRow | undefined;
        if (existing) {
          const grant = this.#workspaceGrant(existing);
          if (
            grant.revokedAt ||
            grant.conversationId !== input.conversationId ||
            grant.displayName !== input.displayName ||
            grant.rootPath !== input.rootPath ||
            grant.access !== input.access ||
            grant.allowNetwork !== input.allowNetwork ||
            grant.expiresAt !== input.expiresAt
          ) {
            throw new Error("IDEMPOTENCY_KEY_REUSED");
          }
          return grant;
        }
      }
      const connected =
        input.conversationId && input.binding?.source === "user_added"
          ? this.listWorkspaceGrants(input.conversationId).filter(
              (grant) =>
                grant.conversationId === input.conversationId && grant.rootPath === input.rootPath,
            )
          : [];
      const duplicates = connected.filter(
        (grant) => grant.bindingSource === "user_added" || !grant.bindingSource,
      );
      const reusable = duplicates.find(
        (grant) =>
          grant.access === input.access &&
          grant.allowNetwork === input.allowNetwork &&
          grant.expiresAt === input.expiresAt,
      );
      // Re-selecting a connected directory must not create another authorization.
      // Keep its primary role when it is selected through Add directory.
      const binding = input.binding && {
        ...input.binding,
        role: connected.some((grant) => grant.bindingRole === "primary")
          ? ("primary" as const)
          : input.binding.role,
      };
      if (reusable && input.conversationId && binding) {
        this.#bindWorkspace({
          workspaceGrantId: reusable.id,
          conversationId: input.conversationId,
          ...binding,
          createdAt: this.#now(),
        });
        for (const duplicate of duplicates) {
          if (duplicate.id !== reusable.id) this.#revokeWorkspaceGrant(duplicate.id);
        }
        return this.workspaceGrant(reusable.id);
      }
      const id = this.#idFactory();
      const createdAt = this.#now();
      this.#database
        .prepare(
          `INSERT INTO workspace_grants
           (id, owner_profile_id, conversation_id, display_name, root_path, access,
            allow_network, expires_at, revoked_at, created_at, project_operation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          this.#ownerProfileId,
          input.conversationId,
          input.displayName,
          input.rootPath,
          input.access,
          input.allowNetwork ? 1 : 0,
          input.expiresAt,
          createdAt,
          input.projectOperationId ?? null,
        );
      this.createScope({
        capability: "workspace",
        resourceType: "workspace",
        resource: id,
        actions: input.access === "read_write" ? ["read", "search", "patch"] : ["read", "search"],
        maxRisk: input.access === "read_write" ? "L3" : "L1",
        conversationId: input.conversationId,
        sessionOnly: false,
        expiresAt: input.expiresAt,
      });
      if (input.access === "read_write") {
        this.createScope({
          capability: "shell",
          resourceType: "workspace",
          resource: id,
          actions: input.allowNetwork ? ["execute", "external_write"] : ["execute"],
          maxRisk: input.allowNetwork ? "L4" : "L3",
          conversationId: input.conversationId,
          sessionOnly: false,
          expiresAt: input.expiresAt,
        });
      }
      if (input.conversationId && binding) {
        this.#bindWorkspace({
          workspaceGrantId: id,
          conversationId: input.conversationId,
          ...binding,
          createdAt,
        });
      }
      for (const duplicate of duplicates) this.#revokeWorkspaceGrant(duplicate.id);
      return this.workspaceGrant(id);
    });
  }

  listWorkspaceBindings(conversationId: string): WorkspaceBinding[] {
    const rows = this.#database
      .prepare(
        `SELECT binding.*
         FROM workspace_bindings AS binding
         JOIN workspace_grants AS grant ON grant.id = binding.workspace_grant_id
         WHERE binding.owner_profile_id = ? AND binding.conversation_id = ?
           AND grant.revoked_at IS NULL
           AND (grant.expires_at IS NULL OR grant.expires_at > ?)
         ORDER BY CASE binding.role WHEN 'primary' THEN 0 ELSE 1 END,
                  binding.updated_at DESC, binding.workspace_grant_id`,
      )
      .all(this.#ownerProfileId, conversationId, this.#now()) as SqlRow[];
    return rows.map((row) => this.#workspaceBinding(row));
  }

  primaryWorkspaceGrant(conversationId: string): WorkspaceGrant | null {
    const binding = this.listWorkspaceBindings(conversationId).find(
      ({ role }) => role === "primary",
    );
    return binding ? this.activeWorkspaceGrant(binding.workspaceGrantId, conversationId) : null;
  }

  bindWorkspace(input: {
    workspaceGrantId: string;
    conversationId: string;
    role: WorkspaceBindingRole;
    source: WorkspaceBindingSource;
    projectDirectoryBindingId?: string;
    sourceRevision?: number;
  }): WorkspaceBinding {
    return this.#transaction(() => {
      const grant = this.activeWorkspaceGrant(input.workspaceGrantId, input.conversationId);
      if (grant.conversationId !== input.conversationId) {
        throw new Error("WORKSPACE_BINDING_CONVERSATION_REQUIRED");
      }
      const now = this.#now();
      this.#bindWorkspace({ ...input, createdAt: now });
      const binding = this.#database
        .prepare("SELECT * FROM workspace_bindings WHERE workspace_grant_id = ?")
        .get(input.workspaceGrantId) as SqlRow | undefined;
      if (!binding) throw new Error("WORKSPACE_BINDING_NOT_FOUND");
      return this.#workspaceBinding(binding);
    });
  }

  reconcileProjectWorkspaceBindings(input: {
    conversationId: string;
    directories: ProjectWorkspaceBindingInput[];
  }): WorkspaceGrant[] {
    const hasConversationPrimary =
      this.primaryWorkspaceGrant(input.conversationId)?.bindingSource === "user_added";
    if (input.directories.filter(({ role }) => role === "primary").length > 1) {
      throw new Error("PROJECT_PRIMARY_DIRECTORY_REQUIRED");
    }
    const desired = new Map<string, ProjectWorkspaceBindingInput>();
    for (const directory of input.directories) {
      if (desired.has(directory.projectDirectoryBindingId)) {
        throw new Error("PROJECT_SCOPE_MISMATCH");
      }
      desired.set(directory.projectDirectoryBindingId, directory);
    }

    const existingRows = this.#database
      .prepare(
        `SELECT binding.* FROM workspace_bindings AS binding
         JOIN workspace_grants AS grant ON grant.id = binding.workspace_grant_id
         WHERE binding.owner_profile_id = ? AND binding.conversation_id = ?
           AND binding.source = 'project' AND grant.revoked_at IS NULL
           AND (grant.expires_at IS NULL OR grant.expires_at > ?)
         ORDER BY binding.updated_at DESC, binding.workspace_grant_id`,
      )
      .all(this.#ownerProfileId, input.conversationId, this.#now()) as SqlRow[];
    const reusable = new Map<string, SqlRow>();
    for (const row of existingRows) {
      const bindingId = row.project_directory_binding_id
        ? String(row.project_directory_binding_id)
        : null;
      const expected = bindingId ? desired.get(bindingId) : undefined;
      if (
        !bindingId ||
        !expected ||
        Number(row.source_revision) !== expected.sourceRevision ||
        reusable.has(bindingId)
      ) {
        this.revokeWorkspaceGrant(String(row.workspace_grant_id));
        continue;
      }
      reusable.set(bindingId, row);
    }

    const grants: WorkspaceGrant[] = [];
    for (const directory of input.directories) {
      const role =
        hasConversationPrimary && directory.role === "primary" ? "additional" : directory.role;
      const existing = reusable.get(directory.projectDirectoryBindingId);
      if (existing) {
        this.bindWorkspace({
          workspaceGrantId: String(existing.workspace_grant_id),
          conversationId: input.conversationId,
          role,
          source: "project",
          projectDirectoryBindingId: directory.projectDirectoryBindingId,
          sourceRevision: directory.sourceRevision,
        });
        grants.push(this.workspaceGrant(String(existing.workspace_grant_id)));
        continue;
      }

      const source = this.activeWorkspaceGrant(directory.sourceWorkspaceGrantId);
      if (
        source.conversationId !== null ||
        source.access !== directory.desiredAccess ||
        source.allowNetwork
      ) {
        throw new Error("PROJECT_SCOPE_MISMATCH");
      }
      grants.push(
        this.grantWorkspace({
          conversationId: input.conversationId,
          displayName: directory.displayName,
          rootPath: source.rootPath,
          access: directory.desiredAccess,
          allowNetwork: false,
          expiresAt: source.expiresAt,
          binding: {
            role,
            source: "project",
            projectDirectoryBindingId: directory.projectDirectoryBindingId,
            sourceRevision: directory.sourceRevision,
          },
        }),
      );
    }
    if (input.directories.some(({ role }) => role === "primary")) {
      this.revokeDefaultWorkspaceGrants(input.conversationId);
    }
    return grants;
  }

  revokeDefaultWorkspaceGrants(conversationId: string): WorkspaceGrant[] {
    return this.#transaction(() => {
      const now = this.#now();
      const rows = this.#database
        .prepare(
          `SELECT grant.id
           FROM workspace_grants AS grant
           JOIN workspace_bindings AS binding ON binding.workspace_grant_id = grant.id
           WHERE grant.owner_profile_id = ? AND binding.conversation_id = ?
             AND binding.source = 'default' AND grant.revoked_at IS NULL`,
        )
        .all(this.#ownerProfileId, conversationId) as Array<{ id: string }>;
      for (const { id } of rows) {
        this.#database
          .prepare("UPDATE workspace_grants SET revoked_at = ? WHERE id = ?")
          .run(now, id);
        this.#database
          .prepare(
            `UPDATE capability_scopes SET revoked_at = COALESCE(revoked_at, ?)
             WHERE owner_profile_id = ? AND resource_type = 'workspace' AND resource = ?`,
          )
          .run(now, this.#ownerProfileId, id);
        this.#database
          .prepare("DELETE FROM workspace_bindings WHERE workspace_grant_id = ?")
          .run(id);
      }
      return rows.map(({ id }) => this.workspaceGrant(id));
    });
  }

  listWorkspaceGrants(conversationId?: string): WorkspaceGrant[] {
    const now = this.#now();
    const rows = conversationId
      ? this.#database
          .prepare(
            `SELECT grant.*, binding.role AS binding_role, binding.source AS binding_source
             FROM workspace_grants AS grant
             LEFT JOIN workspace_bindings AS binding ON binding.workspace_grant_id = grant.id
             WHERE grant.owner_profile_id = ? AND grant.revoked_at IS NULL
               AND (grant.expires_at IS NULL OR grant.expires_at > ?)
               AND (grant.conversation_id IS NULL OR grant.conversation_id = ?)
             ORDER BY grant.created_at`,
          )
          .all(this.#ownerProfileId, now, conversationId)
      : this.#database
          .prepare(
            `SELECT grant.*, binding.role AS binding_role, binding.source AS binding_source
             FROM workspace_grants AS grant
             LEFT JOIN workspace_bindings AS binding ON binding.workspace_grant_id = grant.id
             WHERE grant.owner_profile_id = ? AND grant.revoked_at IS NULL
               AND (grant.expires_at IS NULL OR grant.expires_at > ?)
             ORDER BY grant.created_at`,
          )
          .all(this.#ownerProfileId, now);
    return (rows as SqlRow[]).map((row) => this.#workspaceGrant(row));
  }

  effectiveWorkspaceGrants(conversationId: string): WorkspaceGrant[] {
    const available = this.listWorkspaceGrants(conversationId).filter(
      (grant) => grant.conversationId !== null || !this.isProjectSourceWorkspaceGrant(grant.id),
    );
    const local = available.filter((grant) => grant.conversationId === conversationId);
    const rank = (grant: WorkspaceGrant): number =>
      grant.bindingRole === "primary" ? 0 : grant.bindingSource === "user_added" ? 1 : 2;
    const ordered = (local.length > 0 ? local : available).sort(
      (left, right) =>
        rank(left) - rank(right) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
    );
    const paths = new Set<string>();
    return ordered.filter((grant) => {
      if (paths.has(grant.rootPath)) return false;
      paths.add(grant.rootPath);
      return true;
    });
  }

  isProjectSourceWorkspaceGrant(workspaceGrantId: string): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 FROM workspace_grants AS grant
         WHERE grant.owner_profile_id = ? AND grant.id = ?
           AND (
             grant.project_operation_id IS NOT NULL OR EXISTS (
               SELECT 1 FROM project_directory_bindings AS project_binding
               WHERE project_binding.owner_profile_id = grant.owner_profile_id
                 AND project_binding.workspace_grant_id = grant.id
             )
           )
         LIMIT 1`,
      )
      .get(this.#ownerProfileId, workspaceGrantId) as SqlRow | undefined;
    return Boolean(row);
  }

  workspaceGrant(id: string): WorkspaceGrant {
    const row = this.#database
      .prepare(
        `SELECT grant.*, binding.role AS binding_role, binding.source AS binding_source
         FROM workspace_grants AS grant
         LEFT JOIN workspace_bindings AS binding ON binding.workspace_grant_id = grant.id
         WHERE grant.id = ? AND grant.owner_profile_id = ?`,
      )
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("WORKSPACE_GRANT_NOT_FOUND");
    return this.#workspaceGrant(row);
  }

  activeWorkspaceGrant(id: string, conversationId?: string): WorkspaceGrant {
    const grant = this.workspaceGrant(id);
    if (
      grant.revokedAt ||
      (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(this.#now()))
    ) {
      throw new Error("WORKSPACE_GRANT_INACTIVE");
    }
    if (conversationId && grant.conversationId && grant.conversationId !== conversationId) {
      throw new Error("WORKSPACE_GRANT_CONVERSATION_MISMATCH");
    }
    return grant;
  }

  revokeWorkspaceGrant(id: string): WorkspaceGrant {
    return this.#transaction(() => this.#revokeWorkspaceGrant(id));
  }

  #revokeWorkspaceGrant(id: string): WorkspaceGrant {
    const now = this.#now();
    const result = this.#database
      .prepare(
        `UPDATE workspace_grants SET revoked_at = COALESCE(revoked_at, ?)
           WHERE id = ? AND owner_profile_id = ?`,
      )
      .run(now, id, this.#ownerProfileId);
    if (result.changes !== 1) throw new Error("WORKSPACE_GRANT_NOT_FOUND");
    this.#database
      .prepare(
        `UPDATE capability_scopes SET revoked_at = COALESCE(revoked_at, ?)
           WHERE owner_profile_id = ? AND resource_type = 'workspace' AND resource = ?`,
      )
      .run(now, this.#ownerProfileId, id);
    this.#database.prepare("DELETE FROM workspace_bindings WHERE workspace_grant_id = ?").run(id);
    return this.workspaceGrant(id);
  }

  createWorkspaceChange(input: {
    workspaceGrantId: string;
    runId: string;
    relativePath: string;
    beforeSha256: string | null;
    afterSha256: string;
    beforeText: string | null;
    afterText: string;
    diff: string;
  }): WorkspaceChangeRecord {
    const id = this.#idFactory();
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO workspace_changes
         (id, owner_profile_id, workspace_grant_id, run_id, relative_path, status,
          before_sha256, after_sha256, before_text, after_text, diff, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.#ownerProfileId,
        input.workspaceGrantId,
        input.runId,
        input.relativePath,
        input.beforeSha256,
        input.afterSha256,
        input.beforeText,
        input.afterText,
        input.diff,
        now,
        now,
      );
    return this.workspaceChange(id);
  }

  markWorkspaceChange(id: string, status: WorkspaceChange["status"]): WorkspaceChangeRecord {
    const result = this.#database
      .prepare(
        "UPDATE workspace_changes SET status = ?, updated_at = ? WHERE id = ? AND owner_profile_id = ?",
      )
      .run(status, this.#now(), id, this.#ownerProfileId);
    if (result.changes !== 1) throw new Error("WORKSPACE_CHANGE_NOT_FOUND");
    return this.workspaceChange(id);
  }

  workspaceChange(id: string): WorkspaceChangeRecord {
    const row = this.#database
      .prepare("SELECT * FROM workspace_changes WHERE id = ? AND owner_profile_id = ?")
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("WORKSPACE_CHANGE_NOT_FOUND");
    return this.#workspaceChange(row);
  }

  listWorkspaceChanges(workspaceGrantId: string, limit = 50): WorkspaceChangeRecord[] {
    return (
      this.#database
        .prepare(
          `SELECT * FROM workspace_changes
           WHERE owner_profile_id = ? AND workspace_grant_id = ?
           ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .all(this.#ownerProfileId, workspaceGrantId, limit) as SqlRow[]
    ).map((row) => this.#workspaceChange(row));
  }

  #workspaceChange(row: SqlRow): WorkspaceChangeRecord {
    const change = workspaceChangeSchema.parse({
      id: row.id,
      workspaceGrantId: row.workspace_grant_id,
      runId: row.run_id,
      relativePath: row.relative_path,
      status: row.status,
      beforeSha256: row.before_sha256,
      afterSha256: row.after_sha256,
      diff: row.diff,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return {
      ...change,
      beforeText: row.before_text === null ? null : String(row.before_text),
      afterText: String(row.after_text),
    };
  }

  createWorkspaceChangeSet(input: {
    workspaceGrantId: string;
    runId: string;
    toolCallId: string;
    baselineRevision: string;
    finalRevision: string;
    manifest: unknown[];
    diffs: unknown[];
    entries: WorkspaceChangeSetEntry[];
    blocked: boolean;
  }): WorkspaceChangeSetRecord {
    const id = this.#idFactory();
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO workspace_change_sets
         (id, owner_profile_id, workspace_grant_id, run_id, tool_call_id, status,
          baseline_revision, final_revision, manifest_json, diffs_json, entries_json,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.#ownerProfileId,
        input.workspaceGrantId,
        input.runId,
        input.toolCallId,
        input.blocked ? "blocked" : "pending_review",
        input.baselineRevision,
        input.finalRevision,
        JSON.stringify(input.manifest),
        JSON.stringify(input.diffs),
        JSON.stringify(input.entries),
        now,
        now,
      );
    return this.workspaceChangeSet(id);
  }

  workspaceChangeSet(id: string): WorkspaceChangeSetRecord {
    const row = this.#database
      .prepare("SELECT * FROM workspace_change_sets WHERE id = ? AND owner_profile_id = ?")
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("WORKSPACE_CHANGE_SET_NOT_FOUND");
    return this.#workspaceChangeSet(row);
  }

  listWorkspaceChangeSets(workspaceGrantId: string, limit = 50): WorkspaceChangeSetRecord[] {
    return (
      this.#database
        .prepare(
          `SELECT * FROM workspace_change_sets
           WHERE owner_profile_id = ? AND workspace_grant_id = ?
           ORDER BY updated_at DESC, id DESC LIMIT ?`,
        )
        .all(this.#ownerProfileId, workspaceGrantId, limit) as SqlRow[]
    ).map((row) => this.#workspaceChangeSet(row));
  }

  markWorkspaceChangeSet(id: string, status: WorkspaceChangeSetStatus): WorkspaceChangeSetRecord {
    const result = this.#database
      .prepare(
        "UPDATE workspace_change_sets SET status = ?, updated_at = ? WHERE id = ? AND owner_profile_id = ?",
      )
      .run(status, this.#now(), id, this.#ownerProfileId);
    if (result.changes !== 1) throw new Error("WORKSPACE_CHANGE_SET_NOT_FOUND");
    return this.workspaceChangeSet(id);
  }

  #workspaceChangeSet(row: SqlRow): WorkspaceChangeSetRecord {
    return workspaceChangeSetSchema.parse({
      id: row.id,
      workspaceGrantId: row.workspace_grant_id,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      status: row.status,
      baselineRevision: row.baseline_revision,
      finalRevision: row.final_revision,
      manifest: JSON.parse(String(row.manifest_json)),
      diffs: JSON.parse(String(row.diffs_json)),
      entries: JSON.parse(String(row.entries_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  addRunInstructionSources(runId: string, sources: WorkspaceInstructionSource[]): ExecutionRun {
    if (sources.length === 0) return this.run(runId);
    const current = this.run(runId).instructionSources;
    const merged = [...current];
    for (const source of sources) {
      if (
        !merged.some(
          (entry) => entry.digest === source.digest && entry.appliesTo === source.appliesTo,
        )
      ) {
        merged.push(source);
      }
    }
    this.#database
      .prepare(
        "UPDATE execution_runs SET instruction_sources_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(merged), this.#now(), runId);
    return this.run(runId);
  }

  freezeRunConfiguration(
    runId: string,
    input: {
      initialToolNames: string[];
      availableToolNames: string[];
      skillInstallationIds: string[];
      instructionSources: WorkspaceInstructionSource[];
    },
  ): ExecutionRun {
    const result = this.#database
      .prepare(
        `UPDATE execution_runs
         SET initial_tool_names_json = ?, available_tool_names_json = ?,
             skill_installation_ids_json = ?, instruction_sources_json = ?,
             configuration_frozen_at = ?, updated_at = ?
         WHERE id = ? AND configuration_frozen_at IS NULL`,
      )
      .run(
        JSON.stringify(input.initialToolNames),
        JSON.stringify(input.availableToolNames),
        JSON.stringify(input.skillInstallationIds),
        JSON.stringify(input.instructionSources),
        this.#now(),
        this.#now(),
        runId,
      );
    if (result.changes !== 1) throw new Error("RUN_CONFIGURATION_ALREADY_FROZEN");
    return this.run(runId);
  }

  sideEffect(idempotencyKey: string, operationDigest?: string): NormalizedToolResult | null {
    const row = this.#database
      .prepare(
        "SELECT result_json, operation_digest FROM tool_side_effects WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as { result_json: string; operation_digest: string } | undefined;
    if (row && operationDigest !== undefined && row.operation_digest !== operationDigest) {
      throw new Error("SIDE_EFFECT_IDEMPOTENCY_CONFLICT");
    }
    return row ? normalizedToolResultSchema.parse(JSON.parse(row.result_json)) : null;
  }

  sideEffectAttempt(idempotencyKey: string, operationDigest?: string): SideEffectAttempt | null {
    const row = this.#database
      .prepare("SELECT * FROM tool_side_effect_attempts WHERE idempotency_key = ?")
      .get(idempotencyKey) as SqlRow | undefined;
    if (!row) return null;
    if (operationDigest !== undefined && String(row.operation_digest) !== operationDigest) {
      throw new Error("SIDE_EFFECT_IDEMPOTENCY_CONFLICT");
    }
    return {
      idempotencyKey: String(row.idempotency_key),
      toolCallId: String(row.tool_call_id),
      operationDigest: String(row.operation_digest),
      status: String(row.status) as SideEffectAttempt["status"],
      result:
        row.result_json === null
          ? null
          : normalizedToolResultSchema.parse(JSON.parse(String(row.result_json))),
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
    };
  }

  beginSideEffectAttempt(idempotencyKey: string, toolCallId: string, operationDigest = ""): void {
    const existing = this.sideEffectAttempt(idempotencyKey, operationDigest);
    if (existing) {
      if (existing.status === "committed") return;
      throw new Error("SIDE_EFFECT_OUTCOME_UNKNOWN");
    }
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO tool_side_effect_attempts
         (idempotency_key, tool_call_id, status, result_json, started_at, updated_at,
          operation_digest)
         VALUES (?, ?, 'executing', NULL, ?, ?, ?)`,
      )
      .run(idempotencyKey, toolCallId, now, now, operationDigest);
  }

  commitSideEffectAttempt(
    idempotencyKey: string,
    toolCallId: string,
    result: NormalizedToolResult,
    operationDigest = "",
  ): void {
    this.#transaction(() => {
      const now = this.#now();
      const updated = this.#database
        .prepare(
          `UPDATE tool_side_effect_attempts
           SET status = 'committed', result_json = ?, updated_at = ?
           WHERE idempotency_key = ? AND tool_call_id = ? AND status = 'executing'
             AND operation_digest = ?`,
        )
        .run(JSON.stringify(result), now, idempotencyKey, toolCallId, operationDigest);
      if (updated.changes !== 1) throw new Error("SIDE_EFFECT_ATTEMPT_NOT_EXECUTING");
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO tool_side_effects
           (idempotency_key, tool_call_id, result_json, committed_at, operation_digest)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(idempotencyKey, toolCallId, JSON.stringify(result), now, operationDigest);
    });
  }

  markSideEffectOutcomeUnknown(
    idempotencyKey: string,
    toolCallId: string,
    operationDigest = "",
  ): void {
    this.#database
      .prepare(
        `UPDATE tool_side_effect_attempts
         SET status = 'outcome_unknown', updated_at = ?
         WHERE idempotency_key = ? AND tool_call_id = ? AND status = 'executing'
           AND operation_digest = ?`,
      )
      .run(this.#now(), idempotencyKey, toolCallId, operationDigest);
  }

  commitSideEffect(
    idempotencyKey: string,
    toolCallId: string,
    result: NormalizedToolResult,
    operationDigest = "",
  ): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO tool_side_effects
         (idempotency_key, tool_call_id, result_json, committed_at, operation_digest)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(idempotencyKey, toolCallId, JSON.stringify(result), this.#now(), operationDigest);
    this.sideEffect(idempotencyKey, operationDigest);
  }

  recoverInterrupted(): { toolCalls: number; runs: number; scopes: number; permissions: number } {
    const now = this.#now();
    return this.#transaction(() => {
      const permissions = this.#database
        .prepare(
          "UPDATE permission_requests SET status = 'expired', resolved_at = ? WHERE status = 'pending'",
        )
        .run(now).changes;
      const toolCalls = this.#database
        .prepare(
          `UPDATE tool_calls SET status = 'failed', error_code = 'TOOL_HOST_INTERRUPTED',
           completed_at = ?, updated_at = ? WHERE status IN ('requested', 'waiting_for_permission', 'running')`,
        )
        .run(now, now).changes;
      this.#database
        .prepare(
          `UPDATE tool_side_effect_attempts SET status = 'outcome_unknown', updated_at = ?
           WHERE status = 'executing'`,
        )
        .run(now);
      this.#database
        .prepare(
          `UPDATE workspace_changes SET status = 'outcome_unknown', updated_at = ?
           WHERE status = 'preparing'`,
        )
        .run(now);
      this.#database
        .prepare(
          `UPDATE workspace_change_sets SET status = 'outcome_unknown', updated_at = ?
           WHERE status = 'applying'`,
        )
        .run(now);
      this.#database
        .prepare(
          `UPDATE run_steps SET status = 'failed', error_code = 'TOOL_HOST_INTERRUPTED', completed_at = ?
           WHERE status IN ('queued', 'running')`,
        )
        .run(now);
      this.#database
        .prepare(
          `UPDATE run_items SET status = 'failed', error_code = 'TOOL_HOST_INTERRUPTED',
           completed_at = COALESCE(completed_at, ?), updated_at = ?
           WHERE status IN ('queued', 'running')`,
        )
        .run(now, now);
      const runs = this.#database
        .prepare(
          `UPDATE execution_runs SET status = 'failed', error_code = 'TOOL_HOST_INTERRUPTED',
           completed_at = ?, updated_at = ?
           WHERE status IN ('queued', 'running', 'waiting_for_user', 'waiting_for_permission')`,
        )
        .run(now, now).changes;
      this.#database
        .prepare(
          `UPDATE work_items SET status = 'failed', completed_at = ?, updated_at = ?, revision = revision + 1
           WHERE status IN ('queued', 'running', 'waiting_for_user', 'waiting_for_permission')`,
        )
        .run(now, now);
      const scopes = this.#database
        .prepare(
          "UPDATE capability_scopes SET revoked_at = ? WHERE session_only = 1 AND revoked_at IS NULL",
        )
        .run(now).changes;
      return {
        toolCalls: Number(toolCalls),
        runs: Number(runs),
        scopes: Number(scopes),
        permissions: Number(permissions),
      };
    });
  }

  listWorkItems(conversationId?: string, limit = 50): WorkItem[] {
    const rows = conversationId
      ? this.#database
          .prepare(
            `SELECT * FROM work_items WHERE owner_profile_id = ? AND conversation_id = ?
             ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(this.#ownerProfileId, conversationId, limit)
      : this.#database
          .prepare(
            "SELECT * FROM work_items WHERE owner_profile_id = ? ORDER BY updated_at DESC LIMIT ?",
          )
          .all(this.#ownerProfileId, limit);
    return (rows as SqlRow[]).map((row) => this.#workItem(row));
  }

  workspaceOutputCandidates(conversationId?: string): WorkspaceOutputCandidate[] {
    const parameters = conversationId
      ? [this.#ownerProfileId, conversationId]
      : [this.#ownerProfileId];
    const joins = `JOIN execution_runs er ON er.id = wc.run_id
      JOIN work_items wi ON wi.id = er.work_item_id
      JOIN conversations c ON c.id = wi.conversation_id
      JOIN workspace_grants wg ON wg.id = wc.workspace_grant_id`;
    const filter = `wc.owner_profile_id = ? AND wi.owner_profile_id = wc.owner_profile_id
      AND c.owner_profile_id = wc.owner_profile_id AND wg.owner_profile_id = wc.owner_profile_id
      AND c.deleted_at IS NULL
      ${conversationId ? "AND wi.conversation_id = ?" : ""}`;
    const rows = this.#database
      .prepare(
        `SELECT wc.*, wi.conversation_id, wg.root_path FROM workspace_changes wc
       ${joins} WHERE ${filter} AND wc.status IN ('applied', 'reverted')`,
      )
      .all(...parameters) as SqlRow[];
    const candidates: WorkspaceOutputCandidate[] = rows.map((row) => ({
      conversationId: String(row.conversation_id),
      workspaceGrantId: String(row.workspace_grant_id),
      workspaceRootPath: String(row.root_path),
      relativePath: String(row.relative_path),
      afterSha256: row.status === "applied" ? String(row.after_sha256) : null,
      sourceRevision: `${row.id}:${row.status}`,
      updatedAt: String(row.updated_at),
    }));
    const sets = this.#database
      .prepare(
        `SELECT wc.*, wi.conversation_id, wg.root_path FROM workspace_change_sets wc
       ${joins} WHERE ${filter} AND wc.status IN ('applied', 'reverted')`,
      )
      .all(...parameters) as SqlRow[];
    for (const row of sets) {
      const changeSet = this.#workspaceChangeSet(row);
      for (const entry of changeSet.entries) {
        if (entry.entryType !== "file") continue;
        const grant = this.workspaceGrant(entry.workspaceGrantId);
        const candidate: WorkspaceOutputCandidate = {
          conversationId: String(row.conversation_id),
          workspaceGrantId: grant.id,
          workspaceRootPath: grant.rootPath,
          relativePath: entry.relativePath,
          afterSha256: changeSet.status === "applied" ? entry.afterSha256 : null,
          sourceRevision: `${changeSet.id}:${changeSet.status}`,
          updatedAt: changeSet.updatedAt,
        };
        candidates.push(candidate);
        if (entry.previousRelativePath) {
          candidates.push({
            ...candidate,
            relativePath: entry.previousRelativePath,
            afterSha256: null,
          });
        }
      }
    }
    const latest = new Map<string, WorkspaceOutputCandidate>();
    for (const candidate of candidates.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.sourceRevision.localeCompare(a.sourceRevision),
    )) {
      const key = JSON.stringify([
        candidate.conversationId,
        candidate.workspaceRootPath,
        candidate.relativePath,
      ]);
      if (!latest.has(key)) latest.set(key, candidate);
    }
    return [...latest.values()];
  }

  artifactRetention(conversationId?: string): ArtifactRetention {
    const rows = this.#database
      .prepare(
        `SELECT tc.*, wi.conversation_id
         FROM tool_calls tc
         JOIN execution_runs er ON er.id = tc.run_id
         JOIN work_items wi ON wi.id = er.work_item_id
         WHERE wi.owner_profile_id = ?
           AND tc.status = 'completed'
           AND tc.tool_name IN ('openerx_artifact_write', 'openerx_office_artifact')
           ${conversationId ? "AND wi.conversation_id = ?" : ""}
         ORDER BY tc.completed_at DESC, tc.updated_at DESC, tc.id DESC`,
      )
      .all(
        ...(conversationId ? [this.#ownerProfileId, conversationId] : [this.#ownerProfileId]),
      ) as Array<SqlRow & { conversation_id: string }>;
    const latestByArtifact = new Map<
      string,
      {
        artifactId: string;
        conversationId: string;
        displayName: string;
        format: string;
        purpose: "deliverable" | "intermediate";
      }
    >();
    for (const row of rows) {
      const call = this.#toolCall(row);
      const operation = call.input;
      if (
        !operation ||
        (operation.operation !== "artifact.write" &&
          operation.operation !== "artifact.office.write")
      ) {
        continue;
      }
      const purpose = operation.input.purpose === "intermediate" ? "intermediate" : "deliverable";
      const displayName = operation.input.displayName;
      const format =
        operation.operation === "artifact.write"
          ? operation.input.format
          : operation.input.spec.format;
      for (const part of call.resultContent) {
        if (part.type !== "artifact" || latestByArtifact.has(part.artifactId)) continue;
        latestByArtifact.set(part.artifactId, {
          artifactId: part.artifactId,
          conversationId: row.conversation_id,
          displayName,
          format,
          purpose,
        });
      }
    }

    const deliverableIds: string[] = [];
    const disposableIds: string[] = [];
    const latestByOutput = new Set<string>();
    for (const reference of latestByArtifact.values()) {
      const outputKey = `${reference.conversationId}\u0000${reference.format}\u0000${reference.displayName.trim().toLowerCase()}`;
      if (
        reference.purpose === "intermediate" ||
        legacyTransientArtifactName(reference.displayName) ||
        latestByOutput.has(outputKey)
      ) {
        disposableIds.push(reference.artifactId);
        continue;
      }
      latestByOutput.add(outputKey);
      deliverableIds.push(reference.artifactId);
    }
    return { deliverableIds, disposableIds };
  }

  listMcpServers(): McpServerConfig[] {
    return (
      this.#database
        .prepare(
          "SELECT config_json FROM mcp_server_configs WHERE owner_profile_id = ? ORDER BY updated_at DESC",
        )
        .all(this.#ownerProfileId) as Array<{ config_json: string }>
    ).map(({ config_json }) => mcpServerConfigSchema.parse(JSON.parse(config_json)));
  }

  localWebSearchSettings(): StoredLocalWebSearchSettings | null {
    const row = this.#database
      .prepare(
        `SELECT provider_id, locale, safe_search, updated_at
         FROM local_web_search_settings WHERE owner_profile_id = ?`,
      )
      .get(this.#ownerProfileId) as
      | {
          provider_id: string;
          locale: string;
          safe_search: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      ...localWebSearchSettingsSelectionSchema.parse({
        providerId: row.provider_id,
        locale: row.locale,
        safeSearch: row.safe_search,
      }),
      updatedAt: row.updated_at,
    };
  }

  saveLocalWebSearchSettings(input: LocalWebSearchSettingsSelection): StoredLocalWebSearchSettings {
    const parsed = localWebSearchSettingsSelectionSchema.parse(input);
    const updatedAt = this.#now();
    this.#database
      .prepare(
        `INSERT INTO local_web_search_settings
         (owner_profile_id, provider_id, locale, safe_search, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_profile_id) DO UPDATE SET
           provider_id = excluded.provider_id,
           locale = excluded.locale,
           safe_search = excluded.safe_search,
           updated_at = excluded.updated_at`,
      )
      .run(this.#ownerProfileId, parsed.providerId, parsed.locale, parsed.safeSearch, updatedAt);
    return { ...parsed, updatedAt };
  }

  upsertMcpServer(config: McpServerConfig): McpServerConfig {
    const parsed = mcpServerConfigSchema.parse(config);
    const now = this.#now();
    this.#database
      .prepare(
        `INSERT INTO mcp_server_configs(id, owner_profile_id, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
         WHERE owner_profile_id = excluded.owner_profile_id`,
      )
      .run(parsed.id, this.#ownerProfileId, JSON.stringify(parsed), now, now);
    return parsed;
  }

  removeMcpServer(serverId: string): { serverId: string; removed: boolean } {
    const removed = this.#database
      .prepare("DELETE FROM mcp_server_configs WHERE id = ? AND owner_profile_id = ?")
      .run(serverId, this.#ownerProfileId).changes;
    return { serverId, removed: Number(removed) === 1 };
  }

  listToolCalls(runId: string): ToolCall[] {
    return (
      this.#database
        .prepare("SELECT * FROM tool_calls WHERE run_id = ? ORDER BY updated_at, id")
        .all(runId) as SqlRow[]
    ).map((row) => this.#toolCall(row));
  }

  listSteps(runId: string): RunStep[] {
    return (
      this.#database
        .prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY sequence")
        .all(runId) as SqlRow[]
    ).map((row) => this.#step(row));
  }

  listRuns(workItemId: string): ExecutionRun[] {
    return (
      this.#database
        .prepare(
          "SELECT * FROM execution_runs WHERE work_item_id = ? ORDER BY attempt DESC, created_at DESC",
        )
        .all(workItemId) as SqlRow[]
    ).map((row) => this.#run(row));
  }

  listRunItems(runId: string): RunItem[] {
    return (
      this.#database
        .prepare("SELECT * FROM run_items WHERE run_id = ? ORDER BY sequence, created_at, id")
        .all(runId) as SqlRow[]
    ).map((row) => this.#runItem(row));
  }

  runItemByRef(runId: string, piItemRef: string): RunItem | null {
    const row = this.#database
      .prepare("SELECT * FROM run_items WHERE run_id = ? AND pi_item_ref = ?")
      .get(runId, piItemRef) as SqlRow | undefined;
    return row ? this.#runItem(row) : null;
  }

  toolCallByPiRef(runId: string, piCallRef: string): ToolCall | null {
    const row = this.#database
      .prepare("SELECT * FROM tool_calls WHERE run_id = ? AND pi_call_ref = ?")
      .get(runId, piCallRef) as SqlRow | undefined;
    return row ? this.#toolCall(row) : null;
  }

  listPermissionsForRun(runId: string): PermissionRequest[] {
    return (
      this.#database
        .prepare("SELECT * FROM permission_requests WHERE run_id = ? ORDER BY requested_at")
        .all(runId) as SqlRow[]
    ).map((row) => this.#permission(row));
  }

  workItemDetail(
    workItemId: string,
    runId?: string,
  ): {
    workItem: WorkItem;
    runs: ExecutionRun[];
    run: ExecutionRun;
    items: RunItem[];
    steps: RunStep[];
    toolCalls: ToolCall[];
    permissions: PermissionRequest[];
  } {
    const workItem = this.workItem(workItemId);
    if (!workItem.activeRunId) throw new Error("RUN_NOT_FOUND");
    const runs = this.listRuns(workItemId);
    const run = this.run(runId ?? workItem.activeRunId);
    if (run.workItemId !== workItem.id) throw new Error("RUN_WORK_ITEM_MISMATCH");
    return {
      workItem,
      runs,
      run,
      items: this.listRunItems(run.id),
      steps: this.listSteps(run.id),
      toolCalls: this.listToolCalls(run.id),
      permissions: this.listPermissionsForRun(run.id),
    };
  }

  listPermissions(status?: PermissionRequest["status"]): PermissionRequest[] {
    const rows = status
      ? this.#database
          .prepare(
            "SELECT * FROM permission_requests WHERE owner_profile_id = ? AND status = ? ORDER BY requested_at DESC",
          )
          .all(this.#ownerProfileId, status)
      : this.#database
          .prepare(
            "SELECT * FROM permission_requests WHERE owner_profile_id = ? ORDER BY requested_at DESC",
          )
          .all(this.#ownerProfileId);
    return (rows as SqlRow[]).map((row) => this.#permission(row));
  }

  workItem(id: string): WorkItem {
    const row = this.#database
      .prepare("SELECT * FROM work_items WHERE id = ? AND owner_profile_id = ?")
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("WORK_ITEM_NOT_FOUND");
    return this.#workItem(row);
  }

  run(id: string): ExecutionRun {
    const row = this.#database.prepare("SELECT * FROM execution_runs WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("RUN_NOT_FOUND");
    return this.#run(row);
  }

  step(id: string): RunStep {
    const row = this.#database.prepare("SELECT * FROM run_steps WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("RUN_STEP_NOT_FOUND");
    return this.#step(row);
  }

  runItem(id: string): RunItem {
    const row = this.#database.prepare("SELECT * FROM run_items WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("RUN_ITEM_NOT_FOUND");
    return this.#runItem(row);
  }

  toolCall(id: string): ToolCall {
    const row = this.#database.prepare("SELECT * FROM tool_calls WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    if (!row) throw new Error("TOOL_CALL_NOT_FOUND");
    return this.#toolCall(row);
  }

  permission(id: string): PermissionRequest {
    const row = this.#database
      .prepare("SELECT * FROM permission_requests WHERE id = ? AND owner_profile_id = ?")
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("PERMISSION_NOT_FOUND");
    return this.#permission(row);
  }

  scope(id: string): CapabilityScope {
    const row = this.#database
      .prepare("SELECT * FROM capability_scopes WHERE id = ? AND owner_profile_id = ?")
      .get(id, this.#ownerProfileId) as SqlRow | undefined;
    if (!row) throw new Error("CAPABILITY_SCOPE_NOT_FOUND");
    return this.#scope(row);
  }

  #workItem(row: SqlRow): WorkItem {
    const runState = row.active_run_id
      ? (this.#database
          .prepare("SELECT status, cancellation_requested_at FROM execution_runs WHERE id = ?")
          .get(String(row.active_run_id)) as
          | { status: string; cancellation_requested_at: string | null }
          | undefined)
      : undefined;
    const status = this.#cancellationStatus(
      String(row.status),
      runState?.status,
      runState?.cancellation_requested_at,
    );
    return workItemSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      title: row.title,
      status,
      activeRunId: row.active_run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      revision: row.revision,
    });
  }

  #run(row: SqlRow): ExecutionRun {
    const status = this.#cancellationStatus(
      String(row.status),
      String(row.status),
      typeof row.cancellation_requested_at === "string" ? row.cancellation_requested_at : null,
    );
    return executionRunSchema.parse({
      id: row.id,
      workItemId: row.work_item_id,
      attempt: row.attempt,
      status,
      piPackageVersion: row.pi_package_version,
      piHostContractVersion: row.pi_host_contract_version,
      selectedModelRef: row.selected_model_ref,
      effectiveModelRef: row.effective_model_ref,
      branchId: row.branch_id ?? null,
      thinkingLevel: row.thinking_level,
      fallbackReason: row.fallback_reason ?? null,
      initialToolNames: JSON.parse(String(row.initial_tool_names_json ?? "[]")),
      availableToolNames: JSON.parse(String(row.available_tool_names_json ?? "[]")),
      skillInstallationIds: JSON.parse(String(row.skill_installation_ids_json ?? "[]")),
      instructionSources: JSON.parse(String(row.instruction_sources_json ?? "[]")),
      piSessionRef: row.pi_session_ref,
      usageRecords: JSON.parse(String(row.usage_records_json ?? "[]")),
      cancellationRequestedAt: row.cancellation_requested_at ?? null,
      lastPiEventSequence: row.last_pi_event_sequence,
      retryCount: row.retry_count,
      compactionCount: row.compaction_count,
      errorCode: row.error_code,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    });
  }

  #step(row: SqlRow): RunStep {
    return runStepSchema.parse({
      id: row.id,
      runId: row.run_id,
      piStepRef: row.pi_step_ref,
      kind: row.kind,
      title: row.title,
      status: row.status,
      sequence: row.sequence,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorCode: row.error_code,
    });
  }

  #runItem(row: SqlRow): RunItem {
    return runItemSchema.parse({
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      piItemRef: row.pi_item_ref,
      status: row.status,
      content: JSON.parse(String(row.content_json)),
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  #updateToolRunItem(
    call: ToolCall,
    status: ToolCall["status"],
    errorCode: string | null,
    now: string,
  ): void {
    this.upsertRunItem({
      runId: call.runId,
      piItemRef: `tool:${call.piCallRef}`,
      status:
        status === "completed" || status === "failed" || status === "cancelled"
          ? status
          : "running",
      content: {
        type: "tool",
        toolCallId: call.id,
        toolName: call.toolName,
        input: call.input,
        inputSummary: call.inputSummary,
        targetSummary: call.targetSummary,
      },
      startedAt: call.startedAt ?? now,
      completedAt: call.completedAt,
      errorCode,
    });
  }

  #projectToolResultItems(
    call: ToolCall,
    resultContent: NormalizedToolResult["content"],
    resultData: unknown,
    status: ToolCall["status"],
    now: string,
  ): void {
    const itemStatus =
      status === "completed" || status === "failed" || status === "cancelled"
        ? status
        : "completed";
    for (const [index, part] of resultContent.entries()) {
      if (part.type === "source") {
        this.upsertRunItem({
          runId: call.runId,
          piItemRef: `source:${call.id}:${index}`,
          status: itemStatus,
          content: { type: "source", toolCallId: call.id, source: part.source },
          startedAt: call.startedAt ?? now,
          completedAt: now,
          errorCode: call.errorCode,
        });
      }
      if (part.type === "diff") {
        this.upsertRunItem({
          runId: call.runId,
          piItemRef: `diff:${call.id}:${part.workspaceChangeId}`,
          status: itemStatus,
          content: {
            type: "diff",
            toolCallId: call.id,
            workspaceChangeId: part.workspaceChangeId,
            relativePath: part.relativePath,
            patch: part.patch,
          },
          startedAt: call.startedAt ?? now,
          completedAt: now,
          errorCode: call.errorCode,
        });
      }
    }
    const operation = call.input;
    if (!operation?.operation.startsWith("shell_")) return;
    const data =
      resultData && typeof resultData === "object" ? (resultData as Record<string, unknown>) : {};
    const output = resultContent
      .filter(
        (part): part is Extract<(typeof resultContent)[number], { type: "text" }> =>
          part.type === "text",
      )
      .map(({ text }) => text)
      .join("\n")
      .slice(0, 2_000_000);
    const command =
      operation.operation === "shell_execute" ? operation.command : operation.operation;
    const args =
      operation.operation === "shell_execute"
        ? operation.args
        : "processId" in operation
          ? [operation.processId]
          : [];
    this.upsertRunItem({
      runId: call.runId,
      piItemRef: `command:${call.id}`,
      status: itemStatus,
      content: {
        type: "command",
        toolCallId: call.id,
        command,
        args,
        cwd:
          operation.operation === "shell_execute"
            ? (operation.cwd ?? operation.relativeCwd ?? null)
            : null,
        processId: typeof data.processId === "string" ? data.processId : null,
        exitCode:
          typeof data.exitCode === "number" && Number.isInteger(data.exitCode)
            ? data.exitCode
            : null,
        output,
        outputTruncated: data.outputTruncated === true || output.length >= 2_000_000,
      },
      startedAt: call.startedAt ?? now,
      completedAt: now,
      errorCode: call.errorCode,
    });
  }

  #toolCall(row: SqlRow): ToolCall {
    return toolCallSchema.parse({
      id: row.id,
      runId: row.run_id,
      stepId: row.step_id,
      piCallRef: row.pi_call_ref,
      toolName: row.tool_name,
      source: row.source,
      status: row.status,
      risk: row.risk,
      idempotencyKey: row.idempotency_key,
      input: row.input_json === null ? null : JSON.parse(String(row.input_json)),
      inputSummary: row.input_summary,
      targetSummary: row.target_summary,
      resultSummary: row.result_summary,
      resultContent: JSON.parse(String(row.result_content_json ?? "[]")),
      errorCode: row.error_code,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    });
  }

  #permission(row: SqlRow): PermissionRequest {
    return permissionRequestSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      workItemId: row.work_item_id,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      capability: row.capability,
      risk: row.risk,
      resourceType: row.resource_type,
      resource: row.resource,
      actions: JSON.parse(String(row.actions_json)),
      reason: row.reason,
      payloadDigest: row.payload_digest,
      status: row.status,
      requestedAt: row.requested_at,
      expiresAt: row.expires_at,
      resolvedAt: row.resolved_at,
      resolution: row.resolution,
      scopeId: row.scope_id,
    });
  }

  #scope(row: SqlRow): CapabilityScope {
    return capabilityScopeSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      capability: row.capability,
      resourceType: row.resource_type,
      resource: row.resource,
      actions: JSON.parse(String(row.actions_json)),
      maxRisk: row.max_risk,
      conversationId: row.conversation_id ?? null,
      sessionOnly: Number(row.session_only) === 1,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    });
  }

  #workspaceGrant(row: SqlRow): WorkspaceGrant {
    return workspaceGrantSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      conversationId: row.conversation_id ?? null,
      displayName: row.display_name,
      rootPath: row.root_path,
      access: row.access,
      allowNetwork: Number(row.allow_network) === 1,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      ...(row.binding_role ? { bindingRole: row.binding_role } : {}),
      ...(row.binding_source ? { bindingSource: row.binding_source } : {}),
    });
  }

  #workspaceBinding(row: SqlRow): WorkspaceBinding {
    return {
      workspaceGrantId: String(row.workspace_grant_id),
      ownerProfileId: String(row.owner_profile_id),
      conversationId: String(row.conversation_id),
      role: row.role as WorkspaceBindingRole,
      source: row.source as WorkspaceBindingSource,
      ...(row.project_directory_binding_id
        ? { projectDirectoryBindingId: String(row.project_directory_binding_id) }
        : {}),
      ...(row.source_revision ? { sourceRevision: Number(row.source_revision) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  #bindWorkspace(input: {
    workspaceGrantId: string;
    conversationId: string;
    role: WorkspaceBindingRole;
    source: WorkspaceBindingSource;
    projectDirectoryBindingId?: string;
    sourceRevision?: number;
    createdAt: string;
  }): void {
    const hasProjectSource = input.source === "project";
    if (
      hasProjectSource !== Boolean(input.projectDirectoryBindingId) ||
      hasProjectSource !== Boolean(input.sourceRevision)
    ) {
      throw new Error("WORKSPACE_PROJECT_BINDING_METADATA_INVALID");
    }
    if (input.role === "primary") {
      this.#database
        .prepare(
          `UPDATE workspace_bindings SET role = 'additional', updated_at = ?
           WHERE owner_profile_id = ? AND conversation_id = ? AND role = 'primary'
             AND workspace_grant_id <> ?`,
        )
        .run(input.createdAt, this.#ownerProfileId, input.conversationId, input.workspaceGrantId);
    }
    this.#database
      .prepare(
        `INSERT INTO workspace_bindings
         (workspace_grant_id, owner_profile_id, conversation_id, role, source, created_at,
          updated_at, project_directory_binding_id, source_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_grant_id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           role = excluded.role,
           source = excluded.source,
           updated_at = excluded.updated_at,
           project_directory_binding_id = excluded.project_directory_binding_id,
           source_revision = excluded.source_revision`,
      )
      .run(
        input.workspaceGrantId,
        this.#ownerProfileId,
        input.conversationId,
        input.role,
        input.source,
        input.createdAt,
        input.createdAt,
        input.projectDirectoryBindingId ?? null,
        input.sourceRevision ?? null,
      );
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

  #cancellationStatus(
    publicStatus: string,
    runStatus: string | undefined,
    cancellationRequestedAt: string | null | undefined,
  ): string {
    if (!cancellationRequestedAt || !runStatus) return publicStatus;
    if (["queued", "running", "waiting_for_user", "waiting_for_permission"].includes(runStatus)) {
      return "cancelling";
    }
    return runStatus === "cancelled" ? "interrupted" : publicStatus;
  }
}
