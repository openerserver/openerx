import {
  type NormalizedToolResult,
  normalizedToolResultSchema,
  type PermissionRequest,
  type ToolOperation,
} from "@openerx/contracts";
import type { ToolRepository } from "@openerx/storage";
import {
  capabilityRequirement,
  hasUncertainExternalSideEffect,
  operationDigest,
  scopeAllows,
  summarizeOperation,
} from "./policy";
import {
  type BrokerExecutionResult,
  type ToolAdapter,
  ToolAdapterError,
  type ToolExecutionProjection,
} from "./types";

interface PendingApproval {
  resolve(decision: "approved" | "denied"): void;
  reject(error: Error): void;
}

export class ToolBrokerError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

function withoutEncodedMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEncodedMedia);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/^(bytesBase64|imageDataUrl|data)$/u.test(key) && typeof entry === "string") continue;
    output[key] = withoutEncodedMedia(entry);
  }
  return output;
}

function normalizedContent(result: NormalizedToolResult): NormalizedToolResult {
  const parsed = normalizedToolResultSchema.parse(result);
  if (parsed.content.length > 0) return parsed;
  const data = parsed.data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (
      typeof record.mediaType === "string" &&
      record.mediaType.startsWith("image/") &&
      typeof record.bytesBase64 === "string"
    ) {
      return {
        ...parsed,
        data: withoutEncodedMedia(data),
        content: [
          { type: "text", text: parsed.summary },
          { type: "image", data: record.bytesBase64, mimeType: record.mediaType },
        ],
      };
    }
  }
  return {
    ...parsed,
    content: [
      {
        type: "text",
        text:
          data === undefined
            ? parsed.summary
            : `${parsed.summary}\n${JSON.stringify(withoutEncodedMedia(data))}`.slice(0, 1_000_000),
      },
      ...parsed.sources.map((source) => ({ type: "source" as const, source })),
      ...parsed.artifacts.map((artifactId) => ({ type: "artifact" as const, artifactId })),
    ],
  };
}

export class CapabilityBroker {
  readonly #repository: ToolRepository;
  readonly #adapters = new Map<ToolOperation["operation"], ToolAdapter>();
  readonly #pendingApprovals = new Map<string, PendingApproval>();

  constructor(repository: ToolRepository, adapters: readonly ToolAdapter[]) {
    this.#repository = repository;
    for (const adapter of adapters) {
      for (const operation of adapter.operations) {
        if (this.#adapters.has(operation)) throw new Error(`Duplicate tool adapter: ${operation}`);
        this.#adapters.set(operation, adapter);
      }
    }
  }

  async execute(
    projection: ToolExecutionProjection,
    operation: ToolOperation,
    signal: AbortSignal = new AbortController().signal,
    update: (summary: string, truncated?: boolean) => void = () => undefined,
  ): Promise<BrokerExecutionResult> {
    const digest = operationDigest(operation);
    let uncertainAttempt: ReturnType<ToolRepository["sideEffectAttempt"]>;
    let replay: ReturnType<ToolRepository["sideEffect"]>;
    try {
      uncertainAttempt = this.#repository.sideEffectAttempt(operation.idempotencyKey, digest);
      replay = this.#repository.sideEffect(operation.idempotencyKey, digest);
    } catch (error) {
      if (error instanceof Error && error.message === "SIDE_EFFECT_IDEMPOTENCY_CONFLICT") {
        throw new ToolBrokerError("SIDE_EFFECT_IDEMPOTENCY_CONFLICT");
      }
      throw error;
    }
    if (
      uncertainAttempt?.status === "executing" ||
      uncertainAttempt?.status === "outcome_unknown"
    ) {
      throw new ToolBrokerError(
        "SIDE_EFFECT_OUTCOME_UNKNOWN",
        "The prior external action may have completed; reconcile it before retrying.",
      );
    }
    if (replay) return { status: "completed", result: replay, replayed: true };

    const adapter = this.#adapters.get(operation.operation);
    if (!adapter) throw new ToolBrokerError("TOOL_NOT_AVAILABLE", operation.operation);
    const requirement = capabilityRequirement(operation);
    const summary = summarizeOperation(operation);
    const { toolCall } = this.#repository.createToolCall({
      runId: projection.runId,
      piCallRef: projection.piToolCallId,
      toolName: projection.toolName,
      source: operation.operation.startsWith("mcp_") ? "mcp" : "openerx",
      risk: requirement.risk,
      idempotencyKey: operation.idempotencyKey,
      input: operation,
      inputSummary: summary.input,
      targetSummary: summary.target,
    });
    if (toolCall.status === "failed" && toolCall.errorCode === "PERMISSION_DENIED") {
      throw new ToolBrokerError("PERMISSION_DENIED");
    }

