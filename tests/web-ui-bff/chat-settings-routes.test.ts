import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "../../control-plane/web-ui-bff/node_modules/hono";

mock.restore();

const tempRoot = mkdtempSync(join(tmpdir(), "openerx-chat-settings-"));
process.env.OPENCODE_ROOT = tempRoot;

const runChatSettingsAssistantMock = mock(async (args: { message: string; modelsConfig: Record<string, unknown>; mcpConfig: Record<string, unknown> }) => {
  if (args.message.includes("parallel") || args.message.includes("judge")) {
    return {
      action: "preview",
      configType: "orchestration-strategy",
      explanation: "将 ops 分类切换为并行执行，并启用 judge。",
      patch: {
        judge: {
          enabled: true,
        },
        templates: [
          {
            id: "tpl-ops-parallel",
            name: "tpl-ops-parallel",
            mode: "parallel",
            agents: ["oracle-enterprise"],
            enabled: true,
            categoryDefaults: ["ops"],
          },
        ],
      },
      rawText: "{}",
      mermaidPreview: {
        ops: "sequenceDiagram\nAdmin->>Engine: 提交任务(ops)",
      },
      visualizations: [],
    };
  }

  if (args.message.includes("gpt-4o")) {
    const currentModels = args.modelsConfig as {
      defaults: Record<string, unknown>;
      providers: Record<string, unknown>;
      list: Array<Record<string, unknown>>;
    };
    return {
      action: "preview",
      configType: "models",
      explanation: "新增 gpt-4o 模型，其他模型配置保持不变。",
      patch: {
        defaults: currentModels.defaults,
        providers: currentModels.providers,
        list: [...currentModels.list, { id: "gpt-4o", name: "GPT-4o", provider: "github-copilot" }],
      },
      rawText: "{}",
      mermaidPreview: {},
      visualizations: [],
    };
  }

  if (args.message.includes("oracle-enterprise")) {
    return {
      action: "preview",
      configType: "agents",
      explanation: "仅更新 oracle-enterprise 的 description 字段。",
      patch: {
        name: "oracle-enterprise",
        frontmatterPatch: {
          description:
            "Responsible for operations troubleshooting, system inspection, deployment diagnostics, and recovery guidance.",
        },
      },
      rawText: "{}",
      mermaidPreview: {},
      visualizations: [],
    };
  }

  if (args.message.includes("start-work")) {
    return {
      action: "preview",
      configType: "commands",
      explanation: "更新 start-work 命令描述，保留现有命令流程。",
      patch: {
        name: "start-work",
        frontmatterPatch: {
          description: "Start a new work task with planning, validation, and execution orchestration",
        },
      },
      rawText: "{}",
      mermaidPreview: {},
      visualizations: [],
    };
  }

  if (args.message.includes("handoff plugin")) {
    return {
      action: "preview",
      configType: "plugins",
      explanation: "禁用 handoff plugin，保留其他插件状态不变。",
      patch: {
        plugins: [
          {
            path: "./.opencode/plugins/handoff.ts",
            name: "handoff",
            enabled: false,
          },
          {
            path: "./.opencode/plugins/logger.ts",
            name: "logger",
            enabled: true,
          },
        ],
      },
      rawText: "{}",
      mermaidPreview: {},
      visualizations: [],
    };
  }

  if (args.message.includes("install skills-plugin")) {
    return {
      action: "preview",
      configType: "plugins",
      explanation: "安装 skills-plugin，并保持其他插件注册状态不变。",
      patch: {
        operation: "install",
        source: "./.opencode/plugins/skills-plugin.ts",
      },
      rawText: "{}",
      mermaidPreview: {},
      visualizations: [],
    };
  }

  if (args.message.includes("uninstall logger plugin")) {
    return {
      action: "preview",
      configType: "plugins",
      explanation: "卸载 logger plugin，并保持其他插件状态不变。",
      patch: {
        operation: "uninstall",
        name: "logger",
      },
      rawText: "{}",
      mermaidPreview: {},
      visualizations: [],
    };
  }

  const currentMcp = args.mcpConfig as Record<string, unknown>;
  return {
    action: "preview",
    configType: "mcp",
    explanation: "新增 demo-memory MCP server，保持其余 MCP 配置不变。",
    patch: {
      ...currentMcp,
      "demo-memory": {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
        description: "Demo memory MCP for validation",
      },
    },
    rawText: "{}",
    mermaidPreview: {},
    visualizations: [],
  };
});

