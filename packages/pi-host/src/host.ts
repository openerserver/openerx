import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  type PiActivityEvent,
  type PiFileToolRequestFrame,
  type PiHostEventFrame,
  type PiPromptFrame,
  type PiSessionControlFrame,
  type PiToolRequestFrame,
  piFileToolResponseFrameSchema,
  piHostBootstrapSchema,
  piHostRequestFrameSchema,
  piToolResponseFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";
import { createProductPiSession, ModelRuntime } from "./agent-session";
import { createProductCapabilityTools } from "./capability-tools";
import { createProductFileTools } from "./file-tools";
import { createPlatformModelProvider, HttpPlatformModelTransport } from "./platform-provider";
import { ProductSessionRegistry } from "./session-registry";
import { createProductSkillTools, validateSkillMounts } from "./skill-tools";

interface ActiveGeneration {
  abortRequested: boolean;
  sequence: number;
  activitySequence: number;
  session?: AgentSession;
  terminal: boolean;
  conversationId: string;
}

interface PendingFileToolRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
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
    const pendingCapabilityTools = new Map<string, PendingFileToolRequest>();
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
      request: async (frame: PiToolRequestFrame): Promise<unknown> => {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            pendingCapabilityTools.delete(frame.requestId);
            reject(new Error("CAPABILITY_TOOL_TIMEOUT"));
          }, 30 * 60_000);
          pendingCapabilityTools.set(frame.requestId, { resolve, reject, timeout });
          port.postMessage(frame);
        });
      },
    };

    const emit = (
      generationId: string,
      state: ActiveGeneration,
      event: Pick<PiHostEventFrame, "type"> &
        Partial<Pick<PiHostEventFrame, "delta" | "errorCode" | "usage">>,
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
        ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
        ...(event.usage === undefined ? {} : { usage: event.usage }),
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
            "piToolCallId" | "toolName" | "inputSummary" | "resultSummary" | "errorCode"
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
        ...(event.piToolCallId ? { piToolCallId: event.piToolCallId } : {}),
        ...(event.toolName ? { toolName: event.toolName } : {}),
        ...(event.inputSummary ? { inputSummary: event.inputSummary } : {}),
        ...(event.resultSummary ? { resultSummary: event.resultSummary } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      };
      port.postMessage(frame);
    };

    const prompt = async (frame: PiPromptFrame): Promise<void> => {
      const duplicateConversation = [...active.values()].some(
        (state) => state.conversationId === frame.conversationId,
      );
      const state: ActiveGeneration = {
        abortRequested: false,
        sequence: 0,
        activitySequence: 0,
        terminal: false,
        conversationId: frame.conversationId,
      };
      active.set(frame.generationId, state);
      if (duplicateConversation) {
        emit(frame.generationId, state, {
          type: "failed",
          errorCode: "PI_CONVERSATION_ALREADY_ACTIVE",
        });
        active.delete(frame.generationId);
        return;
      }
      let unsubscribe: (() => void) | undefined;
      let authoritativeUsage: PiHostEventFrame["usage"];
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
            request: {
              accountId: frame.platform.accountId,
              conversationId: frame.conversationId,
              messageId: frame.assistantMessageId,
              selectedModelRef: frame.platform.selectedModelRef,
              approvedFallbackModelRef: frame.platform.approvedFallbackModelRef,
              requestDedupeKey: frame.platform.requestDedupeKey,
            },
            onUsage: (usage) => {
              authoritativeUsage = usage;
            },
          });
          modelRuntime = await ModelRuntime.create({
            modelsPath: null,
            refreshOnCreate: false,
          });
          modelRuntime.registerNativeProvider(platform.provider);
          model = platform.model;
        }
        if (!modelRuntime || !model) {
          throw new PiModelNotConfiguredError("OpenerX Platform Model is not configured");
        }
        const sessionManager = await sessionRegistry.sessionManager(frame.conversationId);
        const skills = validateSkillMounts(bootstrap.profileDirectory, frame.skills ?? []);
        const result = await createProductPiSession({
          cwd: workspaceDirectory,
          agentDir: agentDirectory,
          history: frame.history.slice(0, -1),
          modelRuntime,
          model,
          sessionManager,
          files: frame.files,
          skills,
          customTools: [
            ...createProductFileTools({
              generationId: frame.generationId,
              conversationId: frame.conversationId,
              transport: fileToolTransport,
            }),
            ...createProductCapabilityTools({
              generationId: frame.generationId,
              conversationId: frame.conversationId,
              assistantMessageId: frame.assistantMessageId,
              transport: capabilityToolTransport,
            }),
            ...createProductSkillTools({
              generationId: frame.generationId,
              conversationId: frame.conversationId,
              assistantMessageId: frame.assistantMessageId,
              mounts: skills,
              transport: capabilityToolTransport,
            }),
          ],
        });
        const session = result.session;
        state.session = session;
        if (state.abortRequested) {
          emit(frame.generationId, state, { type: "stopped" });
          return;
        }
        unsubscribe = session.subscribe((event) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "text_delta" &&
            event.assistantMessageEvent.delta.length > 0
          ) {
            emit(frame.generationId, state, {
              type: "delta",
              delta: event.assistantMessageEvent.delta,
            });
            return;
          }
          if (event.type === "tool_execution_start") {
            emitActivity(frame.generationId, state, {
              type: "tool.requested",
              piToolCallId: event.toolCallId,
              toolName: event.toolName,
              inputSummary: JSON.stringify(event.args).slice(0, 2_000),
            });
            return;
          }
          if (event.type === "tool_execution_update") {
            emitActivity(frame.generationId, state, {
              type: "tool.progressed",
              piToolCallId: event.toolCallId,
              toolName: event.toolName,
              resultSummary: JSON.stringify(event.partialResult).slice(0, 4_000),
            });
            return;
          }
          if (event.type === "tool_execution_end") {
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
            emitActivity(frame.generationId, state, { type: "run.compacting" });
            return;
          }
          if (event.type === "compaction_end") {
            emitActivity(frame.generationId, state, {
              type: "run.compacted",
              ...(event.errorMessage ? { errorCode: "PI_COMPACTION_FAILED" } : {}),
            });
            return;
          }
          if (event.type === "auto_retry_start") {
            emitActivity(frame.generationId, state, {
              type: "run.retrying",
              resultSummary: `attempt ${event.attempt}/${event.maxAttempts}`,
            });
            return;
          }
          if (event.type === "auto_retry_end") {
            emitActivity(frame.generationId, state, {
              type: "run.retry_completed",
              ...(event.success ? {} : { errorCode: "PI_RETRY_FAILED" }),
            });
          }
        });
        await session.prompt(promptMessage.text, { expandPromptTemplates: true });
        await session.waitForIdle();
        const assistant = lastAssistantMessage(session);
        if (
          state.abortRequested ||
          assistant?.stopReason === "aborted" ||
          assistant?.stopReason === "length"
        ) {
          emit(frame.generationId, state, {
            type: "stopped",
            ...(assistant?.stopReason === "length"
              ? { errorCode: "MODEL_OUTPUT_LIMIT_REACHED" }
              : {}),
          });
        } else if (!assistant || assistant.stopReason === "error") {
          emit(frame.generationId, state, {
            type: "failed",
            errorCode: assistant ? "PI_PROVIDER_FAILURE" : "PI_EMPTY_RESPONSE",
          });
        } else {
          emit(frame.generationId, state, {
            type: "completed",
            ...(authoritativeUsage ? { usage: authoritativeUsage } : {}),
          });
        }
      } catch (error) {
        emit(frame.generationId, state, {
          type: state.abortRequested ? "stopped" : "failed",
          ...(state.abortRequested ? {} : { errorCode: errorCode(error) }),
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
        result = {
          kind: "pi.session.control-result",
          requestId: frame.requestId,
          ok: false,
          errorCode: "PI_SESSION_NOT_READY",
        };
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
        pendingCapabilityTools.delete(capabilityToolResponse.data.requestId);
        if (capabilityToolResponse.data.ok) pending.resolve(capabilityToolResponse.data.data);
        else pending.reject(new Error(capabilityToolResponse.data.errorCode));
        return;
      }
      const request = piHostRequestFrameSchema.safeParse(event.data);
      if (!request.success) return;
      if (request.data.kind === "pi.session.prompt") {
        void prompt(request.data);
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
    port.start();
    port.postMessage({
      kind: "pi-host.ready",
      contractVersion: 1,
      nonce: bootstrap.nonce,
    });
  });
}
