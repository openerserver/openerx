export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus =
  | "pending"
  | "streaming"
  | "cancelling"
  | "completed"
  | "stopped"
  | "interrupted"
  | "failed";

export interface ConversationEntity {
  id: string;
  ownerProfileId: string;
  title: string;
  activeBranchId: string;
  selectedModelRef: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  revision: number;
}

export interface BranchEntity {
  id: string;
  conversationId: string;
  parentBranchId: string | null;
  forkedFromMessageId: string | null;
  label: string;
  createdAt: string;
}

export interface MessageEntity {
  id: string;
  conversationId: string;
  branchId: string;
  parentMessageId: string | null;
  role: MessageRole;
  status: MessageStatus;
  text: string;
  errorCode: string | null;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export const terminalMessageStatuses = new Set<MessageStatus>([
  "completed",
  "stopped",
  "interrupted",
  "failed",
]);

const allowedTransitions: Readonly<Record<MessageStatus, ReadonlySet<MessageStatus>>> = {
  pending: new Set(["streaming", "cancelling", "completed", "stopped", "interrupted", "failed"]),
  streaming: new Set(["cancelling", "completed", "stopped", "interrupted", "failed"]),
  cancelling: new Set(["completed", "interrupted", "failed"]),
  completed: new Set(),
  stopped: new Set(),
  interrupted: new Set(),
  failed: new Set(),
};

export function canTransitionMessage(from: MessageStatus, to: MessageStatus): boolean {
  return from === to || allowedTransitions[from].has(to);
}

export function assertMessageTransition(from: MessageStatus, to: MessageStatus): void {
  if (!canTransitionMessage(from, to)) {
    throw new Error(`Invalid message transition: ${from} -> ${to}`);
  }
}

export function deriveConversationTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "新对话";
  }
  return normalized.length <= 42 ? normalized : `${normalized.slice(0, 41)}…`;
}

export function isConversationVisible(
  conversation: ConversationEntity,
  includeArchived: boolean,
): boolean {
  return conversation.deletedAt === null && (includeArchived || conversation.archivedAt === null);
}
