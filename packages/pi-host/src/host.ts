import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  automaticMemoryExtractionOutputSchema,
  defaultThinkingLevel,
  memorySemanticClusterOutputSchema,
  type PiActivityEvent,
  type PiFileToolRequestFrame,
  type PiHostEventFrame,
  type PiMemoryClusterFrame,
  type PiMemoryExtractFrame,
  type PiPromptFrame,
  type PiSessionControlFrame,
  type PiToolProgressFrame,
  type PiToolRequestFrame,
  piFileToolResponseFrameSchema,
  piHostBootstrapSchema,
  piHostContractVersion,
  piHostRequestFrameSchema,
  piToolProgressFrameSchema,
  piToolResponseFrameSchema,
  type UsageRecord,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";
import { desktopBrand } from "../../branding/src/index";
import { createProductPiSession, ModelRuntime } from "./agent-session";
import { createProductCapabilityTools } from "./capability-tools";
import { createProductFileTools } from "./file-tools";
import { createProductMcpTools } from "./mcp-tools";
import {
  filterIneligibleMemoryExtractionSources,
  memoryClusterSystemPrompt,
  memoryExtractionSystemPrompt,
  parseMemoryJsonOutput,
  validateMemoryClusterOutput,
  validateMemoryExtractionOutput,
} from "./memory-background";
import { createProductMemoryTools, productMemoryToolNames } from "./memory-tools";
import { createProductPlanTool, productPlanToolName } from "./plan-tool";
import { createPlatformModelProvider, HttpPlatformModelTransport } from "./platform-provider";
import { ProductSessionRegistry } from "./session-registry";
import { createProductSkillTools, validateSkillMounts } from "./skill-tools";
import { createProductToolSearch } from "./tool-search";
import { createProductWorkspaceTools } from "./workspace-tools";

interface ActiveGeneration {
  abortRequested: boolean;
  sequence: number;
  activitySequence: number;
  session?: AgentSession;
  terminal: boolean;
  conversationId: string;
  branchId: string;
  modelRound: number;
  lastTextModelRound: number | null;
  reasoningRound: number;
  compactionRound: number;
}

interface PendingFileToolRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export function createRestrictedByokFetch(baseUrl: string): typeof globalThis.fetch {
  const allowed = new URL(baseUrl);
  const allowedPath = allowed.pathname.replace(/\/$/u, "");
  return async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    const pathAllowed =
      allowedPath === "" ||
      allowedPath === "/" ||
      requestUrl.pathname === allowedPath ||
      requestUrl.pathname.startsWith(`${allowedPath}/`);
    if (requestUrl.origin !== allowed.origin || !pathAllowed) {
      throw new Error("BYOK_REQUEST_TARGET_FORBIDDEN");
    }
    const response = await fetch(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("BYOK_REDIRECT_FORBIDDEN");
    }
    return response;
  };
}

interface PendingCapabilityToolRequest extends PendingFileToolRequest {
  lastProgressSequence: number;
  onProgress?: (frame: PiToolProgressFrame) => void;
  signal?: AbortSignal;
  abort?: () => void;
}

class PiModelNotConfiguredError extends Error {}

export interface PiHostOptions {
  model?: Model<string>;
  modelRuntime?: ModelRuntime;
}

function lastAssistantMessage(session: AgentSession): AssistantMessage | undefined {
  return [...session.messages]
    .reverse()
    .find((message): message is AssistantMessage => message.role === "assistant");
}

