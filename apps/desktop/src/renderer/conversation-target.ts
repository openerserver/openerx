export function conversationTargetHref(target: {
  conversationId: string;
  branchId?: string | null;
  messageId?: string | null;
}): string {
  const params = new URLSearchParams();
  if (target.branchId) params.set("branch", target.branchId);
  if (target.messageId) params.set("message", target.messageId);
  return `/chat/${encodeURIComponent(target.conversationId)}${params.size ? `?${params}` : ""}`;
}
