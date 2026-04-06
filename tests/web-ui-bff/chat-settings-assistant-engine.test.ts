import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { OrchestrationStrategy } from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  createOpencodeAdapterModuleMock,
  createRuntimeProviderModuleMock,
} from "./opencode-adapter-mock";

const runDetachedPromptMock = mock(async () => ({
  ok: true,
  text: JSON.stringify({
    action: "preview",
    configType: "orchestration-strategy",
    explanation: "启用 ops pipeline，并保持原有执行模式。",
    patch: {
      templates: [
        {
          id: "tpl-ops-pipeline",
          name: "tpl-ops-pipeline",
          mode: "pipeline",
          agents: ["oracle-enterprise"],
          enabled: true,
          categoryDefaults: ["ops"],
        },
      ],
    },
  }),
  sessionId: "session-1",
}));

const opencodeAdapterModule = createOpencodeAdapterModuleMock({
  runDetachedPrompt: runDetachedPromptMock,
});

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter",
  () => opencodeAdapterModule,
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  createRuntimeProviderModuleMock(opencodeAdapterModule),
);

const { runChatSettingsAssistant } = await import(
  "../../control-plane/web-ui-bff/src/modules/chat-settings/assistant-engine"
);

const baseStrategy: OrchestrationStrategy = {
  categoryAgentMap: {
    quick: ["explore-enterprise"],
    deep: ["hephaestus-enterprise"],
    ops: ["oracle-enterprise"],
    security: ["oracle-enterprise"],
    architecture: ["prometheus-enterprise"],
  },
  categoryModelMap: {
    quick: "",
    deep: "",
    ops: "",
    security: "",
    architecture: "",
  },
  enablePipeline: false,
  hooks: [],
  templates: [
    {
      id: "default-single",
      name: "标准单执行",
      mode: "single",
      agents: [],
      enabled: true,
      categoryDefaults: ["quick", "deep", "ops", "security", "architecture"],
    },
  ],
  judge: {
    enabled: false,
    agent: "prometheus-enterprise",
    model: "",
    promptTemplate: "judge",
    timeoutMs: 30000,
    selectionStrategy: "judge-pick",
  },
};

beforeEach(() => {
  runDetachedPromptMock.mockClear();
});

describe("chat settings assistant engine", () => {
  test("normalizes pipeline mode alias into enablePipeline and a valid template mode", async () => {
    const response = await runChatSettingsAssistant({
      strategy: baseStrategy,
      modelsConfig: {
        defaults: { model: "github-copilot:claude-opus-4.6" },
        providers: {},
        list: [],
      },
      mcpConfig: {},
      agentSummaries: [],
      skillSummaries: [],
      skillDetails: [],
      commandSummaries: [],
      commandDetails: [],
      securityBaseline: { raw: "# baseline" },
      pluginsConfig: { plugins: [] },
      allowedPluginSourcePrefixes: [],
      installablePluginSources: [],
      availableAgents: [
        "oracle-enterprise",
        "explore-enterprise",
        "hephaestus-enterprise",
        "prometheus-enterprise",
      ],
      availableModels: ["github-copilot:claude-opus-4.6"],
      history: [],
      message: "Please enable pipeline mode alias for ops only.",
      model: {
        providerId: "github-copilot",
        modelId: "claude-opus-4.6",
        route: "github-copilot:claude-opus-4.6",
      },
    });

    expect(response.configType).toBe("orchestration-strategy");
    expect(response.patch.enablePipeline).toBe(true);
    expect(
      (response.patch.templates as Array<{ mode: string; categoryDefaults?: string[] }>)?.[0]?.mode,
    ).toBe("single");
    expect(
      (response.patch.templates as Array<{ mode: string; categoryDefaults?: string[] }>)?.[0]
        ?.categoryDefaults,
    ).toEqual(["ops"]);
  });

  test("returns an admin-facing error for unsupported orchestration mode values", async () => {
    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify({
        action: "preview",
        configType: "orchestration-strategy",
        explanation: "将 ops 改成 mesh 模式。",
        patch: {
          templates: [
            {
              id: "tpl-ops-mesh",
              name: "tpl-ops-mesh",
              mode: "mesh",
              agents: ["oracle-enterprise"],
              enabled: true,
              categoryDefaults: ["ops"],
            },
          ],
        },
      }),
      sessionId: "session-2",
    });

    await expect(
      runChatSettingsAssistant({
        strategy: baseStrategy,
        modelsConfig: {
          defaults: { model: "github-copilot:claude-opus-4.6" },
          providers: {},
          list: [],
        },
        mcpConfig: {},
        agentSummaries: [],
        skillSummaries: [],
        skillDetails: [],
        commandSummaries: [],
        commandDetails: [],
        securityBaseline: { raw: "# baseline" },
        pluginsConfig: { plugins: [] },
        allowedPluginSourcePrefixes: [],
        installablePluginSources: [],
        availableAgents: [
          "oracle-enterprise",
          "explore-enterprise",
          "hephaestus-enterprise",
          "prometheus-enterprise",
        ],
        availableModels: ["github-copilot:claude-opus-4.6"],
        history: [],
        message: "Please set ops to mesh mode.",
        model: {
          providerId: "github-copilot",
          modelId: "claude-opus-4.6",
          route: "github-copilot:claude-opus-4.6",
        },
      }),
    ).rejects.toThrow("AI 返回的编排建议暂时无法直接应用");
  });

  test("returns an admin-facing error when the model reply is not valid JSON", async () => {
    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      text: "请把 ops 改成 mesh 模式，我建议使用一个新的网格模板。",
      sessionId: "session-3",
    });
    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      text: "还是建议把 ops 改成 mesh 模式，但这次我也不返回 JSON。",
      sessionId: "session-4",
    });

    await expect(
      runChatSettingsAssistant({
        strategy: baseStrategy,
        modelsConfig: {
          defaults: { model: "github-copilot:claude-opus-4.6" },
          providers: {},
          list: [],
        },
        mcpConfig: {},
        agentSummaries: [],
        skillSummaries: [],
        skillDetails: [],
        commandSummaries: [],
        commandDetails: [],
        securityBaseline: { raw: "# baseline" },
        pluginsConfig: { plugins: [] },
        allowedPluginSourcePrefixes: [],
        installablePluginSources: [],
        availableAgents: [
          "oracle-enterprise",
          "explore-enterprise",
          "hephaestus-enterprise",
          "prometheus-enterprise",
        ],
        availableModels: ["github-copilot:claude-opus-4.6"],
        history: [],
        message: "Please set ops to mesh mode.",
        model: {
          providerId: "github-copilot",
          modelId: "claude-opus-4.6",
          route: "github-copilot:claude-opus-4.6",
        },
      }),
    ).rejects.toThrow("本次回复没有形成可解析的配置结构");
  });
});
