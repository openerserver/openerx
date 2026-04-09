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
});