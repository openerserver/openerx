import { describe, expect, it } from "vitest";
import { condenseParallelCandidateToolItems } from "./task-detail-parallel-tool-condense";

describe("task-detail-parallel-tool-condense", () => {
  it("merges duplicated tool outputs into the earlier tool call card", () => {
    const items = condenseParallelCandidateToolItems([
      {
        key: "assistant-1",
        role: "assistant",
        text: "已执行命令",
        toolCalls: [
          {
            key: "assistant-1:tool:call-1",
            kind: "shell",
            label: "run",
            stateLabel: "completed",
            stateColor: "green",
            outputPreview: "first output",
          },
        ],
        raw: null,
      } as any,
      {
        key: "tool-1",
        role: "tool",
        text: "second output",
        toolCalls: [],
        raw: {
          id: "call-1",
          info: { id: "call-1" },
          parts: [{ type: "tool", callID: "call-1" }],
        },
      } as any,
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.toolCalls[0]?.outputPreview).toBe("first output\n\nsecond output");
  });

  it("keeps unmatched tool items separate", () => {
    const items = condenseParallelCandidateToolItems([
      {
        key: "assistant-1",
        role: "assistant",
        text: "已执行命令",
        toolCalls: [
          {
            key: "assistant-1:tool:call-1",
            kind: "shell",
            label: "run",
            stateLabel: "completed",
            stateColor: "green",
          },
          {
            key: "assistant-1:tool:call-3",
            kind: "shell",
            label: "run-other",
            stateLabel: "completed",
            stateColor: "green",
          },
        ],
        raw: null,
      } as any,
      {
        key: "tool-2",
        role: "tool",
        text: "standalone output",
        toolCalls: [],
        raw: {
          id: "call-2",
          info: { id: "call-2" },
          parts: [{ type: "tool", callID: "call-2" }],
        },
      } as any,
    ]);

    expect(items).toHaveLength(2);
    expect(items[1]?.role).toBe("tool");
  });
});