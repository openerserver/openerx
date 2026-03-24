import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useTreeMessages } from "../../control-plane/web-ui/src/composables/useTreeMessages";
import {
  type TaskConversationMessageItem,
  normalizeSessionConversationItems,
} from "../../control-plane/web-ui/src/lib/message-normalize";
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
    apiMocks.getTaskExecutionTraceView.mockReset();
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

    expect(apiMocks.getTaskExecutionTraceView).toHaveBeenCalledWith("task-1", "session-1");
    expect(state.conversationItems.value).toHaveLength(2);
    const firstItem = state.conversationItems.value[0] as TaskConversationMessageItem | undefined;
    const secondItem = state.conversationItems.value[1] as TaskConversationMessageItem | undefined;
    expect(firstItem?.text).toBe("第一条消息");
    expect(secondItem?.agent).toBe("planner");
    expect(secondItem?.role).toBe("assistant");
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

  it("prefers richer tool snapshots when the same call is observed multiple times in one trace item", () => {
    const items = normalizeTraceConversationItems(
      {
        taskId: "task-1",
        sessionId: "session-1",
        segments: [],
        hookExecutions: [],
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
});
