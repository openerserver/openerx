import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type CapabilityAction,
  type CapabilityScope,
  capabilityScopeSchema,
  type ExecutionRun,
  executionRunSchema,
  type McpServerConfig,
  mcpServerConfigSchema,
  type NormalizedToolResult,
  normalizedToolResultSchema,
  type PermissionRequest,
  permissionRequestSchema,
  type RunStep,
  runStepSchema,
  type ToolCall,
  type ToolCapability,
  type ToolRisk,
  toolCallSchema,
  type WorkItem,
  workItemSchema,
} from "@openerx/contracts";
import { migrateDatabase } from "./migrations";

type SqlRow = Record<string, unknown>;

export interface ToolRepositoryOptions {
  ownerProfileId?: string;
  now?: () => string;
  idFactory?: () => string;
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
  inputSummary: string;
  targetSummary: string;
}

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
    title: string;
    selectedModelRef: string;
    piPackageVersion: string;
    piHostContractVersion: number;
    piSessionRef?: string | null;
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
            selected_model_ref, effective_model_ref, pi_session_ref, last_pi_event_sequence,
            retry_count, compaction_count, error_code, created_at, started_at, completed_at, updated_at)
           VALUES (?, ?, 1, 'running', ?, ?, ?, NULL, ?, 0, 0, 0, NULL, ?, ?, NULL, ?)`,
        )
        .run(
          runId,
          workItemId,
          input.piPackageVersion,
          input.piHostContractVersion,
          input.selectedModelRef,
          input.piSessionRef ?? null,
          now,
          now,
          now,
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
            input_summary, target_summary, result_summary, error_code, started_at, completed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
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
        );
      return { step: this.step(stepId), toolCall: this.toolCall(toolCallId) };
    });
  }

  markToolCall(
    toolCallId: string,
    status: ToolCall["status"],
    input: { resultSummary?: string | null; errorCode?: string | null } = {},
  ): ToolCall {
    const now = this.#now();
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    const result = this.#database
      .prepare(
        `UPDATE tool_calls
         SET status = ?, result_summary = COALESCE(?, result_summary), error_code = ?,
             started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
             completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        input.resultSummary ?? null,
        input.errorCode ?? null,
        status,
        now,
        terminal ? 1 : 0,
        now,
        now,
        toolCallId,
      );
    if (result.changes !== 1) throw new Error("TOOL_CALL_NOT_FOUND");
    const call = this.toolCall(toolCallId);
    if (terminal) {
      this.#database
        .prepare(`UPDATE run_steps SET status = ?, completed_at = ?, error_code = ? WHERE id = ?`)
        .run(
          status === "completed" ? "completed" : status,
          now,
          input.errorCode ?? null,
          call.stepId,
        );
    }
    return call;
  }

  completeRun(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    errorCode?: string,
  ): void {
    const now = this.#now();
    this.#transaction(() => {
      const runRow = this.#database
        .prepare("SELECT work_item_id FROM execution_runs WHERE id = ?")
        .get(runId) as { work_item_id: string } | undefined;
      if (!runRow) throw new Error("RUN_NOT_FOUND");
      this.#database
        .prepare(
          `UPDATE execution_runs SET status = ?, error_code = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(status, errorCode ?? null, now, now, runId);
      this.#database
        .prepare(
          `UPDATE work_items SET status = ?, completed_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(status === "cancelled" ? "cancelled" : status, now, now, runRow.work_item_id);
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
    this.setWaitingForPermission(input.runId, true);
    return this.permission(id);
  }

  resolvePermission(input: {
    permissionRequestId: string;
    decision: "once" | "session" | "persistent" | "deny";
    payloadDigest: string;
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
      if (Date.parse(request.expiresAt) <= Date.parse(this.#now())) {
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
    sessionOnly: boolean;
    expiresAt: string | null;
  }): CapabilityScope {
    const id = this.#idFactory();
    this.#database
      .prepare(
        `INSERT INTO capability_scopes
         (id, owner_profile_id, capability, resource_type, resource, actions_json, max_risk,
          session_only, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        this.#ownerProfileId,
        input.capability,
        input.resourceType,
        input.resource,
        JSON.stringify(input.actions),
        input.maxRisk,
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

  revokeScope(scopeId: string): CapabilityScope {
    const result = this.#database
      .prepare(
        "UPDATE capability_scopes SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND owner_profile_id = ?",
      )
      .run(this.#now(), scopeId, this.#ownerProfileId);
    if (result.changes !== 1) throw new Error("CAPABILITY_SCOPE_NOT_FOUND");
    return this.scope(scopeId);
  }

  sideEffect(idempotencyKey: string): NormalizedToolResult | null {
    const row = this.#database
      .prepare("SELECT result_json FROM tool_side_effects WHERE idempotency_key = ?")
      .get(idempotencyKey) as { result_json: string } | undefined;
    return row ? normalizedToolResultSchema.parse(JSON.parse(row.result_json)) : null;
  }

  commitSideEffect(idempotencyKey: string, toolCallId: string, result: NormalizedToolResult): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO tool_side_effects
         (idempotency_key, tool_call_id, result_json, committed_at) VALUES (?, ?, ?, ?)`,
      )
      .run(idempotencyKey, toolCallId, JSON.stringify(result), this.#now());
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
          `UPDATE run_steps SET status = 'failed', error_code = 'TOOL_HOST_INTERRUPTED', completed_at = ?
           WHERE status IN ('queued', 'running')`,
        )
        .run(now);
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

  listMcpServers(): McpServerConfig[] {
    return (
      this.#database
        .prepare(
          "SELECT config_json FROM mcp_server_configs WHERE owner_profile_id = ? ORDER BY updated_at DESC",
        )
        .all(this.#ownerProfileId) as Array<{ config_json: string }>
    ).map(({ config_json }) => mcpServerConfigSchema.parse(JSON.parse(config_json)));
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

  workItemDetail(workItemId: string): {
    workItem: WorkItem;
    run: ExecutionRun;
    steps: RunStep[];
    toolCalls: ToolCall[];
    permissions: PermissionRequest[];
  } {
    const workItem = this.workItem(workItemId);
    if (!workItem.activeRunId) throw new Error("RUN_NOT_FOUND");
    const run = this.run(workItem.activeRunId);
    return {
      workItem,
      run,
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
    return workItemSchema.parse({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      title: row.title,
      status: row.status,
      activeRunId: row.active_run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      revision: row.revision,
    });
  }

  #run(row: SqlRow): ExecutionRun {
    return executionRunSchema.parse({
      id: row.id,
      workItemId: row.work_item_id,
      attempt: row.attempt,
      status: row.status,
      piPackageVersion: row.pi_package_version,
      piHostContractVersion: row.pi_host_contract_version,
      selectedModelRef: row.selected_model_ref,
      effectiveModelRef: row.effective_model_ref,
      piSessionRef: row.pi_session_ref,
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
      inputSummary: row.input_summary,
      targetSummary: row.target_summary,
      resultSummary: row.result_summary,
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
      sessionOnly: Number(row.session_only) === 1,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
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
