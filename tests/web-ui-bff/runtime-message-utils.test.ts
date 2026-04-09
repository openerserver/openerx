import { describe, expect, test } from "bun:test";

let runtimeMessageUtilsImportCounter = 0;

async function loadRuntimeMessageUtils() {
  runtimeMessageUtilsImportCounter += 1;
  return import(
    `../../control-plane/web-ui-bff/src/modules/agent-control/runtime-message-utils?runtime-message-utils-test=${runtimeMessageUtilsImportCounter}`
  );
}

describe("runtime-message-utils", () => {
  test("returns traceId for failed assistant messages with embedded errors", async () => {
    const { extractAssistantResultFromMessages } = await loadRuntimeMessageUtils();
    const result = extractAssistantResultFromMessages([
      {
        info: {
          id: "trace-error-1",
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
    expect(result.traceId).toBe("trace-error-1");
    expect(result.tokenUsed).toBe(10);
  });

  test("returns traceId for completed assistant messages", async () => {
    const { extractAssistantResultFromMessages } = await loadRuntimeMessageUtils();
    const result = extractAssistantResultFromMessages([
      {
        info: {
          id: "trace-complete-1",
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
    expect(result.traceId).toBe("trace-complete-1");
  });

  test("does not treat assistant replies with pending tool continuation as completed", async () => {
    const { extractAssistantResultFromMessages } = await loadRuntimeMessageUtils();
    const result = extractAssistantResultFromMessages([
      {
        info: {
          id: "trace-tool-call-1",
          role: "assistant",
          finish: "tool-calls",
          time: {
            created: 1773406563485,
            completed: 1773406563502,
          },
        },
        parts: [
          {
            type: "text",
            text: "Calling a tool",
          },
          {
            type: "tool_call",
            id: "tool-call-1",
            toolName: "search_code",
            state: {
              status: "running",
            },
          },
        ],
      },
    ]);

    expect(result.completed).toBe(false);
    expect(result.failed).toBe(false);
    expect(result.text).toBe("Calling a tool");
    expect(result.traceId).toBe("trace-tool-call-1");
  });
});