mock.module("../../control-plane/web-ui-bff/src/modules/chat-settings/assistant-engine", () => ({
  runChatSettingsAssistant: runChatSettingsAssistantMock,
}));

async function createApp() {
  const { chatSettingsRoutes } = await import(
    "../../control-plane/web-ui-bff/src/modules/chat-settings/routes?chat-settings-routes-test"
  );
  const app = new Hono();
  app.use("/api/*", async (c, next) => {
    c.set("user", {
      sub: "user-admin",
      org: "org-default",
      role: "platform_admin",
      projects: [{ id: "proj-default", role: "project_admin" }],
      tv: 0,
    });
    await next();
  });
  app.route("/api/chat-settings", chatSettingsRoutes);
  return app;
}

function seedOpencodeRoot() {
  mkdirSync(join(tempRoot, ".opencode", "agents"), { recursive: true });
  mkdirSync(join(tempRoot, ".opencode", "commands"), { recursive: true });
  mkdirSync(join(tempRoot, ".opencode", "plugins"), { recursive: true });
  mkdirSync(join(tempRoot, ".opencode", "state"), { recursive: true });

  writeFileSync(
    join(tempRoot, "opencode.json"),
    `${JSON.stringify(
      {
        model: "github-copilot/claude-opus-4.6",
        agents: {
          defaults: {
            model: "github-copilot:claude-opus-4.6",
            provider: "github-copilot",
          },
        },
        models: {
          providers: {
            "github-copilot": {
              api: "github-copilot",
              name: "GitHub Copilot",
            },
          },
          list: [{ id: "claude-opus-4.6", name: "Claude Opus 4.6", provider: "github-copilot" }],
        },
        mcp: {
          exa: {
            type: "local",
            command: ["npx", "-y", "@anthropic-ai/exa-mcp-server"],
            environment: { EXA_API_KEY: "${EXA_API_KEY}" },
          },
          context7: {
            type: "local",
            command: ["npx", "-y", "@anthropic-ai/context7-mcp-server"],
          },
          "grep-app": {
            type: "local",
            command: ["npx", "-y", "@anthropic-ai/grep-app-mcp-server"],
          },
        },
        plugin: ["./.opencode/plugins/handoff.ts", "./.opencode/plugins/logger.ts"],
      },
      null,
      2,
    )}\n`,
  );

  for (const agentName of ["oracle-enterprise", "explore-enterprise", "hephaestus-enterprise", "prometheus-enterprise"]) {
    writeFileSync(
      join(tempRoot, ".opencode", "agents", `${agentName}.md`),
      [
        "---",
        `name: ${agentName}`,
        `description: Seeded ${agentName} description`,
        "model: github-copilot:claude-opus-4.6",
        "---",
        "",
        `Seeded ${agentName} body.`,
        "",
      ].join("\n"),
    );
  }

  writeFileSync(
    join(tempRoot, ".opencode", "commands", "start-work.md"),
    [
      "---",
      'description: "Start a new work task with full orchestration pipeline: planning → audit → validation → execution"',
      "---",
      "",
      "# /start-work",
      "",
      "Original start-work command body.",
      "",
    ].join("\n"),
  );

  writeFileSync(join(tempRoot, ".opencode", "plugins", "handoff.ts"), "export const name = 'handoff';\n");
  writeFileSync(join(tempRoot, ".opencode", "plugins", "logger.ts"), "export const name = 'logger';\n");
  writeFileSync(join(tempRoot, ".opencode", "plugins", "skills-plugin.ts"), "export const name = 'skills-plugin';\n");

  writeFileSync(
    join(tempRoot, ".opencode", "state", "orchestration-strategy.json"),
    `${JSON.stringify(
      {
        categoryAgentMap: { ops: ["oracle-enterprise"] },
        categoryModelMap: { ops: "github-copilot:claude-opus-4.6" },
        enablePipeline: true,
        hooks: [],
        templates: [],
        judge: {
          enabled: false,
          agent: "oracle-enterprise",
          model: "github-copilot:claude-opus-4.6",
          promptTemplate: "",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

async function createPreview(app: Hono, message: string) {
  const response = await app.request("/api/chat-settings/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model: "github-copilot:claude-opus-4.6",
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    data: {
      conversationId: string;
      patch: { index: number; configType: string; configVersion: string };
    };
  };
}

async function applyPreview(
  app: Hono,
  preview: { data: { conversationId: string; patch: { index: number; configVersion: string } } },
  options?: { conversationId?: string; includePendingPatch?: boolean },
) {
  const response = await app.request("/api/chat-settings/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: options?.conversationId || preview.data.conversationId,
      patchIndex: preview.data.patch.index,
      configVersion: preview.data.patch.configVersion,
      pendingPatch: options?.includePendingPatch ? preview.data.patch : undefined,
    }),
  });
  return response;
}

beforeEach(() => {
  runChatSettingsAssistantMock.mockClear();
  seedOpencodeRoot();
});

afterAll(() => {
  if (existsSync(tempRoot)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("chat settings routes", () => {
  test("returns orchestration structured summaries and preview details", async () => {
    const app = await createApp();

    const currentContextResponse = await app.request("/api/chat-settings/current-context");
    expect(currentContextResponse.status).toBe(200);
    const currentContextPayload = (await currentContextResponse.json()) as {
      data: {
        orchestrationVersion: string;
        categorySummaries: Array<{ category: string; templateName: string }>;
        supportedCategories: string[];
      };
    };

    expect(currentContextPayload.data.orchestrationVersion.length).toBeGreaterThan(0);
    expect(currentContextPayload.data.categorySummaries.some((item) => item.category === "ops")).toBe(true);
    expect(currentContextPayload.data.supportedCategories).toEqual(["quick", "deep", "ops", "security", "architecture"]);

    const chatResponse = await app.request("/api/chat-settings/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Please switch ops to parallel and enable judge.",
        model: "github-copilot:claude-opus-4.6",
      }),
    });
    expect(chatResponse.status).toBe(200);
    const chatPayload = (await chatResponse.json()) as {
      data: {
        conversationId: string;
        patch: {
          index: number;
          configVersion: string;
          configType: string;
          orchestrationPreview: {
            affectedCategories: string[];
            judgeChange: { changed: boolean; afterEnabled: boolean };
            templateChanges: Array<{ category: string; afterMode: string }>;
            strategySummaryAfter: Array<{ category: string; executionMode: string; judgeEnabled: boolean }>;
            riskHints: Array<{ level: string }>;
          };
        };
      };
    };

    expect(chatPayload.data.patch.configType).toBe("orchestration-strategy");
    expect(chatPayload.data.patch.orchestrationPreview.affectedCategories).toEqual(["ops"]);
    expect(chatPayload.data.patch.orchestrationPreview.judgeChange).toMatchObject({ changed: true, afterEnabled: true });
    expect(chatPayload.data.patch.orchestrationPreview.templateChanges[0]).toMatchObject({ category: "ops", afterMode: "parallel" });
    expect(chatPayload.data.patch.orchestrationPreview.strategySummaryAfter[0]?.category.length).toBeGreaterThan(0);
    expect(chatPayload.data.patch.orchestrationPreview.riskHints.some((item) => item.level === "high")).toBe(true);

    const applyResponse = await applyPreview(app, {
      data: {
        conversationId: chatPayload.data.conversationId,
        patch: {
          index: chatPayload.data.patch.index,
          configVersion: chatPayload.data.patch.configVersion,
        },
      },
    });
    expect(applyResponse.status).toBe(200);

    const applyPayload = (await applyResponse.json()) as {
      data: {
        orchestrationVersion: string;
        categorySummaries: Array<{ category: string; judgeEnabled: boolean }>;
      };
    };
    expect(applyPayload.data.orchestrationVersion.length).toBeGreaterThan(0);
    expect(applyPayload.data.categorySummaries.some((item) => item.category === "ops")).toBe(true);
  });

  test("applies a models patch through chat and apply routes", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please add github-copilot model gpt-4o.");

    expect(preview.data.patch.configType).toBe("models");

    const applyResponse = await applyPreview(app, preview);
    expect(applyResponse.status).toBe(200);

    const config = readJson(join(tempRoot, "opencode.json"));
    const models = ((config.models as Record<string, unknown>).list as Array<Record<string, unknown>>) || [];
    expect(models.some((item) => item.id === "gpt-4o" && item.provider === "github-copilot")).toBe(true);
  });

  test("applies a preview by signed fallback patch when in-memory pending state is missing", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please switch ops to parallel and enable judge.");

    const applyResponse = await applyPreview(app, preview, {
      conversationId: "missing-conversation-after-restart",
      includePendingPatch: true,
    });

    expect(applyResponse.status).toBe(200);

    const applyPayload = (await applyResponse.json()) as {
      data: {
        orchestrationVersion: string;
        categorySummaries: Array<{ category: string; executionMode: string }>;
      };
    };
    expect(applyPayload.data.orchestrationVersion.length).toBeGreaterThan(0);
    expect(applyPayload.data.categorySummaries.some((item) => item.category === "ops")).toBe(true);
  });

  test("applies an agent description patch through chat and apply routes", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please update oracle-enterprise description.");

    expect(preview.data.patch.configType).toBe("agents");

    const applyResponse = await applyPreview(app, preview);
    expect(applyResponse.status).toBe(200);

    const agentFile = readFileSync(join(tempRoot, ".opencode", "agents", "oracle-enterprise.md"), "utf-8");
    expect(agentFile).toContain("description: Responsible for operations troubleshooting");
    expect(agentFile).toContain("deployment diagnostics, and recovery guidance.");
  });

  test("applies an MCP patch that uses command arrays", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please add demo-memory MCP server.");

    expect(preview.data.patch.configType).toBe("mcp");

    const applyResponse = await applyPreview(app, preview);
    expect(applyResponse.status).toBe(200);

    const payload = (await applyResponse.json()) as { data: { configVersions: { mcp: string } } };
    expect(payload.data.configVersions.mcp.length).toBeGreaterThan(0);

    const config = readJson(join(tempRoot, "opencode.json"));
    const mcp = (config.mcp as Record<string, Record<string, unknown>>) || {};
    expect(mcp["demo-memory"]).toEqual({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
      description: "Demo memory MCP for validation",
    });
    expect(mcp.exa?.environment).toEqual({ EXA_API_KEY: "${EXA_API_KEY}" });
  });

  test("applies a command patch through chat and apply routes", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please update start-work command description.");

    expect(preview.data.patch.configType).toBe("commands");

    const applyResponse = await applyPreview(app, preview);
    expect(applyResponse.status).toBe(200);

    const commandFile = readFileSync(join(tempRoot, ".opencode", "commands", "start-work.md"), "utf-8");
    expect(commandFile).toContain("planning, validation, and execution orchestration");
    expect(commandFile).toContain("Original start-work command body.");
  });

  test("applies a plugin enable-disable patch through chat and apply routes", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please disable handoff plugin only.");

    expect(preview.data.patch.configType).toBe("plugins");

    const applyResponse = await applyPreview(app, preview);
    expect(applyResponse.status).toBe(200);

    const config = readJson(join(tempRoot, "opencode.json"));
    expect(config.plugin).toEqual(["./.opencode/plugins/logger.ts"]);
    expect(config._disabledPlugins).toEqual(["./.opencode/plugins/handoff.ts"]);
  });

  test("applies a plugin install patch through chat and apply routes with restricted sources", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please install skills-plugin only.");

    expect(preview.data.patch.configType).toBe("plugins");

    const applyResponse = await applyPreview(app, preview);
    expect(applyResponse.status).toBe(200);

    const config = readJson(join(tempRoot, "opencode.json"));
    expect(config.plugin).toEqual([
      "./.opencode/plugins/handoff.ts",
      "./.opencode/plugins/logger.ts",
      "./.opencode/plugins/skills-plugin.ts",
    ]);
  });

  test("applies a plugin uninstall patch through chat and apply routes", async () => {
    const app = await createApp();
    const preview = await createPreview(app, "Please uninstall logger plugin.");

    expect(preview.data.patch.configType).toBe("plugins");

    const applyResponse = await applyPreview(app, preview);
    expect(applyResponse.status).toBe(200);

    const config = readJson(join(tempRoot, "opencode.json"));
    expect(config.plugin).toEqual(["./.opencode/plugins/handoff.ts"]);
  });
});