import { type Page, type Route, expect, test } from "@playwright/test";

type ChatSettingsContext = {
  data: {
    configVersion: string;
    orchestrationVersion: string;
    configVersions: {
      "orchestration-strategy": string;
      models: string;
      mcp: string;
      security: string;
      plugins: string;
      agents: Record<string, string>;
      skills: Record<string, string>;
      commands: Record<string, string>;
    };
    strategy: Record<string, unknown>;
    categorySummaries: Array<Record<string, unknown>>;
    supportedCategories: string[];
    modelsConfig: {
      defaults: Record<string, unknown>;
      providers: Record<string, unknown>;
      list: Array<Record<string, unknown>>;
    };
    mcpConfig: Record<string, unknown>;
    mermaidByCategory: Record<string, string>;
    modelsVisualizations: Array<{ kind: "mermaid" | "json"; title: string; content: string }>;
    agents: string[];
    models: string[];
    agentSummaries: Array<Record<string, unknown>>;
    skillSummaries: Array<Record<string, unknown>>;
    commandSummaries: Array<Record<string, unknown>>;
    securityBaseline: { raw: string };
    pluginsConfig: { plugins: Array<Record<string, unknown>> };
    allowedPluginSourcePrefixes: string[];
    installablePluginSources: Array<Record<string, unknown>>;
    supportedConfigTypes: string[];
  };
};

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

