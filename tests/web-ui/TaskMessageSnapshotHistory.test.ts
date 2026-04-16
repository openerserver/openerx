import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPhaseRecord } from "../../control-plane/web-ui/src/lib/api";
import { useTaskMessageSnapshot } from "../../control-plane/web-ui/src/composables/useTaskMessageSnapshot";

const apiMocks = vi.hoisted(() => ({
  getTaskPhases: vi.fn(),
  getTaskPhaseView: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getTaskPhases: apiMocks.getTaskPhases,
    getTaskPhaseView: apiMocks.getTaskPhaseView,
  };
});

function createPhase(overrides?: Partial<TaskPhaseRecord>): TaskPhaseRecord {
  return {
    id: "phase-1",
    phaseIndex: 1,
    phaseKind: "single",
    triggerType: "continue",
    status: "completed",
    parentPhaseId: null,
    resumedFromPhaseId: null,
    awaitingAdoptionSince: null,
    anchorSessionId: null,
    coordinationKey: null,
    candidateCount: null,
    winnerSessionId: null,
    judgeSessionId: null,
    startedAt: "2026-04-08T03:18:17.218Z",
    finishedAt: "2026-04-08T03:18:24.437Z",
    createdAt: "2026-04-08T03:18:17.218Z",
    updatedAt: "2026-04-08T03:18:24.437Z",
    sessionIds: [],
    ...overrides,
  };
}

function createAssistantMessage(args: {
  id: string;
  sessionId: string;
  text: string;
  createdAt: string;
}) {
  return {
    id: args.id,
    sessionId: args.sessionId,
    role: "assistant",
    status: "completed",
    text: args.text,
    parts: [
      {
        id: `part-${args.id}`,
        partIndex: 0,
        partType: "text",
        text: args.text,
      },
    ],
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    completedAt: args.createdAt,
  };
}

function createPhaseView(args: {
  phase: TaskPhaseRecord;
  currentSessionId: string;
  messages: unknown[];
}) {
  return {
    data: {
      phase: args.phase,
      sessions: [],
      messageGroups: [
        {
          runtimeSessionId: args.currentSessionId,
          phaseRole: "mainline",
          phaseItemIndex: 0,
          messages: args.messages,
        },
      ],
      meta: {
        currentSessionId: args.currentSessionId,
        currentPhaseId: args.phase.id,
        latestPhaseId: args.phase.id,
        phaseCount: 1,
        sessionCount: 1,
        messageGroupCount: 1,
        messageCount: args.messages.length,
      },
    },
  };
}

describe("useTaskMessageSnapshot history continuity", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    apiMocks.getTaskPhases.mockReset();
    apiMocks.getTaskPhaseView.mockReset();
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  it("keeps loaded phase history when currentPhaseId advances to a child phase", async () => {
    const phaseRoot = createPhase({
      id: "phase-root",
      phaseIndex: 1,
      sessionIds: ["task-session:task-1:session-root"],
    });
    const phase1 = createPhase({
      id: "phase-1",
      phaseIndex: 2,
      parentPhaseId: "phase-root",
      sessionIds: ["task-session:task-1:session-1"],
    });
    const phase2 = createPhase({
      id: "phase-2",
      phaseIndex: 3,
      parentPhaseId: "phase-1",
      sessionIds: ["task-session:task-1:session-2"],
    });

    const phase1View = createPhaseView({
      phase: phase1,
      currentSessionId: "session-1",
      messages: [
        createAssistantMessage({
          id: "assistant-current",
          sessionId: "session-1",
          text: "current reply",
          createdAt: "2026-04-08T03:18:19.218Z",
        }),
      ],
    });
    const phaseRootView = createPhaseView({
      phase: phaseRoot,
      currentSessionId: "session-root",
      messages: [
        createAssistantMessage({
          id: "assistant-root",
          sessionId: "session-root",
          text: "root reply",
          createdAt: "2026-04-08T03:18:10.218Z",
        }),
      ],
    });
    const phase2View = createPhaseView({
      phase: phase2,
      currentSessionId: "session-2",
      messages: [
        createAssistantMessage({
          id: "assistant-child",
          sessionId: "session-2",
          text: "child reply",
          createdAt: "2026-04-08T03:18:30.218Z",
        }),
      ],
    });

    apiMocks.getTaskPhases
      .mockResolvedValueOnce({ data: [phaseRoot, phase1] })
      .mockResolvedValueOnce({ data: [phaseRoot, phase1] })
      .mockResolvedValue({ data: [phaseRoot, phase1, phase2] });
    apiMocks.getTaskPhaseView
      .mockResolvedValueOnce(phase1View)
      .mockResolvedValueOnce(phaseRootView)
      .mockResolvedValue(phase2View);

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const currentSessionId = ref<string | null>("session-1");
    const currentPhaseId = ref<string | null>("phase-1");
    scope = effectScope();
    const snapshot = scope.run(() =>
      useTaskMessageSnapshot(taskId, sessionId, {
        currentSessionId,
        currentPhaseId,
      }),
    );
    if (!snapshot) {
      throw new Error("expected message snapshot");
    }

    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(snapshot.sourceMessages.value.map((item: any) => item.text)).toEqual(["current reply"]);

    await snapshot.loadOlderHistory();
    await Promise.resolve();
    await nextTick();

    expect(apiMocks.getTaskPhaseView).toHaveBeenNthCalledWith(2, "task-1", "phase-root");
    expect(snapshot.sourceMessages.value.map((item: any) => item.text)).toEqual([
      "root reply",
      "current reply",
    ]);

    sessionId.value = "session-2";
    currentSessionId.value = "session-2";
    currentPhaseId.value = "phase-2";
    await snapshot.refresh();
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(snapshot.sourceMessages.value.map((item: any) => item.text)).toEqual([
      "root reply",
      "current reply",
      "child reply",
    ]);
  });
});