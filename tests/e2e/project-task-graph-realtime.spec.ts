import { type Page, type Route, expect, test } from "@playwright/test";

interface GraphTask {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  prompt: string;
  status: string;
  currentStageLabel: string | null;
  latestActivityAt: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface GraphView {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
  tasks: GraphTask[];
  edges: Array<{
    id: string;
    sourceTaskId: string;
    targetTaskId: string;
    type: "depends-on" | "blocks" | "spawned-from";
    source: "manual" | "system" | "task-create";
  }>;
  capabilities: {
    supportsDependsOn: boolean;
    supportsBlocks: boolean;
    supportsSpawnedFrom: boolean;
  };
  refreshedAt: string;
}

function makeTask(id: string, title: string, status: string, stage: string): GraphTask {
  return {
    id,
    projectId: "proj-default",
    userId: "user-admin",
    title,
    prompt: `${title} 的执行说明`,
    status,
    currentStageLabel: stage,
    latestActivityAt: "2026-03-16T09:00:00.000Z",
    createdAt: "2026-03-16T08:00:00.000Z",
    startedAt: "2026-03-16T08:10:00.000Z",
    finishedAt: null,
  };
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function installRealtimeMock(page: Page) {
  await page.addInitScript(() => {
    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 3;
      url: string;
      readyState = MockWebSocket.CONNECTING;
      onopen: ((event?: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event?: CloseEvent) => void) | null = null;
      onerror: ((event?: Event) => void) | null = null;
      listeners = new Map<string, Set<(event: Event) => void>>();
      subscribedProjects = new Set<string>();

      constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          const openEvent = new Event("open");
          this.onopen?.(openEvent);
          this.dispatch("open", openEvent);
        }, 0);
      }

      addEventListener(type: string, listener: (event: Event) => void) {
        const set = this.listeners.get(type) || new Set();
        set.add(listener);
        this.listeners.set(type, set);
      }

      removeEventListener(type: string, listener: (event: Event) => void) {
        this.listeners.get(type)?.delete(listener);
      }

      send(payload: string) {
        try {
          const message = JSON.parse(payload) as { type?: string; projectId?: string };
          if (message.type === "subscribe_project" && message.projectId) {
            this.subscribedProjects.add(message.projectId);
          }
        } catch {
          // Ignore malformed payloads in tests.
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        const closeEvent = new Event("close");
        this.onclose?.(closeEvent as CloseEvent);
        this.dispatch("close", closeEvent);
      }

      dispatch(type: string, event: Event) {
        for (const listener of this.listeners.get(type) || []) {
          listener(event);
        }
      }
    }

    Object.assign(window, {
      WebSocket: MockWebSocket,
      __openerxEmitRealtimeEvent(event: Record<string, unknown>) {
        const messageEvent = new MessageEvent("message", {
          data: JSON.stringify(event),
        });
        for (const socket of MockWebSocket.instances) {
          const projectId = typeof event.projectId === "string" ? event.projectId : undefined;
          if (
            projectId &&
            socket.subscribedProjects.size > 0 &&
            !socket.subscribedProjects.has(projectId)
          ) {
            continue;
          }
          socket.onmessage?.(messageEvent);
          socket.dispatch("message", messageEvent);
        }
      },
    });
  });
}

async function installProjectGraphRoutes(page: Page, graphView: GraphView) {
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
      createdAt: "2026-03-10T00:00:00.000Z",
      lastLoginAt: "2026-03-16T08:00:00.000Z",
      projects: [
        {
          id: "proj-default",
          role: "project_admin",
          name: "Default Project",
          slug: "default-project",
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
        slug: "default-project",
        description: "实时项目任务图测试",
      },
    ]);
  });

  await page.route("**/api/projects/proj-default/task-graph-view", async (route) => {
    await fulfillJson(route, graphView);
  });
}

async function installAuthState(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "auth",
      JSON.stringify({
        token: "playwright-admin-token",
        user: {
          id: "user-admin",
          username: "admin",
          displayName: "Admin",
          email: null,
          role: "platform_admin",
          accountStatus: "active",
          mustChangePassword: false,
          projects: [{ id: "proj-default", role: "project_admin" }],
        },
      }),
    );
  });
}

