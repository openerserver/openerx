import { expect, test, type Page, type Route } from "@playwright/test";

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function buildAuthUser() {
  return {
    id: "user-admin",
    username: "admin",
    displayName: "Admin",
    email: null,
    role: "platform_admin",
    accountStatus: "active",
    mustChangePassword: false,
    lastLoginAt: "2026-03-15T10:00:00.000Z",
    createdAt: "2026-03-09T00:00:00.000Z",
    projects: [
      {
        id: "proj-default",
        role: "project_admin",
        name: "Default Project",
        slug: "default",
      },
    ],
  };
}

function buildAgentQueueItem(overrides: Record<string, unknown> = {}) {
  return {
    agentRunId: "run-analytics-1",
    taskId: "task-analytics-1",
    taskTitle: "审批风险处理",
    projectId: "proj-default",
    projectName: "Default Project",
    agentType: "explore-enterprise",
    status: "stopped",
    sessionId: null,
    currentStage: null,
    blockerType: "stopped",
    blockerLabel: "已停止待处理",
    blockerReason: "人工停止待处理",
    riskLevel: "high",
    approvalStatus: null,
    requiresIntervention: true,
    startedAt: "2026-03-13T12:00:00.000Z",
    finishedAt: "2026-03-13T12:00:05.000Z",
    lastActivityAt: "2026-03-13T12:00:05.000Z",
    durationMs: 5000,
    modelUsed: "github-copilot:claude-opus-4.6",
    tokenUsed: 0,
    resultSummary: "人工停止待处理",
    guidanceCount: 1,
    primaryAttentionReason: "manual_stop",
    quickActions: [],
    actionPermissions: {
      canPause: false,
      canResume: true,
      canTerminate: true,
      canInjectGuidance: true,
      canViewApproval: true,
      canViewAudit: true,
      canViewCodeChanges: true,
      canExport: true,
    },
    ...overrides,
  };
}

function buildHealthResponse() {
  return {
    generatedAt: "2026-03-15T10:17:30.000Z",
    viewScope: "project",
    totalRuns: 1,
    completedRuns: 0,
    failedRuns: 1,
    stoppedRuns: 1,
    humanInterventionRuns: 1,
    attentionRuns: 1,
    approvalBlockedRuns: 1,
    avgDurationMs: 0,
    failureRate: 100,
    interventionRate: 100,
    agentRanking: [
      {
        key: "explore-enterprise",
        label: "explore-enterprise",
        totalRuns: 1,
        successRate: 0,
        failureRate: 100,
        avgDurationMs: 0,
        avgTokens: 0,
      },
    ],
    modelRanking: [
      {
        key: "github-copilot:claude-opus-4.6",
        label: "github-copilot:claude-opus-4.6",
        totalRuns: 1,
        successRate: 0,
        failureRate: 100,
        avgDurationMs: 0,
        avgTokens: 0,
      },
    ],
  };
}

function buildFailuresResponse() {
  return {
    generatedAt: "2026-03-15T10:17:30.000Z",
    viewScope: "project",
    totalAttentionRuns: 1,
    blockerBreakdown: [{ label: "已停止待处理", count: 1, share: 100 }],
    failureReasons: [{ label: "人工停止待处理", count: 1, share: 100 }],
    riskBreakdown: [{ label: "高风险", count: 1, share: 100 }],
  };
}

function buildTimelineResponse() {
  return {
    generatedAt: "2026-03-15T10:17:30.000Z",
    viewScope: "project",
    bucketUnit: "hour",
    buckets: [
      {
        key: "2026-03-13T12",
        label: "03-13 12",
        totalRuns: 1,
        completedRuns: 0,
        failedRuns: 1,
        attentionRuns: 1,
        interventionRuns: 1,
      },
    ],
  };
}

