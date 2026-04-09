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
  phaseId?: string;
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
        | "phase-created"
        | "phase-updated"
        | "phase-awaiting-adoption"
        | "phase-paused"
        | "phase-resumed"
        | "phase-cancelled"
        | "phase-completed"
        | "phase-failed";
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
  ["task.phase.created", "phase-created"],
  ["task.phase.updated", "phase-updated"],
  ["task.phase.awaiting_adoption", "phase-awaiting-adoption"],
  ["task.phase.paused", "phase-paused"],
  ["task.phase.resumed", "phase-resumed"],
  ["task.phase.cancelled", "phase-cancelled"],
  ["task.phase.completed", "phase-completed"],
  ["task.phase.failed", "phase-failed"],
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
    phaseId: event.phaseId,
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
    if (snapshotReason === "phase.created") {
      return { ...base, kind: "phase-created" };
    }
    if (snapshotReason === "phase.updated") {
      return { ...base, kind: "phase-updated" };
    }
    if (snapshotReason === "phase.awaiting_adoption") {
      return { ...base, kind: "phase-awaiting-adoption" };
    }
    if (snapshotReason === "phase.paused") {
      return { ...base, kind: "phase-paused" };
    }
    if (snapshotReason === "phase.resumed") {
      return { ...base, kind: "phase-resumed" };
    }
    if (snapshotReason === "phase.cancelled") {
      return { ...base, kind: "phase-cancelled" };
    }
    if (snapshotReason === "phase.completed") {
      return { ...base, kind: "phase-completed" };
    }
    if (snapshotReason === "phase.failed") {
      return { ...base, kind: "phase-failed" };
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