test("project task graph applies project realtime events incrementally", async ({ page }) => {
  const graphView: GraphView = {
    project: {
      id: "proj-default",
      name: "Default Project",
      slug: "default-project",
      description: "实时项目任务图测试",
    },
    tasks: [
      makeTask("task-alpha", "认证链路修复", "running", "Implement"),
      makeTask("task-beta", "审批策略收敛", "running", "Design"),
    ],
    edges: [
      {
        id: "edge-1",
        sourceTaskId: "task-alpha",
        targetTaskId: "task-beta",
        type: "depends-on",
        source: "task-create",
      },
    ],
    capabilities: {
      supportsDependsOn: true,
      supportsBlocks: false,
      supportsSpawnedFrom: false,
    },
    refreshedAt: "2026-03-16T09:00:00.000Z",
  };

  await installRealtimeMock(page);
  await installAuthState(page);
  await installProjectGraphRoutes(page, graphView);

  await page.goto("/projects/proj-default/task-graph");
  await page.waitForLoadState("domcontentloaded");
  if (page.url().includes("/login")) {
    await page.goto("/projects/proj-default/task-graph");
  }

  await expect(page.getByText("Default Project / 任务总图")).toBeVisible();
  await expect(page.getByTestId("project-task-graph-stat-running")).toHaveText("2");
  await expect(page.locator('[data-task-id="task-beta"]')).toHaveAttribute(
    "data-group-label",
    "Design",
  );

  graphView.tasks = graphView.tasks.map((task) =>
    task.id === "task-alpha"
      ? {
          ...task,
          status: "completed",
          finishedAt: "2026-03-16T09:05:00.000Z",
          latestActivityAt: "2026-03-16T09:05:00.000Z",
        }
      : task,
  );

  await page.evaluate(() => {
    (
      window as unknown as {
        __openerxEmitRealtimeEvent: (event: Record<string, unknown>) => void;
      }
    ).__openerxEmitRealtimeEvent({
      id: "evt-task-completed",
      type: "task.completed",
      ts: "2026-03-16T09:05:00.000Z",
      projectId: "proj-default",
      taskId: "task-alpha",
      data: {},
    });
  });

  await expect(page.getByTestId("project-task-graph-stat-running")).toHaveText("1");
  await expect(page.locator('[data-task-id="task-alpha"]')).toHaveAttribute(
    "data-status-label",
    "已完成",
  );

  graphView.tasks = graphView.tasks.map((task) =>
    task.id === "task-beta"
      ? {
          ...task,
          status: "waiting_approval",
          latestActivityAt: "2026-03-16T09:06:00.000Z",
        }
      : task,
  );

  await page.evaluate(() => {
    (
      window as unknown as {
        __openerxEmitRealtimeEvent: (event: Record<string, unknown>) => void;
      }
    ).__openerxEmitRealtimeEvent({
      id: "evt-approval-required",
      type: "approval.required",
      ts: "2026-03-16T09:06:00.000Z",
      projectId: "proj-default",
      taskId: "task-beta",
      data: {},
    });
  });

  await expect(page.getByTestId("project-task-graph-stat-waiting-approval")).toHaveText("1");
  await expect(page.locator('[data-task-id="task-beta"]')).toHaveAttribute(
    "data-status-label",
    "待审批",
  );

  graphView.tasks = graphView.tasks.map((task) =>
    task.id === "task-beta"
      ? {
          ...task,
          currentStageLabel: "Verify",
          latestActivityAt: "2026-03-16T09:07:00.000Z",
        }
      : task,
  );

  await page.evaluate(() => {
    (
      window as unknown as {
        __openerxEmitRealtimeEvent: (event: Record<string, unknown>) => void;
      }
    ).__openerxEmitRealtimeEvent({
      id: "evt-pipeline-stage-updated",
      type: "pipeline.stage.updated",
      ts: "2026-03-16T09:07:00.000Z",
      projectId: "proj-default",
      taskId: "task-beta",
      data: {
        stageLabel: "Verify",
      },
    });
  });

  await expect(page.locator('[data-task-id="task-beta"]')).toHaveAttribute(
    "data-group-label",
    "Verify",
  );
});
