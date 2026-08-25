import type { NormalizedToolResult, PermissionRequest, ToolOperation } from "@openerx/contracts";
import type { ToolRepository } from "@openerx/storage";
import { capabilityRequirement, operationDigest, scopeAllows, summarizeOperation } from "./policy";
import type { BrokerExecutionResult, ToolAdapter, ToolExecutionProjection } from "./types";

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
    update: (summary: string) => void = () => undefined,
  ): Promise<BrokerExecutionResult> {
    const replay = this.#repository.sideEffect(operation.idempotencyKey);
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
      inputSummary: summary.input,
      targetSummary: summary.target,
    });
    if (toolCall.status === "failed" && toolCall.errorCode === "PERMISSION_DENIED") {
      throw new ToolBrokerError("PERMISSION_DENIED");
    }

    const requiresApproval =
      requirement.risk !== "L0" &&
      (requirement.forcePerCallApproval ||
        !this.#repository
          .activeScopes(requirement.capability)
          .some((scope) => scopeAllows(scope, requirement)));
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
        payloadDigest: operationDigest(operation),
      });
      if (permission.status !== "approved") return { status: "permission_required", permission };
    }

    this.#repository.markToolCall(toolCall.id, "running");
    const startedAt = Date.now();
    try {
      const result = await adapter.execute(operation, {
        signal,
        toolCallId: toolCall.id,
        projection,
        update,
      });
      const normalized = {
        ...result,
        durationMs: Math.max(result.durationMs, Date.now() - startedAt),
      };
      this.#repository.commitSideEffect(operation.idempotencyKey, toolCall.id, normalized);
      this.#repository.markToolCall(toolCall.id, "completed", {
        resultSummary: normalized.summary,
      });
      return { status: "completed", result: normalized, replayed: false };
    } catch (error) {
      const code = signal.aborted
        ? "TOOL_CANCELLED"
        : error instanceof ToolBrokerError
          ? error.code
          : error instanceof Error
            ? (error.message.split(":", 1)[0] ?? "TOOL_FAILED")
            : "TOOL_FAILED";
      this.#repository.markToolCall(toolCall.id, signal.aborted ? "cancelled" : "failed", {
        errorCode: code,
      });
      throw error instanceof ToolBrokerError ? error : new ToolBrokerError(code);
    }
  }

  async executeAwaitingPermission(
    projection: ToolExecutionProjection,
    operation: ToolOperation,
    signal: AbortSignal = new AbortController().signal,
    update: (summary: string) => void = () => undefined,
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
  }): PermissionRequest {
    const result = this.#repository.resolvePermission(input);
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