function buildContext(): ChatSettingsContext {
  return {
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
          ops: ["oracle-enterprise"],
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
            agents: ["oracle-enterprise"],
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
          primaryAgents: ["oracle-enterprise"],
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
        defaults: {
          model: "github-copilot:claude-opus-4.6",
          provider: "github-copilot",
        },
        providers: {
          "github-copilot": {
            api: "github-copilot",
            name: "GitHub Copilot",
          },
        },
        list: [
          {
            id: "claude-opus-4.6",
            name: "Claude Opus 4.6",
            provider: "github-copilot",
          },
          {
            id: "gpt-4o",
            name: "GPT-4o",
            provider: "github-copilot",
          },
        ],
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
      agents: ["oracle-enterprise"],
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
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function installApiMocks(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/chat-settings/history")) {
      await fulfillJson(route, { data: [] });
      return;
    }

    await fulfillJson(route, {});
  });

  const currentContext = buildContext();
  const previewPatch = {
    index: 0,
    action: "preview",
    configType: "orchestration-strategy",
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
          agents: ["oracle-enterprise"],
          enabled: true,
          categoryDefaults: ["deep"],
        },
      ],
    },
    rawText: "{}",
    mermaidPreview: {
      deep: deepMermaidCode,
    },
    visualizations: [],
    orchestrationPreview: {
      configVersion: "orchestration-version-1",
      explanation: "将 deep 分类切换为并行执行，并启用 judge。",
      affectedCategories: ["deep"],
      changeCards: [
        {
          id: "judge-change",
          category: "deep",
          changeType: "judge",
          title: "Judge 策略变化",
          summary: "关闭 -> 启用",
          beforeLabel: "oracle-enterprise / github-copilot:claude-opus-4.6",
          afterLabel: "oracle-enterprise / github-copilot:claude-opus-4.6",
          riskLevel: "high",
          affectsJudge: true,
          affectsTemplate: false,
        },
        {
          id: "category-deep",
          category: "deep",
          changeType: "template",
          title: "deep 编排策略预览",
          summary: "single -> parallel，模板 tpl-deep-single -> tpl-deep-parallel",
          beforeLabel: "tpl-deep-single / single",
          afterLabel: "tpl-deep-parallel / parallel",
          riskLevel: "medium",
          affectsJudge: true,
          affectsTemplate: true,
          mermaidCode: deepMermaidCode,
        },
      ],
      judgeChange: {
        changed: true,
        beforeEnabled: false,
        afterEnabled: true,
        beforeAgent: "oracle-enterprise",
        afterAgent: "oracle-enterprise",
        beforeModel: "github-copilot:claude-opus-4.6",
        afterModel: "github-copilot:claude-opus-4.6",
      },
      templateChanges: [
        {
          category: "deep",
          beforeTemplate: "tpl-deep-single",
          afterTemplate: "tpl-deep-parallel",
          beforeMode: "single",
          afterMode: "parallel",
        },
      ],
      strategySummaryBefore: currentContext.data.categorySummaries,
      strategySummaryAfter: currentContext.data.categorySummaries.map((item) =>
        item.category === "deep"
          ? {
              ...item,
              templateName: "tpl-deep-parallel",
              executionMode: "parallel",
              judgeEnabled: true,
            }
          : item,
      ),
      riskHints: [
        {
          level: "high",
          summary: "本次变更会启用 judge，执行路径与最终候选选择逻辑会发生变化。",
        },
      ],
      mermaidPreview: {
        deep: deepMermaidCode,
      },
      rawPatch: {},
    },
    configVersion: "orchestration-version-1",
    createdAt: "2026-03-13T03:30:00.000Z",
  };

  await page.route("**/api/auth/login", async (route) => {
    await fulfillJson(route, {
      token: "playwright-admin-token",
      user: {
        id: "user-admin",
        username: "admin",
        displayName: "Admin",
        email: null,
        role: "platform_admin",
        accountStatus: "active",
        mustChangePassword: false,
        lastLoginAt: "2026-03-13T03:00:00.000Z",
        createdAt: "2026-03-09T00:00:00.000Z",
        projects: [{ id: "proj-default", role: "project_admin" }],
      },
    });
  });

  await page.route("**/api/auth/me", async (route) => {
    await fulfillJson(route, {
      id: "user-admin",
      username: "admin",
      displayName: "Admin",
      email: null,
      role: "platform_admin",
      accountStatus: "active",
      mustChangePassword: false,
      lastLoginAt: "2026-03-13T03:00:00.000Z",
      createdAt: "2026-03-09T00:00:00.000Z",
      projects: [
        {
          id: "proj-default",
          role: "project_admin",
          name: "Default Project",
          slug: "default",
        },
      ],
    });
  });

  await page.route("**/api/projects", async (route) => {
    await fulfillJson(route, [
      {
        id: "proj-default",
        orgId: "org-default",
        name: "Default Project",
        slug: "default",
      },
    ]);
  });

  await page.route("**/api/approvals?status=pending", async (route) => {
    await fulfillJson(route, []);
  });

  await page.route("**/api/chat-settings/current-context", async (route) => {
    await fulfillJson(route, currentContext);
  });

  await page.route("**/api/chat-settings/chat", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as { message?: string };
    if (payload.message?.includes("patch.templates[0].mode 必须等于 mesh")) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "AI 返回的编排建议暂时无法直接应用：本次回复没有形成可解析的配置结构。请用更直接的方式描述目标，例如“只修改 ops 分类，执行模式改为 parallel，其他保持不变”。",
        }),
      });
      return;
    }

    await fulfillJson(route, {
      data: {
        conversationId: "conversation-1",
        configVersion: currentContext.data.configVersion,
        message: previewPatch.explanation,
        patch: previewPatch,
      },
    });
  });

  await page.route("**/api/chat-settings/apply", async (route) => {
    currentContext.data.configVersion = "root-version-2";
    currentContext.data.orchestrationVersion = "orchestration-version-2";
    currentContext.data.configVersions["orchestration-strategy"] = "orchestration-version-2";
    currentContext.data.categorySummaries = currentContext.data.categorySummaries.map((item) =>
      item.category === "deep"
        ? {
            ...item,
            templateName: "tpl-deep-parallel",
            executionMode: "parallel",
            judgeEnabled: true,
          }
        : item,
    );

    await fulfillJson(route, {
      data: {
        ok: true,
        configVersion: currentContext.data.configVersion,
        orchestrationVersion: currentContext.data.orchestrationVersion,
        strategy: currentContext.data.strategy,
        categorySummaries: currentContext.data.categorySummaries,
        mermaidByCategory: currentContext.data.mermaidByCategory,
        visualizations: [],
        configVersions: currentContext.data.configVersions,
      },
    });
  });
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Opener-X" })).toBeVisible();
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123!");

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/auth/me") && response.ok()),
    page.getByRole("button", { name: /^登\s*录$/ }).click(),
  ]);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function openChatSettings(page: Page) {
  const menuItem = page.locator(".ant-menu-item").filter({ hasText: "对话配置" }).first();
  await expect(menuItem).toBeVisible();

  await Promise.all([page.waitForURL(/\/chat-settings$/), menuItem.click()]);
  await expect(page.getByRole("heading", { name: "编排策略控制台" })).toBeVisible();
}

