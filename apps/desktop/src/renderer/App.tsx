import type {
  ChatEvent,
  ConversationSnapshot,
  ConversationSummary,
  DesktopEnvironment,
  Message,
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

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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

  return (
    <header className="conversation-toolbar">
      <div>
        <p className="eyebrow">{conversation.selectedModelRef}</p>
        <h1>{conversation.title}</h1>
      </div>
      <div className="toolbar-actions">
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
        <Route path="/settings/*" element={<Placeholder title="设置" />} />
        <Route path="*" element={<Navigate to="/chat/new" replace />} />
      </Routes>
    </div>
  );
}
