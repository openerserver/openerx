import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import {
  type CreateAgentSessionResult,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PiHistoryMessage } from "@openerx/contracts";

const emptyUsage: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface CreateProductPiSessionOptions {
  cwd: string;
  agentDir: string;
  history: PiHistoryMessage[];
  modelRuntime?: ModelRuntime;
  model?: Model<string>;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
}

function seedProductHistory(
  sessionManager: SessionManager,
  history: PiHistoryMessage[],
  model?: Model<string>,
): void {
  let timestamp = Date.now() - history.length;
  for (const message of history) {
    if (message.role === "system") continue;
    timestamp += 1;
    if (message.role === "assistant") {
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: message.text }],
        api: model?.api ?? "openai-responses",
        provider: model?.provider ?? "openerx-product-history",
        model: model?.id ?? "unknown",
        usage: emptyUsage,
        stopReason: "stop",
        timestamp,
      });
      continue;
    }
    sessionManager.appendMessage({
      role: "user",
      content: message.text,
      timestamp,
    });
  }
}

export async function createProductPiSession(
  options: CreateProductPiSessionOptions,
): Promise<CreateAgentSessionResult> {
  const settingsManager =
    options.settingsManager ??
    SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: false });
  const sessionManager = options.sessionManager ?? SessionManager.inMemory(options.cwd);
  seedProductHistory(sessionManager, options.history, options.model);
  const systemPrompt = [
    "You are OpenerX, a precise personal AI assistant.",
    ...options.history.filter(({ role }) => role === "system").map(({ text }) => text),
  ].join("\n\n");

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
  });
  await resourceLoader.reload();

  return await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime: options.modelRuntime,
    model: options.model,
    noTools: "all",
    resourceLoader,
    sessionManager,
    settingsManager,
  });
}

export { ModelRuntime, SessionManager, SettingsManager };
