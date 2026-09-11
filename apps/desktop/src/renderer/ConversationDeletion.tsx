import type { Conversation, ConversationSummary } from "@openerx/contracts";
import { Trash } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { ConfirmDialog } from "./ConfirmDialog";
import "./conversation-deletion.css";

type ConversationTarget = Pick<Conversation, "id" | "title" | "projectId">;
type RequestDeletion = (conversation: ConversationTarget, trigger: HTMLElement | null) => void;

const ConversationDeletionContext = createContext<RequestDeletion | null>(null);

export function useConversationDeletion(): RequestDeletion {
  const requestDeletion = useContext(ConversationDeletionContext);
  if (!requestDeletion) throw new Error("Conversation deletion provider is missing");
  return requestDeletion;
}

export function ConversationDeleteButton({
  conversation,
}: {
  conversation: ConversationTarget;
}): React.JSX.Element {
  const requestDeletion = useConversationDeletion();
  return (
    <button
      type="button"
      className="conversation-list-delete"
      aria-label={`删除对话：${conversation.title}`}
      title="删除对话"
      onClick={(event) => requestDeletion(conversation, event.currentTarget)}
    >
      <Trash size={15} aria-hidden="true" />
    </button>
  );
}

export function ConversationDeletionProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [target, setTarget] = useState<ConversationTarget | null>(null);
  const [forgetSourceMemories, setForgetSourceMemories] = useState(false);
  const [notice, setNotice] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const restoreFocus = (): void => {
    window.requestAnimationFrame(() => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
      else if (listRef.current?.isConnected) {
        const next = listRef.current.querySelector<HTMLElement>("a, button");
        (next ?? document.getElementById("main-content"))?.focus();
      } else document.getElementById("main-content")?.focus();
    });
  };

  const remove = useMutation({
    mutationFn: ({
      conversation,
      forgetMemories,
    }: {
      conversation: ConversationTarget;
      forgetMemories: boolean;
    }) =>
      window.openerx.deleteConversation({
        conversationId: conversation.id,
        forgetSourceMemories: forgetMemories,
      }),
    onSuccess: async (_result, { conversation, forgetMemories }) => {
      const currentId = matchPath("/chat/:conversationId", pathnameRef.current)?.params
        .conversationId;
      if (currentId === conversation.id) {
        navigate(conversation.projectId ? `/projects/${conversation.projectId}` : "/chat/new", {
          replace: true,
        });
      }
      await queryClient.cancelQueries({ queryKey: ["chat", "conversation", conversation.id] });
      queryClient.removeQueries({ queryKey: ["chat", "conversation", conversation.id] });
      queryClient.setQueriesData<ConversationSummary[]>({ queryKey: ["chat", "list"] }, (current) =>
        current?.filter(({ id }) => id !== conversation.id),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["chat", "search"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ...(forgetMemories ? [queryClient.invalidateQueries({ queryKey: ["memory"] })] : []),
      ]);
      setTarget(null);
      setNotice(`已删除对话：${conversation.title}`);
      restoreFocus();
    },
  });

  const requestDeletion: RequestDeletion = (conversation, trigger) => {
    if (remove.isPending) return;
    remove.reset();
    setForgetSourceMemories(false);
    setNotice("");
    triggerRef.current = trigger;
    listRef.current =
      trigger?.closest<HTMLElement>(".conversation-list-row")?.parentElement ?? null;
    setTarget(conversation);
  };

  return (
    <ConversationDeletionContext.Provider value={requestDeletion}>
      {children}
      <span className="visually-hidden conversation-delete-notice" role="status">
        {notice}
      </span>
      {target ? (
        <ConfirmDialog
          title="删除这个对话？"
          description="删除后将不再出现在历史记录中。此操作无法在应用内撤销。"
          confirmLabel="确认删除"
          pending={remove.isPending}
          onCancel={() => {
            if (remove.isPending) return;
            setTarget(null);
            restoreFocus();
          }}
          onConfirm={() =>
            remove.mutate({ conversation: target, forgetMemories: forgetSourceMemories })
          }
        >
          <p className="confirmation-dialog-target">“{target.title}”</p>
          <label className="confirmation-dialog-option">
            <input
              type="checkbox"
              checked={forgetSourceMemories}
              disabled={remove.isPending}
              onChange={(event) => setForgetSourceMemories(event.target.checked)}
            />
            <span>
              同时删除仅来源于此对话的长期记忆
              <small>其他对话或手动创建的记忆不受影响。</small>
            </span>
          </label>
          {remove.isError ? (
            <p className="conversation-delete-error" role="alert">
              删除未完成，请重试。
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </ConversationDeletionContext.Provider>
  );
}
