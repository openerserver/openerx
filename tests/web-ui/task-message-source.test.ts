import { describe, expect, it } from "vitest";
import { buildSessionMessagesFromExecutionTrace } from "../../control-plane/web-ui/src/lib/task-message-source";

describe("buildSessionMessagesFromExecutionTrace", () => {
  it("filters non-narrative timeline items before building legacy session messages", () => {
    const items = buildSessionMessagesFromExecutionTrace(
      {
        timeline: [
          {
            id: "status-1",
            role: "system",
            text: "任务进入 running 状态",
            createdAt: "2026-03-26T09:00:00.000Z",
          },
          {
            id: "msg-1",
            role: "user",
            text: "参考组件 是什么，用50个字以内回答",
            createdAt: "2026-03-26T09:01:00.000Z",
          },
          {
            id: "msg-2",
            role: "assistant",
            text: "参考组件是复用现有页面结构的既有组件。",
            createdAt: "2026-03-26T09:01:02.000Z",
          },
        ],
        timelineMeta: {
          cacheState: "complete",
        },
      },
      { includeLineage: true },
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ role: "user", text: "参考组件 是什么，用50个字以内回答" });
    expect(items[1]).toMatchObject({ role: "assistant", text: "参考组件是复用现有页面结构的既有组件。" });
  });

  it("falls back to execution trace messages when timeline only contains status items", () => {
    const items = buildSessionMessagesFromExecutionTrace(
      {
        timeline: [
          {
            id: "status-1",
            role: "system",
            text: "任务进入 running 状态",
            createdAt: "2026-03-26T09:00:00.000Z",
          },
        ],
        messages: [
          {
            id: "msg-1",
            role: "user",
            text: "补充一下页面交互要求",
            createdAt: "2026-03-26T09:01:00.000Z",
          },
          {
            id: "msg-2",
            role: "assistant",
            text: "先读取现有页面和接口。",
            createdAt: "2026-03-26T09:01:02.000Z",
          },
        ],
        timelineMeta: {
          cacheState: "complete",
        },
      },
      { includeLineage: true },
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ role: "user", text: "补充一下页面交互要求" });
    expect(items[1]).toMatchObject({ role: "assistant", text: "先读取现有页面和接口。" });
  });

  it("synthesizes prompt and response when only status timeline items remain", () => {
    const items = buildSessionMessagesFromExecutionTrace(
      {
        finalPrompt: "原始用户输入",
        latestResponse: "投影任务的最终回复",
        timeline: [
          {
            id: "status-1",
            role: "system",
            text: "任务进入 running 状态",
            createdAt: "2026-03-25T09:44:23.156Z",
            completedAt: "2026-03-25T09:44:23.156Z",
          },
        ],
        timelineMeta: {
          cacheState: "complete",
        },
        snapshot: {
          lastActivityAt: "2026-03-25T09:47:35.022Z",
        },
      },
      { includeLineage: true },
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ role: "user", text: "原始用户输入" });
    expect(items[1]).toMatchObject({ role: "assistant", text: "投影任务的最终回复" });
  });

  it("appends synthetic assistant content when source items only contain the user prompt", () => {
    const items = buildSessionMessagesFromExecutionTrace({
      finalPrompt: "继续这个任务",
      latestResponse: "这是补齐出来的最终回复",
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          text: "继续这个任务",
          createdAt: "2026-03-26T10:00:00.000Z",
        },
      ],
      snapshot: {
        lastActivityAt: "2026-03-26T10:00:05.000Z",
      },
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ role: "user", text: "继续这个任务" });
    expect(items[1]).toMatchObject({ role: "assistant", text: "这是补齐出来的最终回复" });
  });
});