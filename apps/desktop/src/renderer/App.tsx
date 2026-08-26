import type {
  BillingOverview,
  ChargeRecord,
  ChatEvent,
  ConversationSnapshot,
  ConversationSummary,
  DesktopEnvironment,
  DeviceSession,
  McpServerConfig,
  Message,
  ModelCatalogEntry,
  PersonalFile,
  RechargeOrder,
  RefundOrder,
  SkillInstallation,
  SyncConflict,
  TokenAggregateField,
  UsageRecord,
  WorkItem,
  WorkItemDetail,
} from "@openerx/contracts";
import {
  ArrowClockwise,
  ArrowUp,
  CaretDown,
  ChatCircle,
  CheckCircle,
  Desktop,
  DeviceMobile,
  DownloadSimple,
  FileText,
  FolderSimple,
  GearSix,
  Info,
  MagnifyingGlass,
  Moon,
  Paperclip,
  PaperPlaneTilt,
  Plus,
  QrCode,
  Receipt,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  Sun,
  TerminalWindow,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import remarkGfm from "remark-gfm";

const suggestions = [
  "法国的首都是哪里？",
  "请把这段文字改写成正式邮件",
  "生成一个代码块和表格",
  "写一篇 2000 字说明",
];

const chatKeys = {
  list: (includeArchived = false) => ["chat", "list", includeArchived] as const,
  conversation: (id: string) => ["chat", "conversation", id] as const,
};

const accountKey = ["account", "state"] as const;
const billingKey = ["billing"] as const;
const themeStorageKey = "openerx.theme";

type ThemePreference = "system" | "dark" | "light";

const themeOptions = [
  {
    value: "system",
    label: "跟随系统",
    description: "随 macOS 或 Windows 外观自动切换",
    icon: Desktop,
  },
  {
    value: "dark",
    label: "深色",
    description: "保持当前 Codex 风格的深色工作区",
    icon: Moon,
  },
  {
    value: "light",
    label: "浅色",
    description: "适合明亮环境的柔和浅色工作区",
    icon: Sun,
  },
] as const;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

function initialThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function resolvedTheme(preference: ThemePreference): "dark" | "light" {
  if (preference !== "system") return preference;
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function tokenValue(field: TokenAggregateField): string {
  return field.unknownRecords > 0
    ? `${field.known.toLocaleString()} + ${field.unknownRecords} 条未知`
    : field.known.toLocaleString();
}

function cny(minor: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(minor / 100);
}

function previousMonth(): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const capabilityLabels: Record<keyof ModelCatalogEntry["capabilities"], string> = {
  text: "文本",
  imageInput: "图片",
  fileInput: "文件",
  tools: "工具",
  mcp: "MCP",
  imageGeneration: "图片生成",
};

const toolCatalog = [
  { namespace: "builtin", name: "确定性计算", detail: "无网络算术计算" },
  { namespace: "builtin", name: "结构化数据", detail: "排序、选择与去重" },
  { namespace: "files", name: "文件与成果", detail: "受 Scope 限制的读取、检索、转换与版本" },
  { namespace: "platform", name: "Web 搜索", detail: "第一方检索与可打开来源" },
  { namespace: "platform", name: "图片生成", detail: "账户鉴权的平台图片生成" },
  { namespace: "local", name: "隔离浏览器", detail: "独立 Profile 的导航与交互" },
  { namespace: "local", name: "Shell / 代码", detail: "授权工作区内的可停止进程" },
  { namespace: "local", name: "桌面控制", detail: "屏幕读取与逐次确认交互" },
  { namespace: "mcp", name: "MCP", detail: "STDIO 与 Streamable HTTP 服务" },
] as const;

function modelCapabilities(model: ModelCatalogEntry): string {
  return Object.entries(model.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capabilityLabels[capability as keyof typeof capabilityLabels])
    .join("、");
}

function conflictPayload(payload: SyncConflict["clientPayload"]): string {
  if (payload === null) return "删除";
  const title = typeof payload.title === "string" ? payload.title : null;
  return title ?? JSON.stringify(payload).slice(0, 160);
}

function Composer({
  conversationId,
  onOpenContext,
  contextOpen = false,
}: {
  conversationId?: string;
  onOpenContext?: () => void;
  contextOpen?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [skillInstallationId, setSkillInstallationId] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const chooseFiles = useMutation({
    mutationFn: () => window.openerx.chooseFiles({ conversationId: conversationId ?? null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    },
  });
  const skills = useQuery({
    queryKey: ["skills", "composer"],
    queryFn: () => window.openerx.listSkills(),
    retry: false,
  });
  const send = useMutation({
    mutationFn: (text: string) =>
      window.openerx.sendMessage({
        conversationId: conversationId ?? null,
        text,
        idempotencyKey: idempotencyKey("send"),
        ...(skillInstallationId ? { skillInstallationId } : {}),
      }),
    onSuccess: async (receipt) => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      if (!conversationId) navigate(`/chat/${receipt.conversationId}`);
    },
  });

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        const text = draft.trim();
        if (text && !send.isPending) send.mutate(text);
      }}
    >
      <label htmlFor={`message-${conversationId ?? "new"}`}>发送消息</label>
      <textarea
        id={`message-${conversationId ?? "new"}`}
        rows={3}
        placeholder="输入你的需求…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            const text = draft.trim();
            if (text && !send.isPending) send.mutate(text);
          }
        }}
      />
      <div className="composer-actions">
        <div className="composer-tools">
          <button
            type="button"
            className="icon-button"
            aria-label="添加附件"
            onClick={() => chooseFiles.mutate()}
            disabled={chooseFiles.isPending}
          >
            <Paperclip size={18} weight="regular" />
          </button>
          <label className="composer-select" htmlFor={`skill-${conversationId ?? "new"}`}>
            <Sparkle size={15} weight="regular" />
            <select
              id={`skill-${conversationId ?? "new"}`}
              aria-label="选择 Skill"
              value={skillInstallationId}
              onChange={(event) => setSkillInstallationId(event.target.value)}
            >
              <option value="">自动 Skill</option>
              {(skills.data ?? [])
                .filter(({ enabled, packageState }) => enabled && packageState === "installed")
                .map((skill) => (
                  <option value={skill.id} key={skill.id}>
                    {skill.displayName}
                  </option>
                ))}
            </select>
            <CaretDown size={13} weight="bold" />
          </label>
          {onOpenContext ? (
            <button
              type="button"
              className={`composer-context ${contextOpen ? "is-active" : ""}`}
              onClick={onOpenContext}
            >
              <SidebarSimple size={15} weight="regular" />
              <span>{contextOpen ? "关闭上下文" : "当前上下文"}</span>
            </button>
          ) : null}
          <span className="composer-hint">Shift + Enter 换行</span>
        </div>
        <button
          type="submit"
          className="primary-action"
          aria-label="发送"
          disabled={!draft.trim() || send.isPending}
        >
          <PaperPlaneTilt size={17} weight="fill" />
          <span>{send.isPending ? "发送中…" : "发送"}</span>
          <kbd>↵</kbd>
        </button>
      </div>
      {send.error ? <p className="inline-error">{send.error.message}</p> : null}
      {chooseFiles.error ? <p className="inline-error">{chooseFiles.error.message}</p> : null}
    </form>
  );
}

function NewChat(): React.JSX.Element {
  return (
    <main className="new-chat-page">
      <header className="new-chat-topbar">
        <span className="topbar-product">OpenerX 2.0</span>
        <span className="topbar-state">
          <span className="status-dot" /> 已同步
        </span>
      </header>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">OpenerX 2.0 · Chat Alpha</p>
        <h1 id="welcome-title">今天想完成什么？</h1>
        <p>对话由 Pi AgentSession 驱动；模型与能力由当前个人配置决定。</p>
      </section>
      <section className="suggestion-grid" aria-label="验收建议">
        {suggestions.map((suggestion) => (
          <Suggestion key={suggestion} text={suggestion} />
        ))}
      </section>
      <Composer />
    </main>
  );
}

function Suggestion({ text }: { text: string }): React.JSX.Element {
  const navigate = useNavigate();
  const send = useMutation({
    mutationFn: () =>
      window.openerx.sendMessage({
        conversationId: null,
        text,
        idempotencyKey: idempotencyKey("suggestion"),
      }),
    onSuccess: (receipt) => navigate(`/chat/${receipt.conversationId}`),
  });
  return (
    <button type="button" className="suggestion-card" onClick={() => send.mutate()}>
      <Sparkle size={17} weight="regular" />
      {text}
      <ArrowUp size={17} weight="regular" />
    </button>
  );
}

