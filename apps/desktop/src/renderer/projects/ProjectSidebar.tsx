import type { ConversationSummary } from "@openerx/contracts";
import {
  CaretRight,
  ChatCircle,
  FolderSimple,
  Info,
  Plus,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { type UseQueryResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { matchPath, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ConversationDeleteButton } from "../ConversationDeletion";
import { projectKeys, useProjectList } from "./use-projects";

function operationId(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "项目暂时无法保存，请稍后重试。";
}

export function ProjectSidebar({
  conversations,
}: {
  conversations: UseQueryResult<ConversationSummary[]>;
}): React.JSX.Element {
  const [showArchived, setShowArchived] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const projects = useProjectList(showArchived);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentConversationId = matchPath("/chat/:conversationId", pathname)?.params.conversationId;
  const currentProjectId =
    matchPath("/projects/:projectId/*", pathname)?.params.projectId ??
    conversations.data?.find(({ id }) => id === currentConversationId)?.projectId;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation within the same project must reveal the selected conversation after a manual collapse.
  useEffect(() => {
    if (!currentProjectId) return;
    setExpandedProjects((current) =>
      current.has(currentProjectId) ? current : new Set([...current, currentProjectId]),
    );
  }, [currentProjectId, pathname]);

  function toggleProject(projectId: string): void {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }
  const create = useMutation({
    mutationFn: () =>
      window.openerx.createProject({
        operationId: operationId(),
        name,
        instructions,
      }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.root });
      setCreateOpen(false);
      setName("");
      setInstructions("");
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <section className="project-sidebar" aria-label="项目">
      <div className="project-sidebar-heading">
        <span>{showArchived ? "项目 · 含归档" : "项目"}</span>
        <div>
          <button
            type="button"
            aria-label={showArchived ? "仅显示活动项目" : "显示归档项目"}
            aria-pressed={showArchived}
            onClick={() => setShowArchived((value) => !value)}
          >
            <SlidersHorizontal size={14} />
          </button>
          <button type="button" aria-label="新建项目" onClick={() => setCreateOpen(true)}>
            <Plus size={14} weight="bold" />
          </button>
        </div>
      </div>
      <nav className="project-sidebar-list" aria-label="项目列表">
        {projects.data?.map((project) => {
          const expanded = expandedProjects.has(project.id);
          const projectConversations = conversations.data?.filter(
            (conversation) => conversation.projectId === project.id,
          );
          const listId = `project-conversations-${project.id}`;
          return (
            <div className="project-sidebar-group" key={project.id}>
              <div
                className={`project-sidebar-row${currentProjectId === project.id ? " current" : ""}`}
              >
                <button
                  type="button"
                  className="project-sidebar-toggle"
                  aria-label={project.name}
                  aria-expanded={expanded}
                  aria-controls={listId}
                  title={project.name}
                  onClick={() => toggleProject(project.id)}
                >
                  <CaretRight className="project-sidebar-caret" size={12} />
                  <FolderSimple
                    size={16}
                    weight={project.pinnedRank === null ? "regular" : "fill"}
                  />
                  <span className="project-sidebar-copy">
                    <strong>{project.name}</strong>
                    {project.archivedAt || project.reconnectRequiredCount > 0 ? (
                      <small>
                        {project.archivedAt ? "已归档" : ""}
                        {project.archivedAt && project.reconnectRequiredCount > 0 ? " · " : ""}
                        {project.reconnectRequiredCount > 0
                          ? `${project.reconnectRequiredCount} 个目录待重连`
                          : ""}
                      </small>
                    ) : null}
                  </span>
                </button>
                <div className="project-sidebar-actions">
                  <NavLink
                    to={`/projects/${project.id}`}
                    aria-label={`打开 ${project.name} 项目概览`}
                    title="项目概览"
                  >
                    <Info size={15} />
                  </NavLink>
                  {!project.archivedAt ? (
                    <NavLink
                      to={`/projects/${project.id}/new`}
                      aria-label={`在 ${project.name} 中新建对话`}
                      title="在此项目中新建对话"
                    >
                      <Plus size={15} />
                    </NavLink>
                  ) : null}
                </div>
              </div>
              <section
                id={listId}
                className="project-sidebar-conversations"
                aria-label={`${project.name} 的对话`}
                hidden={!expanded}
              >
                {expanded ? (
                  <>
                    {projectConversations?.map((conversation) => (
                      <div className="conversation-list-row" key={conversation.id}>
                        <NavLink
                          to={`/chat/${conversation.id}`}
                          className={({ isActive }) =>
                            `project-sidebar-conversation${isActive ? " active" : ""}`
                          }
                          title={conversation.title}
                        >
                          <ChatCircle size={14} />
                          <span>{conversation.title}</span>
                          {conversation.archivedAt ? <small>已归档</small> : null}
                        </NavLink>
                        <ConversationDeleteButton conversation={conversation} />
                      </div>
                    ))}
                    {conversations.isPending ? (
                      <p className="project-sidebar-state" role="status">
                        正在加载对话…
                      </p>
                    ) : conversations.isError ? (
                      <div className="project-sidebar-state" role="status">
                        对话加载失败。
                        <button type="button" onClick={() => void conversations.refetch()}>
                          重试
                        </button>
                      </div>
                    ) : projectConversations?.length === 0 ? (
                      <p className="project-sidebar-state">暂无对话</p>
                    ) : null}
                  </>
                ) : null}
              </section>
            </div>
          );
        })}
      </nav>
      {projects.isSuccess && projects.data.length === 0 ? (
        <p className="project-sidebar-empty">还没有项目。新对话仍可直接使用。</p>
      ) : null}
      {projects.error ? <p className="project-inline-error">项目列表暂时不可用。</p> : null}

      {createOpen ? (
        <div className="project-dialog-backdrop">
          <section
            className="project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
          >
            <header>
              <div>
                <p className="project-panel-eyebrow">个人工作区</p>
                <h2 id="new-project-title">新建项目</h2>
              </div>
              <button type="button" aria-label="关闭新建项目" onClick={() => setCreateOpen(false)}>
                <X size={17} />
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <label>
                <span>项目名称</span>
                <input
                  maxLength={80}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：年度市场报告"
                />
              </label>
              <label>
                <span>项目说明（可选）</span>
                <textarea
                  maxLength={20_000}
                  rows={5}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="说明目标、偏好和长期上下文；不要填写密码或密钥。"
                />
              </label>
              {create.error ? (
                <p className="project-inline-error">{errorMessage(create.error)}</p>
              ) : null}
              <footer>
                <button type="button" onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button
                  className="project-primary-button"
                  type="submit"
                  disabled={create.isPending || !name.trim()}
                >
                  {create.isPending ? "正在创建…" : "创建项目"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
