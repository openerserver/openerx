import { FolderSimple, Plus, SlidersHorizontal, X } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { projectKeys, useProjectList } from "./use-projects";

function operationId(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "项目暂时无法保存，请稍后重试。";
}

export function ProjectSidebar(): React.JSX.Element {
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const projects = useProjectList(showArchived);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
        {projects.data?.map((project) => (
          <NavLink
            key={project.id}
            to={`/projects/${project.id}`}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            <FolderSimple size={16} weight={project.pinnedRank === null ? "regular" : "fill"} />
            <span className="project-sidebar-copy">
              <strong>{project.name}</strong>
              <small>
                {project.archivedAt ? "已归档 · " : ""}
                {project.conversationCount} 个对话
                {project.reconnectRequiredCount > 0
                  ? ` · ${project.reconnectRequiredCount} 个目录待重连`
                  : ""}
              </small>
            </span>
          </NavLink>
        ))}
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
