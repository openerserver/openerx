import type { WorkItemDetail } from "@openerx/contracts";
import { ArrowCounterClockwise, FileCode } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import "./workspace-edits.css";

type UndoConfirmation = { kind: "run" } | { kind: "edit"; editId: string };

export function WorkItemWorkspaceEdits({
  workItemId,
  runId,
}: {
  workItemId: string;
  runId: string | null;
}): React.JSX.Element | null {
  const detail = useQuery({
    queryKey: ["tools", "work-item", workItemId, runId],
    queryFn: () => window.openerx.getWorkItem({ workItemId, ...(runId ? { runId } : {}) }),
  });
  return detail.data ? <WorkspaceEdits key={detail.data.run.id} detail={detail.data} /> : null;
}

function undoError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/WORKSPACE_UNDO_RUN_ACTIVE/u.test(message)) return "任务仍在运行，请在本轮结束后撤销。";
  if (/WORKSPACE_(UNDO_CONTENT_CHANGED|CHANGE_SET_CONFLICT)/u.test(message))
    return "文件已有后续变化，本次未覆盖文件。请先查看最新内容。";
  if (/WORKSPACE_UNDO_RECOVERY_PENDING/u.test(message)) return "请先继续完成上次中断的撤销。";
  if (/RECOVERY_REQUIRED/u.test(message)) return "撤销未完成，部分文件需要根据修改记录恢复。";
  if (/GRANT|SCOPE|SYMLINK|PATH_|WRITE_NOT_GRANTED/u.test(message))
    return "文件位置或工作区授权已变化，无法撤销。";
  if (/CHANGE_SET_BLOCKED/u.test(message)) return "这组修改缺少可恢复的文件内容，无法自动撤销。";
  return "暂时无法撤销，请重试或查看修改记录。";
}

