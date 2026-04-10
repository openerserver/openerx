import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useTreeMessages } from "../../control-plane/web-ui/src/composables/useTreeMessages";
import {
  type TaskConversationMessageItem,
  normalizeSessionConversationItems,
} from "../../control-plane/web-ui/src/lib/message-normalize";
import { buildSessionMessagesFromExecutionTrace } from "../../control-plane/web-ui/src/lib/task-message-source";
import { normalizeTraceConversationItems } from "../../control-plane/web-ui/src/lib/task-trace-conversation";
import {
  DEFAULT_JUDGE_CONFIG,
  buildSavedRuntimePlan,
  resolveEditableExecutionMode,
  resolveEditableJudgeConfig,
  resolveEditableParallelCandidates,
  resolveEditableSequentialSteps,
  serializeTaskStrategy,
} from "../../control-plane/web-ui/src/lib/taskExecutionMode";

const apiMocks = vi.hoisted(() => ({
  getTaskMessages: vi.fn(),
  getTaskExecutionTraceView: vi.fn(),
}));

const realtimeStoreMock = vi.hoisted(() => ({
  events: [] as Array<{
    id: string;
    type: string;
    taskId?: string;
    sessionId?: string;
    data: Record<string, unknown>;
  }>,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getTaskMessages: apiMocks.getTaskMessages,
    getTaskExecutionTraceView: apiMocks.getTaskExecutionTraceView,
  };
});

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeStoreMock,
}));

function createTraceFromMessages(messages: unknown[]) {
  const traceMessages = messages.map((message, index) => {
    const record = message as {
      id?: string;
      role?: string;
      text?: string;
      createdAt?: string;
      info?: { id?: string; role?: string; time?: { created?: string | number } };
      parts?: Array<{ text?: string; content?: string }>;
    };
    const parts = Array.isArray(record.parts) ? record.parts : [];
    const text = parts
      .map((part) =>
        typeof part.text === "string"
          ? part.text
          : typeof part.content === "string"
            ? part.content
            : "",
      )
      .filter(Boolean)
      .join("\n");
    const created =
      record.createdAt ??
      (typeof record.info?.time?.created === "string" ? record.info.time.created : undefined);

    return {
      id: record.info?.id ?? record.id ?? `message-${index}`,
      role: record.info?.role ?? record.role ?? "assistant",
      text,
      createdAt: created,
      raw: message,
    };
  });

  return {
    taskId: "task-1",
    sessionId: "session-1",
    segments: [],
    hookExecutions: [],
    messages: traceMessages,
  };
}

