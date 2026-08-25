import type {
  ChatEvent,
  ConversationSnapshot,
  ConversationSummary,
  DesktopEnvironment,
  Message,
  TokenAggregateField,
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
    },
  });
  const signOut = useMutation({
    mutationFn: () => window.openerx.signOut(),
    onSuccess: async (state) => {
      queryClient.setQueryData(accountKey, state);
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
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
        {state?.status === "signed_in" && state.session ? (
          <div className="device-card">
            <strong>{state.session.device.name}</strong>
            <span>
              {state.session.device.platform} · {state.session.device.arch} · session v
              {state.session.sessionVersion}
            </span>
            <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              退出此设备
            </button>
          </div>
        ) : (
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
        )}
      </section>
      <p className="settings-note">
        Refresh 凭证只保存在系统凭证边界；退出设备会删除本机凭证并撤销该 DeviceSession，
        不会删除云端对话。
      </p>
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
