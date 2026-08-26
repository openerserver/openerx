import { randomUUID } from "node:crypto";
import type {
  AppServiceAuthorization,
  ChatEvent,
  ExecutionRun,
  McpServerConfig,
  NormalizedToolResult,
  PermissionRequest,
  PiActivityEvent,
  PiToolRequestFrame,
  RunStep,
  ToolCall,
  ToolOperation,
  WorkItem,
} from "@openerx/contracts";
import type { ToolRepository } from "@openerx/storage";
import {
  BuiltinToolAdapter,
  CapabilityBroker,
  type CapabilityHost,
  type CredentialResolver,
  capabilityRequirement,
  HostCapabilityAdapter,
  HttpPlatformImageGenerationTransport,
  HttpPlatformWebSearchTransport,
  McpToolAdapter,
  ShellToolAdapter,
  summarizeOperation,
  type ToolAdapter,
  type ToolExecutionContext,
} from "@openerx/tool-sdk";

class GenerationWebSearchAdapter implements ToolAdapter {
  readonly operations = ["web_search"] as const;
  constructor(
    private readonly authorization: (generationId: string) => AppServiceAuthorization | undefined,
  ) {}

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (operation.operation !== "web_search") throw new Error("WEB_SEARCH_OPERATION_NOT_SUPPORTED");
    const generationId = context.projection?.generationId;
    const authorization = generationId ? this.authorization(generationId) : undefined;
    if (!authorization) throw new Error("AUTHENTICATION_REQUIRED");
    return await new HttpPlatformWebSearchTransport(
      authorization.platformBaseUrl,
      authorization.accessToken,
    ).search({
      query: operation.query,
      ...(operation.recencyDays === undefined ? {} : { recencyDays: operation.recencyDays }),
      ...(operation.domains === undefined ? {} : { domains: operation.domains }),
      signal: context.signal,
    });
  }
}

class GenerationImageGenerationAdapter implements ToolAdapter {
  readonly operations = ["image_generate"] as const;
  constructor(
    private readonly authorization: (generationId: string) => AppServiceAuthorization | undefined,
  ) {}

  async execute(
    operation: ToolOperation,
    context: ToolExecutionContext,
  ): Promise<NormalizedToolResult> {
    if (operation.operation !== "image_generate") {
      throw new Error("IMAGE_GENERATION_OPERATION_NOT_SUPPORTED");
    }
    const generationId = context.projection?.generationId;
    const authorization = generationId ? this.authorization(generationId) : undefined;
    if (!authorization) throw new Error("AUTHENTICATION_REQUIRED");
    return await new HttpPlatformImageGenerationTransport(
      authorization.platformBaseUrl,
      authorization.accessToken,
    ).generate({
      prompt: operation.prompt,
      aspectRatio: operation.aspectRatio,
      count: operation.count,
      signal: context.signal,
    });
  }
}

export interface ToolAppServiceOptions {
  repository: ToolRepository;
  workspaceDirectory: string;
  host: CapabilityHost & CredentialResolver;
  resolveUploadPath(fileId: string): string;
  ingestDownload(path: string): Promise<{ fileId: string; displayName: string }>;
  selectedModelRef(assistantMessageId: string): string;
  emit(event: ChatEvent): void;
  additionalAdapters?: ToolAdapter[];
}

interface ActiveProjection {
  workItem: WorkItem;
  run: ExecutionRun;
}

export class ToolAppService {
  readonly #repository: ToolRepository;
  readonly #broker: CapabilityBroker;
  readonly #emitEvent: (event: ChatEvent) => void;
  readonly #selectedModelRef: (assistantMessageId: string) => string;
  readonly #projectionByGeneration = new Map<string, ActiveProjection>();
  readonly #authorizationByGeneration = new Map<string, AppServiceAuthorization>();
  readonly #abortByGeneration = new Map<string, AbortController>();
  readonly #mcp: McpToolAdapter;

