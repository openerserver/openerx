// @vitest-environment jsdom
import type {
  AutomationDefinition,
  AutomationRun,
  ConversationSummary,
  DesktopBridge,
} from "@openerx/contracts";
import {
  enterpriseWorkspaceCapabilities,
  setDesktopWorkspaceBridge,
} from "@openerx/desktop-ui/workspace-bridge";
import { QueryClient, QueryClientProvider, type UseQueryResult } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AutomationsPage } from "../src/renderer/AutomationsPage";
import { ProjectSidebar } from "../src/renderer/projects/ProjectSidebar";

afterEach(() => {
  cleanup();
  setDesktopWorkspaceBridge(null);
  vi.restoreAllMocks();
});

test("project creation escapes a sidebar stacking context and restores focus on cancel", async () => {
  const createProject = vi.fn();
  setDesktopWorkspaceBridge(
    { listProjects: vi.fn().mockResolvedValue([]), createProject } as unknown as DesktopBridge,
    undefined,
    enterpriseWorkspaceCapabilities,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <aside style={{ position: "relative", zIndex: 1, transform: "translateZ(0)" }}>
          <ProjectSidebar
            conversations={
              { data: [], isSuccess: true } as unknown as UseQueryResult<ConversationSummary[]>
            }
          />
        </aside>
        <button type="button">背景聊天输入操作</button>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: "新建项目" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "新建项目" });
  expect(dialog.closest("aside")).toBeNull();
  expect(dialog.parentElement?.parentElement).toBe(document.body);
  expect(screen.getByText("企业工作区")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("项目名称"));
  expect(
    screen.getByRole("button", { name: "背景聊天输入操作", hidden: true }).closest("[inert]"),
  ).not.toBeNull();

  fireEvent.change(screen.getByLabelText("项目说明（可选）"), {
    target: { value: "长项目说明\n".repeat(400) },
  });
  const cancel = screen.getByRole("button", { name: "取消" });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭新建项目" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.closest("[inert]")).toBeNull();
  expect(createProject).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText("还没有项目。新对话仍可直接使用。")).toBeTruthy());
  view.unmount();
  client.clear();
});

test("automation details expose a keyboard focusable history region with the last task link", async () => {
  const selected = {
    id: "automation-audit",
    name: "长历史自动化",
    prompt: "长任务说明。".repeat(500),
    kind: "standalone",
    status: "active",
    schedule: {
      mode: "rrule",
      expression: "FREQ=DAILY",
      timezone: "Asia/Shanghai",
      startAt: "2026-10-09T00:00:00.000Z",
    },
    execution: { modelRef: "fixture/model", catchUpPolicy: "skip" },
    nextRunAt: "2026-10-10T00:00:00.000Z",
  } as AutomationDefinition;
  const history = Array.from({ length: 10 }, (_, index) => ({
    id: `run-${index}`,
    automationId: selected.id,
    status: "succeeded",
    scheduledFor: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    trigger: "schedule",
    conversationId: `task-${index}`,
    branchId: `branch-${index}`,
  })) as unknown as AutomationRun[];
  const bridge = {
    listAutomations: vi.fn().mockResolvedValue([selected]),
    listAutomationRuns: vi.fn().mockResolvedValue(history),
    getLoginStartupSettings: vi.fn().mockResolvedValue({ supported: false, openAtLogin: false }),
    listConversations: vi.fn().mockResolvedValue([]),
    listModels: vi.fn(),
    runAutomationNow: vi.fn(),
  };
  setDesktopWorkspaceBridge(bridge as unknown as DesktopBridge);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/automations?automation=automation-audit"]}>
        <AutomationsPage defaultModelRef="fixture/model" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const region = await screen.findByRole("region", { name: "自动化详情与运行历史" });
  expect(region.getAttribute("tabindex")).toBe("0");
  region.focus();
  expect(document.activeElement).toBe(region);
  await waitFor(() => expect(screen.getAllByRole("link", { name: "查看任务" })).toHaveLength(10));
  expect(screen.getAllByRole("link", { name: "查看任务" }).at(-1)?.getAttribute("href")).toContain(
    "task-9?branch=branch-9",
  );
  expect(bridge.listAutomationRuns).toHaveBeenCalledWith({ automationId: selected.id });
  expect(bridge.listModels).not.toHaveBeenCalled();
  expect(bridge.runAutomationNow).not.toHaveBeenCalled();
  expect(screen.getByText("此平台暂不支持登录启动，请手动保持应用运行")).toBeTruthy();
  expect(screen.queryByText(/Windows/)).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  client.clear();
});