async function installAuthMocks(page: Page) {
  await page.route("**/api/auth/login", async (route) => {
    await fulfillJson(route, {
      token: "playwright-admin-token",
      user: buildAuthUser(),
    });
  });

  await page.route("**/api/auth/me", async (route) => {
    await fulfillJson(route, buildAuthUser());
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
}

async function installAgentOpsMocks(page: Page) {
  await page.route("**/api/agents/overview**", async (route) => {
    await fulfillJson(route, {
      summary: {
        attentionCount: 1,
        runningCount: 0,
        completedCount: 0,
        failureRate: 100,
        avgDurationMs: 0,
        humanInterventionRate: 100,
      },
      queueCounts: {
        attention: 1,
        running: 0,
        recent: 0,
      },
    });
  });

  await page.route("**/api/agents/queues**", async (route) => {
    const url = new URL(route.request().url());
    const queue = url.searchParams.get("queue") || "attention";
    const taskId = url.searchParams.get("taskId");
    const agentRunId = url.searchParams.get("agentRunId");
    const item = buildAgentQueueItem({
      taskId: taskId || "task-analytics-1",
      agentRunId: agentRunId || "run-analytics-1",
    });
    await fulfillJson(route, {
      data: queue === "attention" ? [item] : [],
      total: queue === "attention" ? 1 : 0,
      page: 1,
      pageSize: 20,
    });
  });

  await page.route("**/api/agents/analytics/health**", async (route) => {
    await fulfillJson(route, buildHealthResponse());
  });

  await page.route("**/api/agents/analytics/failures**", async (route) => {
    await fulfillJson(route, buildFailuresResponse());
  });

  await page.route("**/api/agents/analytics/timeline**", async (route) => {
    await fulfillJson(route, buildTimelineResponse());
  });

  await page.route("**/api/agents/*/summary**", async (route) => {
    const url = new URL(route.request().url());
    const pathParts = url.pathname.split("/");
    const agentRunId = pathParts[pathParts.length - 2] || "run-analytics-1";
    const taskId = url.searchParams.get("taskId") || "task-approval-1";
    await fulfillJson(route, {
      entryContext: url.searchParams.get("entryContext") || "approval",
      viewScope: "project",
      agentRunId,
      taskId,
      taskTitle: "审批风险处理",
      projectId: "proj-default",
      projectName: "Default Project",
      agentType: "explore-enterprise",
      status: "stopped",
      sessionId: null,
      modelUsed: "github-copilot:claude-opus-4.6",
      startedAt: "2026-03-13T12:00:00.000Z",
      finishedAt: "2026-03-13T12:00:05.000Z",
      lastActivityAt: "2026-03-13T12:00:05.000Z",
      durationMs: 5000,
      tokenUsed: 0,
      blockerType: "stopped",
      blockerLabel: "已停止待处理",
      riskLevel: "high",
      guidanceCount: 1,
      resultSummary: "人工停止待处理",
      result: null,
      error: null,
      longSummary: "人工停止待处理",
      latestEvents: [],
      actionPermissions: {
        canPause: false,
        canResume: true,
        canTerminate: true,
        canInjectGuidance: true,
        canViewApproval: true,
        canViewAudit: true,
        canViewCodeChanges: true,
        canExport: true,
      },
    });
  });

  await page.route("**/api/agents", async (route) => {
    if (route.request().url().includes("/api/agents/")) {
      await route.fallback();
      return;
    }
    await fulfillJson(route, []);
  });
}

async function installApprovalMocks(page: Page) {
  await page.route("**/api/approvals**", async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    if (status === "pending") {
      await fulfillJson(route, [
        {
          id: "approval-1",
          taskId: "task-approval-1",
          agentRunId: "run-approval-1",
          nodeId: "node-1",
          actionType: "command_execute",
          riskLevel: "high",
          status: "pending",
          requestDetail: {
            trigger: "policy",
            violations: ["高风险命令"],
          },
          createdAt: "2026-03-15T09:50:00.000Z",
          expiresAt: "2026-03-15T10:50:00.000Z",
        },
      ]);
      return;
    }
    await fulfillJson(route, []);
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123!");
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.waitForURL("**/");
}

test.describe("Agent console analytics regression", () => {
  test.beforeEach(async ({ page }) => {
    await installAuthMocks(page);
    await installAgentOpsMocks(page);
    await installApprovalMocks(page);
  });

  test("preserves task deep-link query when analytics writes back a model filter", async ({ page }) => {
    await login(page);

    await page.goto("/agents?entryContext=task&focus=attention&ownerScope=all&taskId=task-task-1&projectId=proj-default");

    await expect(page.getByRole("heading", { name: "Agent 运营中心" })).toBeVisible();
    await expect(page.getByText("管理员分析视图")).toBeVisible();

    await page.getByRole("button", { name: "筛到该模型" }).click();

    await expect(page).toHaveURL(/\/agents\?.*entryContext=task/);
    await expect(page).toHaveURL(/\/agents\?.*taskId=task-task-1/);
    await expect(page).toHaveURL(/\/agents\?.*projectId=proj-default/);
    await expect(page).toHaveURL(/\/agents\?.*ownerScope=all/);
    await expect(page).toHaveURL(/\/agents\?.*model=github-copilot:claude-opus-4.6/);
    await expect(page.getByText("需要处理")).toBeVisible();
    await expect(page.getByText("explore-enterprise").first()).toBeVisible();
  });

  test("navigates from approvals and preserves approval deep-link query when analytics adds risk filter", async ({ page }) => {
    await login(page);

    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "审批管理" })).toBeVisible();

    const approvalAgentLink = page.locator('a[href*="/agents?"]').first();
    await expect(approvalAgentLink).toBeVisible();

    const href = await approvalAgentLink.getAttribute("href");
    expect(href).toContain("entryContext=approval");
    expect(href).toContain("approvalBlocked=true");
    expect(href).toContain("taskId=task-approval-1");
    expect(href).toContain("agentRunId=run-approval-1");

    await page.goto(href || "/agents");

    await expect(page).toHaveURL(/\/agents\?.*entryContext=approval/);
    await expect(page).toHaveURL(/\/agents\?.*approvalBlocked=true/);
    await expect(page).toHaveURL(/\/agents\?.*taskId=task-approval-1/);
    await expect(page).toHaveURL(/\/agents\?.*agentRunId=run-approval-1/);

    await page.getByText("高风险 1").click();

    await expect(page).toHaveURL(/\/agents\?.*entryContext=approval/);
    await expect(page).toHaveURL(/\/agents\?.*approvalBlocked=true/);
    await expect(page).toHaveURL(/\/agents\?.*taskId=task-approval-1/);
    await expect(page).toHaveURL(/\/agents\?.*agentRunId=run-approval-1/);
    await expect(page).toHaveURL(/\/agents\?.*riskLevel=high/);
    await expect(page).toHaveURL(/\/agents\?.*focus=attention/);
  });
});