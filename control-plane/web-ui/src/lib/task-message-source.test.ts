import { describe, expect, it } from "vitest";
import { buildSessionMessagesFromExecutionTrace } from "./task-message-source";

describe("buildSessionMessagesFromExecutionTrace", () => {
  it("prefers lineage timeline items when includeLineage is enabled", () => {
    const messages = buildSessionMessagesFromExecutionTrace(
      {
        timeline: [
          {
            id: "msg-1",
            role: "assistant",
            text: "来自 timeline",
            createdAt: "2026-03-21T10:00:00.000Z",
            completedAt: "2026-03-21T10:00:02.000Z",
          },
        ],
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            text: "来自 messages",
            createdAt: "2026-03-21T10:00:00.000Z",
          },
        ],
      },
      { includeLineage: true },
    );

    expect(messages).toHaveLength(1);
    expect((messages[0] as { text?: string }).text).toBe("来自 timeline");
    expect((messages[0] as { info?: { time?: { created?: number } } }).info?.time?.created).toBe(
      Date.parse("2026-03-21T10:00:00.000Z"),
    );
  });

  it("reuses legacy raw message shape when available", () => {
    const raw = {
      info: {
        id: "msg-2",
        role: "user",
        time: { created: 123 },
      },
      parts: [{ type: "text", text: "原始消息" }],
    };

    const messages = buildSessionMessagesFromExecutionTrace(
      {
        timeline: [
          {
            id: "msg-2",
            role: "user",
            text: "会被忽略",
            raw,
          },
        ],
      },
      { includeLineage: true },
    );

    expect(messages).toEqual([raw]);
  });

  it("falls back to execution trace messages when lineage is not requested", () => {
    const messages = buildSessionMessagesFromExecutionTrace({
      messages: [
        {
          id: "msg-3",
          role: "assistant",
          text: "当前 session 消息",
          createdAt: "2026-03-21T10:01:00.000Z",
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect((messages[0] as { text?: string }).text).toBe("当前 session 消息");
    expect((messages[0] as { parts?: Array<{ text?: string }> }).parts?.[0]?.text).toBe(
      "当前 session 消息",
    );
  });
});