function assistantText(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter(
      (part): part is Extract<(typeof message.content)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map(({ text }) => text)
    .join("")
    .trim();
}

function errorCode(error: unknown): string {
  if (error instanceof PiModelNotConfiguredError) return "PI_MODEL_NOT_CONFIGURED";
  const message = error instanceof Error ? error.message : "";
  if (message.includes("No model selected") || message.includes("No models available")) {
    return "PI_MODEL_NOT_CONFIGURED";
  }
  const platformCode = message.split(":", 1)[0];
  if (
    platformCode &&
    /^(ACCESS_|ACCOUNT_|DEVICE_|MODEL_|PLATFORM_)[A-Z0-9_]+$/.test(platformCode)
  ) {
    return platformCode;
  }
  return "PI_HOST_FAILURE";
}

export function startPiHostProcess(
  parentPort: Electron.ParentPort,
  options: PiHostOptions = {},
): void {
  parentPort.once("message", async (bootstrapEvent) => {
    const bootstrap = piHostBootstrapSchema.parse(bootstrapEvent.data);
    const [port] = bootstrapEvent.ports as MessagePortMain[];
    if (!port) throw new Error("Pi Host bootstrap port is missing");

    const workspaceDirectory = path.join(bootstrap.profileDirectory, "pi-workspace");
    const agentDirectory = path.join(bootstrap.profileDirectory, "pi-agent");
    mkdirSync(workspaceDirectory, { recursive: true });
    mkdirSync(agentDirectory, { recursive: true });
    const active = new Map<string, ActiveGeneration>();
    const pendingFileTools = new Map<string, PendingFileToolRequest>();
    const pendingCapabilityTools = new Map<string, PendingCapabilityToolRequest>();
    const sessionRegistry = new ProductSessionRegistry(
      bootstrap.profileDirectory,
      workspaceDirectory,
    );
    const controlResults = new Map<string, unknown>();

    const fileToolTransport = {
      request: async (frame: PiFileToolRequestFrame): Promise<unknown> => {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            pendingFileTools.delete(frame.requestId);
            reject(new Error("FILE_TOOL_TIMEOUT"));
          }, 15_000);
          pendingFileTools.set(frame.requestId, { resolve, reject, timeout });
          port.postMessage(frame);
        });
      },
    };
    const capabilityToolTransport = {
      request: async (
        frame: PiToolRequestFrame,
        options: {
          signal?: AbortSignal;
          onProgress?: PendingCapabilityToolRequest["onProgress"];
        } = {},
      ): Promise<unknown> => {
        return await new Promise((resolve, reject) => {
          if (options.signal?.aborted) {
            reject(new Error("TOOL_CANCELLED"));
            return;
          }
          const timeout = setTimeout(() => {
            const pending = pendingCapabilityTools.get(frame.requestId);
            pending?.signal?.removeEventListener("abort", pending.abort as EventListener);
            pendingCapabilityTools.delete(frame.requestId);
            port.postMessage({
              kind: "pi.tool.cancel",
              requestId: frame.requestId,
              generationId: frame.generationId,
            });
            reject(new Error("CAPABILITY_TOOL_TIMEOUT"));
          }, 30 * 60_000);
          const abort = () => {
            const pending = pendingCapabilityTools.get(frame.requestId);
            if (!pending) return;
            clearTimeout(pending.timeout);
            pendingCapabilityTools.delete(frame.requestId);
            port.postMessage({
              kind: "pi.tool.cancel",
              requestId: frame.requestId,
              generationId: frame.generationId,
            });
            reject(new Error("TOOL_CANCELLED"));
          };
          pendingCapabilityTools.set(frame.requestId, {
            resolve,
            reject,
            timeout,
            lastProgressSequence: 0,
            ...(options.onProgress ? { onProgress: options.onProgress } : {}),
            ...(options.signal ? { signal: options.signal, abort } : {}),
          });
          options.signal?.addEventListener("abort", abort, { once: true });
          port.postMessage(frame);
        });
      },
    };

    const emit = (
      generationId: string,
      state: ActiveGeneration,
      event: Pick<PiHostEventFrame, "type"> &
        Partial<Pick<PiHostEventFrame, "delta" | "startsNewPart" | "errorCode" | "usageRecords">>,
    ): void => {
      if (state.terminal) return;
      state.sequence += 1;
      const frame: PiHostEventFrame = {
        kind: "pi.product-event",
        generationId,
        eventId: randomUUID(),
        sequence: state.sequence,
        occurredAt: new Date().toISOString(),
        type: event.type,
        ...(event.delta === undefined ? {} : { delta: event.delta }),
        ...(event.startsNewPart === undefined ? {} : { startsNewPart: event.startsNewPart }),
        ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
        ...(event.usageRecords === undefined ? {} : { usageRecords: event.usageRecords }),
      };
      if (event.type !== "delta") state.terminal = true;
      port.postMessage(frame);
    };

    const emitActivity = (
      generationId: string,
      state: ActiveGeneration,
      event: Pick<PiActivityEvent, "type"> &
        Partial<
          Pick<
            PiActivityEvent,
            | "piItemRef"
            | "piToolCallId"
            | "toolName"
            | "inputSummary"
            | "resultSummary"
            | "errorCode"
            | "modelRef"
            | "reasoningTokens"
            | "planEntries"
            | "explanation"
            | "compactionReason"
            | "tokensBefore"
            | "tokensAfter"
            | "attempt"
            | "maxAttempts"
            | "delayMs"
          >
        >,
    ): void => {
      state.activitySequence += 1;
      const frame: PiActivityEvent = {
        kind: "pi.activity-event",
        generationId,
        eventId: randomUUID(),
        sequence: state.activitySequence,
        occurredAt: new Date().toISOString(),
        type: event.type,
        ...(event.piItemRef ? { piItemRef: event.piItemRef } : {}),
        ...(event.piToolCallId ? { piToolCallId: event.piToolCallId } : {}),
        ...(event.toolName ? { toolName: event.toolName } : {}),
        ...(event.inputSummary ? { inputSummary: event.inputSummary } : {}),
        ...(event.resultSummary ? { resultSummary: event.resultSummary } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.modelRef ? { modelRef: event.modelRef } : {}),
        ...(event.reasoningTokens === undefined ? {} : { reasoningTokens: event.reasoningTokens }),
        ...(event.planEntries ? { planEntries: event.planEntries } : {}),
        ...(event.explanation ? { explanation: event.explanation } : {}),
        ...(event.compactionReason ? { compactionReason: event.compactionReason } : {}),
        ...(event.tokensBefore === undefined ? {} : { tokensBefore: event.tokensBefore }),
        ...(event.tokensAfter === undefined ? {} : { tokensAfter: event.tokensAfter }),
        ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
        ...(event.maxAttempts === undefined ? {} : { maxAttempts: event.maxAttempts }),
        ...(event.delayMs === undefined ? {} : { delayMs: event.delayMs }),
      };
      port.postMessage(frame);
    };

    const extractMemories = async (frame: PiMemoryExtractFrame): Promise<void> => {
      const authoritativeUsageRecords: UsageRecord[] = [];
      let session: AgentSession | undefined;
      try {
        let modelRuntime = options.modelRuntime;
        let model = options.model;
        if (frame.platform) {
          const transport = new HttpPlatformModelTransport(
            frame.platform.platformBaseUrl,
            frame.platform.accessToken,
          );
          const catalog = await transport.catalog();
          const platform = createPlatformModelProvider({
            catalog,
            transport,
            thinkingLevel: frame.thinkingLevel ?? "medium",
            request: {
              accountId: frame.platform.accountId,
              conversationId: frame.conversationId,
              messageId: frame.jobId,
              selectedModelRef: frame.platform.selectedModelRef,
              approvedFallbackModelRef: frame.platform.approvedFallbackModelRef,
              requestDedupeKey: frame.platform.requestDedupeKey,
            },
            onUsage: (usage) => {
              if (!authoritativeUsageRecords.some(({ usageId }) => usageId === usage.usageId)) {
                authoritativeUsageRecords.push(usage);
              }
            },
            contextRedactions: [
              {
                value: workspaceDirectory,
                replacement: "<private-memory-extraction-directory>",
              },
              { value: agentDirectory, replacement: "<private-pi-agent-directory>" },
            ],
          });
          modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
          modelRuntime.registerNativeProvider(platform.provider);
          model = platform.model;
        }
        if (frame.byok) {
          const providerId = "openerx-memory-byok";
          const restrictedFetch = createRestrictedByokFetch(frame.byok.baseUrl);
          modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
          modelRuntime.registerProvider(providerId, {
            name: "OpenAI-compatible memory extraction",
            baseUrl: frame.byok.baseUrl,
            api: "openai-completions",
            authHeader: true,
            streamSimple: (candidateModel, context, streamOptions) =>
              streamOpenAICompletions(candidateModel as Model<"openai-completions">, context, {
                ...streamOptions,
                fetch: restrictedFetch,
              }),
            models: [
              {
                id: frame.byok.modelId,
                name: frame.byok.displayName,
                api: "openai-completions",
                reasoning: frame.byok.capabilities.reasoning,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: frame.byok.contextWindow,
                maxTokens: Math.min(frame.byok.maxOutputTokens, 2_000),
              },
            ],
          });
          await modelRuntime.setRuntimeApiKey(providerId, frame.byok.apiKey);
          model = modelRuntime.getModel(providerId, frame.byok.modelId);
        }
        if (!modelRuntime || !model) {
          throw new PiModelNotConfiguredError("Memory extraction model is not configured");
        }
        const result = await createProductPiSession({
          cwd: workspaceDirectory,
          agentDir: agentDirectory,
          history: [],
          thinkingLevel: frame.thinkingLevel ?? "medium",
          modelRuntime,
          model,
          customTools: [],
          systemPromptOverride: memoryExtractionSystemPrompt,
        });
        session = result.session;
        await session.prompt(
          JSON.stringify({
            task: "extract_durable_user_memories",
            messages: frame.messages,
            existingMemories: frame.existingMemories ?? [],
          }),
          { expandPromptTemplates: false },
        );
        await session.waitForIdle();
        const assistant = lastAssistantMessage(session);
        if (!assistant || assistant.stopReason === "error" || assistant.stopReason === "aborted") {
          throw new Error("MEMORY_EXTRACTION_MODEL_FAILED");
        }
        if (assistant.stopReason === "length") {
          throw new Error("MEMORY_EXTRACTION_OUTPUT_TRUNCATED");
        }
        const parsedOutput = automaticMemoryExtractionOutputSchema.parse(
          parseMemoryJsonOutput(assistantText(assistant), "MEMORY_EXTRACTION_OUTPUT_INVALID"),
        );
        const output = filterIneligibleMemoryExtractionSources(parsedOutput, frame.messages);
        validateMemoryExtractionOutput(output, frame.messages, frame.existingMemories ?? []);
        port.postMessage({
          kind: "pi.memory.extract-result",
          requestId: frame.requestId,
          ok: true,
          output,
          usageRecords: authoritativeUsageRecords,
        });
      } catch (caught) {
        const candidate = caught instanceof Error ? caught.message.split(":", 1)[0] : "";
        port.postMessage({
          kind: "pi.memory.extract-result",
          requestId: frame.requestId,
          ok: false,
          errorCode:
            candidate && /^[A-Z][A-Z0-9_]*$/u.test(candidate) ? candidate : errorCode(caught),
        });
      } finally {
        session?.dispose();
      }
    };

    const clusterMemories = async (frame: PiMemoryClusterFrame): Promise<void> => {
      const authoritativeUsageRecords: UsageRecord[] = [];
      let session: AgentSession | undefined;
      try {
        let modelRuntime = options.modelRuntime;
        let model = options.model;
        if (frame.platform) {
          const transport = new HttpPlatformModelTransport(
            frame.platform.platformBaseUrl,
            frame.platform.accessToken,
          );
          const catalog = await transport.catalog();
          const platform = createPlatformModelProvider({
            catalog,
            transport,
            thinkingLevel: frame.thinkingLevel ?? "medium",
            request: {
              accountId: frame.platform.accountId,
              conversationId: frame.runId,
              messageId: frame.requestId,
              selectedModelRef: frame.platform.selectedModelRef,
              approvedFallbackModelRef: frame.platform.approvedFallbackModelRef,
              requestDedupeKey: frame.platform.requestDedupeKey,
            },
            onUsage: (usage) => {
              if (!authoritativeUsageRecords.some(({ usageId }) => usageId === usage.usageId)) {
                authoritativeUsageRecords.push(usage);
              }
            },
            contextRedactions: [
              {
                value: workspaceDirectory,
                replacement: "<private-memory-clustering-directory>",
              },
              { value: agentDirectory, replacement: "<private-pi-agent-directory>" },
            ],
          });
          modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
          modelRuntime.registerNativeProvider(platform.provider);
          model = platform.model;
        }
        if (frame.byok) {
          const providerId = "openerx-memory-cluster-byok";
          const restrictedFetch = createRestrictedByokFetch(frame.byok.baseUrl);
          modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
          modelRuntime.registerProvider(providerId, {
            name: "OpenAI-compatible memory clustering",
            baseUrl: frame.byok.baseUrl,
            api: "openai-completions",
            authHeader: true,
            streamSimple: (candidateModel, context, streamOptions) =>
              streamOpenAICompletions(candidateModel as Model<"openai-completions">, context, {
                ...streamOptions,
                fetch: restrictedFetch,
              }),
            models: [
              {
                id: frame.byok.modelId,
                name: frame.byok.displayName,
                api: "openai-completions",
                reasoning: frame.byok.capabilities.reasoning,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: frame.byok.contextWindow,
                maxTokens: Math.min(frame.byok.maxOutputTokens, 2_000),
              },
            ],
          });
          await modelRuntime.setRuntimeApiKey(providerId, frame.byok.apiKey);
          model = modelRuntime.getModel(providerId, frame.byok.modelId);
        }
        if (!modelRuntime || !model) {
          throw new PiModelNotConfiguredError("Memory clustering model is not configured");
        }
        const result = await createProductPiSession({
          cwd: workspaceDirectory,
          agentDir: agentDirectory,
          history: [],
          thinkingLevel: frame.thinkingLevel ?? "medium",
          modelRuntime,
          model,
          customTools: [],
          systemPromptOverride: memoryClusterSystemPrompt,
        });
        session = result.session;
        await session.prompt(
          JSON.stringify({
            task: "find_memory_duplicates_and_conflicts",
            memories: frame.memories,
          }),
          { expandPromptTemplates: false },
        );
        await session.waitForIdle();
        const assistant = lastAssistantMessage(session);
        if (!assistant || assistant.stopReason === "error" || assistant.stopReason === "aborted") {
          throw new Error("MEMORY_CLUSTER_MODEL_FAILED");
        }
        if (assistant.stopReason === "length") throw new Error("MEMORY_CLUSTER_OUTPUT_TRUNCATED");
        const output = memorySemanticClusterOutputSchema.parse(
          parseMemoryJsonOutput(assistantText(assistant), "MEMORY_CLUSTER_OUTPUT_INVALID"),
        );
        validateMemoryClusterOutput(output, frame.memories);
        port.postMessage({
          kind: "pi.memory.cluster-result",
          requestId: frame.requestId,
          ok: true,
          output,
          usageRecords: authoritativeUsageRecords,
        });
      } catch (caught) {
        const candidate = caught instanceof Error ? caught.message.split(":", 1)[0] : "";
        port.postMessage({
          kind: "pi.memory.cluster-result",
          requestId: frame.requestId,
          ok: false,
          errorCode:
            candidate && /^[A-Z][A-Z0-9_]*$/u.test(candidate) ? candidate : errorCode(caught),
        });
      } finally {
        session?.dispose();
      }
    };

    const prompt = async (frame: PiPromptFrame): Promise<void> => {
      const duplicateBranch = [...active.values()].some(
        (state) => state.branchId === frame.branchId,
      );
      const state: ActiveGeneration = {
        abortRequested: false,
        sequence: 0,
        activitySequence: 0,
        terminal: false,
        conversationId: frame.conversationId,
        branchId: frame.branchId,
        modelRound: 0,
        lastTextModelRound: null,
        reasoningRound: 0,
        compactionRound: 0,
      };
      active.set(frame.generationId, state);
      if (duplicateBranch) {
        emit(frame.generationId, state, {
          type: "failed",
          errorCode: "PI_BRANCH_ALREADY_ACTIVE",
        });
        active.delete(frame.generationId);
        return;
      }
      let unsubscribe: (() => void) | undefined;
      const authoritativeUsageRecords: UsageRecord[] = [];
      try {
        const promptMessage = frame.history.at(-1);
        if (promptMessage?.role !== "user") {
          throw new Error("Pi prompt is missing its final user message");
        }
        let modelRuntime = options.modelRuntime;
        let model = options.model;
        if (frame.platform) {
          const transport = new HttpPlatformModelTransport(
            frame.platform.platformBaseUrl,
            frame.platform.accessToken,
          );
          const catalog = await transport.catalog();
          const platform = createPlatformModelProvider({
            catalog,
            transport,
            thinkingLevel: frame.thinkingLevel ?? defaultThinkingLevel,
            requiresImageInput:
              (frame.images?.length ?? 0) > 0 ||
              frame.history.some((message) => (message.images?.length ?? 0) > 0),
            request: {
              accountId: frame.platform.accountId,
              conversationId: frame.conversationId,
              messageId: frame.assistantMessageId,
              selectedModelRef: frame.platform.selectedModelRef,
              approvedFallbackModelRef: frame.platform.approvedFallbackModelRef,
              requestDedupeKey: frame.platform.requestDedupeKey,
            },
            onUsage: (usage) => {
              if (!authoritativeUsageRecords.some(({ usageId }) => usageId === usage.usageId)) {
                authoritativeUsageRecords.push(usage);
              }
            },
            contextRedactions: [
              {
                value: workspaceDirectory,
                replacement: "<private-pi-session-directory-not-a-tool-workspace>",
              },
              {
                value: agentDirectory,
                replacement: "<private-pi-agent-directory>",
              },
            ],
          });
          modelRuntime = await ModelRuntime.create({
            modelsPath: null,
            refreshOnCreate: false,
          });
          modelRuntime.registerNativeProvider(platform.provider);
          model = platform.model;
        }
        if (frame.byok) {
          const providerId = "openerx-byok";
          const restrictedFetch = createRestrictedByokFetch(frame.byok.baseUrl);
          modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
          modelRuntime.registerProvider(providerId, {
            name: "OpenAI-compatible BYOK",
            baseUrl: frame.byok.baseUrl,
            api: "openai-completions",
            authHeader: true,
            streamSimple: (model, context, streamOptions) =>
              streamOpenAICompletions(model as Model<"openai-completions">, context, {
                ...streamOptions,
                fetch: restrictedFetch,
              }),
            models: [
              {
                id: frame.byok.modelId,
                name: frame.byok.displayName,
                api: "openai-completions",
                reasoning: frame.byok.capabilities.reasoning,
                input: frame.byok.capabilities.imageInput ? ["text", "image"] : ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: frame.byok.contextWindow,
                maxTokens: frame.byok.maxOutputTokens,
              },
            ],
          });
          await modelRuntime.setRuntimeApiKey(providerId, frame.byok.apiKey);
          model = modelRuntime.getModel(providerId, frame.byok.modelId);
        }
        if (!modelRuntime || !model) {
          throw new PiModelNotConfiguredError(
            `${desktopBrand.productName} Platform Model is not configured`,
          );
        }
        const activeModelRef = frame.platform?.selectedModelRef ?? model.id;
        const sessionManager = await sessionRegistry.sessionManager(
          frame.conversationId,
          frame.branchId,
        );
        const skills = validateSkillMounts(bootstrap.profileDirectory, frame.skills ?? []);
        const capabilityTools = createProductCapabilityTools({
          generationId: frame.generationId,
          conversationId: frame.conversationId,
          branchId: frame.branchId,
          assistantMessageId: frame.assistantMessageId,
          ...(frame.workspace?.execution
            ? { brokeredBashExecution: frame.workspace.execution }
            : {}),
          browserSearchFallback: frame.availableToolNames?.includes("openerx_browser") ?? true,
          transport: capabilityToolTransport,
        });
        const workspaceTools = createProductWorkspaceTools({
          generationId: frame.generationId,
          conversationId: frame.conversationId,
          branchId: frame.branchId,
          assistantMessageId: frame.assistantMessageId,
          transport: capabilityToolTransport,
        });
        const mcpTools = createProductMcpTools({
          generationId: frame.generationId,
          conversationId: frame.conversationId,
          branchId: frame.branchId,
          assistantMessageId: frame.assistantMessageId,
          descriptors: frame.mcpTools ?? [],
          transport: capabilityToolTransport,
        });
        const skillTools = createProductSkillTools({
          generationId: frame.generationId,
          conversationId: frame.conversationId,
          branchId: frame.branchId,
          assistantMessageId: frame.assistantMessageId,
          mounts: skills,
          transport: capabilityToolTransport,
        });
        const fileTools = createProductFileTools({
          generationId: frame.generationId,
          conversationId: frame.conversationId,
          branchId: frame.branchId,
          assistantMessageId: frame.assistantMessageId,
          transport: fileToolTransport,
        });
        const memoryTools = frame.memoryEnabled
          ? createProductMemoryTools({
              generationId: frame.generationId,
              conversationId: frame.conversationId,
              branchId: frame.branchId,
              assistantMessageId: frame.assistantMessageId,
              transport: capabilityToolTransport,
            })
          : [];
        const allTools = [
          createProductPlanTool(),
          ...fileTools,
          ...memoryTools,
          ...capabilityTools,
          ...workspaceTools,
          ...mcpTools,
          ...skillTools,
        ];
        const available = frame.availableToolNames
          ? new Set(frame.availableToolNames)
          : new Set(allTools.map(({ name }) => name));
        if (frame.memoryEnabled) {
          for (const name of productMemoryToolNames) available.add(name);
        }
        const searchableTools = allTools.filter(({ name }) => available.has(name));
        let productSession: AgentSession | undefined;
        const toolSearch = createProductToolSearch(searchableTools, {
          active: () => productSession?.getActiveToolNames() ?? ["openerx_tool_search"],
          activate: (toolNames) => productSession?.setActiveToolsByName(toolNames),
        });
        const result = await createProductPiSession({
          cwd: workspaceDirectory,
          agentDir: agentDirectory,
          history: frame.history.slice(0, -1),
          thinkingLevel: frame.thinkingLevel ?? defaultThinkingLevel,
          modelRuntime,
          model,
          sessionManager,
          files: frame.files,
          skills,
          workspace: frame.workspace,
          memories: frame.memories,
          memoryEnabled: frame.memoryEnabled,
          customTools: [toolSearch, ...searchableTools],
        });
        const session = result.session;
        productSession = session;
        if (frame.initialToolNames) {
          session.setActiveToolsByName(
            [
              ...new Set([
                "openerx_tool_search",
                ...frame.initialToolNames,
                ...(frame.memoryEnabled ? productMemoryToolNames : []),
              ]),
            ].filter((name) => name === "openerx_tool_search" || available.has(name)),
          );
        }
        state.session = session;
        if (state.abortRequested) {
          emit(frame.generationId, state, { type: "stopped" });
          return;
        }
        unsubscribe = session.subscribe((event) => {
          if (event.type === "turn_start") {
            state.modelRound += 1;
            emitActivity(frame.generationId, state, {
              type: "model.started",
              piItemRef: `model:${state.modelRound}`,
              modelRef: activeModelRef,
              resultSummary: `模型轮次 ${state.modelRound} 已开始`,
            });
            return;
          }
          if (event.type === "turn_end") {
            emitActivity(frame.generationId, state, {
              type: "model.completed",
              piItemRef: `model:${state.modelRound}`,
              modelRef: activeModelRef,
              resultSummary: `模型轮次 ${state.modelRound} 已完成`,
            });
            return;
          }
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta" &&
            event.assistantMessageEvent.delta.length > 0
          ) {
            const startsNewPart =
              state.lastTextModelRound !== null && state.lastTextModelRound !== state.modelRound;
            state.lastTextModelRound = state.modelRound;
            emit(frame.generationId, state, {
              type: "delta",
              delta: event.assistantMessageEvent.delta,
              ...(startsNewPart ? { startsNewPart: true } : {}),
            });
            return;
          }
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "thinking_start"
          ) {
            state.reasoningRound += 1;
            emitActivity(frame.generationId, state, {
              type: "reasoning.started",
              piItemRef: `reasoning:${state.modelRound}:${state.reasoningRound}`,
              resultSummary: "模型推理已开始；Run 时间线不记录原始思维链。",
            });
            return;
          }
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "thinking_end"
          ) {
            emitActivity(frame.generationId, state, {
              type: "reasoning.completed",
              piItemRef: `reasoning:${state.modelRound}:${state.reasoningRound}`,
              resultSummary: "模型推理已完成；Run 时间线仅保存安全摘要。",
            });
            return;
          }
          if (event.type === "tool_execution_start") {
            if (event.toolName === productPlanToolName) {
              const args = event.args as {
                explanation?: unknown;
                items?: Array<{ text?: unknown; status?: unknown }>;
              };
              const planEntries: Array<{
                text: string;
                status: "pending" | "in_progress" | "completed";
              }> = [];
              for (const item of args.items ?? []) {
                if (
                  typeof item.text === "string" &&
                  (item.status === "pending" ||
                    item.status === "in_progress" ||
                    item.status === "completed")
                ) {
                  planEntries.push({ text: item.text, status: item.status });
                }
              }
              if (planEntries.length > 0) {
                emitActivity(frame.generationId, state, {
                  type: "plan.updated",
                  piItemRef: `plan:${event.toolCallId}`,
                  planEntries,
                  ...(typeof args.explanation === "string"
                    ? { explanation: args.explanation }
                    : {}),
                });
              }
              return;
            }
            emitActivity(frame.generationId, state, {
              type: "tool.requested",
              piToolCallId: event.toolCallId,
              toolName: event.toolName,
              inputSummary: JSON.stringify(event.args).slice(0, 2_000),
            });
            return;
          }
          if (event.type === "tool_execution_update") {
            if (event.toolName === productPlanToolName) return;
            emitActivity(frame.generationId, state, {
              type: "tool.progressed",
              piToolCallId: event.toolCallId,
              toolName: event.toolName,
              resultSummary: JSON.stringify(event.partialResult).slice(0, 4_000),
            });
            return;
          }
          if (event.type === "tool_execution_end") {
            if (event.toolName === productPlanToolName) return;
            emitActivity(frame.generationId, state, {
              type: event.isError ? "tool.failed" : "tool.completed",
              piToolCallId: event.toolCallId,
              toolName: event.toolName,
              resultSummary: JSON.stringify(event.result).slice(0, 4_000),
              ...(event.isError ? { errorCode: "PI_TOOL_EXECUTION_FAILED" } : {}),
            });
            return;
          }
          if (event.type === "compaction_start") {
            state.compactionRound += 1;
            emitActivity(frame.generationId, state, {
              type: "run.compacting",
              piItemRef: `compaction:${state.compactionRound}`,
              compactionReason: event.reason,
            });
            return;
          }
          if (event.type === "compaction_end") {
            emitActivity(frame.generationId, state, {
              type: "run.compacted",
              piItemRef: `compaction:${state.compactionRound}`,
              compactionReason: event.reason,
              ...(event.result?.tokensBefore === undefined
                ? {}
                : { tokensBefore: event.result.tokensBefore }),
              ...(event.result?.estimatedTokensAfter === undefined
                ? {}
                : { tokensAfter: event.result.estimatedTokensAfter }),
              ...(event.errorMessage ? { errorCode: "PI_COMPACTION_FAILED" } : {}),
            });
            return;
          }
          if (event.type === "auto_retry_start") {
            emitActivity(frame.generationId, state, {
              type: "run.retrying",
              piItemRef: `retry:${event.attempt}`,
              resultSummary: `attempt ${event.attempt}/${event.maxAttempts}`,
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              delayMs: event.delayMs,
            });
            return;
          }
          if (event.type === "auto_retry_end") {
            emitActivity(frame.generationId, state, {
              type: "run.retry_completed",
              piItemRef: `retry:${event.attempt}`,
              attempt: event.attempt,
              maxAttempts: event.attempt,
              delayMs: 0,
              ...(event.success ? {} : { errorCode: "PI_RETRY_FAILED" }),
            });
          }
        });
        await session.prompt(promptMessage.text, {
          expandPromptTemplates: true,
          ...(frame.images && frame.images.length > 0
            ? {
                images: frame.images.map(({ data, mimeType }) => ({
                  type: "image" as const,
                  data,
                  mimeType,
                })),
              }
            : {}),
        });
        await session.waitForIdle();
        const assistant = lastAssistantMessage(session);
        if (state.abortRequested || assistant?.stopReason === "aborted") {
          emit(frame.generationId, state, {
            type: "stopped",
            ...(authoritativeUsageRecords.length > 0
              ? { usageRecords: authoritativeUsageRecords }
              : {}),
          });
        } else if (assistant?.stopReason === "length") {
          emit(frame.generationId, state, {
            type: "failed",
            errorCode: "MODEL_OUTPUT_LIMIT_REACHED",
            ...(authoritativeUsageRecords.length > 0
              ? { usageRecords: authoritativeUsageRecords }
              : {}),
          });
        } else if (!assistant || assistant.stopReason === "error") {
          emit(frame.generationId, state, {
            type: "failed",
            errorCode: assistant ? "PI_PROVIDER_FAILURE" : "PI_EMPTY_RESPONSE",
            ...(authoritativeUsageRecords.length > 0
              ? { usageRecords: authoritativeUsageRecords }
              : {}),
          });
        } else {
          emit(frame.generationId, state, {
            type: "completed",
            ...(authoritativeUsageRecords.length > 0
              ? { usageRecords: authoritativeUsageRecords }
              : {}),
          });
        }
      } catch (error) {
        emit(frame.generationId, state, {
          type: state.abortRequested ? "stopped" : "failed",
          ...(state.abortRequested ? {} : { errorCode: errorCode(error) }),
          ...(authoritativeUsageRecords.length > 0
            ? { usageRecords: authoritativeUsageRecords }
            : {}),
        });
      } finally {
        unsubscribe?.();
        state.session?.dispose();
        active.delete(frame.generationId);
      }
    };

    const control = async (frame: PiSessionControlFrame): Promise<void> => {
      const replay = controlResults.get(frame.requestId);
      if (replay) {
        port.postMessage(replay);
        return;
      }
      const state = active.get(frame.generationId);
      let result: unknown;
      if (!state) {
        result = {
          kind: "pi.session.control-result",
          requestId: frame.requestId,
          ok: false,
          errorCode: "PI_GENERATION_NOT_ACTIVE",
        };
      } else if (!state.session) {
        if (frame.action === "abort") {
          state.abortRequested = true;
          result = { kind: "pi.session.control-result", requestId: frame.requestId, ok: true };
        } else {
          result = {
            kind: "pi.session.control-result",
            requestId: frame.requestId,
            ok: false,
            errorCode: "PI_SESSION_NOT_READY",
          };
        }
      } else {
        try {
          if (frame.action === "steer") await state.session.steer(frame.text ?? "");
          else if (frame.action === "follow_up") await state.session.followUp(frame.text ?? "");
          else {
            state.abortRequested = true;
            await state.session.abort();
          }
          result = { kind: "pi.session.control-result", requestId: frame.requestId, ok: true };
        } catch (caught) {
          result = {
            kind: "pi.session.control-result",
            requestId: frame.requestId,
            ok: false,
            errorCode:
              caught instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(caught.message)
                ? caught.message
                : "PI_CONTROL_FAILED",
          };
        }
      }
      controlResults.set(frame.requestId, result);
      if (controlResults.size > 1_000) {
        const oldest = controlResults.keys().next().value;
        if (oldest) controlResults.delete(oldest);
      }
      port.postMessage(result);
    };

    port.on("message", (event) => {
      const fileToolResponse = piFileToolResponseFrameSchema.safeParse(event.data);
      if (fileToolResponse.success) {
        const pending = pendingFileTools.get(fileToolResponse.data.requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pendingFileTools.delete(fileToolResponse.data.requestId);
        if (fileToolResponse.data.ok) pending.resolve(fileToolResponse.data.data);
        else pending.reject(new Error(fileToolResponse.data.errorCode));
        return;
      }
      const capabilityToolResponse = piToolResponseFrameSchema.safeParse(event.data);
      if (capabilityToolResponse.success) {
        const pending = pendingCapabilityTools.get(capabilityToolResponse.data.requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pending.signal?.removeEventListener("abort", pending.abort as EventListener);
        pendingCapabilityTools.delete(capabilityToolResponse.data.requestId);
        if (capabilityToolResponse.data.ok) pending.resolve(capabilityToolResponse.data.data);
        else pending.reject(new Error(capabilityToolResponse.data.errorCode));
        return;
      }
      const capabilityToolProgress = piToolProgressFrameSchema.safeParse(event.data);
      if (capabilityToolProgress.success) {
        const pending = pendingCapabilityTools.get(capabilityToolProgress.data.requestId);
        if (!pending || capabilityToolProgress.data.sequence <= pending.lastProgressSequence) {
          return;
        }
        pending.lastProgressSequence = capabilityToolProgress.data.sequence;
        try {
          pending.onProgress?.(capabilityToolProgress.data);
        } catch {
          // Rendering a progress update cannot change or crash tool execution.
        }
        return;
      }
      const request = piHostRequestFrameSchema.safeParse(event.data);
      if (!request.success) return;
      if (request.data.kind === "pi.session.prompt") {
        void prompt(request.data);
        return;
      }
      if (request.data.kind === "pi.memory.extract") {
        void extractMemories(request.data);
        return;
      }
      if (request.data.kind === "pi.memory.cluster") {
        void clusterMemories(request.data);
        return;
      }
      if (request.data.kind === "pi.session.control") {
        void control(request.data);
        return;
      }
      if (request.data.kind !== "pi.session.abort") return;
      const state = active.get(request.data.generationId);
      if (!state) return;
      state.abortRequested = true;
      if (state.session) void state.session.abort();
    });
    port.once("close", () => {
      for (const pending of pendingFileTools.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("PI_HOST_DISCONNECTED"));
      }
      pendingFileTools.clear();
      for (const pending of pendingCapabilityTools.values()) {
        clearTimeout(pending.timeout);
        pending.signal?.removeEventListener("abort", pending.abort as EventListener);
        pending.reject(new Error("PI_HOST_DISCONNECTED"));
      }
      pendingCapabilityTools.clear();
      for (const state of active.values()) {
        state.abortRequested = true;
        if (state.session) void state.session.abort();
      }
    });
    port.start();
    port.postMessage({
      kind: "pi-host.ready",
      contractVersion: piHostContractVersion,
      nonce: bootstrap.nonce,
    });
  });
}
