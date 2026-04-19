import { describe, expect, it } from "vitest";
import { normalizeSessionConversationItems } from "./message-normalize";

describe("normalizeSessionConversationItems", () => {
  it("keeps read tool file content when the runtime output is JSON formatted", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "assistant-1",
          role: "assistant",
          time: { created: "2026-04-07T17:18:48.465Z" },
        },
        parts: [
          {
            type: "tool",
            toolName: "read",
            callID: "read_1",
            input: { path: "README.md" },
            state: {
              status: "completed",
              output: JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: "# Pi Monorepo\n\nTools for building AI agents.",
                  },
                ],
              }),
            },
          },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.toolCalls).toHaveLength(1);
    expect(items[0]?.toolCalls[0]).toMatchObject({
      filePath: "README.md",
      fileContent: "# Pi Monorepo\n\nTools for building AI agents.",
    });
  });

  it("normalizes persisted phase-view parts into separate thinking text and tool calls", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "assistant-1",
          role: "assistant",
          time: { created: "2026-04-16T03:44:35.000Z" },
        },
        parts: [
          {
            id: "part-thinking",
            partType: "thinking",
            textContent: "先梳理项目结构",
            jsonPayload: {
              type: "thinking",
              text: "先梳理项目结构",
            },
          },
          {
            id: "part-text",
            partType: "text",
            textContent: "这是最终回复",
            jsonPayload: {
              type: "text",
              text: "这是最终回复",
            },
          },
          {
            id: "part-tool",
            partType: "tool_result",
            jsonPayload: {
              type: "tool",
              toolName: "read",
              callID: "read_1",
              input: { path: "README.md" },
              state: {
                status: "completed",
                output: [{ type: "text", text: "# Pi Monorepo" }],
              },
            },
          },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      text: "这是最终回复",
      thinkingText: "先梳理项目结构",
    });
    expect(items[0]?.toolCalls).toHaveLength(1);
    expect(items[0]?.toolCalls[0]).toMatchObject({
      kind: "read",
      filePath: "README.md",
      fileContent: "# Pi Monorepo",
    });
  });
});