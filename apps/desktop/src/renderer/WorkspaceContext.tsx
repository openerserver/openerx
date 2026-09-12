import type { WorkspaceGrant } from "@openerx/contracts";
import { CaretDown, FolderOpen, FolderSimple, Plus, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { withUiTimeout } from "./ui-timeout";
import "./workspace-context.css";

function useWorkspaces(conversationId: string) {
  return useQuery({
    queryKey: ["workspaces", conversationId],
    queryFn: () => withUiTimeout(window.openerx.listWorkspaces({ conversationId })),
    enabled: Boolean(conversationId),
    retry: false,
  });
}

function workspaceName(workspace: WorkspaceGrant): string {
  return workspace.bindingSource === "default" ? "任务专属目录" : workspace.displayName;
}

function sourceName(workspace: WorkspaceGrant): string {
  if (workspace.bindingSource === "project") return "来自项目";
  if (workspace.bindingSource === "default") return "自动创建";
  return workspace.conversationId ? "本对话设置" : "本机共享";
}

function expiryLabel(expiresAt: string | null): string {
  return expiresAt ? new Date(expiresAt).toLocaleString() : "长期有效";
}

function workspaceError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("WORKSPACE_DIRECTORY_REQUIRED") || message.includes("ENOENT")) {
    return "目录已不可用，请重新选择本机文件夹。";
  }
  if (message.includes("WORKSPACE_EXPIRY_INVALID")) return "有效期已过，请重新选择。";
  if (message.includes("WORKSPACE_GRANT_INACTIVE")) return "目录授权已失效，请重新添加。";
  return "暂时无法更新工作目录，请重试。";
}

export function WorkspaceLocation({
  conversationId,
  onOpen,
}: {
  conversationId: string;
  onOpen: () => void;
}): React.JSX.Element | null {
  const workspaces = useWorkspaces(conversationId);
  const primary =
    workspaces.data?.find((workspace) => workspace.bindingRole === "primary") ??
    workspaces.data?.[0];
  if (!primary) return null;
  return (
    <button
      type="button"
      className="conversation-directory-badge"
      aria-label={`工作目录 ${workspaceName(primary)}`}
      title={primary.rootPath}
      onClick={onOpen}
    >
      <FolderOpen size={14} aria-hidden="true" />
      <span>{workspaceName(primary)}</span>
      <CaretDown size={12} aria-hidden="true" />
    </button>
  );
}

function WorkspaceRow({
  workspace,
  primary,
  projectId,
  busy,
  onSelect,
  onRemove,
  onClose,
}: {
  workspace: WorkspaceGrant;
  primary: boolean;
  projectId: string | null;
  busy: boolean;
  onSelect: (workspace: WorkspaceGrant) => void;
  onRemove: (workspace: WorkspaceGrant) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <article className={`workspace-directory-row ${primary ? "is-primary" : ""}`}>
      <div className="workspace-directory-heading">
        {primary ? (
          <FolderOpen size={21} aria-hidden="true" />
        ) : (
          <FolderSimple size={20} aria-hidden="true" />
        )}
        <strong>{workspaceName(workspace)}</strong>
        <span className="workspace-source-tag">{sourceName(workspace)}</span>
      </div>
      <p className="workspace-directory-path" title={workspace.rootPath}>
        {workspace.rootPath}
      </p>
      <details className="workspace-directory-details">
        <summary>
          <span>
            {workspace.access === "read_write" ? "读写" : "只读"} ·{" "}
            {workspace.allowNetwork ? "可联网" : "禁止联网"}
          </span>
          <span>
            权限与操作 <CaretDown size={12} aria-hidden="true" />
          </span>
        </summary>
        <dl>
          <div>
            <dt>文件访问</dt>
            <dd>{workspace.access === "read_write" ? "读取与修改" : "仅读取"}</dd>
          </div>
          <div>
            <dt>Shell 网络</dt>
            <dd>{workspace.allowNetwork ? "允许" : "禁止"}</dd>
          </div>
          <div>
            <dt>有效期</dt>
            <dd>{expiryLabel(workspace.expiresAt)}</dd>
          </div>
        </dl>
        <div className="workspace-row-actions">
          {!primary ? (
            <button type="button" disabled={busy} onClick={() => onSelect(workspace)}>
              设为工作目录
            </button>
          ) : null}
          {workspace.bindingSource === "project" && projectId ? (
            <NavLink to={`/projects/${projectId}`} onClick={onClose}>
              管理项目目录
            </NavLink>
          ) : workspace.conversationId && workspace.bindingSource !== "default" ? (
            <button type="button" disabled={busy} onClick={() => onRemove(workspace)}>
              {primary ? "移除本对话设置" : "移除附加目录"}
            </button>
          ) : null}
        </div>
      </details>
    </article>
  );
}

