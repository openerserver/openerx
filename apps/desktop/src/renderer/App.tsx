import type {
  ChatEvent,
  ConversationSnapshot,
  ConversationSummary,
  DesktopEnvironment,
  DeviceSession,
  Message,
  ModelCatalogEntry,
  SyncConflict,
  TokenAggregateField,
  UsageRecord,
} from "@openerx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
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

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function tokenValue(field: TokenAggregateField): string {
  return field.unknownRecords > 0
    ? `${field.known.toLocaleString()} + ${field.unknownRecords} 条未知`
    : field.known.toLocaleString();
}

const capabilityLabels: Record<keyof ModelCatalogEntry["capabilities"], string> = {
  text: "文本",
  imageInput: "图片",
  fileInput: "文件",
  tools: "工具",
  mcp: "MCP",
  imageGeneration: "图片生成",
};

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

function Composer({ conversationId }: { conversationId?: string }): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: (text: string) =>
      window.openerx.sendMessage({
        conversationId: conversationId ?? null,
        text,
        idempotencyKey: idempotencyKey("send"),
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
        <span>Enter 发送 · Shift+Enter 换行</span>
        <button type="submit" className="primary-action" disabled={!draft.trim() || send.isPending}>
          {send.isPending ? "发送中…" : "发送"}
        </button>
      </div>
      {send.error ? <p className="inline-error">{send.error.message}</p> : null}
    </form>
  );
}

function NewChat(): React.JSX.Element {
  return (
    <main className="new-chat-page">
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
      {text}
    </button>
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

function ConversationToolbar({ snapshot }: { snapshot: ConversationSnapshot }): React.JSX.Element {
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
      <div>
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

function ChatPage(): React.JSX.Element {
  const { conversationId = "" } = useParams();
  const snapshot = useQuery({
    queryKey: chatKeys.conversation(conversationId),
    queryFn: () => window.openerx.getConversation({ conversationId }),
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
      <ConversationToolbar snapshot={snapshot.data} />
      <section className="message-list" aria-live="polite" aria-label="对话消息">
        {snapshot.data.messages.map((message) => (
          <MessageCard key={message.id} message={message} />
        ))}
      </section>
      <Composer conversationId={conversationId} />
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

function AccountSettings(): React.JSX.Element {
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
      <div className="brand">OpenerX</div>
      <nav aria-label="主导航" className="main-nav">
        <NavLink to="/chat/new">＋ 新对话</NavLink>
        <NavLink to="/search">搜索</NavLink>
        <NavLink to="/files">个人文件</NavLink>
        <NavLink to="/assistants">助手与 Skill</NavLink>
        <NavLink to="/settings/account">设置</NavLink>
      </nav>
      <section className="history-list" aria-label="对话历史">
        <div className="history-heading">
          <span>历史</span>
          <button type="button" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? "仅活动" : "含归档"}
          </button>
        </div>
        {history.data?.map((conversation: ConversationSummary) => (
          <NavLink to={`/chat/${conversation.id}`} key={conversation.id}>
            <strong>{conversation.title}</strong>
            <span>
              {conversation.archivedAt ? "已归档 · " : ""}
              {conversation.lastMessagePreview}
            </span>
          </NavLink>
        ))}
      </section>
      <div className={`sync-state service-${displayedStatus}`}>
        <span aria-hidden="true" />
        {environment ? `${environment.platform} · ${displayedStatus}` : "正在连接桌面服务"}
      </div>
      <NavLink className="sidebar-account" to="/settings/account">
        <strong>{account.data?.account?.displayName ?? "未登录"}</strong>
        <span>{account.data?.status ?? "loading"}</span>
      </NavLink>
    </aside>
  );
}

export function App(): React.JSX.Element {
  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);
  const [serviceStatus, setServiceStatus] = useState("starting");
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
    <div className="app-shell">
      <Sidebar environment={environment} serviceStatus={serviceStatus} />
      <Routes>
        <Route path="/chat/new" element={<NewChat />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/files" element={<Placeholder title="个人文件与成果" />} />
        <Route path="/assistants" element={<Placeholder title="助手与 Skill" />} />
        <Route path="/settings/account" element={<AccountSettings />} />
        <Route path="/settings/*" element={<Placeholder title="设置" />} />
        <Route path="*" element={<Navigate to="/chat/new" replace />} />
      </Routes>
    </div>
  );
}
