/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { extractAssistantResultFromMessages } from "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter";

describe("extractAssistantResultFromMessages", () => {
  test("marks assistant messages with embedded errors as failed", () => {
    const result = extractAssistantResultFromMessages([
      {
        info: {
          role: "assistant",
          error: {
            name: "MessageAbortedError",
            data: {
              message: "The operation was aborted.",
            },
          },
          time: {
            created: 1773406563485,
            completed: 1773406563502,
          },
          tokens: {
            input: 10,
            output: 0,
            reasoning: 0,
          },
        },
        parts: [],
      },
    ]);

    expect(result.completed).toBe(false);
    expect(result.failed).toBe(true);
    expect(result.error).toBe("The operation was aborted.");
    expect(result.tokenUsed).toBe(10);
  });

  test("still reports completed assistant messages with text as completed", () => {
    const result = extractAssistantResultFromMessages([
      {
        info: {
          role: "assistant",
          time: {
            created: 1773406563485,
            completed: 1773406563502,
          },
        },
        parts: [
          {
            type: "text",
            text: "done",
          },
        ],
      },
    ]);

    expect(result.completed).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.text).toBe("done");
  });
});
