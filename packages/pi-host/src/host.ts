import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  type PiHostEventFrame,
  type PiPromptFrame,
  piHostBootstrapSchema,
  piHostRequestFrameSchema,
} from "@openerx/contracts";
import type { MessagePortMain } from "electron";
import { createProductPiSession, ModelRuntime } from "./agent-session";
import { createPlatformModelProvider, HttpPlatformModelTransport } from "./platform-provider";

interface ActiveGeneration {
  abortRequested: boolean;
  sequence: number;
  session?: AgentSession;
  terminal: boolean;
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
      const state: ActiveGeneration = { abortRequested: false, sequence: 0, terminal: false };
      active.set(frame.generationId, state);
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
        const result = await createProductPiSession({
          cwd: workspaceDirectory,
          agentDir: agentDirectory,
          history: frame.history.slice(0, -1),
          modelRuntime,
          model,
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
      const request = piHostRequestFrameSchema.safeParse(event.data);
      if (!request.success) return;
      if (request.data.kind === "pi.session.prompt") {
        void prompt(request.data);
        return;
      }
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