export function WorkspaceSection({
  conversationId,
  projectId,
  onClose,
}: {
  conversationId: string;
  projectId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const workspaces = useWorkspaces(conversationId);
  const primary =
    workspaces.data?.find((workspace) => workspace.bindingRole === "primary") ??
    workspaces.data?.[0];
  const additional = workspaces.data?.filter((workspace) => workspace.id !== primary?.id) ?? [];
  const [pickerRole, setPickerRole] = useState<"primary" | "additional" | null>(null);
  const [access, setAccess] = useState<"read_only" | "read_write">("read_write");
  const [allowNetwork, setAllowNetwork] = useState(false);
  const [expiry, setExpiry] = useState("never");
  const [notice, setNotice] = useState<string | null>(null);
  const pickerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (pickerRole) pickerRef.current?.focus();
  }, [pickerRole]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspaces", conversationId] });
  const choose = useMutation({
    mutationFn: () =>
      window.openerx.chooseWorkspace({
        conversationId,
        role: pickerRole ?? "additional",
        access,
        allowNetwork: access === "read_write" && allowNetwork,
        expiresAt:
          expiry === "never"
            ? null
            : new Date(Date.now() + Number(expiry) * 60 * 60_000).toISOString(),
      }),
    onSuccess: async (workspace) => {
      await refresh();
      if (!workspace) return;
      setNotice(
        `${workspace.bindingRole === "primary" ? "工作目录已设为" : "已连接附加目录"} ${workspaceName(workspace)}。`,
      );
      setPickerRole(null);
    },
  });
  const select = useMutation({
    mutationFn: (workspace: WorkspaceGrant) =>
      window.openerx.setPrimaryWorkspace({ conversationId, workspaceGrantId: workspace.id }),
    onSuccess: async (workspace) => {
      await refresh();
      setNotice(`工作目录已设为 ${workspaceName(workspace)}，下一轮开始使用。`);
    },
  });
  const remove = useMutation({
    mutationFn: (workspace: WorkspaceGrant) =>
      window.openerx.revokeWorkspace({ workspaceGrantId: workspace.id }),
    onSuccess: async () => {
      await refresh();
      setNotice("已移除本对话的目录授权，磁盘文件保留。");
    },
  });
  const busy = choose.isPending || select.isPending || remove.isPending;
  const error = workspaces.error ?? choose.error ?? select.error ?? remove.error;
  const openPicker = (role: "primary" | "additional") => {
    choose.reset();
    setNotice(null);
    setPickerRole(role);
  };
  return (
    <section className="workspace-context" aria-labelledby="context-workspaces-title">
      <div className="workspace-section-heading">
        <h3 id="context-workspaces-title">当前工作目录</h3>
        <button type="button" disabled={busy} onClick={() => openPicker("primary")}>
          {primary ? "更换" : "选择目录"}
        </button>
      </div>
      {primary ? (
        <WorkspaceRow
          workspace={primary}
          primary
          projectId={projectId}
          busy={busy}
          onSelect={select.mutate}
          onRemove={remove.mutate}
          onClose={onClose}
        />
      ) : (
        <p className="workspace-help">
          {workspaces.isPending
            ? "正在读取工作目录…"
            : "开始任务后会自动准备专属目录，也可以选择已有文件夹。"}
        </p>
      )}
      {primary ? (
        <p className="workspace-help">
          {primary.access === "read_only"
            ? "当前目录只读，需要写入时请选择可读写的目录。"
            : "命令默认在此执行，新文件也保存在这里。"}
        </p>
      ) : null}
      <div className="workspace-section-heading workspace-additional-heading">
        <h3>
          附加目录 <span>{additional.length}</span>
        </h3>
        <button type="button" disabled={busy} onClick={() => openPicker("additional")}>
          <Plus size={14} aria-hidden="true" />
          添加
        </button>
      </div>
      {additional.map((workspace) => (
        <WorkspaceRow
          key={workspace.id}
          workspace={workspace}
          primary={false}
          projectId={projectId}
          busy={busy}
          onSelect={select.mutate}
          onRemove={remove.mutate}
          onClose={onClose}
        />
      ))}
      {additional.length === 0 ? (
        <p className="workspace-help">需要使用其他文件夹时再添加。</p>
      ) : null}
      {pickerRole ? (
        <section
          ref={pickerRef}
          tabIndex={-1}
          className="workspace-picker"
          aria-label={pickerRole === "primary" ? "更换工作目录" : "添加附加目录"}
        >
          <div className="workspace-section-heading">
            <h4>{pickerRole === "primary" ? "更换工作目录" : "添加附加目录"}</h4>
            <button
              type="button"
              aria-label="取消目录选择"
              disabled={busy}
              onClick={() => setPickerRole(null)}
            >
              <X size={15} />
            </button>
          </div>
          <p className="workspace-help">
            {pickerRole === "primary"
              ? "选择下一轮执行命令和创建文件的位置。"
              : "扩展本对话可访问的文件，不改变当前工作目录。"}
          </p>
          <label className="workspace-access-field">
            <span>访问权限</span>
            <select
              value={access}
              onChange={(event) => {
                const next = event.target.value as typeof access;
                setAccess(next);
                if (next === "read_only") setAllowNetwork(false);
              }}
            >
              <option value="read_write">读写</option>
              <option value="read_only">只读</option>
            </select>
          </label>
          <details className="workspace-picker-advanced">
            <summary>
              更多权限设置 <CaretDown size={12} aria-hidden="true" />
            </summary>
            <label className="workspace-access-field">
              <span>有效期</span>
              <select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                <option value="never">长期有效</option>
                <option value="1">1 小时</option>
                <option value="24">24 小时</option>
                <option value="168">7 天</option>
              </select>
            </label>
            <label className="workspace-network-field">
              <input
                type="checkbox"
                checked={allowNetwork}
                disabled={access === "read_only"}
                onChange={(event) => setAllowNetwork(event.target.checked)}
              />
              <span>允许 Shell 网络</span>
            </label>
          </details>
          <button
            type="button"
            className="workspace-choose-button"
            disabled={busy}
            onClick={() => choose.mutate()}
          >
            <FolderOpen size={16} aria-hidden="true" />
            {choose.isPending ? "正在选择…" : "选择本机文件夹"}
          </button>
        </section>
      ) : null}
      {error ? (
        <div className="workspace-feedback" role="alert">
          <p>{workspaceError(error)}</p>
          <button
            type="button"
            onClick={() => {
              choose.reset();
              select.reset();
              remove.reset();
              void workspaces.refetch();
            }}
          >
            重试
          </button>
        </div>
      ) : notice ? (
        <p className="workspace-feedback" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
