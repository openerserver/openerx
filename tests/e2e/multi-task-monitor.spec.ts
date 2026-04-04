import { type Page, type Route, expect, test } from "@playwright/test";

function buildTask(
  taskId: string,
  title: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: taskId,
    projectId: "proj-default",
    userId: "user-admin",
    title,
    prompt: `${title} 的处理说明`,
    status,
    createdAt: "2026-03-14T08:00:00.000Z",
    startedAt: "2026-03-14T08:02:00.000Z",
    ...overrides,
  };
}

const tasks = {
  taskStage: buildTask("task-stage-1", "认证链路修复", "running"),
  taskFallbackDone: buildTask("task-fallback-1", "历史构建修复", "failed", {
    createdAt: "2026-03-14T07:00:00.000Z",
    finishedAt: "2026-03-14T07:10:00.000Z",
  }),
  taskFallbackLive: buildTask("task-fallback-2", "灰度巡检", "running", {
    createdAt: "2026-03-14T08:10:00.000Z",
    startedAt: "2026-03-14T08:12:00.000Z",
  }),
  taskFailed2: buildTask("task-failed-2", "审批链路回退", "failed", {
    createdAt: "2026-03-14T06:40:00.000Z",
    finishedAt: "2026-03-14T06:55:00.000Z",
  }),
  taskCompleted1: buildTask("task-completed-1", "发布巡检归档", "completed", {
    createdAt: "2026-03-14T05:20:00.000Z",
    finishedAt: "2026-03-14T05:48:00.000Z",
  }),
  taskCompleted2: buildTask("task-completed-2", "日志清理完成", "completed", {
    createdAt: "2026-03-14T04:30:00.000Z",
    finishedAt: "2026-03-14T04:52:00.000Z",
  }),
} as const;