export function WorkspaceEdits({ detail }: { detail: WorkItemDetail }): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [undoConfirmation, setUndoConfirmation] = useState<UndoConfirmation | null>(null);
  const edits = detail.workspaceEdits ?? [];
  const undoable = edits.filter((edit) => edit.canUndo);
  const completed =
    ["completed", "failed", "interrupted", "cancelled"].includes(detail.run.status) &&
    ["completed", "failed", "interrupted", "cancelled"].includes(detail.workItem.status);
  const undo = useMutation({
    mutationFn: (editId: string | undefined) =>
      window.openerx.undoWorkspaceEdits({
        workItemId: detail.workItem.id,
        runId: detail.run.id,
        ...(editId ? { editId } : {}),
      }),
    onMutate: () => setNotice(""),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["tools", "work-item", detail.workItem.id] });
    },
    onSuccess: async (updated, editId) => {
      queryClient.setQueriesData<WorkItemDetail>(
        { queryKey: ["tools", "work-item", detail.workItem.id] },
        (current) => (current?.run.id === updated.run.id ? updated : current),
      );
      setNotice(editId ? "已撤销文件修改。" : "已撤销本轮已记录的文件修改。");
      setUndoConfirmation(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tools", "work-item", detail.workItem.id] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
      ]);
    },
  });
  if (!edits.length) return null;
  const fileCount = new Set(edits.flatMap(({ relativePaths }) => relativePaths)).size;
  const confirmationEdit =
    undoConfirmation?.kind === "edit"
      ? edits.find((edit) => edit.id === undoConfirmation.editId)
      : undefined;
  const confirmationPaths =
    undoConfirmation?.kind === "edit"
      ? (confirmationEdit?.relativePaths ?? [])
      : undoable.flatMap(({ relativePaths }) => relativePaths);
  const showUndoConfirmation =
    undoConfirmation?.kind === "run" || Boolean(confirmationEdit);
  const confirmUndo = () => {
    if (!undoConfirmation) return;
    undo.mutate(undoConfirmation.kind === "edit" ? undoConfirmation.editId : undefined);
  };
  return (
    <section className="workspace-edits" aria-label="文件修改">
      <header className="workspace-edits-header">
        <strong>
          <FileCode size={17} aria-hidden="true" />
          文件修改 <span className="workspace-edit-count">{fileCount}</span>
        </strong>
        {undoable.length > 1 ? (
          <button
            type="button"
            disabled={!completed || undo.isPending}
            onClick={() => setUndoConfirmation({ kind: "run" })}
          >
            <ArrowCounterClockwise size={14} aria-hidden="true" />
            撤销本轮修改
          </button>
        ) : null}
      </header>
      {edits.map((edit) => {
        const diffs = detail.items.flatMap(({ content }) =>
          content.type === "diff" && content.workspaceChangeId === edit.id ? [content] : [],
        );
        return (
          <div className="workspace-edit" key={edit.id}>
            <div className="workspace-edit-row">
              <div className="workspace-edit-paths">
                {edit.relativePaths.map((relativePath) => (
                  <span key={relativePath} title={relativePath}>
                    {relativePath}
                  </span>
                ))}
              </div>
              {edit.status === "reverted" ? (
                <span className="workspace-edit-reverted">已撤销</span>
              ) : edit.canUndo ? (
                <button
                  type="button"
                  disabled={!completed || undo.isPending}
                  aria-label={`撤销修改：${edit.relativePaths.join("、")}`}
                  onClick={() => setUndoConfirmation({ kind: "edit", editId: edit.id })}
                >
                  <ArrowCounterClockwise size={14} aria-hidden="true" />
                  {undo.isPending && undo.variables === edit.id ? "撤销中…" : "撤销这组修改"}
                </button>
              ) : (
                <span className="workspace-edit-reverted">
                  {["preparing", "applying", "pending_review", "reviewed"].includes(edit.status)
                    ? "尚未完成"
                    : "无法自动撤销"}
                </span>
              )}
            </div>
            {edit.status === "reverted" ? (
              <p className="workspace-edit-note">
                工作区已恢复到撤销前状态；原始差异仅作为历史输出记录保留。
              </p>
            ) : null}
            {diffs.length ? (
              <details className="workspace-edit-diffs">
                <summary>
                  {edit.status === "reverted" ? "查看已撤销的历史差异" : "查看差异"}
                </summary>
                {diffs.map((diff) => (
                  <div key={diff.relativePath}>
                    <strong>{diff.relativePath}</strong>
                    <pre>{diff.patch}</pre>
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        );
      })}
      {!completed && undoable.length ? (
        <p className="workspace-edit-note">本轮结束后可撤销已记录的文件修改。</p>
      ) : null}
      {completed && undoable.length ? (
        <p className="workspace-edit-note">撤销范围为这里记录的文件修改。</p>
      ) : null}
      {notice ? (
        <p className="workspace-edit-note" role="status">
          {notice}
        </p>
      ) : null}
      {undo.error && !showUndoConfirmation ? (
        <p className="inline-error" role="alert">
          {undoError(undo.error)}
        </p>
      ) : null}
      {showUndoConfirmation ? (
        <ConfirmDialog
          title={undoConfirmation?.kind === "edit" ? "撤销这组文件修改？" : "撤销本轮文件修改？"}
          description={
            undoConfirmation?.kind === "edit"
              ? "将恢复这组修改之前的文件内容；如果文件已有后续变化，系统会停止并保留当前内容。"
              : `将恢复本轮 ${undoable.length} 组已记录的文件修改；如果文件已有后续变化，系统会停止并保留当前内容。`
          }
          confirmLabel="确认撤销"
          pending={undo.isPending}
          onCancel={() => {
            if (!undo.isPending) setUndoConfirmation(null);
          }}
          onConfirm={confirmUndo}
        >
          {confirmationPaths.length ? (
            <p className="confirmation-dialog-target">{confirmationPaths.join("、")}</p>
          ) : null}
          {undo.error ? (
            <p className="inline-error" role="alert">
              {undoError(undo.error)}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
