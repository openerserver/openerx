import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatSettings from "../../control-plane/web-ui/src/pages/ChatSettings.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const apiMocks = vi.hoisted(() => ({
  getChatSettingsCurrentContext: vi.fn(),
  chatWithChatSettings: vi.fn(),
  applyChatSettingsPatch: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

const deepMermaidCode = [
  "sequenceDiagram",
  "participant Admin as 管理员",
  "participant Engine as 编排引擎",
  "Admin->>Engine: 提交任务(deep)",
].join("\n");

const opsMermaidCode = [
  "sequenceDiagram",
  "participant Admin as 管理员",
  "participant Engine as 编排引擎",
  "Admin->>Engine: 提交任务(ops)",
].join("\n");

const baseContext = {
  data: {
    configVersion: "root-version-1",
    orchestrationVersion: "orchestration-version-1",
    configVersions: {
      "orchestration-strategy": "orchestration-version-1",
      models: "models-version-1",
      mcp: "mcp-version-1",
      security: "security-version-1",
      plugins: "plugins-version-1",
      agents: {
        "oracle-enterprise": "agent-version-1",
      },
      skills: {},
      commands: {},
    },
    strategy: {
      categoryAgentMap: {
        deep: ["oracle-enterprise"],
        ops: ["explore-enterprise"],
      },
      categoryModelMap: {
        deep: "github-copilot:claude-opus-4.6",
        ops: "github-copilot:gpt-4o",
      },
      enablePipeline: true,
      hooks: [],
      templates: [
        {
          id: "tpl-deep-single",
          name: "tpl-deep-single",
          mode: "single",
          agents: ["oracle-enterprise"],
          enabled: true,
          categoryDefaults: ["deep"],
        },
        {
          id: "tpl-ops-single",
          name: "tpl-ops-single",
          mode: "single",
          agents: ["explore-enterprise"],
          enabled: true,
          categoryDefaults: ["ops"],
        },
      ],
      judge: {
        enabled: false,
        agent: "oracle-enterprise",
        model: "github-copilot:claude-opus-4.6",
        promptTemplate: "",
        timeoutMs: 30000,
        selectionStrategy: "judge-pick",
      },
    },
    categorySummaries: [
      {
        category: "quick",
        templateName: "tpl-deep-single",
        executionMode: "single",
        pipelineEnabled: true,
        judgeEnabled: false,
        judgeAgent: "oracle-enterprise",
        judgeModel: "github-copilot:claude-opus-4.6",
        primaryAgents: ["oracle-enterprise"],
        primaryModel: "未指定",
        notes: ["pipeline 已启用"],
      },
      {
        category: "deep",
        templateName: "tpl-deep-single",
        executionMode: "single",
        pipelineEnabled: true,
        judgeEnabled: false,
        judgeAgent: "oracle-enterprise",
        judgeModel: "github-copilot:claude-opus-4.6",
        primaryAgents: ["oracle-enterprise"],
        primaryModel: "github-copilot:claude-opus-4.6",
        notes: ["pipeline 已启用", "judge 未启用"],
      },
      {
        category: "ops",
        templateName: "tpl-ops-single",
        executionMode: "single",
        pipelineEnabled: true,
        judgeEnabled: false,
        judgeAgent: "oracle-enterprise",
        judgeModel: "github-copilot:claude-opus-4.6",
        primaryAgents: ["explore-enterprise"],
        primaryModel: "github-copilot:gpt-4o",
        notes: ["pipeline 已启用", "judge 未启用"],
      },
      {
        category: "security",
        templateName: "tpl-deep-single",
        executionMode: "single",
        pipelineEnabled: true,
        judgeEnabled: false,
        judgeAgent: "oracle-enterprise",
        judgeModel: "github-copilot:claude-opus-4.6",
        primaryAgents: ["oracle-enterprise"],
        primaryModel: "未指定",
        notes: ["pipeline 已启用"],
      },
      {
        category: "architecture",
        templateName: "tpl-deep-single",
        executionMode: "single",
        pipelineEnabled: true,
        judgeEnabled: false,
        judgeAgent: "oracle-enterprise",
        judgeModel: "github-copilot:claude-opus-4.6",
        primaryAgents: ["oracle-enterprise"],
        primaryModel: "未指定",
        notes: ["pipeline 已启用"],
      },
    ],
    supportedCategories: ["quick", "deep", "ops", "security", "architecture"],
    modelsConfig: {
      defaults: { model: "github-copilot:claude-opus-4.6" },
      providers: {},
      list: [{ id: "claude-opus-4.6", provider: "github-copilot", name: "Claude Opus 4.6" }],
    },
    mcpConfig: {},
    mermaidByCategory: {
      deep: deepMermaidCode,
      ops: opsMermaidCode,
      quick: "sequenceDiagram\nAdmin->>Engine: quick",
      security: "sequenceDiagram\nAdmin->>Engine: security",
      architecture: "sequenceDiagram\nAdmin->>Engine: architecture",
    },
    modelsVisualizations: [],
    agents: ["oracle-enterprise", "explore-enterprise"],
    models: ["github-copilot:claude-opus-4.6", "github-copilot:gpt-4o"],
    agentSummaries: [],
    skillSummaries: [],
    commandSummaries: [],
    securityBaseline: { raw: "# Security Baseline\n" },
    pluginsConfig: { plugins: [] },
    allowedPluginSourcePrefixes: [],
    installablePluginSources: [],
    supportedConfigTypes: ["orchestration-strategy"],
  },
};

