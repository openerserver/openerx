import { describe, expect, it } from "vitest";
import { buildMergedTraceTimelineItems, resolveTraceTimelineItems } from "./task-trace-conversation";

describe("resolveTraceTimelineItems", () => {
  it("falls back to execution trace messages when timeline is empty", () => {
    const items = resolveTraceTimelineItems({
      taskId: "task-1",
      sessionId: "ses-1",
      segments: [],
      hookExecutions: [],
      followupExecutions: [],
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          text: "runtime fallback message",
          createdAt: "2026-03-26T09:00:00.000Z",
          raw: { source: "runtime" },
        },
      ],
      timeline: [],
      timelineMeta: {
        readSource: "opencode-runtime",
        cacheState: "complete",
        complete: true,
        includeLineage: true,
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "msg-1",
      role: "assistant",
      text: "runtime fallback message",
      createdAt: "2026-03-26T09:00:00.000Z",
    });
  });

  it("expands runtime tool parts into tool timeline items", () => {
    const items = resolveTraceTimelineItems({
      taskId: "task-tools",
      sessionId: "ses-tools",
      segments: [],
      hookExecutions: [],
      followupExecutions: [],
      messages: [
        {
          id: "msg-2",
          role: "assistant",
          text: "先搜索页面文件。",
          createdAt: "2026-03-26T09:01:00.000Z",
          raw: {
            info: {
              id: "msg-2",
              role: "assistant",
              time: { created: "2026-03-26T09:01:00.000Z" },
            },
            parts: [
              { type: "text", text: "先搜索页面文件。" },
              {
                type: "tool",
                callID: "call-1",
                tool: "glob",
                state: {
                  status: "completed",
                  input: { pattern: "src/pages/**/*.vue" },
                  output: "src/pages/TaskDetailV3.vue",
                },
              },
            ],
          },
        },
        {
          id: "msg-3",
          role: "assistant",
          text: "",
          createdAt: "2026-03-26T09:02:00.000Z",
          raw: {
            info: {
              id: "msg-3",
              role: "assistant",
              time: { created: "2026-03-26T09:02:00.000Z" },
            },
            parts: [
              {
                type: "tool",
                callID: "call-2",
                tool: "read",
                state: {
                  status: "completed",
                  input: { filePath: "control-plane/web-ui/src/pages/TaskDetailV3.vue" },
                  output: "<path>control-plane/web-ui/src/pages/TaskDetailV3.vue</path>",
                },
              },
            ],
          },
        },
      ],
      timeline: [],
      timelineMeta: {
        readSource: "opencode-runtime",
        cacheState: "complete",
        complete: true,
        includeLineage: true,
      },
    });

    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      id: "msg-2",
      role: "assistant",
      text: "先搜索页面文件。",
    });
    expect(items[1]).toMatchObject({
      id: "msg-2:tool:call-1:request",
      role: "tool-request",
      sourceEventTypes: ["runtime:tool-request:glob"],
    });
    expect(items[1].text).toContain("glob");
    expect(items[1].text).toContain("src/pages/**/*.vue");
    expect(items[1].raw).toMatchObject({
      source: "trace-message-tool-request",
      toolCallId: "call-1",
      toolName: "glob",
      request: {
        input: {
          pattern: "src/pages/**/*.vue",
        },
      },
    });
    expect(items[2]).toMatchObject({
      id: "msg-2:tool:call-1:result",
      role: "tool-result",
      sourceEventTypes: ["runtime:tool-result:glob"],
    });
    expect(items[2].text).toContain("状态: 完成");
    expect(items[2].text).toContain("src/pages/TaskDetailV3.vue");
    expect(items[2].raw).toMatchObject({
      source: "trace-message-tool-result",
      toolCallId: "call-1",
      toolName: "glob",
      result: {
        status: "completed",
        output: "src/pages/TaskDetailV3.vue",
      },
    });
    expect(items[1].raw).not.toEqual(items[2].raw);
    expect(items[3]).toMatchObject({
      id: "msg-3:tool:call-2:request",
      role: "tool-request",
      sourceEventTypes: ["runtime:tool-request:read"],
    });
    expect(items[4]).toMatchObject({
      id: "msg-3:tool:call-2:result",
      role: "tool-result",
      sourceEventTypes: ["runtime:tool-result:read"],
    });
  });

  it("keeps timeline items when lineage timeline is available", () => {
    const items = resolveTraceTimelineItems(
      {
        taskId: "task-2",
        sessionId: "ses-2",
        segments: [],
        hookExecutions: [],
        followupExecutions: [],
        messages: [
          {
            id: "msg-2",
            role: "assistant",
            text: "message fallback",
            createdAt: "2026-03-26T09:00:00.000Z",
            raw: { source: "runtime" },
          },
        ],
        timeline: [
          {
            id: "tl-1",
            role: "assistant",
            text: "timeline item",
            createdAt: "2026-03-26T09:01:00.000Z",
            completedAt: "2026-03-26T09:01:05.000Z",
            raw: { source: "projection" },
            sourceEventTypes: ["message.completed"],
          },
        ],
        timelineMeta: {
          readSource: "task-domain-projection",
          cacheState: "complete",
          complete: true,
          includeLineage: true,
        },
      },
      { includeLineage: true },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "tl-1",
      text: "timeline item",
      completedAt: "2026-03-26T09:01:05.000Z",
      sourceEventTypes: ["message.completed"],
    });
  });

  it("merges existing status timeline with runtime conversation and tool items", () => {
    const items = buildMergedTraceTimelineItems(
      {
        taskId: "task-merge",
        sessionId: "ses-merge",
        segments: [],
        hookExecutions: [],
        followupExecutions: [],
        messages: [
          {
            id: "msg-user",
            role: "user",
            text: "补充一下页面交互要求",
            createdAt: "2026-03-26T09:02:00.000Z",
            raw: {
              info: {
                id: "msg-user",
                role: "user",
                time: { created: "2026-03-26T09:02:00.000Z" },
              },
              parts: [{ type: "text", text: "补充一下页面交互要求" }],
            },
          },
          {
            id: "msg-assistant",
            role: "assistant",
            text: "先读取现有页面和接口。",
            createdAt: "2026-03-26T09:03:00.000Z",
            raw: {
              info: {
                id: "msg-assistant",
                role: "assistant",
                time: { created: "2026-03-26T09:03:00.000Z" },
              },
              parts: [
                { type: "text", text: "先读取现有页面和接口。" },
                {
                  type: "tool",
                  callID: "call-read-1",
                  tool: "read",
                  state: {
                    status: "completed",
                    input: { filePath: "control-plane/web-ui/src/pages/TaskDetailV3.vue" },
                    output: "<path>control-plane/web-ui/src/pages/TaskDetailV3.vue</path>",
                  },
                },
              ],
            },
          },
        ],
        timeline: [
          {
            id: "status-1",
            role: "system",
            text: "任务进入 running 状态",
            createdAt: "2026-03-26T09:01:00.000Z",
            completedAt: "2026-03-26T09:01:05.000Z",
            raw: { source: "projection" },
            sourceEventTypes: ["projection:status-transition"],
          },
        ],
        timelineMeta: {
          readSource: "opencode-runtime",
          cacheState: "complete",
          complete: true,
          includeLineage: true,
        },
      },
      { includeLineage: true },
    );

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "status-1",
          role: "system",
          text: "任务进入 running 状态",
          sourceEventTypes: ["projection:status-transition"],
        }),
        expect.objectContaining({
          id: "msg-user",
          role: "user",
          text: "补充一下页面交互要求",
        }),
        expect.objectContaining({
          id: "msg-assistant",
          role: "assistant",
          text: "先读取现有页面和接口。",
        }),
        expect.objectContaining({
          id: "msg-assistant:tool:call-read-1:request",
          role: "tool-request",
        }),
        expect.objectContaining({
          id: "msg-assistant:tool:call-read-1:result",
          role: "tool-result",
        }),
      ]),
    );
  });
});