    const hasFullAccess = this.#repository
      .activeScopes("full_access")
      .some((scope) => scope.conversationId === projection.conversationId);
    const requiresApproval =
      !hasFullAccess &&
      requirement.approval !== "automatic" &&
      (requirement.approval === "per_call" ||
        !this.#repository
          .activeScopes(requirement.capability)
          .some(
            (scope) =>
              (scope.conversationId === null ||
                scope.conversationId === projection.conversationId) &&
              scopeAllows(scope, requirement),
          ));
    if (requiresApproval) {
      const permission = this.#repository.createPermission({
        workItemId: projection.workItemId,
        runId: projection.runId,
        toolCallId: toolCall.id,
        capability: requirement.capability,
        risk: requirement.risk,
        resourceType: requirement.resourceType,
        resource: requirement.resource,
        actions: requirement.actions,
        reason: requirement.reason,
        payloadDigest: digest,
      });
      if (permission.status !== "approved") return { status: "permission_required", permission };
    }

    this.#repository.markToolCall(toolCall.id, "running");
    const uncertainSideEffect = hasUncertainExternalSideEffect(operation);
    const startedAt = Date.now();
    try {
      if (uncertainSideEffect) {
        this.#repository.beginSideEffectAttempt(operation.idempotencyKey, toolCall.id, digest);
      }
      const result = await adapter.execute(operation, {
        signal,
        toolCallId: toolCall.id,
        projection,
        update,
      });
      const normalized = normalizedContent({
        ...result,
        durationMs: Math.max(result.durationMs, Date.now() - startedAt),
      });
      if (uncertainSideEffect) {
        this.#repository.commitSideEffectAttempt(
          operation.idempotencyKey,
          toolCall.id,
          normalized,
          digest,
        );
      } else {
        this.#repository.commitSideEffect(
          operation.idempotencyKey,
          toolCall.id,
          normalized,
          digest,
        );
      }
      this.#repository.markToolCall(toolCall.id, "completed", {
        resultSummary: normalized.summary,
        resultContent: normalized.content,
        resultData: normalized.data,
      });
      return { status: "completed", result: normalized, replayed: false };
    } catch (error) {
      if (uncertainSideEffect) {
        this.#repository.markSideEffectOutcomeUnknown(
          operation.idempotencyKey,
          toolCall.id,
          digest,
        );
      }
      const code = signal.aborted
        ? "TOOL_CANCELLED"
        : error instanceof ToolBrokerError
          ? error.code
          : error instanceof Error
            ? (error.message.split(":", 1)[0] ?? "TOOL_FAILED")
            : "TOOL_FAILED";
      const failedResult =
        error instanceof ToolAdapterError ? normalizedContent(error.result) : null;
      this.#repository.markToolCall(toolCall.id, signal.aborted ? "cancelled" : "failed", {
        resultSummary: failedResult?.summary,
        resultContent: failedResult?.content,
        resultData: failedResult?.data,
        errorCode: code,
      });
      throw error instanceof ToolBrokerError ? error : new ToolBrokerError(code);
    }
  }

  async executeAwaitingPermission(
    projection: ToolExecutionProjection,
    operation: ToolOperation,
    signal: AbortSignal = new AbortController().signal,
    update: (summary: string, truncated?: boolean) => void = () => undefined,
    onPermission: (permission: PermissionRequest) => void = () => undefined,
  ): Promise<NormalizedToolResult> {
    const initial = await this.execute(projection, operation, signal, update);
    if (initial.status === "completed") return initial.result;
    onPermission(initial.permission);
    const decision = await this.#waitForApproval(initial.permission, signal);
    if (decision === "denied") throw new ToolBrokerError("PERMISSION_DENIED");
    const resumed = await this.execute(projection, operation, signal, update);
    if (resumed.status !== "completed") throw new ToolBrokerError("PERMISSION_NOT_RESOLVED");
    return resumed.result;
  }

  resolvePermission(input: {
    permissionRequestId: string;
    decision: "once" | "session" | "persistent" | "deny";
    payloadDigest: string;
    scopeConversationId?: string | null;
  }): PermissionRequest {
    const request = this.#repository.permission(input.permissionRequestId);
    const conversationId = this.#repository.workItem(request.workItemId).conversationId;
    if (
      input.decision === "session" &&
      input.scopeConversationId !== undefined &&
      input.scopeConversationId !== conversationId
    ) {
      throw new ToolBrokerError("PERMISSION_SCOPE_MISMATCH");
    }
    const result = this.#repository.resolvePermission({
      ...input,
      scopeConversationId: input.decision === "session" ? conversationId : null,
    });
    this.#pendingApprovals
      .get(input.permissionRequestId)
      ?.resolve(input.decision === "deny" ? "denied" : "approved");
    this.#pendingApprovals.delete(input.permissionRequestId);
    return result.permission;
  }

  async stopAll(): Promise<void> {
    for (const pending of this.#pendingApprovals.values()) {
      pending.reject(new ToolBrokerError("TOOL_HOST_STOPPED"));
    }
    this.#pendingApprovals.clear();
    await Promise.all(
      [...new Set(this.#adapters.values())].map(
        (adapter) => adapter.stopAll?.() ?? Promise.resolve(),
      ),
    );
  }

  #waitForApproval(
    request: PermissionRequest,
    signal: AbortSignal,
  ): Promise<"approved" | "denied"> {
    if (signal.aborted) return Promise.reject(new ToolBrokerError("TOOL_CANCELLED"));
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.#pendingApprovals.delete(request.id);
        reject(new ToolBrokerError("TOOL_CANCELLED"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.#pendingApprovals.set(request.id, {
        resolve: (decision) => {
          signal.removeEventListener("abort", abort);
          resolve(decision);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      });
    });
  }
}