test.describe("Chat Settings admin browser flow", () => {
  test("admin can login, navigate, and inspect orchestration strategy by category", async ({
    page,
  }) => {
    await installApiMocks(page);

    await loginAsAdmin(page);
    await openChatSettings(page);
    await expect(page.getByText("tpl-deep-single").first()).toBeVisible();

    await page.getByRole("tab", { name: "ops" }).click();

    await expect(page.getByText("tpl-ops-single").first()).toBeVisible();
    await expect(page.getByText("github-copilot:gpt-4o").first()).toBeVisible();
  });

  test("admin can preview an orchestration change with before after diff and risk hints", async ({
    page,
  }) => {
    await installApiMocks(page);

    await loginAsAdmin(page);
    await openChatSettings(page);

    await page
      .getByPlaceholder(/例如：请把 deep 分类改成并行执行，并启用 judge。/)
      .fill("请把 deep 分类改成并行执行，并启用 judge。");
    await page.getByRole("button", { name: "生成预览" }).click();

    await expect(page.getByText("编排变更预览")).toBeVisible();
    await expect(page.getByText(/HIGH/).first()).toBeVisible();
    await expect(page.getByText("tpl-deep-single -> tpl-deep-parallel").first()).toBeVisible();
    await expect(page.getByText("single -> parallel").first()).toBeVisible();
  });

  test("admin can apply an orchestration change and see refreshed summary", async ({ page }) => {
    await installApiMocks(page);

    await loginAsAdmin(page);
    await openChatSettings(page);

    await page
      .getByPlaceholder(/例如：请把 deep 分类改成并行执行，并启用 judge。/)
      .fill("请把 deep 分类改成并行执行，并启用 judge。");
    await page.getByRole("button", { name: "生成预览" }).click();

    await page.getByRole("button", { name: "应用编排变更" }).click();

    await expect(page.getByText("编排策略已应用")).toBeVisible();
    await expect(page.getByText("编排版本 orchestration-version-2")).toBeVisible();
    await expect(page.getByText("tpl-deep-parallel").first()).toBeVisible();
    await expect(page.getByText("parallel").first()).toBeVisible();
    await expect(page.getByText("已启用").first()).toBeVisible();
  });

  test("admin sees an orchestration error hint and can refill the recommended rewrite", async ({
    page,
  }) => {
    await installApiMocks(page);

    await loginAsAdmin(page);
    await openChatSettings(page);

    await page
      .getByPlaceholder(/例如：请把 deep 分类改成并行执行，并启用 judge。/)
      .fill(
        "请严格按下面要求生成编排建议：只修改 ops 分类；patch.templates[0].mode 必须等于 mesh；不要改写成 single 或 parallel；也不要开启 pipeline；不要给替代方案。",
      );
    await page.getByRole("button", { name: "生成预览" }).click();

    await expect(
      page
        .locator(".ant-alert")
        .filter({ hasText: /AI 返回的编排建议暂时无法直接应用/ })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "回填推荐改写示例" })).toBeVisible();

    await page.getByRole("button", { name: "回填推荐改写示例" }).click();

    await expect(
      page.getByPlaceholder(/例如：请把 deep 分类改成并行执行，并启用 judge。/),
    ).toHaveValue(
      /请只修改 ops 分类，并保持其他分类不变。执行模式请明确写为 single 或 parallel；如果需要 pipeline，请单独说明开启或关闭 pipeline。请返回可直接应用的 orchestration-strategy patch。/,
    );
  });
});