describe("Task conversation composables", () => {
  beforeEach(() => {
    apiMocks.getTaskMessages.mockReset();
    apiMocks.getTaskExecutionTraceView.mockReset();
    apiMocks.getTaskMessages.mockImplementation(
      async (taskId: string, options?: { sessionId?: string; includeLineage?: boolean }) => {
        const trace = await apiMocks.getTaskExecutionTraceView(
          taskId,
          options?.sessionId ?? "session-1",
          {
            includeLineage: options?.includeLineage,
          },
        );
        return {
          data: buildSessionMessagesFromExecutionTrace(trace, {
            includeLineage: options?.includeLineage,
          }),
          meta:
            trace && typeof trace === "object" && !Array.isArray(trace) && "timelineMeta" in trace
              ? {
                  ...((trace.timelineMeta as Record<string, unknown> | undefined) ?? {}),
                  sessionId: options?.sessionId ?? "session-1",
                }
              : undefined,
        };
      },
    );
    realtimeStoreMock.events = [];
  });

  it("normalizes session messages into conversation items", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-1",
            role: "user",
            time: { created: "2026-03-20T00:00:01.000Z" },
          },
          parts: [{ text: "第一条消息" }],
        },
        {
          info: {
            id: "message-2",
            role: "assistant",
            agent: "planner",
            time: { completed: "2026-03-20T00:00:02.000Z" },
          },
          parts: [{ text: "第二条消息" }],
        },
      ]),
    );

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(apiMocks.getTaskMessages).toHaveBeenCalledWith("task-1", {
      sessionId: "session-1",
      includeLineage: undefined,
    });
    expect(state.conversationItems.value).toHaveLength(2);
    const firstItem = state.conversationItems.value[0] as TaskConversationMessageItem | undefined;
    const secondItem = state.conversationItems.value[1] as TaskConversationMessageItem | undefined;
    expect(firstItem?.text).toBe("第一条消息");
    expect(secondItem?.agent).toBe("planner");
    expect(secondItem?.role).toBe("assistant");
  });

  it("preserves backend message order instead of resorting by timestamp", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-late",
            role: "assistant",
            time: { completed: "2026-03-20T00:00:05.000Z" },
          },
          parts: [{ text: "后写入但排在前面的回复" }],
        },
        {
          info: {
            id: "message-early",
            role: "user",
            time: { created: "2026-03-20T00:00:01.000Z" },
          },
          parts: [{ text: "更早的消息" }],
        },
      ]),
    );

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value).toHaveLength(2);
    expect(state.conversationItems.value.map((item) => item.key)).toEqual([
      "message-late",
      "message-early",
    ]);
    expect(state.conversationItems.value.map((item) => item.role)).toEqual(["assistant", "user"]);
  });

  it("hides workflow execution-context user rows and collapses equivalent assistant replies", async () => {
    apiMocks.getTaskMessages.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "synthetic-root-user",
            role: "user",
            time: { created: "2026-04-06T15:12:33.269Z" },
          },
          parts: [{ type: "text", text: "请回复：页面任务执行正常。" }],
        },
        {
          info: {
            id: "assistant-preview",
            role: "assistant",
            time: {
              created: "2026-04-06T15:12:33.771Z",
              completed: "2026-04-06T15:12:33.771Z",
            },
          },
          parts: [{ type: "text", text: "页面任务执行正常。" }],
        },
        {
          info: {
            id: "assistant-rich",
            role: "assistant",
            time: {
              created: "2026-04-06T15:12:33.771Z",
              completed: "2026-04-06T15:12:33.771Z",
            },
          },
          parts: [
            { type: "thinking", text: "**Confirming task execution**" },
            { type: "text", text: "页面任务执行正常。" },
          ],
        },
        {
          info: {
            id: "execution-context-user",
            role: "user",
            time: { created: "2026-04-06T15:12:33.806Z" },
          },
          parts: [
            {
              type: "text",
              text: "Execution context:\n- Opener-X task ID: task-1\n- Project ID: proj-default\n\n请回复：页面任务执行正常。",
            },
          ],
        },
        {
          _type: "workflow_group",
          info: {
            id: "workflow-group-task-1",
            role: "workflow",
            variant: "context",
            label: "工作流消息",
            hint: "当前阶段与执行上下文",
          },
          steps: [
            {
              agentName: "当前工作流",
              sessionId: "session-1",
              messages: [
                {
                  info: {
                    id: "workflow-message-1",
                    role: "user",
                    time: { created: "2026-04-06T15:12:33.806Z" },
                  },
                  parts: [
                    {
                      type: "text",
                      text: "- Opener-X task ID: task-1\n- Project ID: proj-default\n\n请回复：页面任务执行正常。",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      meta: {
        sessionId: "session-1",
        messageCount: 5,
      },
    });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId, { includeLineage: true });

    await flushPromises();

    expect(state.conversationItems.value.map((item) => item.role)).toEqual([
      "user",
      "workflow",
      "assistant",
    ]);
    expect(state.conversationItems.value[0]).toMatchObject({
      key: "synthetic-root-user",
      role: "user",
      text: "请回复：页面任务执行正常。",
    });
    expect(state.conversationItems.value[2]).toMatchObject({
      key: "assistant-rich",
      role: "assistant",
      text: "页面任务执行正常。",
    });
  });

  it("classifies messages by info role first and falls back to record role", () => {
    const items = normalizeSessionConversationItems([
      {
        id: "tool-message",
        role: "tool",
        text: "bash output",
      },
      {
        id: "assistant-message",
        role: "user",
        info: {
          id: "assistant-message",
          role: "assistant",
          time: { completed: "2026-03-20T00:00:02.000Z" },
        },
        parts: [{ text: "真实角色应该是 assistant" }],
      },
      {
        id: "system-message",
        role: "system",
        text: "internal state",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      key: "tool-message",
      role: "tool",
      text: "bash output",
    });
    expect(items[1]).toMatchObject({
      key: "assistant-message",
      role: "assistant",
      text: "真实角色应该是 assistant",
    });
  });

  it("keeps user prompts visible when execution trace falls back to runtime messages", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue({
      taskId: "task-1",
      sessionId: "session-1",
      segments: [],
      hookExecutions: [],
      messages: [
        {
          id: "msg-1",
          role: "user",
          text: "给输入法设计一个操作页面",
          createdAt: "2026-03-25T09:44:01.000Z",
          raw: {
            id: "msg-1",
            role: "user",
            info: {
              id: "msg-1",
              role: "user",
              time: { created: "2026-03-25T09:44:01.000Z" },
            },
            parts: [{ type: "text", text: "给输入法设计一个操作页面" }],
          },
        },
        {
          id: "msg-2",
          role: "assistant",
          text: "先做需求澄清。",
          createdAt: "2026-03-25T09:44:10.000Z",
          raw: {
            id: "msg-2",
            role: "assistant",
            info: {
              id: "msg-2",
              role: "assistant",
              agent: "explore-enterprise",
              time: { completed: "2026-03-25T09:44:10.000Z" },
            },
            parts: [{ type: "text", text: "先做需求澄清。" }],
          },
        },
        {
          id: "msg-3",
          role: "user",
          text: "第二轮用户输入",
          createdAt: "2026-03-25T09:45:01.000Z",
          raw: {
            id: "msg-3",
            role: "user",
            info: {
              id: "msg-3",
              role: "user",
              time: { created: "2026-03-25T09:45:01.000Z" },
            },
            parts: [{ type: "text", text: "第二轮用户输入" }],
          },
        },
        {
          id: "msg-4",
          role: "assistant",
          text: "第二轮模型回复",
          createdAt: "2026-03-25T09:45:10.000Z",
          raw: {
            id: "msg-4",
            role: "assistant",
            info: {
              id: "msg-4",
              role: "assistant",
              agent: "explore-enterprise",
              time: { completed: "2026-03-25T09:45:10.000Z" },
            },
            parts: [{ type: "text", text: "第二轮模型回复" }],
          },
        },
      ],
      timeline: [],
      timelineMeta: {
        readSource: "runtime-fallback",
        cacheState: "complete",
        complete: true,
        includeLineage: true,
        lineagePath: ["session-1"],
        cachedSessionCount: 1,
        itemCount: 4,
      },
    });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId, { includeLineage: true });

    await flushPromises();

    expect(apiMocks.getTaskMessages).toHaveBeenCalledWith("task-1", {
      sessionId: "session-1",
      includeLineage: true,
    });
    expect(state.conversationItems.value.map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(
      state.conversationItems.value.map((item) =>
        "text" in item && typeof item.text === "string" ? item.text : "",
      ),
    ).toEqual(["给输入法设计一个操作页面", "先做需求澄清。", "第二轮用户输入", "第二轮模型回复"]);
  });

  it("merges realtime assistant chunks into a streaming draft", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-1",
            role: "user",
            time: { created: "2026-03-20T00:00:01.000Z" },
          },
          parts: [{ text: "继续实现" }],
        },
      ]),
    );
    realtimeStoreMock.events = [
      {
        id: "event-2",
        type: "message.part.updated",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          rawType: "message.part.updated",
          part: {
            type: "text",
            messageID: "message-2",
            text: "正在",
          },
        },
      },
      {
        id: "event-1",
        type: "message.updated",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          rawType: "message.updated",
          info: {
            id: "message-2",
            role: "assistant",
            agent: "planner",
            time: { created: "2026-03-20T00:00:02.000Z" },
          },
        },
      },
    ];

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value).toHaveLength(2);
    expect(state.conversationItems.value[1]).toMatchObject({
      key: "message-2",
      role: "assistant",
      agent: "planner",
      text: "正在",
      isStreaming: true,
    });
    expect(state.hasStreamingAssistant.value).toBe(true);
  });

  it("merges task-domain realtime assistant patches into a streaming draft", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-1",
            role: "user",
            time: { created: "2026-03-20T00:00:01.000Z" },
          },
          parts: [{ text: "继续实现" }],
        },
      ]),
    );
    realtimeStoreMock.events = [
      {
        id: "event-domain-delta",
        type: "task.message.delta",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          messageId: "message-2",
          partType: "text",
          delta: "正在",
        },
      },
      {
        id: "event-domain-meta",
        type: "task.message.updated",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          message: {
            id: "message-2",
            role: "assistant",
            agent: "planner",
            time: { created: "2026-03-20T00:00:02.000Z" },
          },
        },
      },
    ];

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value).toHaveLength(2);
    expect(state.conversationItems.value[1]).toMatchObject({
      key: "message-2",
      role: "assistant",
      agent: "planner",
      text: "正在",
      isStreaming: true,
    });
    expect(state.hasStreamingAssistant.value).toBe(true);
  });

  it("does not treat user workflow-context parts as assistant streaming replies", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-1",
            role: "user",
            time: { created: "2026-03-20T00:00:01.000Z" },
          },
          parts: [{ text: "继续执行" }],
        },
      ]),
    );
    realtimeStoreMock.events = [
      {
        id: "event-user-part",
        type: "message.part.updated",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          rawType: "message.part.updated",
          part: {
            type: "text",
            messageID: "message-user-2",
            text: "## 当前执行上下文\n任务：测试\n\n回复我的输入：继续执行",
          },
        },
      },
      {
        id: "event-user-meta",
        type: "message.updated",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          rawType: "message.updated",
          info: {
            id: "message-user-2",
            role: "user",
            time: { created: "2026-03-20T00:00:02.000Z" },
          },
        },
      },
    ];

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value).toHaveLength(1);
    expect(state.conversationItems.value[0]).toMatchObject({
      key: "message-1",
      role: "user",
      text: "继续执行",
    });
    expect(state.hasStreamingAssistant.value).toBe(false);
  });

  it("keeps tool-only assistant messages and extracts tool summaries", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-tool-1",
            role: "assistant",
            agent: "builder",
            time: { completed: "2026-03-20T00:00:03.000Z" },
          },
          parts: [
            {
              type: "tool",
              id: "tool-1",
              toolName: "create_file",
              input: {
                filePath: "docs/result.md",
                content: "hello",
              },
              state: {
                status: "completed",
                output: {
                  ok: true,
                },
              },
            },
          ],
        },
      ]),
    );

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value).toHaveLength(1);
    expect(state.conversationItems.value[0]).toMatchObject({
      key: "message-tool-1",
      role: "assistant",
      agent: "builder",
      text: undefined,
    });
    expect(state.conversationItems.value[0]?.toolCalls).toEqual([
      expect.objectContaining({
        key: "tool-1",
        kind: "create_file",
        label: "create_file",
        stateLabel: "完成",
        filePath: "docs/result.md",
      }),
    ]);
  });

  it("drops empty pending tool snapshots that only expose a tool name and status", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-tool-empty",
            role: "assistant",
            agent: "builder",
            time: { completed: "2026-03-20T00:00:03.000Z" },
          },
          parts: [
            {
              type: "tool",
              id: "tool-empty",
              toolName: "glob",
              state: {
                status: "pending",
              },
            },
          ],
        },
        {
          info: {
            id: "message-tool-bash-running",
            role: "assistant",
            agent: "builder",
            time: { completed: "2026-03-20T00:00:04.000Z" },
          },
          parts: [
            {
              type: "tool",
              id: "tool-bash-running",
              toolName: "bash",
              input: {
                command: "ls -F",
              },
              state: {
                status: "running",
              },
            },
          ],
        },
      ]),
    );

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value).toHaveLength(1);
    expect(state.conversationItems.value[0]?.toolCalls).toEqual([
      expect.objectContaining({
        kind: "bash",
        stateLabel: "执行中",
        command: "ls -F",
      }),
    ]);
  });

  it("normalizes a candidate session into multiple adoption-ready conversation items", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "candidate-user-1",
          role: "user",
          time: { created: "2026-03-20T00:00:01.000Z" },
        },
        parts: [{ text: "请先检查现状" }],
      },
      {
        info: {
          id: "candidate-assistant-1",
          role: "assistant",
          agent: "builder",
          time: { completed: "2026-03-20T00:00:02.000Z" },
        },
        parts: [{ text: "先给出第一轮分析。" }],
      },
      {
        info: {
          id: "candidate-assistant-2",
          role: "assistant",
          agent: "builder",
          time: { completed: "2026-03-20T00:00:03.000Z" },
        },
        parts: [
          {
            type: "tool",
            id: "candidate-tool-1",
            toolName: "read",
            input: { filePath: "docs/spec.md" },
            state: {
              status: "completed",
              output: {
                path: "docs/spec.md",
                content: "spec content",
              },
            },
          },
          { text: "第二轮结合工具结果给出修正。" },
        ],
      },
    ]);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ role: "user", text: "请先检查现状" });
    expect(items[1]).toMatchObject({ role: "assistant", text: "先给出第一轮分析。" });
    expect(items[2]).toMatchObject({
      role: "assistant",
      text: "第二轮结合工具结果给出修正。",
      toolCalls: [
        expect.objectContaining({
          kind: "read",
          filePath: "docs/spec.md",
          stateLabel: "完成",
        }),
      ],
    });
  });

  it("keeps failed tool calls even when the tool part has no visible input or output details", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "failed-tool-only-assistant",
          role: "assistant",
          time: { completed: "2026-03-20T00:00:04.000Z" },
        },
        parts: [
          {
            type: "tool",
            id: "failed-tool-call-1",
            toolName: "bash",
            state: {
              status: "failed",
            },
          },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      role: "assistant",
      toolCalls: [
        expect.objectContaining({
          kind: "bash",
          label: "bash",
          stateLabel: "失败",
        }),
      ],
    });
  });

  it("preserves failed assistant message status and error text", () => {
    const items = normalizeSessionConversationItems([
      {
        status: "failed",
        errorText: "An unknown error occurred",
        info: {
          id: "failed-assistant-message",
          role: "assistant",
          finish: "error",
          error: "An unknown error occurred",
          time: { completed: "2026-03-20T00:00:04.000Z" },
        },
        parts: [
          {
            type: "text",
            text: "我已展示了两个C文件的内容，现在问用户下一步做什么。",
          },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      role: "assistant",
      status: "failed",
      errorText: "An unknown error occurred",
      text: "我已展示了两个C文件的内容，现在问用户下一步做什么。",
    });
  });

  it("prefers richer tool snapshots when the same call is observed multiple times in one trace item", () => {
    const items = normalizeTraceConversationItems(
      {
        taskId: "task-1",
        sessionId: "session-1",
        segments: [],
        hookExecutions: [],
        followupExecutions: [],
        timeline: [
          {
            id: "message-trace-1",
            role: "assistant",
            text: "",
            createdAt: "2026-03-22T00:00:01.000Z",
            raw: {
              info: {
                id: "message-trace-1",
                role: "assistant",
                time: { created: "2026-03-22T00:00:01.000Z" },
              },
              parts: [
                {
                  id: "tool-call-1-pending",
                  type: "tool",
                  toolName: "bash",
                  callID: "call-1",
                  state: { status: "pending" },
                },
                {
                  id: "tool-call-1-running",
                  type: "tool",
                  toolName: "bash",
                  callID: "call-1",
                  state: { status: "running" },
                  input: { command: "ls -F" },
                },
              ],
            },
          },
        ],
        timelineMeta: { cacheState: "complete" },
      },
      undefined,
      { includeLineage: true },
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.toolCalls).toEqual([
      expect.objectContaining({
        kind: "bash",
        command: "ls -F",
        stateLabel: "执行中",
      }),
    ]);
  });

  it("falls back to latestResponse when projection timeline only contains system items", () => {
    const items = normalizeTraceConversationItems(
      {
        taskId: "task-1",
        sessionId: "session-1",
        finalPrompt: "原始用户输入",
        latestResponse: "投影任务的最终回复",
        segments: [],
        hookExecutions: [],
        followupExecutions: [],
        timeline: [
          {
            id: "timeline-system-1",
            role: "system",
            text: "任务进入 running 状态",
            createdAt: "2026-03-25T09:44:23.156Z",
            completedAt: "2026-03-25T09:44:23.156Z",
            raw: {
              projection: true,
              itemKind: "status-transition",
            },
          },
          {
            id: "timeline-system-2",
            role: "system",
            text: "投影任务的最终回复",
            createdAt: "2026-03-25T09:47:35.022Z",
            completedAt: "2026-03-25T09:47:35.022Z",
            raw: {
              projection: true,
              itemKind: "status-transition",
            },
          },
        ],
        timelineMeta: { cacheState: "complete", readSource: "task-domain-projection" },
        snapshot: {
          status: "completed",
          latestResult: "投影任务的最终回复",
          activeCandidateCount: 0,
          completedCandidateCount: 0,
          failedCandidateCount: 0,
          totalChainSteps: 0,
          completedChainSteps: 0,
          lastActivityAt: "2026-03-25T09:47:35.022Z",
          updatedAt: "2026-03-25T09:47:35.029Z",
        },
      },
      undefined,
      { includeLineage: true },
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      role: "user",
      text: "原始用户输入",
      isStreaming: false,
    });
    expect(items[1]).toMatchObject({
      role: "assistant",
      text: "投影任务的最终回复",
      isStreaming: false,
    });
  });

  it("extracts file path from apply_patch payloads", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-tool-2",
            role: "assistant",
            agent: "builder",
            time: { completed: "2026-03-20T00:00:04.000Z" },
          },
          parts: [
            {
              type: "tool",
              id: "tool-2",
              toolName: "apply_patch",
              input: {
                input:
                  "*** Begin Patch\n*** Update File: design/paid-parallel-compare/verification.md\n@@\n-old\n+new\n*** End Patch",
              },
              state: {
                status: "completed",
                output: "Success",
              },
            },
          ],
        },
      ]),
    );

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value[0]?.toolCalls).toEqual([
      expect.objectContaining({
        kind: "apply_patch",
        filePath: "design/paid-parallel-compare/verification.md",
        headline: "design/paid-parallel-compare/verification.md",
      }),
    ]);
  });

  it("extracts file path from apply_patch output when patch input is unavailable", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-tool-3",
            role: "assistant",
            agent: "builder",
            time: { completed: "2026-03-20T00:00:05.000Z" },
          },
          parts: [
            {
              type: "tool",
              id: "tool-3",
              toolName: "apply_patch",
              input: {
                explanation: "update verification doc",
              },
              state: {
                status: "completed",
                output:
                  "Success. Updated the following files:\nA design/paid-parallel-compare/diagrams.mmd",
              },
            },
          ],
        },
      ]),
    );

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value[0]?.toolCalls).toEqual([
      expect.objectContaining({
        kind: "apply_patch",
        filePath: "design/paid-parallel-compare/diagrams.mmd",
        headline: "design/paid-parallel-compare/diagrams.mmd",
      }),
    ]);
  });

  it("does not expose descriptive metadata as tool parameters when command is already present", async () => {
    apiMocks.getTaskExecutionTraceView.mockResolvedValue(
      createTraceFromMessages([
        {
          info: {
            id: "message-tool-bash-1",
            role: "assistant",
            agent: "builder",
            time: { completed: "2026-03-22T00:00:05.000Z" },
          },
          parts: [
            {
              type: "tool",
              id: "tool-bash-1",
              toolName: "bash",
              input: {
                command: 'rg -n "authMiddleware" control-plane/service/src',
                explanation: "scan auth middleware entrypoint",
                goal: "定位 auth 中间件入口",
              },
              state: {
                status: "completed",
                output:
                  "control-plane/service/src/middleware/auth.ts:12:export function authMiddleware() {}",
              },
            },
          ],
        },
      ]),
    );

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTreeMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value[0]?.toolCalls).toEqual([
      expect.objectContaining({
        kind: "bash",
        command: 'rg -n "authMiddleware" control-plane/service/src',
        inputPreview: undefined,
        description: "scan auth middleware entrypoint",
      }),
    ]);
  });

  it("derives editable execution mode state from task strategy only", () => {
    const task = {
      executionMode: undefined,
      strategy: JSON.stringify({
        executionMode: "parallel",
        parallelCandidates: [
          { model: "github-copilot:gpt-5-mini", label: "候选 A" },
          { model: "github-copilot:gpt-5.4", label: "候选 B" },
        ],
      }),
    };

    expect(resolveEditableExecutionMode(task as never)).toBe("parallel");
    expect(resolveEditableParallelCandidates(task as never)).toEqual([
      { model: "github-copilot:gpt-5-mini", label: "候选 A" },
      { model: "github-copilot:gpt-5.4", label: "候选 B" },
    ]);
    expect(resolveEditableSequentialSteps(task as never)).toEqual([]);
    expect(resolveEditableJudgeConfig(task as never)).toEqual(DEFAULT_JUDGE_CONFIG);
  });

  it("serializes saved execution mode back into task strategy and runtime plan", () => {
    const task = {
      selectedModel: "github-copilot:gpt-5.4",
      strategy: JSON.stringify({
        selectedAgent: "oracle-enterprise",
        parallelCandidates: [{ model: "old:model" }],
      }),
    };

    const strategy = serializeTaskStrategy(task as never, {
      mode: "parallel",
      candidates: [
        { model: "github-copilot:gpt-5-mini", label: "候选 A" },
        { model: "github-copilot:gpt-5.4", label: "候选 B" },
      ],
      judge: {
        ...DEFAULT_JUDGE_CONFIG,
        enabled: true,
        model: "github-copilot:gpt-5.4",
        selectionStrategy: "highest-score",
      },
    });
    const runtimePlan = buildSavedRuntimePlan(task as never, {
      mode: "parallel",
      candidates: [
        { model: "github-copilot:gpt-5-mini", label: "候选 A" },
        { model: "github-copilot:gpt-5.4", label: "候选 B" },
      ],
      judge: {
        ...DEFAULT_JUDGE_CONFIG,
        enabled: true,
        model: "github-copilot:gpt-5.4",
      },
    });

    expect(JSON.parse(strategy)).toEqual({
      selectedAgent: "oracle-enterprise",
      executionMode: "parallel",
      parallelCandidates: [
        { model: "github-copilot:gpt-5-mini", label: "候选 A" },
        { model: "github-copilot:gpt-5.4", label: "候选 B" },
      ],
      judge: {
        ...DEFAULT_JUDGE_CONFIG,
        enabled: true,
        model: "github-copilot:gpt-5.4",
        selectionStrategy: "highest-score",
      },
    });
    expect(JSON.parse(runtimePlan)).toEqual({
      mode: "parallel",
      steps: [
        { id: "exec-parallel", type: "execution", status: "pending" },
        { id: "judge-0", type: "judge", status: "pending", dependsOn: ["exec-parallel"] },
      ],
      candidates: [
        {
          label: "候选 A",
          agent: "default-executor",
          model: "github-copilot:gpt-5-mini",
          role: "executor",
          status: "pending",
        },
        {
          label: "候选 B",
          agent: "default-executor",
          model: "github-copilot:gpt-5.4",
          role: "executor",
          status: "pending",
        },
      ],
    });
  });

  it("reads judge config from task strategy with sane defaults", () => {
    const task = {
      strategy: JSON.stringify({
        executionMode: "parallel",
        judge: {
          enabled: true,
          agent: "prometheus-enterprise",
          model: "github-copilot:gpt-5.4",
          timeoutMs: 45000,
          selectionStrategy: "highest-score",
        },
      }),
    };

    expect(resolveEditableJudgeConfig(task as never)).toEqual({
      ...DEFAULT_JUDGE_CONFIG,
      enabled: true,
      agent: "prometheus-enterprise",
      model: "github-copilot:gpt-5.4",
      timeoutMs: 45000,
      selectionStrategy: "highest-score",
    });
  });

  it("accepts object-form task strategy payloads from the API", () => {
    const task = {
      executionMode: undefined,
      strategy: {
        executionMode: "parallel",
        parallelCandidates: [{ model: "github-copilot:gpt-5.4", label: "候选 A" }],
        judge: {
          enabled: true,
          agent: "prometheus-enterprise",
          model: "github-copilot:gpt-5.4",
        },
      },
    };

    expect(resolveEditableExecutionMode(task as never)).toBe("parallel");
    expect(resolveEditableParallelCandidates(task as never)).toEqual([
      { model: "github-copilot:gpt-5.4", label: "候选 A" },
    ]);
    expect(resolveEditableJudgeConfig(task as never)).toEqual({
      ...DEFAULT_JUDGE_CONFIG,
      enabled: true,
      agent: "prometheus-enterprise",
      model: "github-copilot:gpt-5.4",
    });
  });
});
