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

describe("task-detail-parallel-source-policy", () => {
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
        note: "执行追踪暂未返回可展示回复，当前已回退到会话消息展示候选内容。",
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
        note: "执行追踪暂时不可用，当前已回退到会话消息展示候选回复。",
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