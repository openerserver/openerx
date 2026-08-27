import path from "node:path";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import {
  type CreateAgentSessionResult,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  PiHistoryMessage,
  PiPromptFrame,
  PiSkillMount,
  SupportedFileFormat,
  ThinkingLevel,
} from "@openerx/contracts";

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
  thinkingLevel?: ThinkingLevel;
  modelRuntime?: ModelRuntime;
  model?: Model<string>;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  customTools?: ToolDefinition[];
  files?: Array<{ personalFileId: string; displayName: string; format: SupportedFileFormat }>;
  skills?: PiSkillMount[];
  workspace?: PiPromptFrame["workspace"];
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
      content:
        message.images && message.images.length > 0
          ? [
              { type: "text", text: message.text },
              ...message.images.map(({ data, mimeType }) => ({
                type: "image" as const,
                data,
                mimeType,
              })),
            ]
          : message.text,
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
  if (sessionManager.getEntries().length === 0) {
    seedProductHistory(sessionManager, options.history, options.model);
  }
  const fileContext =
    options.files && options.files.length > 0
      ? [
          "Files attached to this conversation are available only through openerx_file_* tools:",
          ...options.files.map(
            (file) => `- ${file.displayName} (${file.format}, id ${file.personalFileId})`,
          ),
        ].join("\n")
      : "No files are attached to this conversation.";
  const workspaceContext = options.workspace?.grants.length
    ? [
        "Authorized project workspaces (use grant ids and relative paths only):",
        ...options.workspace.grants.map(
          (grant) =>
            `- ${grant.displayName} (grant ${grant.id}, ${grant.access}, network ${grant.allowNetwork ? "allowed" : "denied"})`,
        ),
        "Applicable project instructions already loaded for this Turn:",
        ...(options.workspace.instructionSources.length > 0
          ? options.workspace.instructionSources.map(
              (source) =>
                `[${source.kind}] ${source.relativePath} (${source.appliesTo}, digest ${source.digest})\n${source.content}`,
            )
          : ["- none"]),
        "Before changing a nested path, load its applicable instructions. Every write must use openerx_workspace_apply_patch and retain its diff.",
      ].join("\n")
    : "No project workspace is authorized for this conversation.";
  const systemPrompt = [
    "You are OpenerX, a precise personal AI assistant.",
    "Never request or invent raw filesystem paths. Use OpenerX attachment tools or authorized workspace grant ids with relative paths.",
    "Use OpenerX capability tools for Web, image generation, browser, Shell, desktop, and independently typed MCP actions. Never claim an action completed before its tool result.",
    "Use browser submit and desktop submit/send/delete/purchase only for an explicitly intended high-impact action; each requires user approval.",
    fileContext,
    workspaceContext,
    ...options.history.filter(({ role }) => role === "system").map(({ text }) => text),
  ].join("\n\n");

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noExtensions: true,
    additionalSkillPaths: options.skills?.map(({ baseDir }) => baseDir) ?? [],
    noSkills: (options.skills?.length ?? 0) === 0,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
    skillsOverride: (base) => {
      const mounts = new Map(
        (options.skills ?? []).map((mount) => [path.resolve(mount.baseDir), mount]),
      );
      return {
        skills: base.skills.flatMap((skill) => {
          const mount = mounts.get(path.resolve(skill.baseDir));
          return mount ? [{ ...skill, disableModelInvocation: !mount.autoInvoke }] : [];
        }),
        diagnostics: base.diagnostics,
      };
    },
  });
  await resourceLoader.reload();

  return await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime: options.modelRuntime,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    noTools: "builtin",
    customTools: options.customTools,
    resourceLoader,
    sessionManager,
    settingsManager,
  });
}

export { ModelRuntime, SessionManager, SettingsManager };
