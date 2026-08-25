import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  type PiFileToolRequestFrame,
  type PiHostEventFrame,
  type PiPromptFrame,
  piFileToolResponseFrameSchema,
  piHostBootstrapSchema,
  piHostRequestFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";
import { createProductPiSession, ModelRuntime } from "./agent-session";
import { createProductFileTools } from "./file-tools";
import { createPlatformModelProvider, HttpPlatformModelTransport } from "./platform-provider";
import { ProductSessionRegistry } from "./session-registry";

interface ActiveGeneration {
  abortRequested: boolean;
  sequence: number;
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
    const sessionRegistry = new ProductSessionRegistry(
      bootstrap.profileDirectory,
      workspaceDirectory,
    );

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

    const prompt = async (frame: PiPromptFrame): Promise<void> => {
      const duplicateConversation = [...active.values()].some(
        (state) => state.conversationId === frame.conversationId,
      );
      const state: ActiveGeneration = {
        abortRequested: false,
        sequence: 0,
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
        const result = await createProductPiSession({
          cwd: workspaceDirectory,
          agentDir: agentDirectory,
          history: frame.history.slice(0, -1),
          modelRuntime,
          model,
          sessionManager,
          files: frame.files,
          customTools: createProductFileTools({
            generationId: frame.generationId,
            conversationId: frame.conversationId,
            transport: fileToolTransport,
          }),
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
          }
        });
        await session.prompt(promptMessage.text, { expandPromptTemplates: false });
        await session.waitForIdle();
        const assistant = lastAssistantMessage(session);
        if (state.abortRequested || assistant?.stopReason === "aborted") {
          emit(frame.generationId, state, { type: "stopped" });
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
      const request = piHostRequestFrameSchema.safeParse(event.data);
      if (!request.success) return;
      if (request.data.kind === "pi.session.prompt") {
        void prompt(request.data);
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
