import { describe, expect, it } from "vitest";
import { resolveParallelCandidateSessionStateFromSources } from "./task-detail-parallel-source-policy";

function buildAssistantItem(text: string) {
  return {
    key: `assistant-${text}`,
    role: "assistant",
    text,
    toolCalls: [],
    raw: null,
  } as any;
}

function buildUserItem(text: string) {
  return {
    key: `user-${text}`,
    role: "user",
    text,
    userInputText: text,
    toolCalls: [],
    raw: null,
    createdAt: "2026-04-16T03:44:35.000Z",
  } as any;
}

describe("task-detail-parallel-source-policy", () => {
  it("prefers phase-view baseline display over session fallback when both are available", () => {
    expect(
      resolveParallelCandidateSessionStateFromSources({
        phaseBaseline: {
          items: [buildAssistantItem("phase baseline reply")],
          hasSettledReply: true,
        },
        sessionFallback: {
          items: [buildAssistantItem("session fallback reply")],
          hasSettledReply: true,
        },
        traceLoad: {
          ok: true,
          trace: {
            taskId: "task-1",
            sessionId: "session-a",
            latestResponse: "trace reply",
            messages: [],
            timeline: [],
            segments: [],
            hookExecutions: [],
            followupExecutions: [],
          } as any,
          traceItems: [buildAssistantItem("trace reply")],
          traceState: {},
        },
      }),
    ).toEqual({
      items: [buildAssistantItem("phase baseline reply")],
      hasSettledReply: true,
      traceState: {},
    });
  });

  it("keeps session fallback display when trace has no displayable reply", () => {
    expect(
      resolveParallelCandidateSessionStateFromSources({
        sessionFallback: {
          items: [buildAssistantItem("fallback reply")],
          hasSettledReply: true,
        },
        traceLoad: {
          ok: true,
          trace: {
            taskId: "task-1",
            sessionId: "session-a",
            latestResponse: "",
            messages: [],
            timeline: [],
            segments: [],
            hookExecutions: [],
            followupExecutions: [],
          } as any,
          traceItems: [],
          traceState: {},
        },
      }),
    ).toMatchObject({
      items: [buildAssistantItem("fallback reply")],
      hasSettledReply: true,
      traceState: {
        state: "incomplete",
        note: "执行追踪暂未返回可展示回复，当前继续展示来自会话消息的候选内容。",
      },
    });
  });

  it("preserves phase baseline trace state when a running candidate trace has no displayable reply", () => {
    expect(
      resolveParallelCandidateSessionStateFromSources({
        phaseBaseline: {
          items: [buildAssistantItem("phase baseline reply")],
          hasSettledReply: true,
          traceState: {
            state: "incomplete",
            note: "当前候选仍在执行，阶段视图里的候选内容可能还不完整。",
          },
        },
        sessionFallback: {
          items: [],
          hasSettledReply: false,
        },
        traceLoad: {
          ok: true,
          trace: {
            taskId: "task-1",
            sessionId: "session-a",
            latestResponse: "",
            messages: [],
            timeline: [],
            segments: [],
            hookExecutions: [],
            followupExecutions: [],
          } as any,
          traceItems: [],
          traceState: {},
        },
      }),
    ).toEqual({
      items: [buildAssistantItem("phase baseline reply")],
      hasSettledReply: true,
      traceState: {
        state: "incomplete",
        note: "当前候选仍在执行，阶段视图里的候选内容可能还不完整。",
      },
    });
  });

  it("merges session fallback user prompts into the phase baseline items", () => {
    expect(
      resolveParallelCandidateSessionStateFromSources({
        phaseBaseline: {
          items: [buildAssistantItem("phase baseline reply")],
          hasSettledReply: true,
        },
        sessionFallback: {
          items: [buildUserItem("pi-monorepo 项目 是什么？")],
          hasSettledReply: false,
        },
        traceLoad: {
          ok: true,
          trace: {
            taskId: "task-1",
            sessionId: "session-a",
            latestResponse: "trace reply",
            messages: [],
            timeline: [],
            segments: [],
            hookExecutions: [],
            followupExecutions: [],
          } as any,
          traceItems: [buildAssistantItem("trace reply")],
          traceState: {},
        },
      }),
    ).toMatchObject({
      items: [
        buildAssistantItem("phase baseline reply"),
        buildUserItem("pi-monorepo 项目 是什么？"),
      ],
      hasSettledReply: true,
      traceState: {},
    });
  });

  it("preserves phase baseline trace state when trace loading fails", () => {
    expect(
      resolveParallelCandidateSessionStateFromSources({
        phaseBaseline: {
          items: [buildAssistantItem("phase baseline reply")],
          hasSettledReply: true,
          traceState: {
            state: "stale",
            note: "当前候选已暂停，当前展示的是最近一次阶段视图快照。",
          },
        },
        sessionFallback: {
          items: [],
          hasSettledReply: false,
        },
        traceLoad: { ok: false },
      }),
    ).toEqual({
      items: [buildAssistantItem("phase baseline reply")],
      hasSettledReply: true,
      traceState: {
        state: "stale",
        note: "当前候选已暂停，当前展示的是最近一次阶段视图快照。",
      },
    });
  });

  it("falls back to session messages with stale trace state when trace loading fails", () => {
    expect(
      resolveParallelCandidateSessionStateFromSources({
        sessionFallback: {
          items: [buildAssistantItem("fallback reply")],
          hasSettledReply: true,
        },
        traceLoad: { ok: false },
      }),
    ).toMatchObject({
      items: [buildAssistantItem("fallback reply")],
      hasSettledReply: true,
      traceState: {
        state: "stale",
        note: "执行追踪暂时不可用，当前继续展示来自会话消息的候选内容。",
      },
    });
  });

  it("uses trace display directly when no session fallback is available", () => {
    const traceItem = buildAssistantItem("trace reply");
    expect(
      resolveParallelCandidateSessionStateFromSources({
        sessionFallback: {
          items: [],
          hasSettledReply: false,
        },
        traceLoad: {
          ok: true,
          trace: {
            taskId: "task-1",
            sessionId: "session-a",
            latestResponse: "trace reply",
            messages: [],
            timeline: [],
            segments: [],
            hookExecutions: [],
            followupExecutions: [],
          } as any,
          traceItems: [traceItem],
          traceState: {},
        },
      }),
    ).toEqual({
      items: [traceItem],
      hasSettledReply: true,
      traceState: {},
    });
  });

  it("reuses cached trace state as stale data after silent refresh failure", () => {
    const cachedItem = buildAssistantItem("cached reply");
    expect(
      resolveParallelCandidateSessionStateFromSources({
        cachedState: {
          items: [cachedItem],
          hasSettledReply: true,
          traceState: {},
        },
        sessionFallback: {
          items: [],
          hasSettledReply: false,
        },
        silent: true,
        traceLoad: { ok: false },
      }),
    ).toEqual({
      items: [cachedItem],
      hasSettledReply: true,
      traceState: {
        state: "stale",
        note: "静默刷新失败，当前展示的是上一次成功加载的执行追踪。",
      },
    });
  });
});