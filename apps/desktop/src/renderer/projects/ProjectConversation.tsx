import type { Conversation, ConversationSnapshot, ProjectDirectoryState } from "@openerx/contracts";
import { ArrowRight, FolderSimple, X } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { projectKeys, useProject, useProjectList } from "./use-projects";

function operationId(): string {
  return crypto.randomUUID();
}

function moveError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("PROJECT_MOVE_BLOCKED_BY_ACTIVE_RUN")) {
    return "当前回复仍在运行。请先停止或等待完成，再更改项目。";
  }
  if (message.includes("CONVERSATION_REVISION_CONFLICT")) {
    return "对话刚刚在其他位置更新，请关闭确认框后重试。";
  }
  return "暂时无法更改项目，请稍后重试。";
}

function DirectoryDifference({
  title,
  directories,
  emptyLabel,
}: {
  title: string;
  directories: ProjectDirectoryState[];
  emptyLabel: string;
}): React.JSX.Element {
  return (
    <section className="project-move-scope">
      <h3>{title}</h3>
      {directories.length > 0 ? (
        <ul>
          {directories.map((state) => (
            <li key={state.directory.id}>
              <FolderSimple size={16} />
              <span className="project-move-directory-copy">
                <strong>{state.directory.displayName}</strong>
                <small className="project-move-directory-meta">
                  {state.directory.role === "primary" ? "主目录" : "附加目录"} ·{" "}
                  {state.directory.desiredAccess === "read_write" ? "可读写" : "只读"} ·{" "}
                  {state.connectionState === "connected" ? "当前设备已连接" : "需要重连"}
                </small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="project-move-note">{emptyLabel}</p>
      )}
    </section>
  );
}

export function ConversationProjectBadge({
  projectId,
}: {
  projectId: string | null;
}): React.JSX.Element | null {
  const project = useProject(projectId ?? "");
  if (!projectId) return null;
  return (
    <NavLink className="conversation-project-badge" to={`/projects/${projectId}`}>
      <FolderSimple size={14} weight="fill" />
      <span>{project.data?.project.name ?? "项目"}</span>
    </NavLink>
  );
}

export function ConversationProjectMoveDialog({
  conversation,
  onClose,
  onMoved,
}: {
  conversation: Conversation;
  onClose: () => void;
  onMoved: (projectName: string | null) => void;
}): React.JSX.Element {
  const [targetProjectId, setTargetProjectId] = useState(conversation.projectId ?? "");
  const projects = useProjectList(false);
  const currentProject = useProject(conversation.projectId ?? "");
  const targetProject = useProject(targetProjectId);
  const queryClient = useQueryClient();
  const targetName = targetProject.data?.project.name ?? null;
  const unchanged = targetProjectId === (conversation.projectId ?? "");
  const move = useMutation({
    mutationFn: () =>
      window.openerx.moveConversationToProject({
        operationId: operationId(),
        conversationId: conversation.id,
        projectId: targetProjectId || null,
        expectedConversationRevision: conversation.revision,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ConversationSnapshot>(
        ["chat", "conversation", conversation.id],
        (snapshot) => (snapshot ? { ...snapshot, conversation: updated } : snapshot),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat", "list"] }),
        queryClient.invalidateQueries({ queryKey: projectKeys.root }),
        queryClient.invalidateQueries({ queryKey: ["workspaces", conversation.id] }),
      ]);
      onMoved(targetName);
      onClose();
    },
  });
  const targetReady = targetProjectId.length === 0 || Boolean(targetProject.data);

  return (
    <div className="project-dialog-backdrop">
      <section
        className="project-dialog project-move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-move-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header>
          <div>
            <p className="project-panel-eyebrow">对话归属</p>
            <h2 id="project-move-title">更改所属项目</h2>
          </div>
          <button type="button" aria-label="关闭更改项目" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="project-move-content">
          <label>
            <span>目标项目</span>
            <select
              aria-label="目标项目"
              value={targetProjectId}
              onChange={(event) => setTargetProjectId(event.target.value)}
            >
              <option value="">不属于项目</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <div className="project-move-summary" aria-live="polite">
            <div>
              <span>{currentProject.data?.project.name ?? "无项目"}</span>
              <ArrowRight size={17} />
              <strong>{targetProject.data?.project.name ?? "无项目"}</strong>
            </div>
            <p className="project-move-note">
              只影响下一轮生成；现有消息、成果和已完成运行保持不变。
            </p>
          </div>

          {conversation.projectId ? (
            <DirectoryDifference
              title="下一轮将不再继承"
              directories={currentProject.data?.directories ?? []}
              emptyLabel="原项目没有目录；只移除原项目说明。"
            />
          ) : null}
          {targetProjectId ? (
            <DirectoryDifference
              title="下一轮将继承"
              directories={targetProject.data?.directories ?? []}
              emptyLabel="目标项目没有目录；只继承项目说明。"
            />
          ) : (
            <section className="project-move-scope">
              <h3>下一轮保持</h3>
              <p className="project-move-note">仅为此对话添加的文件和目录不会被移除。</p>
            </section>
          )}

          {move.error ? <p className="project-inline-error">{moveError(move.error)}</p> : null}
        </div>
        <footer className="project-move-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="project-primary-button"
            disabled={unchanged || !targetReady || move.isPending}
            onClick={() => move.mutate()}
          >
            {move.isPending ? "正在更改…" : "确认更改"}
          </button>
        </footer>
      </section>
    </div>
  );
}
