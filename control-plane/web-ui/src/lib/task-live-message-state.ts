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

export type ReplayLiveAssistantStateScope = {
  sessionId: string;
  phaseId?: string | null;
};

function matchesScopePhase(
  patchEvent: TaskMessagePatchEvent,
  phaseId: string | null | undefined,
): boolean {
  if (!phaseId) {
    return true;
  }
  if (!patchEvent.phaseId) {
    return true;
  }
  return patchEvent.phaseId === phaseId;
}

export function replayTaskMessagePatchEvents(
  patchEvents: TaskMessagePatchEvent[],
  scope: string | ReplayLiveAssistantStateScope,
): LiveAssistantState {
  const { sessionId, phaseId = null }: ReplayLiveAssistantStateScope =
    typeof scope === "string" ? { sessionId: scope } : scope;
  const state = createEmptyLiveAssistantState();
  const chronologicalEvents = patchEvents.slice().reverse();

  for (const patchEvent of chronologicalEvents) {
    if (!matchesScopePhase(patchEvent, phaseId)) {
      continue;
    }
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

export function mergeLiveAssistantStates(
  states: LiveAssistantState[],
): LiveAssistantState {
  const merged = createEmptyLiveAssistantState();

  for (const state of states) {
    for (const messageId of state.orderedAssistantMessageIds) {
      if (!merged.orderedAssistantMessageIds.includes(messageId)) {
        merged.orderedAssistantMessageIds.push(messageId);
      }
    }
    for (const [messageId, meta] of state.metaById.entries()) {
      merged.metaById.set(messageId, meta);
    }
    for (const [messageId, text] of state.textById.entries()) {
      const currentText = merged.textById.get(messageId);
      if (!currentText || text.length >= currentText.length) {
        merged.textById.set(messageId, text);
      }
    }
    for (const [messageId, thinkingText] of state.thinkingById.entries()) {
      const currentThinkingText = merged.thinkingById.get(messageId);
      if (!currentThinkingText || thinkingText.length >= currentThinkingText.length) {
        merged.thinkingById.set(messageId, thinkingText);
      }
    }
    for (const messageId of state.incompleteIds.values()) {
      merged.incompleteIds.add(messageId);
    }
  }

  return merged;
}

export type ReplayPhaseLiveAssistantStateOptions = {
  phaseId?: string | null;
  sessionIds: string[];
};

export function replayPhaseLiveAssistantState(
  patchEvents: TaskMessagePatchEvent[],
  options: ReplayPhaseLiveAssistantStateOptions,
): LiveAssistantState {
  const sessionIds = options.sessionIds.filter(
    (sessionId): sessionId is string =>
      typeof sessionId === "string" && sessionId.trim().length > 0,
  );
  if (sessionIds.length === 0) {
    return createEmptyLiveAssistantState();
  }

  const uniqueSessionIds = Array.from(new Set(sessionIds));
  const phaseId = options.phaseId ?? null;
  const states = uniqueSessionIds.map((sessionId) =>
    replayTaskMessagePatchEvents(patchEvents, { sessionId, phaseId }),
  );
  return mergeLiveAssistantStates(states);
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