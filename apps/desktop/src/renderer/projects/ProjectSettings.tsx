import type { ProjectDetail, ProjectDirectoryState } from "@openerx/contracts";
import { FolderOpen, Plug, Trash, X } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { projectKeys } from "./use-projects";

function operationId(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "项目设置暂时无法更新，请稍后重试。";
}

export function ProjectSettings({
  detail,
  onClose,
}: {
  detail: ProjectDetail;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState(detail.project.name);
  const [instructions, setInstructions] = useState(detail.project.instructions);
  const [pinned, setPinned] = useState(detail.project.pinnedRank !== null);
  const [directoryAccess, setDirectoryAccess] = useState<"read_only" | "read_write">("read_write");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setName(detail.project.name);
    setInstructions(detail.project.instructions);
    setPinned(detail.project.pinnedRank !== null);
  }, [detail.project.instructions, detail.project.name, detail.project.pinnedRank]);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: projectKeys.root });
  };
  const update = useMutation({
    mutationFn: () =>
      window.openerx.updateProject({
        operationId: operationId(),
        projectId: detail.project.id,
        expectedRevision: detail.project.revision,
        name,
        instructions,
        pinnedRank: pinned ? (detail.project.pinnedRank ?? 0) : null,
      }),
    onSuccess: async () => {
      await refresh();
      setNotice("项目设置已保存。");
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      detail.project.archivedAt
        ? window.openerx.restoreProject({
            operationId: operationId(),
            projectId: detail.project.id,
            expectedRevision: detail.project.revision,
          })
        : window.openerx.archiveProject({
            operationId: operationId(),
            projectId: detail.project.id,
            expectedRevision: detail.project.revision,
          }),
    onSuccess: async () => {
      await refresh();
      setNotice(detail.project.archivedAt ? "项目已恢复。" : "项目已归档；本机文件没有被删除。");
    },
  });
  const chooseDirectory = useMutation({
    mutationFn: (input: {
      projectDirectoryId: string | null;
      desiredAccess: "read_only" | "read_write";
    }) =>
      window.openerx.chooseProjectDirectory({
        operationId: operationId(),
        projectId: detail.project.id,
        projectDirectoryId: input.projectDirectoryId,
        expectedProjectRevision: detail.project.revision,
        desiredAccess: input.desiredAccess,
      }),
    onSuccess: async (state) => {
      if (state) {
        await refresh();
        setNotice(state.directory.role === "primary" ? "主目录已连接。" : "附加目录已连接。");
      }
    },
  });
  const setPrimary = useMutation({
    mutationFn: (projectDirectoryId: string) =>
      window.openerx.setPrimaryProjectDirectory({
        operationId: operationId(),
        projectId: detail.project.id,
        projectDirectoryId,
        expectedProjectRevision: detail.project.revision,
      }),
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: (projectDirectoryId: string) =>
      window.openerx.disconnectProjectDirectory({
        operationId: operationId(),
        projectDirectoryId,
        expectedProjectRevision: detail.project.revision,
      }),
    onSuccess: async () => {
      await refresh();
      setNotice("此设备上的目录授权已断开。");
    },
  });
  const remove = useMutation({
    mutationFn: (state: ProjectDirectoryState) => {
      const replacementPrimaryDirectoryId =
        state.directory.role === "primary"
          ? (detail.directories.find(({ directory }) => directory.id !== state.directory.id)
              ?.directory.id ?? null)
          : null;
      return window.openerx.removeProjectDirectory({
        operationId: operationId(),
        projectId: detail.project.id,
        projectDirectoryId: state.directory.id,
        replacementPrimaryDirectoryId,
        expectedProjectRevision: detail.project.revision,
      });
    },
    onSuccess: async () => {
      await refresh();
      setNotice("目录已移出项目；磁盘文件没有被删除。");
    },
  });
  const busy =
    update.isPending ||
    archive.isPending ||
    chooseDirectory.isPending ||
    setPrimary.isPending ||
    disconnect.isPending ||
    remove.isPending;
  const mutationError =
    update.error ??
    archive.error ??
    chooseDirectory.error ??
    setPrimary.error ??
    disconnect.error ??
    remove.error;

  return (
    <aside className="project-settings-panel" aria-labelledby="project-settings-title">
      <header>
        <div>
          <p className="project-panel-eyebrow">项目配置</p>
          <h2 id="project-settings-title">设置</h2>
        </div>
        <button type="button" aria-label="关闭项目设置" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <form
        className="project-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) update.mutate();
        }}
      >
        <label>
          <span>名称</span>
          <input
            maxLength={80}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <span>项目说明</span>
          <textarea
            maxLength={20_000}
            rows={7}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <small>每轮对话都会继承；说明不能改变工具或目录权限。</small>
        </label>
        <label className="project-checkbox-field">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
          />
          <span>在侧栏置顶</span>
        </label>
        <button className="project-primary-button" type="submit" disabled={busy || !name.trim()}>
          保存设置
        </button>
      </form>

      <section className="project-directory-settings" aria-labelledby="project-directories-title">
        <div className="project-section-heading">
          <div>
            <h3 id="project-directories-title">本机目录</h3>
            <p className="project-section-description">
              第一个目录自动成为主目录。路径只保存在当前设备。
            </p>
          </div>
          <div className="project-add-directory-controls">
            <select
              aria-label="新目录访问权限"
              value={directoryAccess}
              onChange={(event) =>
                setDirectoryAccess(event.target.value as "read_only" | "read_write")
              }
            >
              <option value="read_write">可读写</option>
              <option value="read_only">只读</option>
            </select>
            <button
              type="button"
              className="project-secondary-button"
              disabled={busy || Boolean(detail.project.archivedAt)}
              onClick={() =>
                chooseDirectory.mutate({ projectDirectoryId: null, desiredAccess: directoryAccess })
              }
            >
              <FolderOpen size={16} /> 添加目录
            </button>
          </div>
        </div>
        <div className="project-directory-list">
          {detail.directories.map((state) => (
            <article key={state.directory.id}>
              <div className="project-directory-copy">
                <strong>{state.directory.displayName}</strong>
                <span className="project-directory-meta">
                  {state.directory.role === "primary" ? "主目录" : "附加目录"} ·{" "}
                  {state.directory.desiredAccess === "read_write" ? "可读写" : "只读"} ·{" "}
                  {state.connectionState === "connected" ? "已连接" : "需要重连"}
                </span>
              </div>
              <div className="project-directory-actions">
                {state.connectionState === "reconnect_required" ? (
                  <button
                    type="button"
                    disabled={busy || Boolean(detail.project.archivedAt)}
                    onClick={() =>
                      chooseDirectory.mutate({
                        projectDirectoryId: state.directory.id,
                        desiredAccess: state.directory.desiredAccess,
                      })
                    }
                  >
                    <Plug size={15} /> 重连
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => disconnect.mutate(state.directory.id)}
                  >
                    断开
                  </button>
                )}
                {state.directory.role !== "primary" ? (
                  <button
                    type="button"
                    disabled={busy || Boolean(detail.project.archivedAt)}
                    onClick={() => setPrimary.mutate(state.directory.id)}
                  >
                    设为主目录
                  </button>
                ) : null}
                <button
                  type="button"
                  className="project-danger-quiet"
                  disabled={busy || Boolean(detail.project.archivedAt)}
                  onClick={() => remove.mutate(state)}
                >
                  <Trash size={15} /> 移出
                </button>
              </div>
            </article>
          ))}
          {detail.directories.length === 0 ? (
            <p className="project-empty-copy">尚未绑定目录；项目仍可用于纯聊天。</p>
          ) : null}
        </div>
      </section>

      {notice ? (
        <p className="project-notice" role="status">
          {notice}
        </p>
      ) : null}
      {mutationError ? <p className="project-inline-error">{errorMessage(mutationError)}</p> : null}

      <section className="project-archive-settings">
        <h3 className="project-archive-title">
          {detail.project.archivedAt ? "恢复项目" : "归档项目"}
        </h3>
        <p className="project-archive-description">
          {detail.project.archivedAt
            ? "恢复后可以继续创建项目对话和管理目录。"
            : "归档不会删除对话或磁盘中的文件。"}
        </p>
        <button type="button" disabled={busy} onClick={() => archive.mutate()}>
          {archive.isPending ? "正在处理…" : detail.project.archivedAt ? "恢复项目" : "归档项目"}
        </button>
      </section>
    </aside>
  );
}
