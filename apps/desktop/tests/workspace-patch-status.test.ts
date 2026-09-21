import type { ToolCall, WorkspaceEditSummary } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { workspacePatchStatus } from "../src/renderer/workspace-patch-status";

const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;
const update = (file: string) => `*** Update File: ${file}\n@@\n-before\n+after`;
function fixture() {
  const failed: ToolCall = {
    id: "failed",
    runId: "run",
    stepId: "step",
    piCallRef: "call-1",
    toolName: "openerx_workspace_apply_patch",
    source: "openerx",
    status: "failed",
    risk: "L3",
    idempotencyKey: "failed-patch",
    input: {
      operation: "workspace_patch",
      workspaceGrantId: "grant",
      idempotencyKey: "failed-patch",
      patch: patch(update("a.txt")),
    },
    inputSummary: "patch",
    targetSummary: "grant",
    resultSummary: null,
    resultContent: [],
    errorCode: "WORKSPACE_READ_REQUIRED",
    startedAt: "2026-09-20T01:00:00.000Z",
    completedAt: "2026-09-20T01:00:01.000Z",
    updatedAt: "2026-09-20T01:00:01.000Z",
  };
  const succeeded: ToolCall = {
    ...failed,
    id: "success",
    status: "completed",
    errorCode: null,
    startedAt: "2026-09-20T01:00:02.000Z",
    completedAt: "2026-09-20T01:00:03.000Z",
    resultContent: [
      { type: "diff", workspaceChangeId: "edit", relativePath: "a.txt", patch: "-before\n+after" },
    ],
  };
  const edit: WorkspaceEditSummary = {
    id: "edit",
    kind: "change_set",
    workspaceGrantId: "grant",
    relativePaths: ["a.txt"],
    status: "applied",
    canUndo: true,
    createdAt: "2026-09-20T01:00:03.000Z",
  };
  return { failed, succeeded, edit };
}

describe("workspace patch recovery presentation", () => {
  it("explains the missing read without implying approval or success", () => {
    const { failed } = fixture();
    expect(workspacePatchStatus(failed, [failed], [])).toMatchObject({
      recovered: false,
      label: "未写入 · 需修正后重试",
      message: expect.stringContaining("无需再次授权"),
    });
  });

  it("recognizes a later identical patch only with persisted applied diffs", () => {
    const { failed, succeeded, edit } = fixture();
    expect(workspacePatchStatus(failed, [failed, succeeded], [edit])).toMatchObject({
      recovered: true,
      label: "后续重试成功",
    });
    expect(failed.status).toBe("failed"); // Presentation does not rewrite the audit trail.
  });

  it.each([
    "other-run",
    "other-grant",
    "earlier",
    "unrelated-content",
    "no-diff",
    "no-edit",
    "reverted",
    "pending",
    "failed",
    "cancelled",
  ])("does not infer recovery from %s", (caseName) => {
    const { failed, succeeded, edit } = fixture();
    if (caseName === "other-run") succeeded.runId = "another-run";
    if (caseName === "other-grant" && succeeded.input?.operation === "workspace_patch")
      succeeded.input = { ...succeeded.input, workspaceGrantId: "another-grant" };
    if (caseName === "earlier") succeeded.startedAt = "2026-09-20T00:59:59.000Z";
    if (caseName === "unrelated-content" && succeeded.input?.operation === "workspace_patch")
      succeeded.input = {
        ...succeeded.input,
        patch: patch(update("a.txt").replace("+after", "+unrelated")),
      };
    if (caseName === "no-diff") succeeded.resultContent = [];
    if (caseName === "reverted") edit.status = "reverted";
    if (caseName === "pending") edit.status = "pending_review";
    if (caseName === "failed" || caseName === "cancelled") succeeded.status = caseName;
    expect(
      workspacePatchStatus(failed, [failed, succeeded], caseName === "no-edit" ? [] : [edit])
        ?.recovered,
    ).toBe(false);
  });

  it("requires all files, including a split Delete+Add replacement's final Add", () => {
    const { failed, succeeded, edit } = fixture();
    const add = "*** Add File: b.txt\n+replacement";
    failed.input = {
      operation: "workspace_patch",
      workspaceGrantId: "grant",
      idempotencyKey: "failed-patch",
      patch: patch(`${update("a.txt")}\n*** Delete File: b.txt\n${add}`),
    };
    const deleted: ToolCall = {
      ...succeeded,
      id: "delete",
      input: { ...failed.input, patch: patch("*** Delete File: b.txt") },
      resultContent: [
        { type: "diff", workspaceChangeId: "delete-edit", relativePath: "b.txt", patch: "-before" },
      ],
    };
    const deleteEdit = { ...edit, id: "delete-edit", relativePaths: ["b.txt"] };
    expect(workspacePatchStatus(failed, [succeeded, deleted], [edit, deleteEdit])?.recovered).toBe(
      false,
    );
    const added: ToolCall = {
      ...deleted,
      id: "add",
      input: { ...failed.input, patch: patch(add) },
      resultContent: [
        {
          type: "diff",
          workspaceChangeId: "add-edit",
          relativePath: "b.txt",
          patch: "+replacement",
        },
      ],
    };
    expect(
      workspacePatchStatus(
        failed,
        [succeeded, deleted, added],
        [edit, deleteEdit, { ...deleteEdit, id: "add-edit" }],
      )?.recovered,
    ).toBe(true);
  });

  it("corrects legacy no-write completed labels without a database migration", () => {
    const { failed, succeeded, edit } = fixture();
    failed.status = "completed";
    failed.errorCode = null;
    failed.resultSummary = "工作区补丁需要先完成前置读取，未写入文件";
    expect(workspacePatchStatus(failed, [failed], [])?.recovered).toBe(false);
    expect(workspacePatchStatus(failed, [failed, succeeded], [edit])?.recovered).toBe(true);
  });

  it("does not relabel permission or cancellation errors", () => {
    const { failed, succeeded, edit } = fixture();
    failed.errorCode = "PERMISSION_DENIED";
    expect(workspacePatchStatus(failed, [succeeded], [edit])).toBeNull();
    failed.status = "cancelled";
    failed.errorCode = "WORKSPACE_READ_REQUIRED";
    expect(workspacePatchStatus(failed, [succeeded], [edit])).toBeNull();
  });
});
