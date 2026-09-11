// @vitest-environment jsdom
import type { DesktopBridge, PermissionRequest, WorkItem } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingToolApproval } from "../src/renderer/PendingToolApproval";

const time = "2026-09-11T01:00:00.000Z";
const conversationId = crypto.randomUUID();
const workItem: WorkItem = {
  id: crypto.randomUUID(),
  ownerProfileId: "local-default",
  conversationId,
  messageId: crypto.randomUUID(),
  title: "等待授权",
  status: "waiting_for_permission",
  activeRunId: crypto.randomUUID(),
  createdAt: time,
  updatedAt: time,
  completedAt: null,
  revision: 1,
};
function permission(reason: string, offset = 0): PermissionRequest {
  if (!workItem.activeRunId) throw new Error("missing run");
  return {
    id: crypto.randomUUID(),
    ownerProfileId: workItem.ownerProfileId,
    workItemId: workItem.id,
    runId: workItem.activeRunId,
    toolCallId: crypto.randomUUID(),
    capability: "file",
    risk: "L2",
    resourceType: "path",
    resource: "/tmp/report.txt",
    actions: ["create"],
    reason,
    payloadDigest: "a".repeat(64),
    status: "pending",
    requestedAt: new Date(Date.parse(time) + offset).toISOString(),
    expiresAt: new Date(Date.parse(time) + 300_000).toISOString(),
    resolvedAt: null,
    resolution: null,
    scopeId: null,
  };
}
function harness(pending: PermissionRequest[], items = [workItem]) {
  let current = pending;
  const bridge = {
    listPermissionRequests: vi.fn(async () => current),
    resolvePermission: vi.fn(async (input: Parameters<DesktopBridge["resolvePermission"]>[0]) => {
      const found = current.find(({ id }) => id === input.permissionRequestId);
      if (!found) throw new Error("missing permission");
      current = current.filter(({ id }) => id !== found.id);
      return {
        ...found,
        status: input.decision === "deny" ? ("denied" as const) : ("approved" as const),
      };
    }),
    setToolPermissionMode: vi.fn(),
  };
  Object.defineProperty(window, "openerx", { configurable: true, value: bridge });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Example() {
    const anchorRef = useRef<HTMLFormElement>(null);
    return (
      <>
        <PendingToolApproval
          conversationId={conversationId}
          workItems={items}
          anchorRef={anchorRef}
        />
        <form ref={anchorRef}>
          <textarea aria-label="消息草稿" />
        </form>
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Example />
    </QueryClientProvider>,
  );
  return { bridge, client };
}
afterEach(cleanup);

describe("pending tool approval", () => {
  it("keeps a stable request visible while new approvals arrive, then advances after a decision", async () => {
    const first = permission("第一项");
    const second = permission("第二项", 1);
    const { bridge, client } = harness([second, first]);
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "待处理的工具授权" });
    expect(within(card).getByText("第一项")).toBeTruthy();
    expect(within(card).getByText(/共 2 项待处理/u)).toBeTruthy();
    const late = permission("后来收到更早的请求", -1);
    act(() => client.setQueryData(["tools", "pending-permissions"], [late, second, first]));
    expect(within(card).getByText("第一项")).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "仅本次允许" }));
    await waitFor(() => expect(within(card).getByText("第二项")).toBeTruthy());
    expect(bridge.resolvePermission).toHaveBeenCalledWith({
      permissionRequestId: first.id,
      payloadDigest: first.payloadDigest,
      decision: "once",
    });
    await user.click(within(card).getByRole("button", { name: "拒绝" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "待处理的工具授权" })).toBeNull(),
    );
    expect(bridge.resolvePermission).toHaveBeenLastCalledWith({
      permissionRequestId: second.id,
      payloadDigest: second.payloadDigest,
      decision: "deny",
    });
  });

  it("ignores another conversation, old runs, resolved requests and cancelled work", async () => {
    const otherWork = { ...workItem, id: crypto.randomUUID(), conversationId: crypto.randomUUID() };
    const cancelledWork = { ...workItem, id: crypto.randomUUID(), status: "cancelled" as const };
    const { bridge } = harness(
      [
        { ...permission("其他对话"), workItemId: otherWork.id },
        { ...permission("历史运行"), runId: crypto.randomUUID() },
        { ...permission("已取消"), workItemId: cancelledWork.id },
        { ...permission("已处理"), status: "approved" },
      ],
      [workItem, otherWork, cancelledWork],
    );
    await waitFor(() => expect(bridge.listPermissionRequests).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "待处理的工具授权" })).toBeNull();
  });

  it("keeps failures visible and retries without duplicate submissions or approving a typed Enter", async () => {
    const first = permission("读取文件");
    const { bridge } = harness([first]);
    let fail: ((error: Error) => void) | undefined;
    bridge.resolvePermission.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "待处理的工具授权" });
    await user.type(screen.getByRole("textbox", { name: "消息草稿" }), "继续输入{Enter}");
    await user.keyboard("{Escape}");
    expect(bridge.resolvePermission).not.toHaveBeenCalled();
    expect(card.isConnected).toBe(true);
    await user.dblClick(within(card).getByRole("button", { name: "仅本次允许" }));
    expect(bridge.resolvePermission).toHaveBeenCalledTimes(1);
    await act(async () => fail?.(new Error("offline")));
    expect(await within(card).findByText("权限设置失败，请重试。")).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "仅本次允许" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "待处理的工具授权" })).toBeNull(),
    );
    expect(bridge.resolvePermission).toHaveBeenCalledTimes(2);
  });

  it("shows a retry surface if pending permissions cannot be loaded", async () => {
    const { bridge, client } = harness([]);
    await waitFor(() =>
      expect(client.getQueryState(["tools", "pending-permissions"])?.status).toBe("success"),
    );
    bridge.listPermissionRequests.mockRejectedValue(new Error("offline"));
    await act(async () => client.invalidateQueries({ queryKey: ["tools"] }));
    const retry = await screen.findByRole("button", { name: "重新加载权限请求" });
    bridge.listPermissionRequests.mockResolvedValue([permission("重试成功")]);
    await userEvent.setup().click(retry);
    expect(await screen.findByText("重试成功")).toBeTruthy();
  });
});