  constructor(options: ToolAppServiceOptions) {
    this.#repository = options.repository;
    this.#emitEvent = options.emit;
    this.#selectedModelRef = options.selectedModelRef;
    this.#mcp = new McpToolAdapter(options.host);
    this.#broker = new CapabilityBroker(options.repository, [
      new BuiltinToolAdapter(),
      new GenerationWebSearchAdapter((generationId) =>
        this.#authorizationByGeneration.get(generationId),
      ),
      new GenerationImageGenerationAdapter((generationId) =>
        this.#authorizationByGeneration.get(generationId),
      ),
      new ShellToolAdapter([options.workspaceDirectory]),
      new HostCapabilityAdapter(options.host, options.resolveUploadPath, options.ingestDownload),
      this.#mcp,
      ...(options.additionalAdapters ?? []),
    ]);
  }

  initialize(): void {
    this.#repository.recoverInterrupted();
    for (const config of this.#repository.listMcpServers()) this.#mcp.register(config);
  }

  repository(): ToolRepository {
    return this.#repository;
  }

  upsertMcpServer(config: McpServerConfig): McpServerConfig {
    const saved = this.#repository.upsertMcpServer(config);
    this.#mcp.register(saved);
    return saved;
  }

  async removeMcpServer(serverId: string): Promise<{ serverId: string; removed: boolean }> {
    await this.#mcp.unregister(serverId);
    return this.#repository.removeMcpServer(serverId);
  }

  async handleRequest(
    frame: PiToolRequestFrame,
    authorization?: AppServiceAuthorization,
  ): Promise<NormalizedToolResult> {
    if (authorization) this.#authorizationByGeneration.set(frame.generationId, authorization);
    const projection = this.#ensureProjection(frame);
    const requirement = {
      requirement: capabilityRequirement(frame.operation),
      summary: summarizeOperation(frame.operation),
    };
    const projected = this.#repository.createToolCall({
      runId: projection.run.id,
      piCallRef: frame.piToolCallId,
      toolName: frame.toolName,
      source: frame.operation.operation.startsWith("mcp_")
        ? "mcp"
        : frame.operation.operation.startsWith("skill_")
          ? "skill"
          : "openerx",
      risk: requirement.requirement.risk,
      idempotencyKey: frame.operation.idempotencyKey,
      inputSummary: requirement.summary.input,
      targetSummary: requirement.summary.target,
    });
    this.#emit("tool.requested", frame, projection, {
      toolCall: projected.toolCall,
      step: projected.step,
    });
    const controller = this.#abortByGeneration.get(frame.generationId) ?? new AbortController();
    this.#abortByGeneration.set(frame.generationId, controller);
    try {
      const result = await this.#broker.executeAwaitingPermission(
        {
          generationId: frame.generationId,
          workItemId: projection.workItem.id,
          runId: projection.run.id,
          conversationId: frame.conversationId,
          assistantMessageId: frame.assistantMessageId,
          piToolCallId: frame.piToolCallId,
          toolName: frame.toolName,
        },
        frame.operation,
        controller.signal,
        (summary) => {
          const call = this.#repository.toolCallByPiRef(projection.run.id, frame.piToolCallId);
          if (call)
            this.#emit("tool.progressed", frame, projection, {
              toolCall: call,
              reason: summary.slice(0, 2_000),
            });
        },
        (permission) => {
          const call = this.#repository.toolCall(permission.toolCallId);
          this.#emit("permission.required", frame, projection, { permission, toolCall: call });
        },
      );
      const call = this.#repository.toolCallByPiRef(projection.run.id, frame.piToolCallId);
      if (call) this.#emit("tool.completed", frame, projection, { toolCall: call });
      return result;
    } catch (error) {
      const call = this.#repository.toolCallByPiRef(projection.run.id, frame.piToolCallId);
      if (call) {
        this.#emit("tool.failed", frame, projection, {
          toolCall: call,
          reason: error instanceof Error ? error.message : "TOOL_FAILED",
        });
      }
      throw error;
    }
  }

  handleActivity(frame: PiActivityEvent): void {
    const projection = this.#projectionByGeneration.get(frame.generationId);
    if (!projection) return;
    if (frame.type === "run.compacted" || frame.type === "run.retry_completed") {
      this.#repository.recordPiProjection(
        projection.run.id,
        frame.sequence,
        frame.type === "run.compacted" ? "compaction" : "retry",
        true,
      );
      this.#emit(
        frame.type === "run.compacted" ? "run.compacted" : "run.retrying",
        this.#syntheticFrame(frame, projection),
        projection,
        { reason: frame.resultSummary ?? frame.errorCode },
      );
    }
  }

  resolvePermission(input: {
    permissionRequestId: string;
    decision: "once" | "session" | "persistent" | "deny";
    payloadDigest: string;
    scopeConversationId?: string | null;
  }): PermissionRequest {
    const permission = this.#broker.resolvePermission(input);
    const projection = [...this.#projectionByGeneration.values()].find(
      ({ run }) => run.id === permission.runId,
    );
    if (projection) {
      this.#emitEvent({
        eventId: randomUUID(),
        type: "permission.resolved",
        conversationId: projection.workItem.conversationId,
        messageId: projection.workItem.messageId,
        sequence: 0,
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: {
          permission,
          workItem: this.#repository.workItem(projection.workItem.id),
          run: this.#repository.run(projection.run.id),
        },
      });
    }
    return permission;
  }

  completeGeneration(
    generationId: string,
    status: "completed" | "failed" | "cancelled",
    errorCode?: string,
  ): void {
    const projection = this.#projectionByGeneration.get(generationId);
    if (projection) {
      this.#repository.completeRun(projection.run.id, status, errorCode);
      const workItem = this.#repository.workItem(projection.workItem.id);
      const run = this.#repository.run(projection.run.id);
      this.#emitEvent({
        eventId: randomUUID(),
        type:
          status === "completed"
            ? "run.completed"
            : status === "cancelled"
              ? "run.cancelled"
              : "run.failed",
        conversationId: workItem.conversationId,
        messageId: workItem.messageId,
        sequence: 0,
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: { workItem, run, ...(errorCode ? { reason: errorCode } : {}) },
      });
    }
    this.#abortByGeneration.get(generationId)?.abort();
    this.#abortByGeneration.delete(generationId);
    this.#authorizationByGeneration.delete(generationId);
    this.#projectionByGeneration.delete(generationId);
  }

  cancelGeneration(generationId: string): void {
    this.#abortByGeneration.get(generationId)?.abort();
    this.completeGeneration(generationId, "cancelled", "USER_CANCELLED");
  }

  async close(): Promise<void> {
    for (const controller of this.#abortByGeneration.values()) controller.abort();
    await this.#broker.stopAll();
    this.#repository.close();
  }

  #ensureProjection(frame: PiToolRequestFrame): ActiveProjection {
    const active = this.#projectionByGeneration.get(frame.generationId);
    if (active) return active;
    const projection = this.#repository.createProjection({
      conversationId: frame.conversationId,
      messageId: frame.assistantMessageId,
      title: `工具任务 · ${frame.toolName}`,
      selectedModelRef: this.#selectedModelRef(frame.assistantMessageId),
      piPackageVersion: "0.84.3",
      piHostContractVersion: 1,
      piSessionRef: `conversation:${frame.conversationId}`,
    });
    this.#projectionByGeneration.set(frame.generationId, projection);
    this.#emit("run.started", frame, projection, {});
    return projection;
  }

  #emit(
    type: ChatEvent["type"],
    frame: Pick<PiToolRequestFrame, "conversationId" | "assistantMessageId">,
    projection: ActiveProjection,
    payload: {
      toolCall?: ToolCall;
      step?: RunStep;
      permission?: PermissionRequest;
      reason?: string;
    },
  ): void {
    this.#emitEvent({
      eventId: randomUUID(),
      type,
      conversationId: frame.conversationId,
      messageId: frame.assistantMessageId,
      sequence: 0,
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      payload: {
        workItem: this.#repository.workItem(projection.workItem.id),
        run: this.#repository.run(projection.run.id),
        ...payload,
      },
    });
  }

  #syntheticFrame(
    _frame: PiActivityEvent,
    projection: ActiveProjection,
  ): Pick<PiToolRequestFrame, "conversationId" | "assistantMessageId"> {
    return {
      conversationId: projection.workItem.conversationId,
      assistantMessageId: projection.workItem.messageId,
    };
  }
}
