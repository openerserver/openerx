import type { RealtimeEvent } from "../stores/realtime";
import {
  asRecord,
  asString,
  getRealtimeEventKind,
  getRealtimeInfo,
  getRealtimePart,
  getRealtimeSnapshotReason,
  hasCompletedTimestamp,
  parseTimestamp,
} from "./message-normalize";

type TaskMessagePatchEventBase = {
  eventId: string;
  taskId?: string;
  sessionId?: string;
  rawEventKind: string;
};

export type TaskMessagePatchEvent =
  | (TaskMessagePatchEventBase & {
      kind: "assistant-progress";
      messageId: string;
      agent?: string;
      modelLabel?: string;
      createdAt?: string;
    })
  | (TaskMessagePatchEventBase & {
      kind: "assistant-completed";
      messageId: string;
      agent?: string;
      modelLabel?: string;
      createdAt?: string;
      completedAt?: string;
    })
  | (TaskMessagePatchEventBase & {
      kind: "assistant-delta";
      messageId: string;
      textDelta: string;
    })
  | (TaskMessagePatchEventBase & {
      kind: "user-message";
      messageId?: string;
    })
  | (TaskMessagePatchEventBase & {
      kind: "tool-message";
      messageId?: string;
    })
  | (TaskMessagePatchEventBase & {
      kind: "session-created" | "session-updated";
    })
  | (TaskMessagePatchEventBase & {
      kind:
        | "task-updated"
        | "task-completed"
        | "task-failed"
        | "task-continued"
        | "task-node-updated"
        | "agent-started"
        | "task-hooks-updated"
        | "task-followup-started"
        | "task-followup-completed"
        | "task-followup-failed";
    })
  | (TaskMessagePatchEventBase & {
      kind: "ignored";
    });

export function isTaskMessagePatchEventRelevant(
  event: TaskMessagePatchEvent,
): event is Exclude<TaskMessagePatchEvent, { kind: "ignored" }> {
  return event.kind !== "ignored";
}

const TASK_EVENT_KIND_TO_PATCH_KIND = new Map<string, TaskMessagePatchEvent["kind"]>([
  ["task.updated", "task-updated"],
  ["task.completed", "task-completed"],
  ["task.failed", "task-failed"],
  ["task.continued", "task-continued"],
  ["task.node.updated", "task-node-updated"],
  ["agent.started", "agent-started"],
  ["task.hooks.updated", "task-hooks-updated"],
  ["task.followup.started", "task-followup-started"],
  ["task.followup.completed", "task-followup-completed"],
  ["task.followup.failed", "task-followup-failed"],
]);

function buildBasePatchEvent(event: RealtimeEvent): TaskMessagePatchEventBase {
  return {
    eventId: event.id,
    taskId: event.taskId,
    sessionId: event.sessionId,
    rawEventKind: getRealtimeEventKind(event),
  };
}

function buildIgnoredPatchEvent(event: RealtimeEvent): TaskMessagePatchEvent {
  return {
    ...buildBasePatchEvent(event),
    kind: "ignored",
  };
}

function extractPatchEventModelProvider(model: Record<string, unknown>) {
  return asString(model.providerID) ?? asString(model.providerId) ?? asString(model.provider);
}

function extractPatchEventModelIdentifier(model: Record<string, unknown>) {
  return asString(model.modelID) ?? asString(model.modelId) ?? asString(model.id);
}

function extractPatchEventModelLabel(info: Record<string, unknown>) {
  const directLabel =
    asString(info.modelLabel) ??
    asString(info.modelRoute) ??
    asString(info.modelID) ??
    asString(info.modelId) ??
    asString(info.modelUsed) ??
    asString(info.model);
  if (directLabel) {
    return directLabel;
  }

  const model = asRecord(info.model);
  if (!model) {
    return undefined;
  }

  const provider = extractPatchEventModelProvider(model);
  const identifier = extractPatchEventModelIdentifier(model);
  if (provider && identifier) {
    return `${provider}:${identifier}`;
  }

  return asString(model.route) ?? asString(model.label) ?? identifier ?? provider;
}

export function toTaskMessagePatchEvent(event: RealtimeEvent): TaskMessagePatchEvent {
  const eventKind = getRealtimeEventKind(event);
  const base = buildBasePatchEvent(event);

  if (eventKind === "task.message.updated") {
    const info = getRealtimeInfo(event);
    const role = asString(info?.role);
    const messageId = asString(info?.id);

    if (role === "assistant" && messageId) {
      const createdAt = parseTimestamp(asRecord(info?.time)?.created);
      const completedAt = parseTimestamp(asRecord(info?.time)?.completed);
      return {
        ...base,
        kind: hasCompletedTimestamp(asRecord(info?.time)?.completed)
          ? "assistant-completed"
          : "assistant-progress",
        messageId,
        agent: asString(info?.agent),
        modelLabel: extractPatchEventModelLabel(info),
        createdAt,
        completedAt,
      };
    }

    if (role === "user") {
      return {
        ...base,
        kind: "user-message",
        messageId,
      };
    }

    if (role === "tool") {
      return {
        ...base,
        kind: "tool-message",
        messageId,
      };
    }

    return buildIgnoredPatchEvent(event);
  }

  if (eventKind === "task.message.delta") {
    const part = getRealtimePart(event);
    const messageId = asString(part?.messageID);
    const partType = asString(part?.type);
    const textDelta =
      typeof event.data.delta === "string" ? event.data.delta : asString(part?.text);
    if (!messageId || partType !== "text" || !textDelta) {
      return buildIgnoredPatchEvent(event);
    }

    return {
      ...base,
      kind: "assistant-delta",
      messageId,
      textDelta,
    };
  }

  if (eventKind === "task.snapshot.updated") {
    const snapshotReason = getRealtimeSnapshotReason(event);
    if (snapshotReason === "session.created") {
      return { ...base, kind: "session-created" };
    }
    if (snapshotReason === "session.updated") {
      return { ...base, kind: "session-updated" };
    }
    return buildIgnoredPatchEvent(event);
  }

  const taskPatchKind = TASK_EVENT_KIND_TO_PATCH_KIND.get(eventKind);
  if (taskPatchKind) {
    return {
      ...base,
      kind: taskPatchKind,
    };
  }

  return buildIgnoredPatchEvent(event);
}