function buildSession(id: string, title: string, updatedAt: string) {
  return {
    id,
    title,
    isActive: true,
    summary: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

function buildMessages(sessionTime: string, assistantText: string) {
  return {
    data: [
      {
        info: {
          id: `user-${sessionTime}`,
          role: "user",
          time: { created: sessionTime },
        },
        parts: [{ type: "text", text: "请继续处理" }],
      },
      {
        info: {
          id: `assistant-${sessionTime}`,
          role: "assistant",
          agent: "oracle-enterprise",
          time: {
            created: sessionTime,
            completed: sessionTime,
          },
        },
        parts: [{ type: "text", text: assistantText }],
      },
    ],
  };
}

function buildExecutionTrace(sessionTime: string, assistantText: string) {
  const messages = buildMessages(sessionTime, assistantText).data;
  return {
    taskId: `task-${sessionTime}`,
    sessionId: `session-${sessionTime}`,
    segments: [],
    messages: messages.map((entry) => ({
      id: String(entry.info.id),
      role: String(entry.info.role),
      text: String((entry.parts[0] as { text: string }).text),
      createdAt: String(entry.info.time.created),
      raw: entry,
    })),
  };
}

function buildStagePipeline() {
  return {
    taskId: tasks.taskStage.id,
    sessionId: "session-stage",
    branchName: "main",
    status: "running",
    createdAt: "2026-03-14T08:01:00.000Z",
    updatedAt: "2026-03-14T08:09:00.000Z",
    stages: [
      {
        id: "stage-1",
        type: "execution",
        label: "检索日志",
        status: "completed",
        order: 1,
        sourceType: "session.message",
        sourceId: null,
        agent: null,
        model: null,
        sessionId: "session-stage",
        startedAt: "2026-03-14T08:03:00.000Z",
        finishedAt: "2026-03-14T08:04:00.000Z",
        durationMs: 60000,
        output: null,
        error: null,
        tokens: null,
        graphNodeId: null,
        dependsOn: [],
      },
      {
        id: "stage-2",
        type: "execution",
        label: "修复认证链路",
        status: "running",
        order: 2,
        sourceType: "session.message",
        sourceId: null,
        agent: null,
        model: null,
        sessionId: "session-stage",
        startedAt: "2026-03-14T08:05:00.000Z",
        finishedAt: null,
        durationMs: null,
        output: null,
        error: null,
        tokens: null,
        graphNodeId: null,
        dependsOn: [],
      },
    ],
    summary: {
      totalStages: 2,
      completedStages: 1,
      failedStages: 0,
      currentStageId: "stage-2",
      totalTokens: { input: 0, output: 0 },
      totalDurationMs: 60000,
      replanCount: 0,
    },
  };
}

function buildFallbackDonePipeline() {
  return {
    taskId: tasks.taskFallbackDone.id,
    sessionId: "session-fallback-done",
    branchName: "release",
    status: "failed",
    createdAt: "2026-03-14T07:00:00.000Z",
    updatedAt: "2026-03-14T07:10:00.000Z",
    stages: [
      {
        id: "stage-a",
        type: "execution",
        label: "下载依赖",
        status: "completed",
        order: 1,
        sourceType: "session.message",
        sourceId: null,
        agent: null,
        model: null,
        sessionId: "session-fallback-done",
        startedAt: "2026-03-14T07:01:00.000Z",
        finishedAt: "2026-03-14T07:03:00.000Z",
        durationMs: 120000,
        output: null,
        error: null,
        tokens: null,
        graphNodeId: null,
        dependsOn: [],
      },
    ],
    summary: {
      totalStages: 3,
      completedStages: 1,
      failedStages: 1,
      currentStageId: null,
      totalTokens: { input: 0, output: 0 },
      totalDurationMs: 120000,
      replanCount: 0,
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

async function installMonitorMocks(page: Page) {
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
        lastLoginAt: "2026-03-14T08:00:00.000Z",
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
      lastLoginAt: "2026-03-14T08:00:00.000Z",
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

  await page.route("**/api/dashboard/provider-tokens**", async (route) => {
    await fulfillJson(route, {
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

  await page.route("**/api/tasks?**", async (route) => {
    await fulfillJson(route, {
      data: [tasks.taskStage, tasks.taskFallbackDone, tasks.taskFallbackLive],
    });
  });

  await page.route("**/api/tasks/task-stage-1", async (route) => {
    await fulfillJson(route, tasks.taskStage);
  });

  await page.route("**/api/tasks/task-fallback-1", async (route) => {
    await fulfillJson(route, tasks.taskFallbackDone);
  });

  await page.route("**/api/tasks/task-fallback-2", async (route) => {
    await fulfillJson(route, tasks.taskFallbackLive);
  });

  await page.route("**/api/tasks/task-stage-1/sessions", async (route) => {
    await fulfillJson(route, {
      data: [buildSession("session-stage", "主分支", "2026-03-14T08:09:00.000Z")],
    });
  });

  await page.route("**/api/tasks/task-fallback-1/sessions", async (route) => {
    await fulfillJson(route, {
      data: [buildSession("session-fallback-done", "回归分支", "2026-03-14T07:10:00.000Z")],
    });
  });

  await page.route("**/api/tasks/task-fallback-2/sessions", async (route) => {
    await fulfillJson(route, {
      data: [buildSession("session-fallback-live", "巡检分支", "2026-03-14T08:16:00.000Z")],
    });
  });

  await page.route("**/api/tasks/task-stage-1/execution-trace**", async (route) => {
    await fulfillJson(route, buildExecutionTrace("2026-03-14T08:09:00.000Z", "认证修复仍在推进。"));
  });

  await page.route("**/api/tasks/task-fallback-1/execution-trace**", async (route) => {
    await fulfillJson(
      route,
      buildExecutionTrace("2026-03-14T07:09:00.000Z", "构建修复记录已结束。"),
    );
  });

  await page.route("**/api/tasks/task-fallback-2/execution-trace**", async (route) => {
    await fulfillJson(route, buildExecutionTrace("2026-03-14T08:16:00.000Z", "巡检任务仍在执行。"));
  });

  await page.route("**/api/tasks/task-stage-1/pipeline**", async (route) => {
    await fulfillJson(route, buildStagePipeline());
  });

  await page.route("**/api/tasks/task-fallback-1/pipeline**", async (route) => {
    await fulfillJson(route, buildFallbackDonePipeline());
  });

  await page.route("**/api/tasks/task-fallback-2/pipeline**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "no pipeline" }),
    });
  });
}

async function installDenseStatusMonitorMocks(page: Page) {
  await installMonitorMocks(page);

  await page.route("**/api/tasks?**", async (route) => {
    await fulfillJson(route, {
      data: [
        tasks.taskStage,
        tasks.taskFallbackLive,
        tasks.taskFallbackDone,
        tasks.taskFailed2,
        tasks.taskCompleted1,
        tasks.taskCompleted2,
      ],
    });
  });

  await page.route("**/api/tasks/task-failed-2", async (route) => {
    await fulfillJson(route, tasks.taskFailed2);
  });
  await page.route("**/api/tasks/task-completed-1", async (route) => {
    await fulfillJson(route, tasks.taskCompleted1);
  });
  await page.route("**/api/tasks/task-completed-2", async (route) => {
    await fulfillJson(route, tasks.taskCompleted2);
  });

  await page.route("**/api/tasks/task-failed-2/sessions", async (route) => {
    await fulfillJson(route, {
      data: [buildSession("session-failed-2", "审批回退分支", "2026-03-14T06:55:00.000Z")],
    });
  });
  await page.route("**/api/tasks/task-completed-1/sessions", async (route) => {
    await fulfillJson(route, {
      data: [buildSession("session-completed-1", "发布分支", "2026-03-14T05:48:00.000Z")],
    });
  });
  await page.route("**/api/tasks/task-completed-2/sessions", async (route) => {
    await fulfillJson(route, {
      data: [buildSession("session-completed-2", "清理分支", "2026-03-14T04:52:00.000Z")],
    });
  });

  await page.route("**/api/tasks/task-failed-2/execution-trace**", async (route) => {
    await fulfillJson(
      route,
      buildExecutionTrace("2026-03-14T06:55:00.000Z", "审批回退已终止，等待人工介入。"),
    );
  });
  await page.route("**/api/tasks/task-completed-1/execution-trace**", async (route) => {
    await fulfillJson(
      route,
      buildExecutionTrace("2026-03-14T05:48:00.000Z", "发布巡检已完成归档。"),
    );
  });
  await page.route("**/api/tasks/task-completed-2/execution-trace**", async (route) => {
    await fulfillJson(
      route,
      buildExecutionTrace("2026-03-14T04:52:00.000Z", "日志清理任务已结束。"),
    );
  });

  await page.route("**/api/tasks/task-failed-2/pipeline**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "no pipeline" }),
    });
  });
  await page.route("**/api/tasks/task-completed-1/pipeline**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "no pipeline" }),
    });
  });
  await page.route("**/api/tasks/task-completed-2/pipeline**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "no pipeline" }),
    });
  });
}

