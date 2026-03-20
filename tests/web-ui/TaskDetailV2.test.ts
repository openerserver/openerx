import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import {
  buildSavedExecutionPlan,
  DEFAULT_JUDGE_CONFIG,
  resolveEditableExecutionMode,
  resolveEditableJudgeConfig,
  resolveEditableParallelCandidates,
  resolveEditableSequentialSteps,
  serializeTaskStrategy,
} from "../../control-plane/web-ui/src/lib/taskExecutionMode";
import { sessionTreeToFlow } from "../../control-plane/web-ui/src/composables/useSessionFlow";
import { useTaskMessages } from "../../control-plane/web-ui/src/composables/useTaskMessages";

const apiMocks = vi.hoisted(() => ({
  getSessionMessages: vi.fn(),
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
    getSessionMessages: apiMocks.getSessionMessages,
  };
});

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeStoreMock,
}));

describe("TaskDetailV2 composables", () => {
  beforeEach(() => {
    apiMocks.getSessionMessages.mockReset();
    realtimeStoreMock.events = [];
  });

  it("converts a session tree into top-down VueFlow nodes and edges", () => {
    const tree = [
      {
        id: "node-root",
        runtimeSessionId: "session-root",
        parentRuntimeSessionId: null,
        forkedFromMessageId: null,
        forkedFromMessageRole: null,
        forkedFromMessagePreview: null,
        firstPromptAfterFork: null,
        branchName: "主线",
        sourceType: "root",
        isActive: true,
        title: "主线",
        summary: null,
        createdAt: null,
        updatedAt: null,
        children: [
          {
            id: "node-child",
            runtimeSessionId: "session-child",
            parentRuntimeSessionId: "session-root",
            forkedFromMessageId: null,
            forkedFromMessageRole: null,
            forkedFromMessagePreview: null,
            firstPromptAfterFork: null,
            branchName: "分叉 A",
            sourceType: "fork",
            isActive: false,
            title: "分叉 A",
            summary: { additions: 1, deletions: 0, files: 1 },
            createdAt: null,
            updatedAt: null,
            children: [],
          },
        ],
      },
    ];

    const result = sessionTreeToFlow(tree, "session-child");
    const rootNode = result.nodes.find((node) => node.id === "session-root");
    const childNode = result.nodes.find((node) => node.id === "session-child");

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(rootNode?.position.y).toBe(0);
    expect((childNode?.position.y ?? 0) > (rootNode?.position.y ?? 0)).toBe(true);
    expect((childNode?.data as { selected: boolean }).selected).toBe(true);
  });

  it("normalizes session messages into conversation items", async () => {
    apiMocks.getSessionMessages.mockResolvedValue({
      data: [
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
      ],
    });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTaskMessages(taskId, sessionId);

    await flushPromises();

    expect(apiMocks.getSessionMessages).toHaveBeenCalledWith("task-1", "session-1");
    expect(state.conversationItems.value).toHaveLength(2);
    expect(state.conversationItems.value[0]?.text).toBe("第一条消息");
    expect(state.conversationItems.value[1]?.agent).toBe("planner");
    expect(state.conversationItems.value[1]?.role).toBe("assistant");
  });

  it("merges realtime assistant chunks into a streaming draft", async () => {
    apiMocks.getSessionMessages.mockResolvedValue({
      data: [
        {
          info: {
            id: "message-1",
            role: "user",
            time: { created: "2026-03-20T00:00:01.000Z" },
          },
          parts: [{ text: "继续实现" }],
        },
      ],
    });
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
    const state = useTaskMessages(taskId, sessionId);

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

  it("keeps tool-only assistant messages and extracts tool summaries", async () => {
    apiMocks.getSessionMessages.mockResolvedValue({
      data: [
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
      ],
    });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTaskMessages(taskId, sessionId);

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

  it("extracts file path from apply_patch payloads", async () => {
    apiMocks.getSessionMessages.mockResolvedValue({
      data: [
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
                input: "*** Begin Patch\n*** Update File: design/paid-parallel-compare/verification.md\n@@\n-old\n+new\n*** End Patch",
              },
              state: {
                status: "completed",
                output: "Success",
              },
            },
          ],
        },
      ],
    });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTaskMessages(taskId, sessionId);

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
    apiMocks.getSessionMessages.mockResolvedValue({
      data: [
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
                output: "Success. Updated the following files:\nA design/paid-parallel-compare/diagrams.mmd",
              },
            },
          ],
        },
      ],
    });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    const state = useTaskMessages(taskId, sessionId);

    await flushPromises();

    expect(state.conversationItems.value[0]?.toolCalls).toEqual([
      expect.objectContaining({
        kind: "apply_patch",
        filePath: "design/paid-parallel-compare/diagrams.mmd",
        headline: "design/paid-parallel-compare/diagrams.mmd",
      }),
    ]);
  });

  it("derives editable execution mode state from task strategy and execution plan", () => {
    const task = {
      executionMode: undefined,
      strategy: JSON.stringify({
        executionMode: "parallel",
        parallelCandidates: [
          { model: "github-copilot:gpt-5-mini", label: "候选 A" },
          { model: "github-copilot:gpt-5.4", label: "候选 B" },
        ],
      }),
      executionPlan: JSON.stringify({
        mode: "sequential-chain",
        steps: [
          {
            id: "step-1",
            type: "chain-step",
            title: "分析问题",
            instruction: "先整理现状",
            model: "github-copilot:gpt-5-mini",
          },
        ],
      }),
    };

    expect(resolveEditableExecutionMode(task as never)).toBe("sequential-chain");
    expect(resolveEditableParallelCandidates(task as never)).toEqual([
      { model: "github-copilot:gpt-5-mini", label: "候选 A" },
      { model: "github-copilot:gpt-5.4", label: "候选 B" },
    ]);
    expect(resolveEditableSequentialSteps(task as never)).toEqual([
      {
        id: "step-1",
        title: "分析问题",
        instruction: "先整理现状",
        model: "github-copilot:gpt-5-mini",
      },
    ]);
    expect(resolveEditableJudgeConfig(task as never)).toEqual(DEFAULT_JUDGE_CONFIG);
  });

  it("serializes saved execution mode back into task strategy and execution plan", () => {
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
    const executionPlan = buildSavedExecutionPlan(task as never, {
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
    expect(JSON.parse(executionPlan)).toEqual({
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