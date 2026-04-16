import type { RealtimeEvent } from "../stores/realtime";
import {
  createEmptyLiveAssistantState,
  type LiveAssistantState,
} from "./message-normalize";
import { type TaskMessagePatchEvent, toTaskMessagePatchEvent } from "./task-message-patch-event";

function mergeStreamingText(existing: string | undefined, incoming: string): string {
  const next = incoming.trim();
  if (!existing) {
    return next;
  }
  if (!next) {
    return existing;
  }
  if (next.startsWith(existing)) {
    return next;
  }
  if (existing === next || existing.endsWith(next)) {
    return existing;
  }
  return `${existing}${next}`;
}

export function cloneLiveAssistantState(state: LiveAssistantState): LiveAssistantState {
  return {
    orderedAssistantMessageIds: [...state.orderedAssistantMessageIds],
    metaById: new Map(state.metaById),
    textById: new Map(state.textById),
    thinkingById: new Map(state.thinkingById),
    incompleteIds: new Set(state.incompleteIds),
  };
}

function rememberAssistantMessageId(state: LiveAssistantState, messageId: string) {
  if (state.orderedAssistantMessageIds.includes(messageId)) {
    return;
  }

  state.orderedAssistantMessageIds.push(messageId);
}

export function applyTaskMessagePatchEventToLiveAssistantState(
  currentState: LiveAssistantState,
  patchEvent: TaskMessagePatchEvent,
  sessionId: string,
): LiveAssistantState {
  if (patchEvent.sessionId !== sessionId) {
    return currentState;
  }

  if (
    patchEvent.kind !== "assistant-progress" &&
    patchEvent.kind !== "assistant-completed" &&
    patchEvent.kind !== "assistant-delta"
  ) {
    return currentState;
  }

  const nextState = cloneLiveAssistantState(currentState);

  if (patchEvent.kind === "assistant-progress" || patchEvent.kind === "assistant-completed") {
    const messageId = patchEvent.messageId;
    nextState.metaById.set(messageId, {
      agent: patchEvent.agent,
      modelLabel: patchEvent.modelLabel,
      createdAt:
        patchEvent.createdAt ??
        (patchEvent.kind === "assistant-completed" ? patchEvent.completedAt : undefined),
    });
    rememberAssistantMessageId(nextState, messageId);

    if (patchEvent.kind === "assistant-completed") {
      nextState.incompleteIds.delete(messageId);
    } else {
      nextState.incompleteIds.add(messageId);
    }

    if (patchEvent.initialText) {
      nextState.textById.set(
        messageId,
        mergeStreamingText(nextState.textById.get(messageId), patchEvent.initialText),
      );
    }

    if (patchEvent.initialThinkingText) {
      nextState.thinkingById.set(
        messageId,
        mergeStreamingText(
          nextState.thinkingById.get(messageId),
          patchEvent.initialThinkingText,
        ),
      );
    }

    return nextState;
  }

  rememberAssistantMessageId(nextState, patchEvent.messageId);
  nextState.incompleteIds.add(patchEvent.messageId);
  const targetMap =
    patchEvent.partType === "thinking" || patchEvent.partType === "reasoning"
      ? nextState.thinkingById
      : nextState.textById;
  targetMap.set(
    patchEvent.messageId,
    mergeStreamingText(targetMap.get(patchEvent.messageId), patchEvent.textDelta),
  );
  return nextState;
}

export function applyRealtimeEventToLiveAssistantState(
  currentState: LiveAssistantState,
  event: RealtimeEvent,
  sessionId: string,
): LiveAssistantState {
  return applyTaskMessagePatchEventToLiveAssistantState(
    currentState,
    toTaskMessagePatchEvent(event),
    sessionId,
  );
}

export function replayTaskMessagePatchEvents(
  patchEvents: TaskMessagePatchEvent[],
  sessionId: string,
): LiveAssistantState {
  const state = createEmptyLiveAssistantState();
  const chronologicalEvents = patchEvents.slice().reverse();

  for (const patchEvent of chronologicalEvents) {
    const nextState = applyTaskMessagePatchEventToLiveAssistantState(
      state,
      patchEvent,
      sessionId,
    );
    state.orderedAssistantMessageIds = nextState.orderedAssistantMessageIds;
    state.metaById = nextState.metaById;
    state.textById = nextState.textById;
    state.thinkingById = nextState.thinkingById;
    state.incompleteIds = nextState.incompleteIds;
  }

  return state;
}

export function replayLiveAssistantState(
  events: RealtimeEvent[],
  sessionId: string,
): LiveAssistantState {
  return replayTaskMessagePatchEvents(
    events.map((event) => toTaskMessagePatchEvent(event)),
    sessionId,
  );
}