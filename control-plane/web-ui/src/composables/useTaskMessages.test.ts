import { describe, expect, it } from "vitest";
import { normalizeSessionConversationItems } from "./useTaskMessages";

describe("normalizeSessionConversationItems", () => {
  it("does not treat task bullet output as a file path", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "msg-1",
          role: "assistant",
        },
        parts: [
          {
            id: "tool-1",
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: {
                description: "需求澄清阶段修正",
              },
              output: `task_id: ses_123\n\n<task_result>\n- 是要评估付费版本的并行处理能力与 GitHub Copilot 的对比？\n</task_result>`,
            },
          },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.toolCalls).toHaveLength(1);
    expect(items[0]?.toolCalls[0]?.filePath).toBeUndefined();
    expect(items[0]?.toolCalls[0]?.headline).toBeUndefined();
    expect(items[0]?.toolCalls[0]?.description).toBe("需求澄清阶段修正");
  });

  it("keeps actual repo file paths from tool output", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "msg-2",
          role: "assistant",
        },
        parts: [
          {
            id: "tool-2",
            type: "tool",
            tool: "run_in_terminal",
            state: {
              status: "completed",
              output: "M package.json\nA control-plane/web-ui/src/composables/useTaskMessages.ts",
            },
          },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.toolCalls).toHaveLength(1);
    expect(items[0]?.toolCalls[0]?.filePath).toBe("package.json");
  });
});