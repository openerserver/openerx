import type { ChatEvent, RemoteProductEvent } from "@openerx/contracts";

const eventKind: Partial<Record<ChatEvent["type"], RemoteProductEvent["kind"]>> = {
  "conversation.created": "conversation.updated",
  "conversation.updated": "conversation.updated",
  "message.delta": "message.delta",
  "message.completed": "message.completed",
  "message.cancelling": "message.cancelling",
  "message.stopped": "message.stopped",
  "message.interrupted": "message.interrupted",
  "message.failed": "message.failed",
  "run.started": "run.status_changed",
  "run.progressed": "run.status_changed",
  "run.cancelling": "run.status_changed",
  "run.completed": "run.status_changed",
  "run.failed": "run.status_changed",
  "run.interrupted": "run.status_changed",
  "run.cancelled": "run.status_changed",
  "tool.requested": "tool.status_changed",
  "tool.progressed": "tool.status_changed",
  "tool.completed": "tool.status_changed",
  "tool.failed": "tool.status_changed",
  "permission.required": "attention.requested",
  "permission.resolved": "attention.resolved",
};

export function projectChatEventForRemote(event: ChatEvent): {
  kind: RemoteProductEvent["kind"];
  conversationId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
} | null {
  const reconciliation = event.payload.reconciliation ?? [];
  const kind = reconciliation.some(({ actionRequired }) => actionRequired)
    ? "review.available"
    : eventKind[event.type];
  if (!kind) return null;
  return {
    kind,
    conversationId: event.conversationId,
    occurredAt: event.occurredAt,
    payload: {
      eventId: event.eventId,
      type: event.type,
      conversationId: event.conversationId,
      messageId: event.messageId,
      sequence: event.sequence,
      ...(event.payload.conversation === undefined
        ? {}
        : { conversationRevision: event.payload.conversation.revision }),
      ...(event.payload.delta === undefined ? {} : { delta: event.payload.delta }),
      ...(event.payload.reason === undefined ? {} : { reason: event.payload.reason }),
      ...(event.payload.workItem === undefined
        ? {}
        : { workItemId: event.payload.workItem.id, workItemStatus: event.payload.workItem.status }),
      ...(event.payload.run === undefined
        ? {}
        : { runId: event.payload.run.id, runStatus: event.payload.run.status }),
      ...(event.payload.toolCall === undefined
        ? {}
        : {
            toolCallId: event.payload.toolCall.id,
            toolName: event.payload.toolCall.toolName,
            toolStatus: event.payload.toolCall.status,
          }),
      ...(event.payload.permission === undefined
        ? {}
        : {
            permissionRequestId: event.payload.permission.id,
            risk: event.payload.permission.risk,
            target: event.payload.permission.resource,
            actions: event.payload.permission.actions,
            payloadDigest: event.payload.permission.payloadDigest,
            expiresAt: event.payload.permission.expiresAt,
          }),
      ...(reconciliation.length === 0 ? {} : { reconciliation }),
    },
  };
}