async function addTaskByTitle(page: Page, title: string) {
  await page.locator(".monitor-toolbar__task-picker").click();
  await page.getByText(title).click();
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123!");
  await page.getByRole("button", { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function switchLayoutMode(page: Page, label: "按状态" | "按阶段" | "按时间" | "自由布局") {
  await page.locator(".monitor-toolbar__layout-mode").click();
  await page.locator(`text=${label}`).last().click();
}

async function dragNodeBy(page: Page, title: string, deltaX: number, deltaY: number) {
  const node = page.locator(".vue-flow__node").filter({ hasText: title }).first();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  const startX = (box?.x || 0) + (box?.width || 0) / 2;
  const startY = (box?.y || 0) + Math.min(40, (box?.height || 0) / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 });
  await page.mouse.up();
}

async function readNodeTranslate(page: Page, title: string) {
  return page
    .locator(".vue-flow__node")
    .filter({ hasText: title })
    .first()
    .evaluate((node) => {
      const style = node.getAttribute("style") || "";
      const match = style.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    });
}

async function readNodeBox(page: Page, title: string) {
  const box = await page
    .locator(".vue-flow__node")
    .filter({ hasText: title })
    .first()
    .boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error(`Unable to find node box for ${title}`);
  }
  return box;
}

test.describe("Multi-task monitor browser flows", () => {
  test("status mode handles dense failed and completed lanes without shrinking cards", async ({
    page,
  }) => {
    await installDenseStatusMonitorMocks(page);
    await loginAsAdmin(page);

    await page.goto("/multi-task-monitor");
    await expect(page.getByRole("heading", { name: "多任务监控台" })).toBeVisible();

    await addTaskByTitle(page, "历史构建修复");
    await addTaskByTitle(page, "审批链路回退");
    await addTaskByTitle(page, "发布巡检归档");
    await addTaskByTitle(page, "日志清理完成");

    await switchLayoutMode(page, "按状态");

    const sections = page.locator(".monitor-structure-section");
    await expect(sections).toHaveCount(3);
    await expect(sections.nth(0)).toContainText("运行中");
    await expect(sections.nth(1)).toContainText("异常");
    await expect(sections.nth(1)).toContainText("2 个任务");
    await expect(sections.nth(2)).toContainText("已完成");
    await expect(sections.nth(2)).toContainText("2 个任务");

    const runningBox = await readNodeBox(page, "认证链路修复");
    const failedBox = await readNodeBox(page, "历史构建修复");
    const completedBox = await readNodeBox(page, "发布巡检归档");
    const failedSectionBox = await sections.nth(1).boundingBox();
    const completedSectionBox = await sections.nth(2).boundingBox();

    expect(Math.abs(runningBox.width - failedBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(failedBox.width - completedBox.width)).toBeLessThanOrEqual(1);
    expect(failedBox.y).toBeGreaterThan(runningBox.y + runningBox.height);
    expect(completedBox.y).toBeGreaterThan(failedBox.y + failedBox.height);
    expect(failedSectionBox).not.toBeNull();
    expect(completedSectionBox).not.toBeNull();
    expect(failedSectionBox?.width || 0).toBeGreaterThanOrEqual(failedBox.width + 120);
    expect(completedSectionBox?.width || 0).toBeGreaterThanOrEqual(completedBox.width + 120);
  });

  test("status mode keeps cards equal-width and stacks lower-priority lanes vertically", async ({
    page,
  }) => {
    await installMonitorMocks(page);
    await loginAsAdmin(page);

    await page.goto("/multi-task-monitor");
    await expect(page.getByRole("heading", { name: "多任务监控台" })).toBeVisible();

    await page.locator(".monitor-toolbar__task-picker").click();
    await page.getByText("历史构建修复").click();

    await switchLayoutMode(page, "按状态");

    const sections = page.locator(".monitor-structure-section");
    await expect(sections).toHaveCount(2);
    await expect(sections.nth(0)).toContainText("运行中");
    await expect(sections.nth(1)).toContainText("异常");

    const runningBox = await readNodeBox(page, "认证链路修复");
    const failedBox = await readNodeBox(page, "历史构建修复");
    const runningSectionBox = await sections.nth(0).boundingBox();
    const failedSectionBox = await sections.nth(1).boundingBox();

    expect(Math.abs(runningBox.width - failedBox.width)).toBeLessThanOrEqual(1);
    expect(runningSectionBox).not.toBeNull();
    expect(failedSectionBox).not.toBeNull();
    expect(runningBox.x).toBeGreaterThanOrEqual((runningSectionBox?.x || 0) + 12);
    expect(runningBox.x + runningBox.width).toBeLessThanOrEqual(
      (runningSectionBox?.x || 0) + (runningSectionBox?.width || 0) - 12,
    );
    expect(failedBox.x).toBeGreaterThanOrEqual((failedSectionBox?.x || 0) + 12);
    expect(failedBox.x + failedBox.width).toBeLessThanOrEqual(
      (failedSectionBox?.x || 0) + (failedSectionBox?.width || 0) - 12,
    );
    expect(failedBox.y).toBeGreaterThan(runningBox.y + runningBox.height);
  });

  test("stage mode keeps fallback tasks in a muted catch-all section", async ({ page }) => {
    await installMonitorMocks(page);
    await loginAsAdmin(page);

    await page.goto("/multi-task-monitor");
    await expect(page.getByRole("heading", { name: "多任务监控台" })).toBeVisible();

    await page.locator(".monitor-toolbar__task-picker").click();
    await page.getByText("历史构建修复").click();

    await switchLayoutMode(page, "按阶段");

    await expect(page.locator(".monitor-layout-banner")).toContainText("按阶段");
    await expect(page.locator(".monitor-structure-section")).toHaveCount(2);
    await expect(page.locator(".monitor-structure-section--running").first()).toContainText(
      "修复认证链路",
    );
    await expect(page.locator(".monitor-structure-section--neutral").first()).toContainText(
      "未识别",
    );
    await expect(page.locator(".monitor-structure-section--neutral").first()).toContainText(
      "阶段信息不完整时暂时归并到这里",
    );
    await expect(page.locator(".monitor-structure-section--neutral").first()).not.toContainText(
      "1/3",
    );
    await expect(page.locator(".monitor-structure-section--neutral").first()).toContainText(
      "2 个任务",
    );
  });

  test("stage mode keeps lane placement stable and switching back restores the free-layout snapshot", async ({
    page,
  }) => {
    await installMonitorMocks(page);
    await loginAsAdmin(page);

    await page.goto("/multi-task-monitor");
    await expect(page.getByRole("heading", { name: "多任务监控台" })).toBeVisible();

    const canvasBox = await page.locator(".monitor-canvas-shell").boundingBox();
    const fallbackBox = await readNodeBox(page, "灰度巡检");
    const stageBox = await readNodeBox(page, "认证链路修复");
    expect(canvasBox).not.toBeNull();
    expect(fallbackBox.y).toBeGreaterThanOrEqual((canvasBox?.y || 0) + 20);
    expect(
      stageBox.x + stageBox.width + 24 <= fallbackBox.x ||
        fallbackBox.x + fallbackBox.width + 24 <= stageBox.x ||
        stageBox.y + stageBox.height + 24 <= fallbackBox.y ||
        fallbackBox.y + fallbackBox.height + 24 <= stageBox.y,
    ).toBe(true);

    const targetNode = page.locator(".vue-flow__node").filter({ hasText: "灰度巡检" }).first();
    await targetNode.click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");

    const moved = await readNodeTranslate(page, "灰度巡检");
    expect(moved).not.toBeNull();

    await switchLayoutMode(page, "按阶段");
    const staged = await readNodeTranslate(page, "灰度巡检");
    expect(staged).not.toEqual(moved);

    await targetNode.click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowDown");

    const stagedMoved = await readNodeTranslate(page, "灰度巡检");
    expect(stagedMoved).not.toBeNull();
    expect(staged).not.toBeNull();
    expect(Math.abs((stagedMoved?.x || 0) - (staged?.x || 0))).toBeLessThanOrEqual(8);
    expect(Math.abs((stagedMoved?.y || 0) - (staged?.y || 0))).toBeLessThanOrEqual(8);

    await page.getByRole("button", { name: "重置布局" }).click();
    const stagedReset = await readNodeTranslate(page, "灰度巡检");
    expect(stagedReset).not.toBeNull();
    expect(staged).not.toBeNull();
    expect(Math.abs((stagedReset?.x || 0) - (staged?.x || 0))).toBeLessThanOrEqual(12);
    expect(Math.abs((stagedReset?.y || 0) - (staged?.y || 0))).toBeLessThanOrEqual(8);

    await switchLayoutMode(page, "自由布局");
    await expect(page.locator(".monitor-layout-banner")).toHaveCount(0);
    await expect(page.locator(".monitor-structure-section")).toHaveCount(0);

    const restored = await readNodeTranslate(page, "灰度巡检");
    expect(restored).not.toBeNull();
    expect(moved).not.toBeNull();
    expect(Math.abs((restored?.x || 0) - (moved?.x || 0))).toBeLessThanOrEqual(12);
    expect(Math.abs((restored?.y || 0) - (moved?.y || 0))).toBeLessThanOrEqual(8);
  });

  test("structured modes ignore direct mouse dragging and keep node coordinates stable", async ({
    page,
  }) => {
    await installMonitorMocks(page);
    await loginAsAdmin(page);

    await page.goto("/multi-task-monitor");
    await expect(page.getByRole("heading", { name: "多任务监控台" })).toBeVisible();

    await addTaskByTitle(page, "历史构建修复");

    for (const mode of ["按状态", "按阶段", "按时间"] as const) {
      await switchLayoutMode(page, mode);
      const before = await readNodeTranslate(page, "认证链路修复");
      expect(before).not.toBeNull();
      await dragNodeBy(page, "认证链路修复", 180, 120);
      await page.waitForTimeout(250);
      const after = await readNodeTranslate(page, "认证链路修复");
      expect(after).not.toBeNull();
      expect(Math.abs((after?.x || 0) - (before?.x || 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((after?.y || 0) - (before?.y || 0))).toBeLessThanOrEqual(1);
    }
  });
});
