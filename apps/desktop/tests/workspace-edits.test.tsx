// @vitest-environment jsdom
import type { WorkItemDetail } from "@openerx/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEdits } from "../src/renderer/WorkspaceEdits";

afterEach(cleanup);

function fixture(
  status = "completed",
  editStatus: "applied" | "reverted" = "applied",
) {
  const detail = {
    workItem: { id: "work-1", status },
    run: { id: "run-1", status },
    items: [],
    workspaceEdits: ["src/app.ts", "docs/notes.md"].map((relativePath, index) => ({
      id: `edit-${index}`,
      kind: "change_set",
      relativePaths: [relativePath],
      status: editStatus,
      canUndo: editStatus === "applied",
    })),
  } as unknown as WorkItemDetail;
  const undoWorkspaceEdits = vi.fn(async () => ({
    ...detail,
    workspaceEdits: detail.workspaceEdits?.map((edit) => ({
      ...edit,
      canUndo: false,
      status: "reverted" as const,
    })),
  }));
  Object.defineProperty(window, "openerx", { configurable: true, value: { undoWorkspaceEdits } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["tools", "work-item", "work-1", undefined], detail);
  render(
    <QueryClientProvider client={client}>
      <WorkspaceEdits detail={detail} />
    </QueryClientProvider>,
  );
  return { detail, client, undoWorkspaceEdits, user: userEvent.setup() };
}

describe("workspace edit controls", () => {
  it("offers visible single-group and run undo and refreshes the persisted detail", async () => {
    const { client, undoWorkspaceEdits, user } = fixture();
    expect(screen.getByRole("region", { name: "文件修改" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "撤销修改：src/app.ts" }));
    expect(screen.getByRole("alertdialog", { name: "撤销这组文件修改？" })).toBeTruthy();
    expect(undoWorkspaceEdits).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(undoWorkspaceEdits).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "撤销修改：src/app.ts" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() =>
      expect(undoWorkspaceEdits).toHaveBeenCalledWith({
        workItemId: "work-1",
        runId: "run-1",
        editId: "edit-0",
      }),
    );
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "已撤销文件修改。");
    expect(
      client.getQueryData<WorkItemDetail>(["tools", "work-item", "work-1", undefined])
        ?.workspaceEdits?.[0]?.status,
    ).toBe("reverted");
    await user.click(screen.getByRole("button", { name: "撤销本轮修改" }));
    expect(screen.getByRole("alertdialog", { name: "撤销本轮文件修改？" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() =>
      expect(undoWorkspaceEdits).toHaveBeenLastCalledWith({ workItemId: "work-1", runId: "run-1" }),
    );
  });

  it("disables undo during generation", () => {
    fixture("running");
    for (const button of screen.getAllByRole("button"))
      expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText("本轮结束后可撤销已记录的文件修改。")).toBeTruthy();
  });

  it("labels reverted edits as historical output", () => {
    fixture("completed", "reverted");
    expect(screen.getAllByText("已撤销")).toHaveLength(2);
    expect(
      screen.getAllByText("工作区已恢复到撤销前状态；原始差异仅作为历史输出记录保留。"),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /撤销修改/u })).toBeNull();
  });

  it("keeps conflict errors visible without changing the edit status", async () => {
    const { client, undoWorkspaceEdits, user } = fixture();
    undoWorkspaceEdits.mockRejectedValueOnce(
      new Error("WORKSPACE_UNDO_CONTENT_CHANGED: src/app.ts"),
    );
    await user.click(screen.getByRole("button", { name: "撤销本轮修改" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect((await screen.findByRole("alert")).textContent).toContain("本次未覆盖文件");
    expect(
      client.getQueryData<WorkItemDetail>(["tools", "work-item", "work-1", undefined])
        ?.workspaceEdits?.[0]?.status,
    ).toBe("applied");
  });
});
