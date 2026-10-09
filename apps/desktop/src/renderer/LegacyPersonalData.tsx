import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export function LegacyPersonalData({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}): React.JSX.Element {
  const [opened, setOpened] = useState(Boolean(initialConversationId));
  const [selectedId, setSelectedId] = useState(initialConversationId);
  const conversations = useQuery({
    queryKey: ["legacy-personal-data", "conversations"],
    queryFn: () => window.openerx.listLegacyConversations({ includeArchived: true }),
    enabled: opened,
  });
  const snapshot = useQuery({
    queryKey: ["legacy-personal-data", "conversation", selectedId],
    queryFn: () => {
      if (!selectedId) throw new Error("请选择旧版记录");
      return window.openerx.getLegacyConversation({ conversationId: selectedId });
    },
    enabled: opened && Boolean(selectedId),
  });
  return (
    <section className="settings-card settings-stack" aria-label="旧版数据">
      <h2>旧版数据</h2>
      <p>升级前的记录保留在此电脑，可查看内容并导出备份。</p>
      <button type="button" onClick={() => setOpened((value) => !value)} aria-expanded={opened}>
        {opened ? "收起旧版记录" : "查看旧版记录"}
      </button>
      {opened ? (
        <>
          {conversations.isPending ? <p role="status">正在读取旧版记录…</p> : null}
          {conversations.error || snapshot.error ? (
            <p role="alert">旧版记录未能读取，请稍后重试。</p>
          ) : null}
          {conversations.data?.length === 0 ? <p>没有旧版对话记录。</p> : null}
          <nav aria-label="旧版对话记录" className="settings-actions">
            {conversations.data?.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                aria-pressed={selectedId === conversation.id}
                onClick={() => setSelectedId(conversation.id)}
              >
                {conversation.title}
              </button>
            ))}
          </nav>
          {snapshot.data ? (
            <section aria-label="旧版对话内容">
              <h3>{snapshot.data.conversation.title}</h3>
              <p className="settings-note">只读记录 · 后续工作请在企业工作台新建任务</p>
              {snapshot.data.messages.map((message) => (
                <article key={message.id}>
                  <strong>
                    {message.role === "user"
                      ? "你"
                      : message.role === "assistant"
                        ? "助手"
                        : "系统"}
                  </strong>
                  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {message.parts.map((part) => part.text).join("\n")}
                  </p>
                </article>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