const orchestrationPreviewPatch = {
  index: 1,
  action: "preview" as const,
  configType: "orchestration-strategy" as const,
  explanation: "将 deep 分类切换为并行执行，并启用 judge。",
  patch: {
    judge: {
      enabled: true,
    },
    templates: [
      {
        id: "tpl-deep-parallel",
        name: "tpl-deep-parallel",
        mode: "parallel",
        agents: ["oracle-enterprise", "explore-enterprise"],
        enabled: true,
        categoryDefaults: ["deep"],
      },
    ],
  },
  rawText: "{}",
  mermaidPreview: {
    deep: deepMermaidCode,
  },
  visualizations: [
    {
      kind: "mermaid" as const,
      title: "编排时序 · deep",
      content: deepMermaidCode,
    },
  ],
  configVersion: "orchestration-version-1",
  createdAt: "2026-03-13T03:01:00.000Z",
};

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.login("fake-token", {
    id: "user-admin",
    username: "admin",
    displayName: "Admin",
    role: "platform_admin",
    accountStatus: "active",
    mustChangePassword: false,
  });

  const wrapper = mount(ChatSettings, {
    global: {
      plugins: [pinia],
      stubs: {
        MermaidRenderer: {
          props: ["code"],
          template: '<div class="mermaid-renderer-stub">{{ code }}</div>',
        },
        MarkdownContent: {
          props: ["content"],
          template: '<div class="markdown-content-stub">{{ content }}</div>',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getChatSettingsCurrentContext.mockResolvedValue(baseContext);
  apiMocks.chatWithChatSettings.mockResolvedValue({
    data: {
      conversationId: "conversation-1",
      configVersion: "root-version-1",
      message: "将 deep 分类切换为并行执行，并启用 judge。",
      patch: orchestrationPreviewPatch,
    },
  });
  apiMocks.applyChatSettingsPatch.mockResolvedValue({
    data: {
      ok: true,
      configVersion: "root-version-2",
      strategy: baseContext.data.strategy,
      mermaidByCategory: baseContext.data.mermaidByCategory,
      visualizations: [],
      configVersions: {
        ...baseContext.data.configVersions,
        "orchestration-strategy": "orchestration-version-2",
      },
    },
  });
});

describe("ChatSettings", () => {
  it("shows an orchestration-first layout and updates summary when switching categories", async () => {
    const wrapper = await mountPage();
    const vm = wrapper.vm as unknown as {
      handleCategoryChange: (category: string) => void;
    };

    expect(wrapper.text()).toContain("编排策略控制台");
    expect(wrapper.text()).toContain("当前编排总览");
    expect(wrapper.text()).toContain("当前分类策略摘要");
    expect(wrapper.text()).not.toContain("当前模型路由");
    expect(wrapper.text()).toContain("tpl-deep-single");
    expect(wrapper.text()).toContain("github-copilot:claude-opus-4.6");

    vm.handleCategoryChange("ops");
    await flushPromises();

    expect(wrapper.text()).toContain("tpl-ops-single");
    expect(wrapper.text()).toContain("explore-enterprise");
    expect(wrapper.findAll(".mermaid-renderer-stub")[0]?.text()).toContain("提交任务(ops)");
  });

  it("prefills orchestration intent templates for the active category", async () => {
    const wrapper = await mountPage();
    const vm = wrapper.vm as unknown as {
      handlePrefillIntent: (templateType: string) => void;
    };

    vm.handlePrefillIntent("parallelize");
    await flushPromises();

    const composer = wrapper.find("textarea");
    expect((composer.element as HTMLTextAreaElement).value).toContain("请把 deep 分类改成并行执行");
  });

  it("renders orchestration change cards from preview", async () => {
    const wrapper = await mountPage();
    const vm = wrapper.vm as unknown as {
      draftIntent: string;
      handleSendIntent: () => Promise<void>;
    };

    vm.draftIntent = "请把 deep 分类改成并行执行，并启用 judge。";
    await vm.handleSendIntent();
    await flushPromises();

    expect(apiMocks.chatWithChatSettings).toHaveBeenCalledWith({
      conversationId: undefined,
      message: "请把 deep 分类改成并行执行，并启用 judge。",
      model: "github-copilot:claude-opus-4.6",
    });
    expect(wrapper.text()).toContain("编排变更预览");
    expect(wrapper.text()).toContain("Judge 策略变化");
    expect(wrapper.text()).toContain("deep 编排策略预览");
    expect(wrapper.text()).toContain("影响 deep");
  });

  it("applies orchestration preview and refreshes the summary", async () => {
    apiMocks.getChatSettingsCurrentContext
      .mockResolvedValueOnce(baseContext)
      .mockResolvedValueOnce({
        data: {
          ...baseContext.data,
          orchestrationVersion: "orchestration-version-2",
          categorySummaries: baseContext.data.categorySummaries.map((item: { category: string; [key: string]: unknown }) =>
            item.category === "deep"
              ? {
                  ...item,
                  templateName: "tpl-deep-parallel",
                  executionMode: "parallel",
                  judgeEnabled: true,
                }
              : item,
          ),
        },
      });

    const wrapper = await mountPage();
    const vm = wrapper.vm as unknown as {
      draftIntent: string;
      handleSendIntent: () => Promise<void>;
      applyCurrentPreview: () => Promise<void>;
    };

    vm.draftIntent = "请把 deep 分类改成并行执行，并启用 judge。";
    await vm.handleSendIntent();
    await flushPromises();
    await vm.applyCurrentPreview();
    await flushPromises();

    expect(apiMocks.applyChatSettingsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        patchIndex: 1,
        configVersion: "orchestration-version-1",
        pendingPatch: expect.objectContaining({
          index: 1,
          configType: "orchestration-strategy",
        }),
      }),
    );
    expect(wrapper.text()).toContain("tpl-deep-parallel");
    expect(wrapper.text()).toContain("parallel");
    expect(wrapper.text()).toContain("已启用");
  });

  it("offers a recommended rewrite button after an admin-facing orchestration error", async () => {
    apiMocks.chatWithChatSettings.mockRejectedValueOnce(
      new Error(
        "AI 返回的编排建议暂时无法直接应用：本次回复没有形成可解析的配置结构。请用更直接的方式描述目标，例如“只修改 ops 分类，执行模式改为 parallel，其他保持不变”。",
      ),
    );

    const wrapper = await mountPage();
    const vm = wrapper.vm as unknown as {
      draftIntent: string;
      handleSendIntent: () => Promise<void>;
    };

    vm.draftIntent = "请严格按下面要求生成编排建议：只修改 ops 分类；patch.templates[0].mode 必须等于 mesh；不要改写成 single 或 parallel；也不要开启 pipeline；不要给替代方案。";
    await vm.handleSendIntent();
    await flushPromises();

    expect(wrapper.text()).toContain("AI 返回的编排建议暂时无法直接应用");
    const rewriteButton = wrapper.findAll("button").find((item) => item.text().includes("回填推荐改写示例"));
    expect(rewriteButton).toBeTruthy();

    await rewriteButton?.trigger("click");
    await flushPromises();

    const composer = wrapper.find("textarea");
    expect((composer.element as HTMLTextAreaElement).value).toContain("请只修改 ops 分类");
    expect((composer.element as HTMLTextAreaElement).value).toContain("执行模式请明确写为 single 或 parallel");
  });
});