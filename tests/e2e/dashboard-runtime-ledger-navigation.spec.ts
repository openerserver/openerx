import { expect, test, type Page, type Route } from "@playwright/test";

function buildTask(taskId: string) {
  return {
    id: taskId,
    projectId: "proj-alpha-api",
    userId: "user-admin",
    title: "核心平台故障回放",
    prompt: "请定位并处理核心平台执行抖动",
    status: "running",
    sessionId: "session-alpha-1",
    selectedModel: "github-copilot:gpt-5.4",
    createdAt: "2026-03-17T08:00:00.000Z",
    startedAt: "2026-03-17T08:02:00.000Z",
  };
}

const runtimeLedgerResponse = {
  projectId: "proj-alpha-api",
  totals: {
    ledgerCount: 1,
    requestCount: 4,
    stepCount: 4,
    inputTokens: 320,
    outputTokens: 160,
    totalTokens: 480,
    costUsd: 0.48,
  },
  items: [
    {
      id: "ledger-alpha-1",
      projectId: "proj-alpha-api",
      taskId: "task-alpha-1",
      agentRunId: "run-alpha-1",
      runtimeSessionId: "session-alpha-1",
      executionSource: "review-runtime",
      entrypointType: "parallel-candidate",
      orchestrationFingerprint: "fp-alpha-1",
      defaultProviderId: "github-copilot",
      defaultModelId: "gpt-5.4",
      requestCount: 4,
      stepCount: 4,
      inputTokens: 320,
      outputTokens: 160,
      totalTokens: 480,
      costUsd: 0.48,
      candidateCount: 2,
      judgeRequestCount: 1,
      hookRequestCount: 0,
      status: "completed",
      startedAt: "2026-03-17T08:02:00.000Z",
      finishedAt: "2026-03-17T08:04:00.000Z",
      syncedAt: "2026-03-17T08:04:00.000Z",
      createdAt: "2026-03-17T08:02:00.000Z",
      updatedAt: "2026-03-17T08:04:00.000Z",
    },
  ],
};

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function installDashboardToTaskDetailMocks(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/changes/")) {
      await fulfillJson(route, { data: [] });
      return;
    }
    if (url.endsWith("/changes")) {
      await fulfillJson(route, { data: [] });
      return;
    }
    if (url.endsWith("/boss-decisions") || url.endsWith("/escalations")) {
      await fulfillJson(route, { data: [] });
      return;
    }
    if (url.endsWith("/operating-mode")) {
      await fulfillJson(route, { data: null });
      return;
    }
    if (url.endsWith("/operating-state")) {
      await fulfillJson(route, {});
      return;
    }
    if (url.endsWith("/role-conclusions") || url.endsWith("/developer-change-requests")) {
      await fulfillJson(route, { data: [] });
      return;
    }

    await fulfillJson(route, {});
  });

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
        lastLoginAt: "2026-03-17T08:00:00.000Z",
        createdAt: "2026-03-01T00:00:00.000Z",
        projects: [
          {
            id: "proj-alpha-api",
            role: "project_admin",
            name: "Alpha API",
            slug: "alpha-api",
          },
          {
            id: "proj-alpha-web",
            role: "project_admin",
            name: "Alpha Web",
            slug: "alpha-web",
          },
        ],
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
      lastLoginAt: "2026-03-17T08:00:00.000Z",
      createdAt: "2026-03-01T00:00:00.000Z",
      projects: [
        {
          id: "proj-alpha-api",
          role: "project_admin",
          name: "Alpha API",
          slug: "alpha-api",
        },
        {
          id: "proj-alpha-web",
          role: "project_admin",
          name: "Alpha Web",
          slug: "alpha-web",
        },
      ],
    });
  });

  await page.route("**/api/projects", async (route) => {
    await fulfillJson(route, [
      {
        id: "proj-alpha-api",
        orgId: "org-default",
        name: "Alpha API",
        slug: "alpha-api",
        settings: {
          projectGroupKey: "core-platform",
          projectGroupLabel: "核心平台",
        },
      },
      {
        id: "proj-alpha-web",
        orgId: "org-default",
        name: "Alpha Web",
        slug: "alpha-web",
        settings: {
          projectGroupKey: "core-platform",
          projectGroupLabel: "核心平台",
        },
      },
    ]);
  });

  await page.route("**/api/orgs", async (route) => {
    await fulfillJson(route, [
      {
        id: "org-default",
        name: "Default Org",
        slug: "default",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
  });

  await page.route("**/api/approvals?status=pending", async (route) => {
    await fulfillJson(route, []);
  });

  await page.route("**/api/dashboard/provider-tokens**", async (route) => {
    await fulfillJson(route, {
      projectId: "proj-alpha-api",
      range: "24h",
      generatedAt: "2026-03-17T08:05:00.000Z",
      summary: {
        range: "24h",
        totalTokens: 0,
        requestCount: 0,
        totalRuns: 0,
        completedRuns: 0,
        topProviderId: null,
        topProviderShare: 0,
        avgTokensPerCompletedRun: 0,
        riskProviderCount: 0,
        monthlyTotals: [],
      },
      providers: [],
    });
  });

  await page.route("**/api/projects/proj-alpha-api/runtime-usage-ledgers**", async (route) => {
    await fulfillJson(route, runtimeLedgerResponse);
  });

  await page.route("**/api/projects/proj-alpha-web/runtime-usage-ledgers**", async (route) => {
    await fulfillJson(route, {
      projectId: "proj-alpha-web",
      totals: {
        ledgerCount: 0,
        requestCount: 0,
        stepCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      items: [],
    });
  });

  await page.route("**/api/tasks/task-alpha-1", async (route) => {
    await fulfillJson(route, buildTask("task-alpha-1"));
  });

  await page.route("**/api/tasks/task-alpha-1/sessions", async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: "session-alpha-1",
          title: "核心平台故障回放",
          isActive: true,
          summary: null,
          createdAt: "2026-03-17T08:02:00.000Z",
          updatedAt: "2026-03-17T08:04:00.000Z",
        },
      ],
    });
  });

  await page.route("**/api/tasks/task-alpha-1/session-tree", async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: "node-alpha-1",
          runtimeSessionId: "session-alpha-1",
          parentRuntimeSessionId: null,
          forkedFromMessageId: null,
          forkedFromMessageRole: null,
          forkedFromMessagePreview: null,
          firstPromptAfterFork: null,
          branchName: "main",
          sourceType: "root",
          isActive: true,
          title: "核心平台故障回放",
          summary: null,
          createdAt: "2026-03-17T08:02:00.000Z",
          updatedAt: "2026-03-17T08:04:00.000Z",
          children: [],
        },
      ],
    });
  });

  await page.route("**/api/tasks/task-alpha-1/sessions/session-alpha-1/messages", async (route) => {
    await fulfillJson(route, {
      data: [
        {
          info: {
            id: "msg-user-1",
            role: "user",
            time: { created: "2026-03-17T08:02:00.000Z" },
          },
          parts: [{ type: "text", text: "请继续排查核心平台执行抖动" }],
        },
        {
          info: {
            id: "msg-assistant-1",
            role: "assistant",
            agent: "oracle-enterprise",
            time: {
              created: "2026-03-17T08:03:00.000Z",
              completed: "2026-03-17T08:04:00.000Z",
            },
          },
          parts: [{ type: "text", text: "已定位到账本批次并完成风险归因。" }],
        },
      ],
    });
  });

  await page.route("**/api/tasks/task-alpha-1/pipeline**", async (route) => {
    await fulfillJson(route, {
      taskId: "task-alpha-1",
      sessionId: "session-alpha-1",
      branchName: "main",
      status: "completed",
      createdAt: "2026-03-17T08:02:00.000Z",
      updatedAt: "2026-03-17T08:04:00.000Z",
      stages: [
        {
          id: "stage-alpha-1",
          type: "execution",
          label: "排查抖动来源",
          status: "completed",
          order: 1,
          sourceType: "session.message",
          sourceId: null,
          agent: null,
          model: null,
          sessionId: "session-alpha-1",
          startedAt: "2026-03-17T08:02:00.000Z",
          finishedAt: "2026-03-17T08:04:00.000Z",
          durationMs: 120000,
          output: null,
          error: null,
          tokens: { input: 320, output: 160 },
          graphNodeId: null,
          dependsOn: [],
        },
      ],
      summary: {
        totalStages: 1,
        completedStages: 1,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 320, output: 160 },
        totalDurationMs: 120000,
        replanCount: 0,
      },
    });
  });

  await page.route("**/api/tasks/task-alpha-1/governance", async (route) => {
    await fulfillJson(route, {
      overallRisk: "low",
      violations: [],
      approvalRequired: false,
    });
  });

  await page.route("**/api/tasks/task-alpha-1/workflow-view", async (route) => {
    await fulfillJson(route, {
      taskId: "task-alpha-1",
      workflow: {
        templateId: null,
        currentStage: "execution",
        status: "running",
        stages: [],
      },
      roleConclusions: [],
      developerChangeRequests: [],
    });
  });

  await page.route("**/api/projects/proj-alpha-api/role-execution-view", async (route) => {
    await fulfillJson(route, {
      project: {
        id: "proj-alpha-api",
        name: "Alpha API",
        slug: "alpha-api",
      },
      summary: {
        totalRoles: 0,
        customizedRoles: 0,
        takeoverRoles: 0,
        riskyRoles: 0,
      },
      rows: [],
      access: {
        overrideReadable: true,
        fallbackToSystemDefaults: true,
        message: null,
      },
    });
  });

  await page.route("**/api/config/models/list", async (route) => {
    await fulfillJson(route, {
      data: [
        {
          id: "github-copilot:gpt-5.4",
          name: "GPT-5.4",
          provider: "github-copilot",
        },
      ],
    });
  });
}

test("dashboard runtime governance opens task detail with focused runtime ledger", async ({ page }) => {
  await installDashboardToTaskDetailMocks(page);
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123!");
  await page.getByRole("button", { name: /^登\s*录$/ }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("核心平台").first()).toBeVisible();
  await expect(page.getByText("session-alpha-1").first()).toBeVisible();

  await page.getByTestId("open-runtime-ledger-task-task-alpha-1").click();

  await expect(page).toHaveURL(/\/tasks\/task-alpha-1/);
  await expect(page).toHaveURL(/session=session-alpha-1/);
  await expect(page).toHaveURL(/runtimeLedger=ledger-alpha-1/);
  await expect(page.getByText("核心平台故障回放").first()).toBeVisible();
  await page.getByRole("button", { name: /治理评估/ }).click();
  await expect(page.getByText("Runtime 账本成本摘要")).toBeVisible();
  await expect(page.getByText("定位账本").first()).toBeVisible();
  await expect(page.getByText("session-alpha-1 · $0.4800").first()).toBeVisible();
  await expect(page.getByText("review-runtime / parallel-candidate")).toBeVisible();
});