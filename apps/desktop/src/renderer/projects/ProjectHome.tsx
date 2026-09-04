import type { ConversationSummary } from "@openerx/contracts";
import { ChatCircle, FolderSimple, GearSix, Plus, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { ProjectSettings } from "./ProjectSettings";
import { useProject } from "./use-projects";

function updatedLabel(timestamp: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(
    new Date(timestamp),
  );
}

export function ProjectHome(): React.JSX.Element {
  const projectId = useParams<{ projectId: string }>().projectId ?? "";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const detail = useProject(projectId);
  const conversations = useQuery({
    queryKey: ["chat", "list", "project", projectId],
    queryFn: () => window.openerx.listConversations({ includeArchived: true }),
    select: (items) => items.filter((conversation) => conversation.projectId === projectId),
    enabled: projectId.length > 0,
  });

  if (detail.isPending) {
    return (
      <main className="project-page">
        <p className="project-page-state">正在打开项目…</p>
      </main>
    );
  }
  if (!detail.data || detail.error) {
    return (
      <main className="project-page">
        <section className="project-error-state" role="alert">
          <WarningCircle size={24} />
          <h1>项目暂时无法打开</h1>
          <p className="project-empty-description">它可能已被移除，或 App Service 暂时不可用。</p>
        </section>
      </main>
    );
  }

  const project = detail.data.project;
  const connected = detail.data.directories.filter(
    ({ connectionState }) => connectionState === "connected",
  ).length;

  return (
    <main className="project-page">
      <header className="project-page-header">
        <div>
          <p className="project-eyebrow">{project.archivedAt ? "已归档项目" : "个人项目"}</p>
          <h1>{project.name}</h1>
          <p>{project.instructions || "还没有项目说明。可以在设置中补充长期目标和偏好。"}</p>
        </div>
        <div className="project-header-actions">
          {!project.archivedAt ? (
            <NavLink className="project-primary-button" to={`/projects/${project.id}/new`}>
              <Plus size={16} weight="bold" /> 在此项目中开始对话
            </NavLink>
          ) : null}
          <button
            type="button"
            className="project-secondary-button"
            onClick={() => setSettingsOpen(true)}
          >
            <GearSix size={16} /> 项目设置
          </button>
        </div>
      </header>

      <section className="project-metrics" aria-label="项目概览">
        <article>
          <strong>{conversations.data?.length ?? 0}</strong>
          <span className="project-metric-label">个对话</span>
        </article>
        <article>
          <strong>{detail.data.directories.length}</strong>
          <span className="project-metric-label">个目录</span>
        </article>
        <article>
          <strong>{connected}</strong>
          <span className="project-metric-label">当前设备已连接</span>
        </article>
      </section>

      {detail.data.directories.some(
        ({ connectionState }) => connectionState === "reconnect_required",
      ) ? (
        <button
          type="button"
          className="project-reconnect-banner"
          onClick={() => setSettingsOpen(true)}
        >
          <WarningCircle size={18} />
          <span>部分项目目录需要在这台设备重新连接。纯聊天仍可使用，目录工具会保持关闭。</span>
        </button>
      ) : null}

      <section className="project-home-section" aria-labelledby="project-conversations-title">
        <div className="project-section-heading">
          <div>
            <h2 id="project-conversations-title">项目对话</h2>
            <p className="project-section-description">
              项目说明和当前设备可用目录会在每一轮生成前重新解析。
            </p>
          </div>
        </div>
        <div className="project-conversation-list">
          {conversations.data?.map((conversation: ConversationSummary) => (
            <NavLink key={conversation.id} to={`/chat/${conversation.id}`}>
              <ChatCircle size={18} />
              <span className="project-list-copy">
                <strong>{conversation.title}</strong>
                <small className="project-list-meta">
                  {conversation.archivedAt ? "已归档 · " : ""}
                  {updatedLabel(conversation.updatedAt)} · {conversation.lastMessagePreview}
                </small>
              </span>
            </NavLink>
          ))}
          {conversations.isSuccess && conversations.data.length === 0 ? (
            <div className="project-empty-state">
              <ChatCircle size={24} />
              <h3>还没有项目对话</h3>
              <p className="project-empty-description">
                从这个项目开始的新对话会自动继承项目说明和已连接目录。
              </p>
              {!project.archivedAt ? (
                <NavLink to={`/projects/${project.id}/new`}>开始第一个对话</NavLink>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="project-home-section" aria-labelledby="project-directory-summary-title">
        <div className="project-section-heading">
          <div>
            <h2 id="project-directory-summary-title">目录</h2>
            <p className="project-section-description">真实路径和授权只保存在当前设备。</p>
          </div>
          <button
            type="button"
            className="project-text-button"
            onClick={() => setSettingsOpen(true)}
          >
            管理目录
          </button>
        </div>
        <div className="project-directory-summary">
          {detail.data.directories.map((state) => (
            <article key={state.directory.id}>
              <FolderSimple size={19} />
              <span className="project-list-copy">
                <strong>{state.directory.displayName}</strong>
                <small className="project-list-meta">
                  {state.directory.role === "primary" ? "主目录" : "附加目录"} ·{" "}
                  {state.directory.desiredAccess === "read_write" ? "可读写" : "只读"}
                </small>
              </span>
              <em data-state={state.connectionState}>
                {state.connectionState === "connected" ? "已连接" : "需要重连"}
              </em>
            </article>
          ))}
          {detail.data.directories.length === 0 ? (
            <p className="project-empty-copy">此项目没有目录。</p>
          ) : null}
        </div>
      </section>

      {settingsOpen ? (
        <ProjectSettings detail={detail.data} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </main>
  );
}
