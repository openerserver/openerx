import { desktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/** Validate a link against fresh conversation branches before changing its active branch. */
export function useConversationTarget(
  conversationId: string,
  ready: boolean,
  queryKey: readonly unknown[],
) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const branchId = params.get("branch"),
    messageId = params.get("message");
  const client = useQueryClient();
  const [result, setResult] = useState<{ key: string; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([conversationId, branchId, messageId, retry]);
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  useEffect(() => {
    if (!ready || (!branchId && !messageId)) return;
    let alive = true;
    const bridge = desktopWorkspaceBridge();
    setResult(null);
    void (async () => {
      let next = await bridge.getConversation({ conversationId });
      if (!alive || desktopWorkspaceBridge() !== bridge) return;
      if (
        branchId &&
        !next.branches.some(
          (branch) => branch.id === branchId && branch.conversationId === conversationId,
        )
      )
        throw new Error("目标分支已不存在或不属于此对话，请重新搜索。");
      if (branchId && next.conversation.activeBranchId !== branchId)
        next = await bridge.activateBranch({ conversationId, branchId });
      if (!alive || desktopWorkspaceBridge() !== bridge) return;
      if (branchId && next.conversation.activeBranchId !== branchId)
        throw new Error("目标分支未能打开，请重试。");
      if (
        messageId &&
        !next.messages.some(
          (message) => message.id === messageId && message.conversationId === conversationId,
        )
      )
        throw new Error("目标消息已不存在，请重新搜索。");
      client.setQueryData(queryKeyRef.current, next);
      void client.invalidateQueries({ queryKey: ["files", "conversation", conversationId] });
      void client.invalidateQueries({ queryKey: ["artifacts", "conversation", conversationId] });
      void client.invalidateQueries({ queryKey: ["workspaces", conversationId] });
      void client.invalidateQueries({ queryKey: ["tools", "work-items", conversationId] });
      setResult({ key, error: null });
    })().catch((error: unknown) => {
      if (alive && desktopWorkspaceBridge() === bridge)
        setResult({
          key,
          error: error instanceof Error ? error.message : "暂时无法定位搜索结果，请重试。",
        });
    });
    return () => {
      alive = false;
    };
    // queryKey denotes this conversation; changes to the snapshot must not reactivate the link.
  }, [conversationId, ready, branchId, messageId, key, client]);
  const targeted = Boolean(branchId || messageId);
  return {
    messageId: targeted && result?.key === key && !result.error ? messageId : null,
    loading: targeted && result?.key !== key,
    error: targeted && result?.key === key ? result.error : null,
    retry: () => setRetry((value) => value + 1),
  };
}