function ContextDock({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { conversationId = "" } = useParams();
  const queryClient = useQueryClient();
  const files = useQuery({
    queryKey: ["files", conversationId],
    queryFn: () => window.openerx.listFiles({ conversationId }),
    enabled: Boolean(conversationId),
  });
  const chooseFiles = useMutation({
    mutationFn: () => window.openerx.chooseFiles({ conversationId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });
  const chooseDirectory = useMutation({
    mutationFn: () => window.openerx.chooseDirectory({ conversationId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });
  const revoke = useMutation({
    mutationFn: (scopeId: string) => window.openerx.revokeFileScope({ scopeId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });
  const fileList = files.data ?? [];

  return (
    <aside className="context-dock" aria-label="当前上下文">
      <header className="context-dock-header">
        <div>
          <div className="context-title-row">
            <h2>当前上下文</h2>
            <Info size={15} weight="regular" />
          </div>
          <p>仅用于当前对话</p>
        </div>
        <button type="button" className="icon-button" aria-label="关闭上下文" onClick={onClose}>
          <X size={19} weight="regular" />
        </button>
      </header>

      <section className="context-files" aria-labelledby="context-files-title">
        <div className="context-section-heading">
          <h3 id="context-files-title">文件</h3>
          <span>{fileList.length}</span>
        </div>
        <div className="context-dropzone">
          <FileText size={26} weight="regular" />
          <strong>添加文件或受控文件夹</strong>
          <span>支持 PDF、Office、表格、图片、文本、代码与 HTML（单个 ≤50MB）</span>
          <div className="context-picker-actions">
            <button type="button" onClick={() => chooseFiles.mutate()}>
              选择文件
            </button>
            <button type="button" onClick={() => chooseDirectory.mutate()}>
              选择文件夹
            </button>
          </div>
        </div>
        {chooseFiles.error || chooseDirectory.error ? (
          <p className="inline-error">{(chooseFiles.error ?? chooseDirectory.error)?.message}</p>
        ) : null}
        <div className="context-file-list">
          {fileList.map((file) => {
            const sourceScopeId = file.sourceScopeId;
            return (
              <article className="context-file" key={file.id}>
                <div className="context-file-icon">
                  <FileText size={19} weight="regular" />
                </div>
                <div className="context-file-copy">
                  <strong title={file.displayName}>{file.displayName}</strong>
                  <span>
                    {formatBytes(file.sizeBytes)} · {file.format.toUpperCase()}
                  </span>
                </div>
                <span
                  className={`context-file-status status-${file.parseStatus === "ready" ? "ready" : "pending"}`}
                >
                  {file.parseStatus === "ready"
                    ? "已解析"
                    : file.parseStatus === "failed"
                      ? file.parseErrorCode
                      : "待解析"}
                </span>
                {sourceScopeId ? (
                  <button
                    type="button"
                    className="icon-button context-file-menu"
                    aria-label={`撤销 ${file.displayName} 的源文件权限`}
                    title="撤销源文件权限（受控副本仍保留）"
                    onClick={() => revoke.mutate(sourceScopeId)}
                  >
                    <X size={16} weight="bold" />
                  </button>
                ) : (
                  <span className="context-file-cloud-copy">云端副本</span>
                )}
              </article>
            );
          })}
          {files.isPending ? <p className="muted-copy">正在读取上下文…</p> : null}
          {!files.isPending && fileList.length === 0 ? (
            <p className="muted-copy">还没有添加文件。</p>
          ) : null}
        </div>
      </section>

      <footer className="context-dock-footer">
        <span>
          <CheckCircle size={16} weight="fill" /> 内容不会用于模型训练
        </span>
        <button type="button" className="text-button">
          了解更多
        </button>
      </footer>
    </aside>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function FilesAndArtifacts(): React.JSX.Element {
  const [selected, setSelected] = useState<{
    kind: "personal_file" | "artifact";
    id: string;
  } | null>(null);
  const [previewMode, setPreviewMode] = useState<"preview" | "source">("preview");
  const files = useQuery({ queryKey: ["files", "all"], queryFn: () => window.openerx.listFiles() });
  const artifacts = useQuery({
    queryKey: ["artifacts"],
    queryFn: () => window.openerx.listArtifacts(),
  });
  const chooseFiles = useMutation({
    mutationFn: () => window.openerx.chooseFiles(),
    onSuccess: () => files.refetch(),
  });
  const preview = useQuery({
    queryKey: ["content-preview", selected?.kind, selected?.id],
    queryFn: () => {
      if (!selected) throw new Error("No preview selected");
      return selected.kind === "personal_file"
        ? window.openerx.previewFile({ personalFileId: selected.id })
        : window.openerx.previewArtifact({ artifactId: selected.id });
    },
    enabled: selected !== null,
  });
  const saveArtifact = useMutation({
    mutationFn: async (artifactId: string) => await window.openerx.saveArtifact({ artifactId }),
  });
  return (
    <main className="library-page">
      <header className="library-header">
        <div>
          <p className="eyebrow">本地优先 · 可同步对象</p>
          <h1>个人文件与成果</h1>
          <p>原始路径权限与受控副本分离；生成成果按版本保留，不静默覆盖。</p>
        </div>
        <button type="button" className="primary-action" onClick={() => chooseFiles.mutate()}>
          <Plus size={17} /> 添加文件
        </button>
      </header>
      <section className="library-section" aria-labelledby="personal-files-title">
        <div className="library-section-title">
          <h2 id="personal-files-title">个人文件</h2>
          <span>{files.data?.length ?? 0}</span>
        </div>
        <div className="library-grid">
          {files.data?.map((file: PersonalFile) => (
            <button
              type="button"
              className="library-card"
              key={file.id}
              onClick={() => {
                setSelected({ kind: "personal_file", id: file.id });
                setPreviewMode("preview");
              }}
            >
              <FileText size={24} />
              <strong>{file.displayName}</strong>
              <span>
                {file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}
              </span>
              <span>
                {file.parseStatus === "ready" ? "引用已就绪" : (file.parseErrorCode ?? "解析中")}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="library-section" aria-labelledby="artifacts-title">
        <div className="library-section-title">
          <h2 id="artifacts-title">成果</h2>
          <span>{artifacts.data?.length ?? 0}</span>
        </div>
        <div className="library-grid">
          {artifacts.data?.map((artifact) => (
            <button
              type="button"
              className="library-card"
              key={artifact.id}
              onClick={() => {
                setSelected({ kind: "artifact", id: artifact.id });
                setPreviewMode("preview");
              }}
            >
              <FolderSimple size={24} />
              <strong>{artifact.displayName}</strong>
              <span>
                {artifact.format.toUpperCase()} · v{artifact.currentVersion}
              </span>
              <span>{artifact.versions.length} 个不可变版本</span>
            </button>
          ))}
        </div>
      </section>
      {selected ? (
        <section className="content-preview" aria-labelledby="content-preview-title">
          <header>
            <div>
              <p className="eyebrow">受控内容预览</p>
              <h2 id="content-preview-title">{preview.data?.displayName ?? "正在加载…"}</h2>
            </div>
            <div className="preview-actions">
              {selected.kind === "artifact" ? (
                <button
                  type="button"
                  disabled={saveArtifact.isPending}
                  onClick={() => saveArtifact.mutate(selected.id)}
                >
                  <DownloadSimple size={15} />
                  {saveArtifact.isPending ? "保存中…" : "下载 / 另存"}
                </button>
              ) : null}
              {preview.data && preview.data.source !== null ? (
                <>
                  <button
                    type="button"
                    className={previewMode === "preview" ? "is-active" : ""}
                    onClick={() => setPreviewMode("preview")}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    className={previewMode === "source" ? "is-active" : ""}
                    onClick={() => setPreviewMode("source")}
                  >
                    源码
                  </button>
                </>
              ) : null}
              <button type="button" onClick={() => setSelected(null)}>
                关闭
              </button>
            </div>
          </header>
          {preview.error ? <p className="inline-error">{preview.error.message}</p> : null}
          {saveArtifact.error ? <p className="inline-error">{saveArtifact.error.message}</p> : null}
          {saveArtifact.data ? (
            <p className="inline-success">已保存 {saveArtifact.data.fileName}</p>
          ) : null}
          {preview.data?.format === "html" && previewMode === "preview" && preview.data.source ? (
            <iframe
              title="HTML 隔离预览"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={preview.data.source}
            />
          ) : preview.data ? (
            <pre>{previewMode === "source" ? preview.data.source : preview.data.parsedText}</pre>
          ) : (
            <p className="muted-copy">正在准备预览…</p>
          )}
          {preview.data?.citations.length ? (
            <footer>{preview.data.citations.length} 个稳定引用位置</footer>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function MessageCard({ message }: { message: Message }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.parts[0]?.text ?? "");
  const conversationId = message.conversationId;
  const stop = useMutation({
    mutationFn: () =>
      window.openerx.stopGeneration({ conversationId, assistantMessageId: message.id }),
  });
  const regenerate = useMutation({
    mutationFn: () =>
      window.openerx.regenerateMessage({
        conversationId,
        assistantMessageId: message.id,
        idempotencyKey: idempotencyKey("regenerate"),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) }),
  });
  const edit = useMutation({
    mutationFn: () =>
      window.openerx.editMessage({
        conversationId,
        messageId: message.id,
        text: editText,
        idempotencyKey: idempotencyKey("edit"),
      }),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
    },
  });
  const text = message.parts.map((part) => part.text).join("");
  const running = message.role === "assistant" && ["pending", "streaming"].includes(message.status);
  const usage = useQuery({
    queryKey: ["usage", "message", message.id],
    queryFn: () => window.openerx.getUsage({ messageId: message.id }),
    enabled: message.role === "assistant" && !running,
    retry: false,
  });
  const usageRecords = useQuery({
    queryKey: ["usage", "records", "message", message.id],
    queryFn: () => window.openerx.getUsageRecords({ messageId: message.id }),
    enabled: message.role === "assistant" && !running,
    retry: false,
  });
  const execution: UsageRecord | undefined = usageRecords.data?.at(-1);

  return (
    <article className={`message message-${message.role}`} data-message-status={message.status}>
      <header>
        <strong>{message.role === "user" ? "你" : "OpenerX"}</strong>
        <span className={`message-status status-${message.status}`}>{message.status}</span>
      </header>
      {editing ? (
        <form
          className="edit-message"
          onSubmit={(event) => {
            event.preventDefault();
            if (editText.trim()) edit.mutate();
          }}
        >
          <textarea
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            rows={4}
          />
          <div>
            <button type="button" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="submit" disabled={!editText.trim() || edit.isPending}>
              创建分支
            </button>
          </div>
        </form>
      ) : message.role === "assistant" ? (
        <div className="markdown-body">
          {text ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {text}
            </ReactMarkdown>
          ) : (
            <p className="thinking">正在思考…</p>
          )}
        </div>
      ) : (
        <p className="user-text">{text}</p>
      )}
      {message.errorCode ? <p className="inline-error">失败原因：{message.errorCode}</p> : null}
      {usage.data && usage.data.records > 0 ? (
        <div className="usage-line" role="status" aria-label="消息 Token 用量">
          <span>输入 {tokenValue(usage.data.inputTokens)}</span>
          <span>缓存 {tokenValue(usage.data.cachedInputTokens)}</span>
          <span>输出 {tokenValue(usage.data.outputTokens)}</span>
          <span>推理 {tokenValue(usage.data.reasoningTokens)}</span>
          <strong>总计 {tokenValue(usage.data.totalTokens)}</strong>
        </div>
      ) : null}
      {execution ? (
        <div className="model-execution" role="status" aria-label="消息模型执行详情">
          <span>选择 {execution.selectedModelRef}</span>
          <span>实际 {execution.effectiveModelRef}</span>
          {execution.fallbackReason ? <strong>降级原因：{execution.fallbackReason}</strong> : null}
        </div>
      ) : null}
      {!editing ? (
        <footer className="message-actions">
          {text ? (
            <button type="button" onClick={() => void navigator.clipboard.writeText(text)}>
              复制
            </button>
          ) : null}
          {message.role === "user" ? (
            <button type="button" onClick={() => setEditing(true)}>
              编辑并分支
            </button>
          ) : null}
          {running ? (
            <button type="button" onClick={() => stop.mutate()} disabled={stop.isPending}>
              停止
            </button>
          ) : null}
          {message.role === "assistant" && !running ? (
            <button
              type="button"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
            >
              {message.status === "failed" ? "重试" : "重新生成"}
            </button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

const workItemStatusLabel: Record<WorkItem["status"], string> = {
  queued: "排队中",
  running: "运行中",
  waiting_for_user: "等待输入",
  waiting_for_permission: "等待授权",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function ToolActivity({ workItem }: { workItem: WorkItem }): React.JSX.Element {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["tools", "work-item", workItem.id],
    queryFn: () => window.openerx.getWorkItem({ workItemId: workItem.id }),
  });
  const resolve = useMutation({
    mutationFn: ({
      permissionRequestId,
      decision,
      payloadDigest,
    }: {
      permissionRequestId: string;
      decision: "once" | "session" | "persistent" | "deny";
      payloadDigest: string;
    }) => window.openerx.resolvePermission({ permissionRequestId, decision, payloadDigest }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tools"] });
    },
  });
  const value: WorkItemDetail | undefined = detail.data;
  const pending = value?.permissions.filter(({ status }) => status === "pending") ?? [];
  const shouldOpen = ["running", "waiting_for_permission", "failed"].includes(workItem.status);
  return (
    <details className="tool-activity" open={shouldOpen || undefined}>
      <summary>
        <TerminalWindow size={17} />
        <strong>{workItem.title}</strong>
        <span className={`tool-state tool-state-${workItem.status}`}>
          {workItemStatusLabel[workItem.status]}
        </span>
      </summary>
      {detail.isPending ? <p className="muted-copy">正在读取工具活动…</p> : null}
      {value?.toolCalls.map((call) => (
        <div className="tool-call-row" key={call.id}>
          <div>
            <strong>{call.toolName}</strong>
            <span>{call.inputSummary}</span>
          </div>
          <span>{call.status}</span>
          {call.resultSummary ? <p>{call.resultSummary}</p> : null}
          {call.errorCode ? <p className="inline-error">{call.errorCode}</p> : null}
        </div>
      ))}
      {pending.map((permission) => {
        const persistentAllowed = ["L1", "L2", "L3"].includes(permission.risk);
        return (
          <section className="permission-card" key={permission.id} aria-label="工具权限确认">
            <p className="eyebrow">{permission.risk} 权限请求</p>
            <strong>{permission.reason}</strong>
            <span>
              {permission.capability} · {permission.resource}
            </span>
            <div>
              <button
                type="button"
                className="primary-action"
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate({
                    permissionRequestId: permission.id,
                    decision: "once",
                    payloadDigest: permission.payloadDigest,
                  })
                }
              >
                仅本次允许
              </button>
              {persistentAllowed ? (
                <button
                  type="button"
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate({
                      permissionRequestId: permission.id,
                      decision: "session",
                      payloadDigest: permission.payloadDigest,
                    })
                  }
                >
                  本次会话允许
                </button>
              ) : null}
              <button
                type="button"
                className="danger-action"
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate({
                    permissionRequestId: permission.id,
                    decision: "deny",
                    payloadDigest: permission.payloadDigest,
                  })
                }
              >
                拒绝
              </button>
            </div>
          </section>
        );
      })}
    </details>
  );
}

function ConversationToolbar({
  snapshot,
  onToggleContext,
}: {
  snapshot: ConversationSnapshot;
  onToggleContext: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const conversation = snapshot.conversation;
  const [renaming, setRenaming] = useState(false);
  const [nextTitle, setNextTitle] = useState(conversation.title);
  const rename = useMutation({
    mutationFn: (title: string) =>
      window.openerx.renameConversation({ conversationId: conversation.id, title }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ConversationSnapshot>(
        chatKeys.conversation(conversation.id),
        (current) => (current ? { ...current, conversation: updated } : current),
      );
      await queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
      setRenaming(false);
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      window.openerx.setConversationArchived({
        conversationId: conversation.id,
        archived: conversation.archivedAt === null,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ConversationSnapshot>(
        chatKeys.conversation(conversation.id),
        (current) => (current ? { ...current, conversation: updated } : current),
      );
      await queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => window.openerx.deleteConversation({ conversationId: conversation.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      navigate("/chat/new");
    },
  });
  const activate = useMutation({
    mutationFn: (branchId: string) =>
      window.openerx.activateBranch({ conversationId: conversation.id, branchId }),
    onSuccess: (next) => queryClient.setQueryData(chatKeys.conversation(conversation.id), next),
  });
  const models = useQuery({
    queryKey: ["models", "catalog"],
    queryFn: () => window.openerx.listModels(),
    retry: false,
  });
  const usage = useQuery({
    queryKey: ["usage", "conversation", conversation.id],
    queryFn: () => window.openerx.getUsage({ conversationId: conversation.id }),
    retry: false,
  });
  const selectModel = useMutation({
    mutationFn: (modelRef: string) =>
      window.openerx.selectConversationModel({ conversationId: conversation.id, modelRef }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ConversationSnapshot>(
        chatKeys.conversation(conversation.id),
        (current) => (current ? { ...current, conversation: updated } : current),
      );
    },
  });
  const selectedModel = models.data?.find(
    ({ modelRef }) => modelRef === conversation.selectedModelRef,
  );

  return (
    <header className="conversation-toolbar">
      <div className="conversation-heading">
        <p className="eyebrow">{conversation.selectedModelRef}</p>
        <h1>{conversation.title}</h1>
      </div>
      <div className="toolbar-actions">
        {models.data?.length ? (
          <label>
            后续消息模型
            <select
              aria-label="后续消息模型"
              value={conversation.selectedModelRef}
              onChange={(event) => selectModel.mutate(event.target.value)}
              disabled={selectModel.isPending}
            >
              {models.data.map((model) => (
                <option
                  value={model.modelRef}
                  key={model.modelRef}
                  disabled={model.status !== "available"}
                >
                  {model.displayName} · {model.status}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedModel ? (
          <div className="model-details">
            <span>{modelCapabilities(selectedModel)}</span>
            <span>
              上下文 {selectedModel.contextWindow.toLocaleString()} · 最大输出{" "}
              {selectedModel.maxOutputTokens.toLocaleString()}
            </span>
            <strong>{selectedModel.priceSummary}</strong>
          </div>
        ) : null}
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label="切换上下文"
          onClick={onToggleContext}
        >
          <SidebarSimple size={17} weight="regular" />
        </button>
        <button type="button" className="toolbar-icon-button" aria-label="更多操作">
          <SlidersHorizontal size={17} weight="regular" />
        </button>
        {snapshot.branches.length > 1 ? (
          <label>
            分支
            <select
              value={conversation.activeBranchId}
              onChange={(event) => activate.mutate(event.target.value)}
            >
              {snapshot.branches.map((branch) => (
                <option value={branch.id} key={branch.id}>
                  {branch.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {renaming ? (
          <form
            className="rename-form"
            onSubmit={(event) => {
              event.preventDefault();
              const title = nextTitle.trim();
              if (title) rename.mutate(title);
            }}
          >
            <label htmlFor="conversation-title">对话标题</label>
            <input
              id="conversation-title"
              value={nextTitle}
              onChange={(event) => setNextTitle(event.target.value)}
            />
            <button type="submit" disabled={!nextTitle.trim() || rename.isPending}>
              保存标题
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setRenaming(true)}>
            重命名
          </button>
        )}
        <button type="button" onClick={() => archive.mutate()}>
          {conversation.archivedAt ? "取消归档" : "归档"}
        </button>
        <button
          type="button"
          className="danger-action"
          onClick={() => {
            if (window.confirm("删除该对话？历史会保留墓碑但不再显示。")) remove.mutate();
          }}
        >
          删除
        </button>
      </div>
      {usage.data && usage.data.records > 0 ? (
        <div className="conversation-usage">
          {usage.data.records} 次模型调用 · Token {tokenValue(usage.data.totalTokens)}
        </div>
      ) : null}
    </header>
  );
}

function ChatPage({
  contextOpen,
  onToggleContext,
}: {
  contextOpen: boolean;
  onToggleContext: () => void;
}): React.JSX.Element {
  const { conversationId = "" } = useParams();
  const snapshot = useQuery({
    queryKey: chatKeys.conversation(conversationId),
    queryFn: () => window.openerx.getConversation({ conversationId }),
    enabled: Boolean(conversationId),
  });
  const workItems = useQuery({
    queryKey: ["tools", "work-items", conversationId],
    queryFn: () => window.openerx.listWorkItems({ conversationId, limit: 100 }),
    enabled: Boolean(conversationId),
  });
  if (snapshot.isPending) return <main className="center-state">正在恢复对话…</main>;
  if (snapshot.error || !snapshot.data) {
    return (
      <main className="center-state inline-error">无法读取对话：{snapshot.error?.message}</main>
    );
  }
  return (
    <main className="conversation-page">
      <ConversationToolbar snapshot={snapshot.data} onToggleContext={onToggleContext} />
      <section className="message-list" aria-live="polite" aria-label="对话消息">
        {snapshot.data.messages.map((message) => (
          <section className="message-stack" key={message.id}>
            <MessageCard message={message} />
            {workItems.data
              ?.filter((workItem) => workItem.messageId === message.id)
              .map((workItem) => (
                <ToolActivity key={workItem.id} workItem={workItem} />
              ))}
          </section>
        ))}
      </section>
      <Composer
        conversationId={conversationId}
        onOpenContext={onToggleContext}
        contextOpen={contextOpen}
      />
    </main>
  );
}

function SearchPage(): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const results = useQuery({
    queryKey: ["chat", "search", query],
    queryFn: () => window.openerx.search({ query, includeArchived: true }),
    enabled: Boolean(query),
  });
  return (
    <main className="search-page">
      <p className="eyebrow">本地历史</p>
      <h1>搜索对话</h1>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <input
          aria-label="搜索关键词"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          搜索
        </button>
      </form>
      <div className="search-results">
        {results.data?.map((result) => (
          <NavLink
            key={`${result.conversationId}-${result.messageId}`}
            to={`/chat/${result.conversationId}`}
          >
            <strong>{result.title}</strong>
            <span>{result.excerpt}</span>
          </NavLink>
        ))}
        {query && results.data?.length === 0 ? <p>没有匹配结果。</p> : null}
      </div>
    </main>
  );
}

function Placeholder({ title }: { title: string }): React.JSX.Element {
  return (
    <main className="placeholder-page">
      <p className="eyebrow">后续检查点</p>
      <h1>{title}</h1>
      <p>该领域尚未进入当前 M1 Chat Alpha 的实现范围。</p>
    </main>
  );
}

function SkillCenter(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"personal" | "workspace">("personal");
  const skills = useQuery({
    queryKey: ["skills"],
    queryFn: () => window.openerx.listSkills(),
  });
  const invocations = useQuery({
    queryKey: ["skills", "invocations"],
    queryFn: () => window.openerx.listSkillInvocations({ limit: 20 }),
  });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
  };
  const install = useMutation({
    mutationFn: () =>
      window.openerx.chooseAndInstallSkill({
        scope,
        workspaceId: scope === "workspace" ? "default" : null,
      }),
    onSuccess: refresh,
  });
  const enable = useMutation({
    mutationFn: ({ installationId, enabled }: { installationId: string; enabled: boolean }) =>
      window.openerx.setSkillEnabled({ installationId, enabled }),
    onSuccess: refresh,
  });
  const autoInvoke = useMutation({
    mutationFn: ({ installationId, value }: { installationId: string; value: boolean }) =>
      window.openerx.setSkillAutoInvoke({ installationId, autoInvoke: value }),
    onSuccess: refresh,
  });
  const approve = useMutation({
    mutationFn: (skill: SkillInstallation) =>
      window.openerx.approveSkillPermissions({
        installationId: skill.id,
        permissionDigest: skill.permissionDigest,
      }),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: (installationId: string) =>
      window.openerx.resetSkillPermissions({ installationId }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (installationId: string) => window.openerx.chooseAndUpdateSkill({ installationId }),
    onSuccess: refresh,
  });
  const rollback = useMutation({
    mutationFn: ({ installationId, version }: { installationId: string; version: string }) =>
      window.openerx.rollbackSkill({ installationId, version }),
    onSuccess: refresh,
  });
  const uninstall = useMutation({
    mutationFn: (installationId: string) => window.openerx.uninstallSkill({ installationId }),
    onSuccess: refresh,
  });
  const mutationError =
    install.error ??
    enable.error ??
    autoInvoke.error ??
    approve.error ??
    reset.error ??
    update.error ??
    rollback.error ??
    uninstall.error;

  return (
    <main className="skill-center-page">
      <header className="skill-center-header">
        <div>
          <p className="eyebrow">Pi Native Skills</p>
          <h1>助手与 Skill</h1>
          <p>开放目录包由 Pi 渐进加载，脚本和资源统一通过 Capability Broker。</p>
        </div>
        <div className="skill-install-controls">
          <label>
            安装范围
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="personal">个人</option>
              <option value="workspace">当前工作区</option>
            </select>
          </label>
          <button
            type="button"
            className="primary-action"
            onClick={() => install.mutate()}
            disabled={install.isPending}
          >
            <Plus size={16} weight="bold" /> 安装 Skill
          </button>
        </div>
      </header>

      <section className="skill-summary" aria-label="Skill 概览">
        <div>
          <strong>{skills.data?.length ?? 0}</strong>
          <span>安装记录</span>
        </div>
        <div>
          <strong>{skills.data?.filter(({ enabled }) => enabled).length ?? 0}</strong>
          <span>已启用</span>
        </div>
        <div>
          <strong>{invocations.data?.length ?? 0}</strong>
          <span>最近调用</span>
        </div>
      </section>

      {skills.isPending ? <p>正在读取 Skill…</p> : null}
      {skills.error ? <p className="inline-error">{skills.error.message}</p> : null}
      {mutationError ? <p className="inline-error">{mutationError.message}</p> : null}
      <section className="skill-grid" aria-label="已安装 Skill">
        {(skills.data ?? []).map((skill) => {
          const approvalRequired =
            skill.permissions.length > 0 &&
            skill.approvedPermissionDigest !== skill.permissionDigest;
          return (
            <article className={`skill-card skill-state-${skill.packageState}`} key={skill.id}>
              <header>
                <div>
                  <span className={`skill-trust trust-${skill.trust}`}>{skill.trust}</span>
                  <h2>{skill.displayName}</h2>
                  <p>{skill.description}</p>
                </div>
                <span className={`skill-enabled ${skill.enabled ? "is-enabled" : ""}`}>
                  {skill.enabled ? "已启用" : "已停用"}
                </span>
              </header>
              <dl className="skill-metadata">
                <div>
                  <dt>范围</dt>
                  <dd>
                    {skill.scope}
                    {skill.workspaceId ? ` · ${skill.workspaceId}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>版本</dt>
                  <dd>{skill.version}</dd>
                </div>
                <div>
                  <dt>发布者</dt>
                  <dd>{skill.publisher}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>
                    {skill.sourceKind} · {skill.sourceLabel}
                  </dd>
                </div>
                <div>
                  <dt>平台</dt>
                  <dd>{skill.platforms.join(" / ")}</dd>
                </div>
                <div>
                  <dt>校验</dt>
                  <dd>
                    <code>{skill.checksumSha256.slice(0, 16)}…</code>
                  </dd>
                </div>
              </dl>
              <section className="skill-dependencies">
                <strong>依赖与权限</strong>
                <p>
                  工具：{skill.declaredTools.join("、") || "无"} · MCP：
                  {skill.declaredMcpServers.join("、") || "无"}
                </p>
                {skill.permissions.length === 0 ? (
                  <span>不声明额外权限</span>
                ) : (
                  skill.permissions.map((permission) => (
                    <span key={`${permission.capability}-${permission.actions.join("-")}`}>
                      {permission.capability} · {permission.actions.join("/")} ·{" "}
                      {permission.targets.join("、") || "当前 Scope"} — {permission.reason}
                    </span>
                  ))
                )}
              </section>
              <div className="skill-card-actions">
                {approvalRequired ? (
                  <button type="button" onClick={() => approve.mutate(skill)}>
                    审核并批准权限
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    enable.mutate({ installationId: skill.id, enabled: !skill.enabled })
                  }
                  disabled={skill.packageState !== "installed" || approvalRequired}
                >
                  {skill.enabled ? "禁用" : "启用"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    autoInvoke.mutate({ installationId: skill.id, value: !skill.autoInvoke })
                  }
                  disabled={!skill.enabled}
                >
                  自动触发：{skill.autoInvoke ? "开" : "关"}
                </button>
                {skill.scope !== "builtin" ? (
                  <button type="button" onClick={() => update.mutate(skill.id)}>
                    更新
                  </button>
                ) : null}
                {skill.rollbackVersions.length > 0 ? (
                  <select
                    aria-label={`回滚 ${skill.displayName}`}
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value)
                        rollback.mutate({ installationId: skill.id, version: event.target.value });
                      event.target.value = "";
                    }}
                  >
                    <option value="">回滚版本…</option>
                    {skill.rollbackVersions.map((version) => (
                      <option value={version} key={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                ) : null}
                {skill.permissions.length > 0 ? (
                  <button type="button" onClick={() => reset.mutate(skill.id)}>
                    重置权限
                  </button>
                ) : null}
                {skill.scope !== "builtin" ? (
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() => {
                      if (window.confirm(`卸载 ${skill.displayName}？本地包会移入可恢复回收目录。`))
                        uninstall.mutate(skill.id);
                    }}
                  >
                    卸载
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="skill-activity" aria-label="Skill 调用记录">
        <h2>最近调用</h2>
        {(invocations.data ?? []).map((invocation) => (
          <div key={invocation.id}>
            <strong>
              {(skills.data ?? []).find(({ id }) => id === invocation.installationId)
                ?.displayName ?? invocation.installationId.slice(0, 8)}
            </strong>
            <span>
              {invocation.trigger} · {invocation.status} · {invocation.reason}
            </span>
          </div>
        ))}
        {invocations.data?.length === 0 ? <p>还没有 Skill 调用。</p> : null}
      </section>
    </main>
  );
}

function ThemeSettings({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}): React.JSX.Element {
  return (
    <section className="settings-card settings-stack theme-settings" aria-label="外观主题">
      <div className="settings-heading">
        <div>
          <h2>外观</h2>
          <p>选择工作区主题，修改会立即生效。</p>
        </div>
      </div>
      <div className="theme-options" role="radiogroup" aria-label="主题">
        {themeOptions.map(({ value: option, label, description, icon: Icon }) => {
          const selected = value === option;
          return (
            <label key={option} className={`theme-option ${selected ? "is-selected" : ""}`}>
              <input
                type="radio"
                name="workspace-theme"
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
              />
              <span className={`theme-preview theme-preview-${option}`} aria-hidden="true">
                <Icon size={19} weight={selected ? "fill" : "regular"} />
              </span>
              <span className="theme-option-copy">
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              {selected ? <CheckCircle size={17} weight="fill" aria-hidden="true" /> : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}

const performanceLabels = {
  desktop_interactive: "桌面可交互",
  app_service_ready: "本地服务就绪",
  idle_rss: "当前进程内存",
} as const;

function DiagnosticsSettings(): React.JSX.Element {
  const diagnostics = useQuery({
    queryKey: ["diagnostics", "preview"],
    queryFn: () => window.openerx.getDiagnosticsPreview(),
    retry: false,
  });
  const personalData = useQuery({
    queryKey: ["personal-data", "summary"],
    queryFn: () => window.openerx.getPersonalDataSummary(),
    retry: false,
  });
  const exportDiagnostics = useMutation({
    mutationFn: () => window.openerx.exportDiagnostics(),
  });
  const exportPersonalData = useMutation({
    mutationFn: () => window.openerx.exportPersonalData(),
  });
  const preview = diagnostics.data;
  const summary = personalData.data;

  return (
    <section
      className="settings-card settings-stack diagnostics-settings"
      aria-label="诊断与数据导出"
    >
      <div className="settings-heading">
        <div>
          <h2>诊断与数据</h2>
          <p>先预览脱敏范围，再决定是否保存；个人内容使用独立导出。</p>
        </div>
        <span className={`diagnostic-health health-${preview?.health ?? "collecting"}`}>
          {preview?.health === "ready"
            ? "状态良好"
            : preview?.health === "attention"
              ? "需要关注"
              : "正在收集"}
        </span>
      </div>
      <section className="diagnostic-metrics" aria-label="性能预算">
        {(preview?.performance ?? []).map((metric) => (
          <article key={metric.name} className={`metric-${metric.status}`}>
            <span>{performanceLabels[metric.name]}</span>
            <strong>
              {metric.value.toLocaleString()} {metric.unit}
            </strong>
            <small>
              预算 ≤ {metric.budget.toLocaleString()} {metric.unit} · {metric.status}
            </small>
          </article>
        ))}
      </section>
      {preview ? (
        <div className="diagnostic-preview">
          <div>
            <strong>诊断包包含</strong>
            {preview.includes.map((item) => (
              <span key={item}>✓ {item}</span>
            ))}
          </div>
          <div>
            <strong>始终排除</strong>
            {preview.excludes.map((item) => (
              <span key={item}>— {item}</span>
            ))}
          </div>
        </div>
      ) : null}
      <p className="settings-note">
        已记录 {preview?.eventCount ?? 0} 条脱敏事件 · {preview?.restartCount ?? 0} 次服务重启 ·{" "}
        {preview?.errorCount ?? 0} 个错误
      </p>
      <section className="personal-data-summary" aria-label="本机个人数据摘要">
        <div>
          <strong>本机个人数据</strong>
          <span>
            {summary?.conversations ?? 0} 个对话 · {summary?.messages ?? 0} 条消息 ·{" "}
            {summary?.files ?? 0} 个文件 · {summary?.artifacts ?? 0} 个成果
          </span>
          <small>Token、报价、费用和账单只读取服务端记录，不写入此本地导出。</small>
        </div>
      </section>
      <div className="settings-actions">
        <button
          type="button"
          onClick={() => exportDiagnostics.mutate()}
          disabled={!preview || exportDiagnostics.isPending}
        >
          <DownloadSimple size={16} /> 导出脱敏诊断包
        </button>
        <button
          type="button"
          onClick={() => exportPersonalData.mutate()}
          disabled={!summary || exportPersonalData.isPending}
        >
          <DownloadSimple size={16} /> 导出个人数据
        </button>
      </div>
      {exportDiagnostics.data ? <p>诊断包已保存：{exportDiagnostics.data.fileName}</p> : null}
      {exportPersonalData.data ? <p>个人数据已保存：{exportPersonalData.data.fileName}</p> : null}
      {diagnostics.error ||
      personalData.error ||
      exportDiagnostics.error ||
      exportPersonalData.error ? (
        <p className="inline-error">
          {
            (
              diagnostics.error ??
              personalData.error ??
              exportDiagnostics.error ??
              exportPersonalData.error
            )?.message
          }
        </p>
      ) : null}
    </section>
  );
}

function RemoteSettings(): React.JSX.Element {
  const queryClient = useQueryClient();
  const remote = useQuery({
    queryKey: ["remote", "state"],
    queryFn: () => window.openerx.getRemoteState(),
    retry: false,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const enable = useMutation({
    mutationFn: (enabled: boolean) => window.openerx.setRemoteEnabled({ enabled }),
    onSuccess: (state) => {
      queryClient.setQueryData(["remote", "state"], state);
      if (!state.enabled) setQrDataUrl(null);
    },
  });
  const challenge = useMutation({
    mutationFn: () => window.openerx.createRemotePairingChallenge(),
  });
  const revoke = useMutation({
    mutationFn: (pairingId: string) => window.openerx.revokeRemotePairing({ pairingId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["remote", "state"] }),
  });

  useEffect(() => {
    const value = challenge.data;
    if (!value) return;
    const pairingUrl = `openerx://remote/pair?payload=${encodeURIComponent(JSON.stringify(value))}`;
    let active = true;
    void QRCode.toDataURL(pairingUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#232823", light: "#ffffff" },
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl);
    });
    return () => {
      active = false;
    };
  }, [challenge.data]);

  const state = remote.data;
  const activePairings = state?.pairings.filter(({ status }) => status === "active") ?? [];
  return (
    <section className="settings-card settings-stack remote-settings" aria-label="手机远程控制">
      <div className="settings-heading">
        <div>
          <h2>手机远程控制</h2>
          <p>手机是控制面；Pi、文件、工具和权限判断仍只在这台电脑运行。</p>
        </div>
        <button
          type="button"
          className={state?.enabled ? "danger-action" : "primary-action"}
          disabled={enable.isPending || remote.isPending || state?.available === false}
          onClick={() => enable.mutate(!state?.enabled)}
        >
          {state?.enabled ? "关闭 Remote" : "开启 Remote"}
        </button>
      </div>
      {state?.enabled ? (
        <div className="remote-status-row">
          <span className={`remote-presence presence-${state.host?.presence ?? "offline"}`}>
            {state.host?.presence ?? "offline"}
          </span>
          <span>{state.host?.displayName}</span>
          <span>{activePairings.length} 台手机已配对</span>
          <button type="button" onClick={() => challenge.mutate()} disabled={challenge.isPending}>
            <QrCode size={16} /> 新建配对码
          </button>
        </div>
      ) : null}
      {challenge.data && qrDataUrl ? (
        <div className="remote-pairing-panel">
          <img src={qrDataUrl} alt="OpenerX Remote 一次性配对二维码" />
          <div>
            <strong>用已登录同一账户的手机扫描</strong>
            <p>二维码不含访问令牌，只含一次性挑战、公钥和到期时间。</p>
            <span>到期：{new Date(challenge.data.expiresAt).toLocaleString()}</span>
            <code>{challenge.data.challengeId}</code>
          </div>
        </div>
      ) : null}
      {activePairings.map((pairing) => (
        <div className="device-card" key={pairing.pairingId}>
          <div>
            <strong>
              <DeviceMobile size={16} /> 控制设备 {pairing.controllerDeviceId.slice(0, 8)}
            </strong>
            <span>创建于 {new Date(pairing.createdAt).toLocaleString()}</span>
            <span>到期于 {new Date(pairing.expiresAt).toLocaleString()}</span>
          </div>
          <button
            type="button"
            onClick={() => revoke.mutate(pairing.pairingId)}
            disabled={revoke.isPending}
          >
            撤销配对
          </button>
        </div>
      ))}
      {remote.error || enable.error || challenge.error || revoke.error || state?.reason ? (
        <p className="inline-error">
          {(remote.error ?? enable.error ?? challenge.error ?? revoke.error)?.message ??
            state?.reason}
        </p>
      ) : null}
    </section>
  );
}

function AccountSettings({
  themePreference,
  onThemeChange,
}: {
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => window.openerx.getAccountState(),
  });
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const signedIn = account.data?.status === "signed_in";
  const devices = useQuery({
    queryKey: ["account", "devices"],
    queryFn: () => window.openerx.listDevices(),
    enabled: signedIn,
    retry: false,
  });
  const sync = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => window.openerx.syncNow(),
    enabled: signedIn,
    retry: false,
  });
  const conflicts = useQuery({
    queryKey: ["sync", "conflicts"],
    queryFn: () => window.openerx.listSyncConflicts(),
    enabled: signedIn,
    retry: false,
  });
  const accountUsage = useQuery({
    queryKey: ["usage", "account"],
    queryFn: () => window.openerx.getUsage(),
    enabled: signedIn,
    retry: false,
  });
  useEffect(() => {
    if (!sync.data?.syncedAt) return;
    void queryClient.invalidateQueries({ queryKey: ["chat"] });
  }, [queryClient, sync.data?.syncedAt]);
  const requestCode = useMutation({
    mutationFn: () => window.openerx.requestEmailCode({ email }),
    onSuccess: (challenge) => setChallengeId(challenge.challengeId),
  });
  const verify = useMutation({
    mutationFn: () => {
      if (!challengeId) throw new Error("请先获取验证码");
      return window.openerx.verifyEmailCode({ challengeId, code });
    },
    onSuccess: (state) => {
      queryClient.setQueryData(accountKey, state);
      setCode("");
      setChallengeId(null);
      void queryClient.invalidateQueries({ queryKey: ["account", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["sync"] });
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    },
  });
  const signOut = useMutation({
    mutationFn: () => window.openerx.signOut(),
    onSuccess: async (state) => {
      queryClient.setQueryData(accountKey, state);
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });
  const signOutAll = useMutation({
    mutationFn: async () => {
      if (!window.confirm("退出全部设备后，所有设备都需要重新验证邮箱。是否继续？")) {
        return null;
      }
      return await window.openerx.signOutAll();
    },
    onSuccess: async (state) => {
      if (!state) return;
      queryClient.setQueryData(accountKey, state);
      queryClient.removeQueries({ queryKey: ["account", "devices"] });
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });
  const revokeDevice = useMutation({
    mutationFn: (sessionId: string) => window.openerx.revokeDevice({ sessionId }),
    onSuccess: async (state) => {
      queryClient.setQueryData(accountKey, state);
      await queryClient.invalidateQueries({ queryKey: ["account", "devices"] });
    },
  });
  const resolveConflict = useMutation({
    mutationFn: (input: { conflictId: string; resolution: "local" | "cloud" }) =>
      window.openerx.resolveSyncConflict(input),
    onSuccess: async (status) => {
      queryClient.setQueryData(["sync", "status"], status);
      await queryClient.invalidateQueries({ queryKey: ["sync", "conflicts"] });
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });
  const clearLocalCache = useMutation({
    mutationFn: async () => {
      if (!window.confirm("仅清理本机缓存；云端对话会在下次同步时恢复。是否继续？")) return null;
      return await window.openerx.clearLocalCache();
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      await queryClient.invalidateQueries({ queryKey: ["sync", "conflicts"] });
    },
  });
  const deleteCloudData = useMutation({
    mutationFn: async () => {
      if (
        !window.confirm(
          "删除账户云端对话会写入保留期墓碑，并同时清理本机缓存。该操作不同于退出设备。是否继续？",
        )
      ) {
        return null;
      }
      return await window.openerx.deleteCloudData();
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      await queryClient.invalidateQueries({ queryKey: ["sync"] });
    },
  });

  if (account.isPending) return <main className="center-state">正在读取账户状态…</main>;
  const state = account.data;
  return (
    <main className="settings-page">
      <p className="eyebrow">Account Alpha</p>
      <h1>账户与设备</h1>
      <ThemeSettings value={themePreference} onChange={onThemeChange} />
      <DiagnosticsSettings />
      <section className="settings-card" aria-label="账户状态">
        <div>
          <span className={`account-status account-${state?.status ?? "unavailable"}`}>
            {state?.status ?? "unavailable"}
          </span>
          <h2>{state?.account?.displayName ?? "登录 OpenerX"}</h2>
          <p>{state?.account?.email ?? "使用一次性邮箱验证码建立此设备会话。"}</p>
        </div>
        {state?.status !== "signed_in" || !state.session ? (
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (challengeId) verify.mutate();
              else requestCode.mutate();
            }}
          >
            <label htmlFor="account-email">邮箱</label>
            <input
              id="account-email"
              type="email"
              value={email}
              disabled={Boolean(challengeId)}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            {challengeId ? (
              <>
                <label htmlFor="account-code">六位验证码</label>
                <input
                  id="account-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </>
            ) : null}
            <button
              type="submit"
              className="primary-action"
              disabled={
                requestCode.isPending ||
                verify.isPending ||
                (!challengeId && !email.trim()) ||
                (Boolean(challengeId) && !/^\d{6}$/.test(code))
              }
            >
              {challengeId ? "验证并登录" : "发送验证码"}
            </button>
            {requestCode.error || verify.error || state?.reason ? (
              <p className="inline-error">
                {requestCode.error?.message ?? verify.error?.message ?? state?.reason}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>
      {state?.status === "signed_in" && state.session ? (
        <>
          <RemoteSettings />
          <section className="settings-card settings-stack" aria-label="设备会话">
            <div className="settings-heading">
              <div>
                <h2>设备会话</h2>
                <p>Refresh 凭证只保存在各设备的系统凭证边界。</p>
              </div>
              <button type="button" onClick={() => void devices.refetch()}>
                刷新设备
              </button>
            </div>
            {(devices.data ?? [state.session]).map((session: DeviceSession) => {
              const current = session.sessionId === state.session?.sessionId;
              return (
                <div className="device-card" key={session.sessionId}>
                  <div>
                    <strong>
                      {session.device.name} {current ? "· 当前设备" : ""}
                    </strong>
                    <span>
                      {session.device.platform} · {session.device.arch} · session v
                      {session.sessionVersion}
                    </span>
                    <span>{session.revokedAt ? `已撤销 ${session.revokedAt}` : "可用"}</span>
                  </div>
                  {!session.revokedAt ? (
                    <button
                      type="button"
                      onClick={() =>
                        current ? signOut.mutate() : revokeDevice.mutate(session.sessionId)
                      }
                      disabled={signOut.isPending || revokeDevice.isPending}
                    >
                      {current ? "退出此设备" : "撤销设备"}
                    </button>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              className="danger-action"
              onClick={() => signOutAll.mutate()}
              disabled={signOutAll.isPending}
            >
              退出全部设备
            </button>
            {devices.error || revokeDevice.error || signOut.error || signOutAll.error ? (
              <p className="inline-error">
                {
                  (devices.error ?? revokeDevice.error ?? signOut.error ?? signOutAll.error)
                    ?.message
                }
              </p>
            ) : null}
          </section>

          <section className="settings-card settings-stack" aria-label="同步状态">
            <div className="settings-heading">
              <div>
                <h2>账户同步</h2>
                {sync.data ? (
                  <p>
                    最近成功 {new Date(sync.data.syncedAt).toLocaleString()} · 待上传{" "}
                    {sync.data.pending} · 冲突 {sync.data.conflicts}
                  </p>
                ) : (
                  <p>正在读取同步状态…</p>
                )}
              </div>
              <button type="button" onClick={() => void sync.refetch()} disabled={sync.isFetching}>
                立即同步
              </button>
            </div>
            {sync.error ? (
              <p className="inline-error">
                同步失败：{sync.error.message}。本地内容仍在 Outbox，可稍后重试。
              </p>
            ) : null}
            {conflicts.data?.map((conflict) => (
              <div className="conflict-card" key={conflict.conflictId}>
                <strong>
                  {conflict.objectType} · {conflict.objectId}
                </strong>
                <span>本机版本：{conflictPayload(conflict.clientPayload)}</span>
                <span>云端版本：{conflictPayload(conflict.serverPayload)}</span>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      resolveConflict.mutate({
                        conflictId: conflict.conflictId,
                        resolution: "local",
                      })
                    }
                  >
                    保留本机版本
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resolveConflict.mutate({
                        conflictId: conflict.conflictId,
                        resolution: "cloud",
                      })
                    }
                  >
                    使用云端版本
                  </button>
                </div>
              </div>
            ))}
            {resolveConflict.error ? (
              <p className="inline-error">冲突处理失败：{resolveConflict.error.message}</p>
            ) : null}
          </section>

          <section className="settings-card settings-stack" aria-label="账户 Token 用量">
            <h2>账户 Token 用量</h2>
            {accountUsage.data ? (
              <div className="usage-line">
                <span>{accountUsage.data.records} 次模型调用</span>
                <span>输入 {tokenValue(accountUsage.data.inputTokens)}</span>
                <span>缓存 {tokenValue(accountUsage.data.cachedInputTokens)}</span>
                <span>输出 {tokenValue(accountUsage.data.outputTokens)}</span>
                <span>推理 {tokenValue(accountUsage.data.reasoningTokens)}</span>
                <strong>总计 {tokenValue(accountUsage.data.totalTokens)}</strong>
              </div>
            ) : (
              <p>暂无可核对的账户用量。</p>
            )}
          </section>

          <section className="settings-card settings-stack" aria-label="个人数据边界">
            <h2>个人数据边界</h2>
            <p>清本机缓存不会创建云端墓碑；退出设备不会删除本机历史或云端对话。</p>
            <div className="settings-actions">
              <button type="button" onClick={() => clearLocalCache.mutate()}>
                清理本机缓存
              </button>
              <button
                type="button"
                className="danger-action"
                onClick={() => deleteCloudData.mutate()}
              >
                删除云端对话数据
              </button>
            </div>
            {clearLocalCache.data ? <p>本机缓存已清理。</p> : null}
            {deleteCloudData.data ? (
              <p>
                已删除 {deleteCloudData.data.deletedObjects} 个云对象；墓碑保留至{" "}
                {new Date(deleteCloudData.data.retainUntil).toLocaleString()}。
              </p>
            ) : null}
            {clearLocalCache.error || deleteCloudData.error ? (
              <p className="inline-error">
                {(clearLocalCache.error ?? deleteCloudData.error)?.message}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}

function BillingAssetCards({ overview }: { overview: BillingOverview }): React.JSX.Element {
  const pointCount = overview.pointGrants.reduce((sum, grant) => sum + grant.remainingPoints, 0);
  return (
    <section className="billing-assets" aria-label="账户资产">
      <article>
        <span>可用额度</span>
        <strong>{cny(overview.quotaAvailableMinor)}</strong>
        <small>{overview.quotaGrants.length} 笔，按最早到期顺序使用</small>
      </article>
      <article>
        <span>可用积分</span>
        <strong>{pointCount.toLocaleString()} 分</strong>
        <small>按服务端兑换规则可抵 {cny(overview.pointAvailableMinor)}</small>
      </article>
      <article>
        <span>充值余额</span>
        <strong>{cny(overview.cash.postedMinor)}</strong>
        <small>当前可用 {cny(overview.cash.availableMinor)}</small>
      </article>
      <article className="billing-total">
        <span>总可用价值</span>
        <strong>{cny(overview.totalAvailableMinor)}</strong>
        <small>预留中 {cny(overview.activeReservationsMinor)}</small>
      </article>
    </section>
  );
}

function ChargeRow({ charge }: { charge: ChargeRecord }): React.JSX.Element {
  return (
    <div className="billing-row" data-charge-status={charge.status}>
      <div>
        <strong>{charge.effectiveModelRef}</strong>
        <span>{new Date(charge.settledAt ?? charge.createdAt).toLocaleString()}</span>
        <span>
          Token：输入 {charge.usage.inputTokens ?? "未知"} · 缓存{" "}
          {charge.usage.cachedInputTokens ?? "未知"} · 输出 {charge.usage.outputTokens ?? "未知"} ·
          推理 {charge.usage.reasoningTokens ?? "未知"}
        </span>
        <span>
          服务端价格 {charge.pricingSnapshot.version} · {charge.pricingSnapshot.description}
        </span>
      </div>
      <div>
        <span>额度 {cny(charge.quotaDeductionMinor)}</span>
        <span>
          积分 {charge.pointsDeducted.toLocaleString()} · {cny(charge.pointDeductionMinor)}
        </span>
        <span>余额 {cny(charge.cashDeductionMinor)}</span>
      </div>
      <strong>{cny(charge.finalAmountMinor)}</strong>
      <code>{charge.chargeId}</code>
      {charge.pendingReason ? <span>待核算：{charge.pendingReason}</span> : null}
    </div>
  );
}

function RechargeRow({ order }: { order: RechargeOrder }): React.JSX.Element {
  return (
    <div className="billing-row">
      <div>
        <strong>{order.provider === "alipay" ? "支付宝" : "微信支付"}</strong>
        <span>{new Date(order.createdAt).toLocaleString()}</span>
      </div>
      <span className={`billing-status status-${order.status}`}>{order.status}</span>
      <strong>{cny(order.amountMinor)}</strong>
      {order.checkoutUrl ? (
        <a href={order.checkoutUrl} target="_blank" rel="noreferrer">
          打开托管收银台
        </a>
      ) : null}
      <code>{order.orderId}</code>
    </div>
  );
}

function RefundRow({ refund }: { refund: RefundOrder }): React.JSX.Element {
  return (
    <div className="billing-row">
      <div>
        <strong>退款 · {refund.reason}</strong>
        <span>{new Date(refund.createdAt).toLocaleString()}</span>
      </div>
      <span className={`billing-status status-${refund.status}`}>{refund.status}</span>
      <strong>-{cny(refund.amountMinor)}</strong>
      <code>{refund.refundId}</code>
    </div>
  );
}

function BillingSettings(): React.JSX.Element {
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => window.openerx.getAccountState(),
  });
  const signedIn = account.data?.status === "signed_in";
  const terms = useQuery({
    queryKey: [...billingKey, "terms"],
    queryFn: () => window.openerx.getBillingTerms(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const overview = useQuery({
    queryKey: [...billingKey, "overview"],
    queryFn: () => window.openerx.getBillingOverview(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const charges = useQuery({
    queryKey: [...billingKey, "charges"],
    queryFn: () => window.openerx.listCharges(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const ledger = useQuery({
    queryKey: [...billingKey, "ledger"],
    queryFn: () => window.openerx.listLedger(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const orders = useQuery({
    queryKey: [...billingKey, "orders"],
    queryFn: () => window.openerx.listRechargeOrders(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const refunds = useQuery({
    queryKey: [...billingKey, "refunds"],
    queryFn: () => window.openerx.listRefunds(),
    enabled: signedIn,
    retry: false,
    refetchOnMount: "always",
  });
  const acceptTerms = useMutation({
    mutationFn: () => {
      if (!terms.data) throw new Error("收费条款尚未加载");
      return window.openerx.acceptBillingTerms(terms.data.terms.version);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...billingKey, "terms"] }),
  });
  const [rechargeMinor, setRechargeMinor] = useState(5_000);
  const [provider, setProvider] = useState<"alipay" | "wechat">("alipay");
  const createOrder = useMutation({
    mutationFn: () =>
      window.openerx.createRechargeOrder({
        amountMinor: rechargeMinor,
        provider,
        idempotencyKey: idempotencyKey("recharge"),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...billingKey, "orders"] }),
  });
  const [statementMonth, setStatementMonth] = useState(previousMonth);
  const statement = useMutation({
    mutationFn: () => window.openerx.exportBillingStatement(statementMonth),
  });

  if (account.isPending) return <main className="center-state">正在读取账户状态…</main>;
  if (!signedIn) {
    return (
      <main className="settings-page">
        <p className="eyebrow">Billing Alpha</p>
        <h1>费用与账单</h1>
        <section className="settings-card settings-stack">
          <h2>需要登录</h2>
          <p>Billing 数据只从当前账户的服务端财务系统读取。</p>
          <NavLink to="/settings/account">前往账户登录</NavLink>
        </section>
      </main>
    );
  }

  const loadError =
    terms.error ??
    overview.error ??
    charges.error ??
    ledger.error ??
    orders.error ??
    refunds.error ??
    null;
  return (
    <main className="settings-page billing-page">
      <p className="eyebrow">Billing Alpha</p>
      <h1>费用与账单</h1>
      <p className="billing-server-note">
        Token 计量、费率匹配、报价、资金预留与最终扣费全部由服务端完成；本页只显示服务端返回的最终
        Billing 信息。
      </p>

      {overview.data ? <BillingAssetCards overview={overview.data} /> : null}

      <section className="settings-card settings-stack" aria-label="收费条款">
        <div className="settings-heading">
          <div>
            <h2>收费条款</h2>
            <p>{terms.data?.terms.summary ?? "正在读取当前条款…"}</p>
          </div>
          {terms.data?.acceptance ? (
            <span className="billing-status status-credited">
              已接受 {new Date(terms.data.acceptance.acceptedAt).toLocaleString()}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => acceptTerms.mutate()}
              disabled={!terms.data || acceptTerms.isPending}
            >
              接受当前条款
            </button>
          )}
        </div>
        {terms.data ? (
          <code>
            版本 {terms.data.terms.version} · 内容 {terms.data.terms.contentHash.slice(0, 12)}
          </code>
        ) : null}
      </section>

      <section className="settings-card settings-stack" aria-label="充值">
        <div className="settings-heading">
          <div>
            <h2>充值</h2>
            <p>客户端只创建订单；支付结果必须经服务端验签后才会进入余额。</p>
          </div>
          <form
            className="billing-order-form"
            onSubmit={(event) => {
              event.preventDefault();
              createOrder.mutate();
            }}
          >
            <label>
              金额
              <select
                value={rechargeMinor}
                onChange={(event) => setRechargeMinor(Number(event.target.value))}
              >
                <option value={1_000}>¥10</option>
                <option value={5_000}>¥50</option>
                <option value={10_000}>¥100</option>
              </select>
            </label>
            <label>
              渠道
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value as "alipay" | "wechat")}
              >
                <option value="alipay">支付宝</option>
                <option value="wechat">微信支付</option>
              </select>
            </label>
            <button type="submit" disabled={createOrder.isPending}>
              创建充值订单
            </button>
          </form>
        </div>
        {createOrder.data ? (
          <p>
            订单 {createOrder.data.orderId} 已创建，当前状态 {createOrder.data.status}
            。到账以服务端状态为准。
            {createOrder.data.checkoutUrl ? (
              <>
                {" "}
                <a href={createOrder.data.checkoutUrl} target="_blank" rel="noreferrer">
                  打开托管收银台
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="billing-list">
          {orders.data?.map((order) => (
            <RechargeRow key={order.orderId} order={order} />
          ))}
          {orders.data?.length === 0 ? <p>暂无充值订单。</p> : null}
          {refunds.data?.map((refund) => (
            <RefundRow key={refund.refundId} refund={refund} />
          ))}
        </div>
      </section>

      <section className="settings-card settings-stack" aria-label="消费明细">
        <div className="settings-heading">
          <div>
            <h2>最终消费明细</h2>
            <p>每笔记录来自服务端 Usage → Charge → Ledger 结算链路。</p>
          </div>
          <span>{charges.data?.length ?? 0} 笔</span>
        </div>
        <div className="billing-list">
          {charges.data?.map((charge) => (
            <ChargeRow key={charge.chargeId} charge={charge} />
          ))}
          {charges.data?.length === 0 ? <p>暂无消费记录。</p> : null}
        </div>
      </section>

      <section className="settings-card settings-stack" aria-label="月度账单">
        <div className="settings-heading">
          <div>
            <h2>月度账单</h2>
            <p>已生成账单不可覆盖；后续退款或调整进入后续账期。</p>
          </div>
          <form
            className="billing-order-form"
            onSubmit={(event) => {
              event.preventDefault();
              statement.mutate();
            }}
          >
            <label>
              月份
              <input
                type="month"
                value={statementMonth}
                onChange={(event) => setStatementMonth(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={statement.isPending}>
              生成账单
            </button>
          </form>
        </div>
        {statement.data ? (
          <div className="statement-result">
            <span>期初 {cny(statement.data.statement.openingMinor)}</span>
            <span>消费 {cny(statement.data.statement.chargesMinor)}</span>
            <span>充值 {cny(statement.data.statement.creditsMinor)}</span>
            <span>退款 {cny(statement.data.statement.refundsMinor)}</span>
            <span>冲正 {cny(statement.data.statement.reversalsMinor)}</span>
            <strong>期末 {cny(statement.data.statement.closingMinor)}</strong>
            <a
              download={`openerx-billing-${statementMonth}.csv`}
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(statement.data.csv)}`}
            >
              下载 CSV
            </a>
            <a
              download={`openerx-billing-${statementMonth}.pdf`}
              href={`data:application/pdf;base64,${statement.data.pdfBase64}`}
            >
              下载 PDF
            </a>
          </div>
        ) : null}
      </section>

      <section className="settings-card settings-stack" aria-label="账本状态">
        <h2>账本状态</h2>
        <p>{ledger.data?.length ?? 0} 个平衡业务事务；客户端无写余额或账本接口。</p>
      </section>

      {loadError || acceptTerms.error || createOrder.error || statement.error ? (
        <p className="inline-error">
          {(loadError ?? acceptTerms.error ?? createOrder.error ?? statement.error)?.message}
        </p>
      ) : null}
    </main>
  );
}

function ToolCenter(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "streamable_http">("stdio");
  const [mcpEndpoint, setMcpEndpoint] = useState("");
  const [mcpCwd, setMcpCwd] = useState("");
  const [mcpAuth, setMcpAuth] = useState<"none" | "bearer" | "oauth">("none");
  const [mcpToken, setMcpToken] = useState("");
  const [mcpOAuthClientId, setMcpOAuthClientId] = useState("");
  const [mcpOAuthClientSecret, setMcpOAuthClientSecret] = useState("");
  const [mcpOAuthScope, setMcpOAuthScope] = useState("");
  const workItems = useQuery({
    queryKey: ["tools", "work-items"],
    queryFn: () => window.openerx.listWorkItems({ limit: 100 }),
  });
  const scopes = useQuery({
    queryKey: ["tools", "scopes"],
    queryFn: () => window.openerx.listCapabilityScopes(),
  });
  const permissions = useQuery({
    queryKey: ["tools", "permissions", "pending"],
    queryFn: () => window.openerx.listPermissionRequests({ status: "pending" }),
  });
  const mcpServers = useQuery({
    queryKey: ["tools", "mcp-servers"],
    queryFn: () => window.openerx.listMcpServers(),
  });
  const revoke = useMutation({
    mutationFn: (scopeId: string) => window.openerx.revokeCapabilityScope({ scopeId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["tools", "scopes"] }),
  });
  const saveMcp = useMutation({
    mutationFn: (config: McpServerConfig) =>
      window.openerx.saveMcpServer({
        config,
        ...(mcpTransport === "streamable_http" && mcpAuth === "bearer" && mcpToken
          ? { bearerToken: mcpToken }
          : {}),
        ...(mcpTransport === "streamable_http" &&
        mcpAuth === "oauth" &&
        mcpOAuthClientId &&
        mcpOAuthClientSecret
          ? {
              oauthClientId: mcpOAuthClientId,
              oauthClientSecret: mcpOAuthClientSecret,
              ...(mcpOAuthScope ? { oauthScope: mcpOAuthScope } : {}),
            }
          : {}),
      }),
    onSuccess: async () => {
      setMcpName("");
      setMcpEndpoint("");
      setMcpCwd("");
      setMcpToken("");
      setMcpOAuthClientId("");
      setMcpOAuthClientSecret("");
      setMcpOAuthScope("");
      await queryClient.invalidateQueries({ queryKey: ["tools", "mcp-servers"] });
    },
  });
  const removeMcp = useMutation({
    mutationFn: (serverId: string) => window.openerx.removeMcpServer({ serverId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["tools", "mcp-servers"] }),
  });
  return (
    <main className="tool-center-page">
      <header>
        <p className="eyebrow">Tool Alpha</p>
        <h1>任务与工具</h1>
        <p>查看 Pi 工具活动、处理权限请求，并撤销设备本地 Scope。</p>
      </header>
      <section className="tool-center-summary" aria-label="工具状态摘要">
        <div>
          <strong>{workItems.data?.length ?? 0}</strong>
          <span>任务</span>
        </div>
        <div>
          <strong>{permissions.data?.length ?? 0}</strong>
          <span>待授权</span>
        </div>
        <div>
          <strong>{scopes.data?.length ?? 0}</strong>
          <span>有效 Scope</span>
        </div>
      </section>
      <section className="tool-catalog" aria-label="工具目录">
        <h2>工具目录</h2>
        <div className="tool-catalog-grid">
          {toolCatalog.map((tool) => (
            <article key={`${tool.namespace}:${tool.name}`}>
              <small>{tool.namespace}</small>
              <strong>{tool.name}</strong>
              <span>{tool.detail}</span>
            </article>
          ))}
        </div>
      </section>
      <section className="tool-center-grid">
        <div>
          <h2>最近任务</h2>
          {workItems.data?.length ? (
            workItems.data.map((workItem) => <ToolActivity key={workItem.id} workItem={workItem} />)
          ) : (
            <p className="muted-copy">还没有工具任务。</p>
          )}
        </div>
        <aside>
          <h2>本地授权</h2>
          {scopes.data?.map((scope) => (
            <article className="scope-card" key={scope.id}>
              <strong>{scope.capability}</strong>
              <span>{scope.resource}</span>
              <small>
                {scope.maxRisk} · {scope.sessionOnly ? "临时" : "持久"}
              </small>
              <button
                type="button"
                className="danger-action"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(scope.id)}
              >
                撤销
              </button>
            </article>
          ))}
          {!scopes.data?.length ? <p className="muted-copy">没有有效授权。</p> : null}
          <h2>MCP 服务</h2>
          {mcpServers.data?.map((server) => (
            <article className="scope-card" key={server.id}>
              <strong>{server.name}</strong>
              <span>{server.transport === "stdio" ? server.command : server.url}</span>
              <small>
                {server.transport} · {server.enabled ? "已启用" : "已禁用"}
                {server.transport === "streamable_http" ? ` · ${server.auth}` : ""}
              </small>
              <button
                type="button"
                className="danger-action"
                onClick={() => removeMcp.mutate(server.id)}
              >
                移除
              </button>
            </article>
          ))}
          <form
            className="mcp-config-form"
            aria-label="添加 MCP 服务"
            onSubmit={(event) => {
              event.preventDefault();
              const id = crypto.randomUUID();
              const config: McpServerConfig =
                mcpTransport === "stdio"
                  ? {
                      id,
                      name: mcpName,
                      transport: "stdio",
                      command: mcpEndpoint,
                      args: [],
                      cwd: mcpCwd,
                      enabled: true,
                      enabledTools: [],
                    }
                  : {
                      id,
                      name: mcpName,
                      transport: "streamable_http",
                      url: mcpEndpoint,
                      auth: mcpAuth,
                      credentialRef: null,
                      enabled: true,
                      enabledTools: [],
                    };
              saveMcp.mutate(config);
            }}
          >
            <strong>添加服务</strong>
            <input
              aria-label="MCP 名称"
              placeholder="名称"
              value={mcpName}
              onChange={(event) => setMcpName(event.target.value)}
              required
            />
            <select
              aria-label="MCP 传输"
              value={mcpTransport}
              onChange={(event) =>
                setMcpTransport(event.target.value as "stdio" | "streamable_http")
              }
            >
              <option value="stdio">STDIO</option>
              <option value="streamable_http">Streamable HTTP</option>
            </select>
            <input
              aria-label={mcpTransport === "stdio" ? "MCP 命令" : "MCP URL"}
              placeholder={mcpTransport === "stdio" ? "可执行文件路径" : "https://…/mcp"}
              value={mcpEndpoint}
              onChange={(event) => setMcpEndpoint(event.target.value)}
              required
            />
            {mcpTransport === "stdio" ? (
              <input
                aria-label="MCP 工作目录"
                placeholder="工作目录"
                value={mcpCwd}
                onChange={(event) => setMcpCwd(event.target.value)}
                required
              />
            ) : (
              <>
                <select
                  aria-label="MCP 认证"
                  value={mcpAuth}
                  onChange={(event) => setMcpAuth(event.target.value as typeof mcpAuth)}
                >
                  <option value="none">无认证</option>
                  <option value="bearer">Bearer</option>
                  <option value="oauth">OAuth</option>
                </select>
                {mcpAuth === "bearer" ? (
                  <input
                    aria-label="MCP Bearer Token"
                    type="password"
                    autoComplete="off"
                    value={mcpToken}
                    onChange={(event) => setMcpToken(event.target.value)}
                    required
                  />
                ) : mcpAuth === "oauth" ? (
                  <>
                    <input
                      aria-label="MCP OAuth Client ID"
                      autoComplete="off"
                      placeholder="Client ID"
                      value={mcpOAuthClientId}
                      onChange={(event) => setMcpOAuthClientId(event.target.value)}
                      required
                    />
                    <input
                      aria-label="MCP OAuth Client Secret"
                      type="password"
                      autoComplete="off"
                      placeholder="Client Secret"
                      value={mcpOAuthClientSecret}
                      onChange={(event) => setMcpOAuthClientSecret(event.target.value)}
                      required
                    />
                    <input
                      aria-label="MCP OAuth Scope"
                      autoComplete="off"
                      placeholder="Scope（可选）"
                      value={mcpOAuthScope}
                      onChange={(event) => setMcpOAuthScope(event.target.value)}
                    />
                  </>
                ) : null}
              </>
            )}
            <button type="submit" className="primary-action" disabled={saveMcp.isPending}>
              保存 MCP
            </button>
            {saveMcp.error ? <p className="inline-error">{saveMcp.error.message}</p> : null}
          </form>
        </aside>
      </section>
    </main>
  );
}

function Sidebar({
  environment,
  serviceStatus,
}: {
  environment: DesktopEnvironment | null;
  serviceStatus: string;
}): React.JSX.Element {
  const [showArchived, setShowArchived] = useState(false);
  const history = useQuery({
    queryKey: chatKeys.list(showArchived),
    queryFn: () => window.openerx.listConversations({ includeArchived: showArchived }),
  });
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => window.openerx.getAccountState(),
  });
  const displayedStatus =
    history.isSuccess && serviceStatus === "starting" ? "ready" : serviceStatus;
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand">
          <span className="brand-mark">
            <img src="/assets/china-unicom-logo.png" alt="中国联通官方标志" />
          </span>
          <span>OpenerX</span>
        </div>
        <button type="button" className="icon-button sidebar-collapse" aria-label="收起侧栏">
          <SidebarSimple size={18} weight="regular" />
        </button>
      </div>
      <nav aria-label="主导航" className="main-nav">
        <NavLink to="/chat/new" className="new-chat-link">
          <Plus size={17} weight="bold" />
          <span>新对话</span>
        </NavLink>
        <NavLink to="/search">
          <MagnifyingGlass size={17} />
          <span>搜索</span>
          <kbd>⌘K</kbd>
        </NavLink>
        <NavLink to="/files">
          <FolderSimple size={17} />
          <span>个人文件</span>
        </NavLink>
        <NavLink to="/tasks">
          <TerminalWindow size={17} />
          <span>任务与工具</span>
        </NavLink>
        <NavLink to="/assistants">
          <Sparkle size={17} />
          <span>助手与 Skill</span>
        </NavLink>
        <NavLink to="/settings/billing">
          <Receipt size={17} />
          <span>费用与账单</span>
        </NavLink>
        <NavLink to="/settings/account">
          <GearSix size={17} />
          <span>设置</span>
        </NavLink>
      </nav>
      <section className="history-list" aria-label="对话历史">
        <div className="history-heading">
          <span>历史</span>
          <button
            type="button"
            aria-label={showArchived ? "仅显示活动对话" : "显示归档对话"}
            onClick={() => setShowArchived((value) => !value)}
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>
        {history.data?.map((conversation: ConversationSummary) => (
          <NavLink to={`/chat/${conversation.id}`} key={conversation.id}>
            <ChatCircle size={16} weight="regular" />
            <strong>{conversation.title}</strong>
            <span>
              {conversation.archivedAt ? "已归档 · " : ""}
              {conversation.lastMessagePreview}
            </span>
          </NavLink>
        ))}
      </section>
      <div className={`sync-state service-${displayedStatus}`}>
        {displayedStatus === "ready" ? (
          <CheckCircle size={16} weight="fill" />
        ) : (
          <ArrowClockwise size={16} />
        )}
        <div>
          <strong>{displayedStatus === "ready" ? "已同步" : "正在同步"}</strong>
          <span>
            {environment ? `${environment.platform} · ${displayedStatus}` : "正在连接桌面服务"}
          </span>
        </div>
        <button type="button" className="icon-button" aria-label="立即同步">
          <ArrowClockwise size={16} />
        </button>
      </div>
      <NavLink className="sidebar-account" to="/settings/account">
        <UserCircle size={23} weight="regular" />
        <strong>{account.data?.account?.displayName ?? "未登录"}</strong>
        <span>{account.data?.status === "signed_in" ? "已登录" : "未登录"}</span>
        <CaretDown size={15} />
      </NavLink>
    </aside>
  );
}

export function App(): React.JSX.Element {
  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);
  const [serviceStatus, setServiceStatus] = useState("starting");
  const [contextOpen, setContextOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  const location = useLocation();
  const isConversationRoute =
    location.pathname.startsWith("/chat/") && location.pathname !== "/chat/new";

  useEffect(() => {
    setContextOpen(isConversationRoute);
  }, [isConversationRoute]);

  useEffect(() => {
    const mediaQuery =
      themePreference === "system" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: light)")
        : null;
    const applyTheme = (): void => {
      const theme = resolvedTheme(themePreference);
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.themePreference = themePreference;
      document.documentElement.style.colorScheme = theme;
    };

    applyTheme();
    try {
      window.localStorage.setItem(themeStorageKey, themePreference);
    } catch {
      // Theme switching still works when storage is unavailable.
    }
    mediaQuery?.addEventListener("change", applyTheme);
    return () => mediaQuery?.removeEventListener("change", applyTheme);
  }, [themePreference]);

  const sequenceByConversation = useRef(new Map<string, number>());
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    void window.openerx.getEnvironment().then((value) => {
      if (active) setEnvironment(value);
    });
    const applyEvent = (event: ChatEvent): void => {
      if (event.type === "service.status") {
        setServiceStatus(event.payload.status ?? "unavailable");
        return;
      }
      if (
        event.type.startsWith("run.") ||
        event.type.startsWith("tool.") ||
        event.type.startsWith("permission.")
      ) {
        void queryClient.invalidateQueries({ queryKey: ["tools"] });
      }
      if (!event.conversationId) return;
      const conversationId = event.conversationId;
      const previous = sequenceByConversation.current.get(conversationId) ?? 0;
      if (event.sequence > previous + 1) {
        void window.openerx
          .getChatEvents({ conversationId, afterSequence: previous })
          .then((events) => {
            sequenceByConversation.current.set(conversationId, events.at(-1)?.sequence ?? previous);
          });
      } else if (event.sequence > previous) {
        sequenceByConversation.current.set(conversationId, event.sequence);
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
      void queryClient.invalidateQueries({ queryKey: ["chat", "list"] });
    };
    const unsubscribe = window.openerx.onChatEvent(applyEvent);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);

  return (
    <div className={`app-shell ${contextOpen ? "context-is-open" : ""}`}>
      <Sidebar environment={environment} serviceStatus={serviceStatus} />
      <div className="app-main">
        <Routes>
          <Route path="/chat/new" element={<NewChat />} />
          <Route
            path="/chat/:conversationId"
            element={
              <ChatPage
                contextOpen={contextOpen}
                onToggleContext={() => setContextOpen((current) => !current)}
              />
            }
          />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/files" element={<FilesAndArtifacts />} />
          <Route path="/tasks" element={<ToolCenter />} />
          <Route path="/assistants" element={<SkillCenter />} />
          <Route path="/settings/billing" element={<BillingSettings />} />
          <Route
            path="/settings/account"
            element={
              <AccountSettings
                themePreference={themePreference}
                onThemeChange={setThemePreference}
              />
            }
          />
          <Route path="/settings/*" element={<Placeholder title="设置" />} />
          <Route path="*" element={<Navigate to="/chat/new" replace />} />
        </Routes>
      </div>
      {contextOpen ? <ContextDock onClose={() => setContextOpen(false)} /> : null}
    </div>
  );
}
