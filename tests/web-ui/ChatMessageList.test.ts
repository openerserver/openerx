import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import ChatMessageList from "../../control-plane/web-ui/src/components/task-detail-shared/ChatMessageList.vue";
import type { TaskRoundMessagesDto } from "../../control-plane/web-ui/src/lib/api";
import type {
  TaskConversationMessageItem,
  TaskConversationParallelItem,
} from "../../control-plane/web-ui/src/lib/message-normalize";
import { normalizeSessionConversationItems } from "../../control-plane/web-ui/src/lib/message-normalize";
import { createTaskMessageSnapshotState } from "../../control-plane/web-ui/src/lib/task-message-snapshot";

function createPassThroughStub(name: string) {
  return defineComponent({
    name,
    props: ["message", "description"],
    template: "<div><slot />{{ message }}{{ description }}</div>",
  });
}

const ButtonStub = defineComponent({
  name: "AButton",
  emits: ["click"],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  document.execCommand = originalExecCommand;
});

describe("ChatMessageList tool cards", () => {
  it("keeps assistant thinking text separate from visible reply text during normalization", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "assistant-normalize-thinking-1",
          role: "assistant",
          time: { created: "2026-04-10T10:00:00.000Z" },
        },
        parts: [
          { type: "thinking", text: "**Confirming task execution**" },
          { type: "text", text: "页面任务执行正常。" },
        ],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      thinkingText: "**Confirming task execution**",
      text: "页面任务执行正常。",
    });
  });

  it("does not surface mirrored thinking text as a visible assistant reply", () => {
    const items = normalizeSessionConversationItems([
      {
        info: {
          id: "assistant-thinking-mirror-1",
          role: "assistant",
          time: { created: "2026-04-10T10:00:00.000Z" },
        },
        text: "先确认当前任务状态。",
        parts: [{ type: "thinking", text: "先确认当前任务状态。" }],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      thinkingText: "先确认当前任务状态。",
      text: undefined,
    });
  });

  it("renders assistant thinking inside a collapsible section", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-thinking-1",
        role: "assistant",
        thinkingText: "**Confirming task execution**\n\n准备展示最终回复。",
        text: "页面任务执行正常。",
        toolCalls: [],
        createdAt: "2026-04-10T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    expect(wrapper.text()).toContain("模型回复");
    expect(wrapper.text()).toContain("页面任务执行正常。");
    expect(wrapper.text()).toContain("查看思考过程");
    expect(wrapper.text()).not.toContain("Confirming task execution");

    const toggle = wrapper.findAll("button").find((button) => button.text() === "查看思考过程");
    expect(toggle).toBeTruthy();

    await toggle?.trigger("click");

    expect(wrapper.text()).toContain("收起思考过程");
    expect(wrapper.text()).toContain("Confirming task execution");
    expect(wrapper.text()).toContain("准备展示最终回复。");
  });

  it("renders original user input directly without an expand toggle", () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-user-final-sent-1",
        role: "user",
        text: "简短输入",
        userInputText: "简短输入",
        finalSentText: "简短输入\n补充上下文",
        toolCalls: [],
        createdAt: "2026-04-10T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    expect(wrapper.find(".chat-message-card__plain").text()).toBe("简短输入");
    expect(wrapper.text()).not.toContain("补充上下文");
    expect(wrapper.text()).not.toContain("查看完整发送内容");
    expect(wrapper.text()).not.toContain("收起完整发送内容");
  });

  it("does not render empty-text fallback for assistant messages with thinking only", () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-thinking-only-1",
        role: "assistant",
        thinkingText: "先确认当前任务状态。",
        text: undefined,
        toolCalls: [],
        createdAt: "2026-04-10T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    expect(wrapper.text()).toContain("查看思考过程");
    expect(wrapper.text()).not.toContain("暂无文本内容");
  });

  it("renders streaming assistant text immediately without waiting for reveal throttling", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-streaming-1",
        role: "assistant",
        text: "正在实时输出的第一段正文",
        toolCalls: [],
        createdAt: "2026-04-10T10:00:00.000Z",
        raw: null,
        isStreaming: true,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    await nextTick();

    expect(wrapper.text()).toContain("正在实时输出的第一段正文");
    expect(wrapper.text()).not.toContain("暂无文本内容");
  });

  it("requests older history automatically when the user scrolls to the top", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-history-anchor",
        role: "assistant",
        text: "当前轮次最新回复",
        toolCalls: [],
        createdAt: "2026-04-10T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
        hasOlderHistory: true,
        historyLoading: false,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    const list = wrapper.get("[data-testid='task-detail-v2-message-list']").element as HTMLElement;
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      get: () => 320,
    });

    list.scrollTop = 0;
    await wrapper.get("[data-testid='task-detail-v2-message-list']").trigger("scroll");

    expect(wrapper.emitted("loadOlderHistory")).toHaveLength(1);
  });

  it("requests older history when the sticky history trigger is clicked", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-history-click",
        role: "assistant",
        text: "当前轮次最新回复",
        toolCalls: [],
        createdAt: "2026-04-10T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
        hasOlderHistory: true,
        historyLoading: false,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    const list = wrapper.get("[data-testid='task-detail-v2-message-list']").element as HTMLElement;
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      get: () => 320,
    });

    list.scrollTop = 640;
    await wrapper.get(".chat-message-list__history-trigger").trigger("click");

    expect(wrapper.text()).toContain("向上滚动或点击加载更早消息");
    expect(wrapper.emitted("loadOlderHistory")).toHaveLength(1);
  });

  it("keeps user-visible instruction text from execution context prompts", () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-user-execution-context",
        role: "user",
        text: `Execution context:
- Opener-X task ID: task-1

## 当前执行上下文
任务：编写一个macos上的输入法
请只完成当前阶段的目标。
完成后请输出本阶段产出摘要。
如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。

/start-work 请先梳理需求和边界条件，再实现功能代码。`,
        toolCalls: [],
        createdAt: "2026-04-02T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    expect(wrapper.text()).toContain("用户输入");
    expect(wrapper.text()).toContain("/start-work 请先梳理需求和边界条件，再实现功能代码。");
    expect(wrapper.text()).not.toContain("Opener-X task ID");
  });

  it("shows tool actions beside each assistant turn instead of one session panel", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-1",
        role: "assistant",
        text: "先读取文件",
        toolCalls: [
          {
            key: "tool-read-1",
            kind: "read_file",
            label: "read_file",
            stateLabel: "完成",
            stateColor: "success",
            filePath: "control-plane/web-ui/src/pages/MultiTaskMonitor.vue",
            inputPreview:
              "path: control-plane/web-ui/src/pages/MultiTaskMonitor.vue\nrange: 400-470",
            outputPreview: "const monitorNode = createNode();",
          },
        ],
        createdAt: "2026-03-22T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
      {
        key: "message-2",
        role: "assistant",
        text: undefined,
        toolCalls: [
          {
            key: "tool-search-1",
            kind: "grep_search",
            label: "grep_search",
            stateLabel: "完成",
            stateColor: "success",
            inputPreview:
              "includePattern: **/tests/web-ui/TaskExecutionTracePanel.test.ts\nquery: ExecutionTraceTimelineItem",
            outputPreview: "No results found.",
          },
        ],
        createdAt: "2026-03-22T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    const groups = wrapper.findAll(".task-tool-call-group");

    expect(groups).toHaveLength(2);
    expect(groups[0]?.text()).toContain("读取 MultiTaskMonitor.vue，行 400 到 470");
    expect(groups[1]?.text()).toContain(
      "搜索文本 ExecutionTraceTimelineItem（**/tests/web-ui/TaskExecutionTracePanel.test.ts），无结果",
    );
    expect(wrapper.text()).not.toContain("参数");
    expect(wrapper.text()).not.toContain("输出");
    expect(wrapper.text()).not.toContain("共 1 个动作");

    const toggles = wrapper.findAll("button.task-tool-call-group__toggle");
    expect(toggles).toHaveLength(2);
    await toggles[0]?.trigger("click");
    await toggles[1]?.trigger("click");

    expect(wrapper.text()).toContain("收起");
    expect(wrapper.text()).toContain("读取 MultiTaskMonitor.vue，行 400 到 470");
    expect(wrapper.text()).toContain(
      "搜索文本 ExecutionTraceTimelineItem（**/tests/web-ui/TaskExecutionTracePanel.test.ts），无结果",
    );
    expect(wrapper.text()).not.toContain("参数");
    expect(wrapper.text()).not.toContain("输出");

    const detailToggle = wrapper.findAll("button").find((button) =>
      button.text().includes("读取 MultiTaskMonitor.vue，行 400 到 470"),
    );
    expect(detailToggle).toBeTruthy();
    await detailToggle?.trigger("click");

    expect(wrapper.text()).toContain("详情");
    expect(wrapper.text()).toContain("文件");
    expect(wrapper.text()).toContain("参数");
    expect(wrapper.text()).toContain("输出");
    expect(wrapper.text()).toContain("range: 400-470");
    expect(wrapper.text()).toContain("const monitorNode = createNode();");
  });

  it("folds tool result messages back into the previous assistant turn", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-main-tool",
        role: "assistant",
        text: "先写入 main.c",
        toolCalls: [
          {
            key: "tool-main-flow-write",
            kind: "write",
            label: "write",
            stateLabel: "执行中",
            stateColor: "processing",
            filePath: "main.c",
            inputPreview: "path: main.c",
          },
        ],
        createdAt: "2026-03-22T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
      {
        key: "message-main-tool-output",
        role: "tool",
        text: "Command exited with code 2",
        toolCalls: [
          {
            key: "tool-main-flow-output",
            kind: "write",
            label: "write",
            stateLabel: "失败",
            stateColor: "error",
            filePath: "main.c",
            outputPreview:
              '{"content":[{"type":"text","text":"Successfully wrote 69 bytes to main.c"}],"details":{}}',
          },
        ],
        createdAt: "2026-03-22T10:00:30.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    expect(wrapper.findAll(".task-tool-call-group")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("工具输出");

    const groupToggle = wrapper.find("button.task-tool-call-group__toggle");
    expect(groupToggle).toBeTruthy();
    await groupToggle.trigger("click");

    expect(wrapper.text()).toContain("写入 main.c");

    const detailToggle = wrapper.findAll("button").find((button) =>
      button.text().includes("写入 main.c"),
    );
    expect(detailToggle).toBeTruthy();
    await detailToggle?.trigger("click");

    expect(wrapper.text()).toContain("Successfully wrote 69 bytes to main.c");
    expect(wrapper.text()).toContain("Command exited with code 2");
  });

  it("restores embedded tool-call rendering from round snapshot messages", async () => {
    const snapshot: TaskRoundMessagesDto = {
      taskId: "task-1",
      round: {
        id: "task-session:task-1:session-1",
        taskId: "task-1",
        sessionId: "session-1",
        kind: "continue",
        source: "continue",
        status: "completed",
        promptText: "显示一下当前目录下的 c 程序",
        createdAt: "2026-04-15T14:06:41.706Z",
        updatedAt: "2026-04-15T14:08:28.420Z",
      },
      messages: [
        {
          id: "assistant-1",
          roundId: "task-session:task-1:session-1",
          sessionId: "session-1",
          role: "assistant",
          status: "completed",
          text: "内部思考不应直接显示为正文",
          errorText: null,
          parts: [
            {
              id: "assistant-1:thinking",
              partIndex: 0,
              partType: "text",
              type: "thinking",
              text: "**Defining User Intent**",
              finalizedAt: "2026-04-15T14:06:41.768Z",
            },
            {
              id: "assistant-1:tool",
              partIndex: 1,
              partType: "toolCall",
              type: "tool",
              toolName: "bash",
              callID: "bash_1",
              input: {
                command: "ls *.c *.h",
              },
              state: {
                status: "completed",
              },
              text: "",
              finalizedAt: "2026-04-15T14:06:41.768Z",
            },
          ],
          createdAt: "2026-04-15T14:06:41.768Z",
          updatedAt: "2026-04-15T14:06:41.768Z",
          startedAt: "2026-04-15T14:06:41.768Z",
          completedAt: "2026-04-15T14:06:41.768Z",
        },
        {
          id: "tool-1",
          roundId: "task-session:task-1:session-1",
          sessionId: "session-1",
          role: "tool",
          status: "completed",
          text: "ls: *.h: No such file or directory\nprint_cc.c\n\n\nCommand exited with code 1",
          errorText: null,
          parts: [
            {
              id: "tool-1:text",
              partIndex: 0,
              partType: "text",
              text: "ls: *.h: No such file or directory\nprint_cc.c\n\n\nCommand exited with code 1",
              finalizedAt: "2026-04-15T14:08:06.744Z",
            },
          ],
          createdAt: "2026-04-15T14:08:06.744Z",
          updatedAt: "2026-04-15T14:08:06.744Z",
          startedAt: "2026-04-15T14:08:06.744Z",
          completedAt: "2026-04-15T14:08:06.744Z",
        },
      ],
      reconcileRequired: false,
      snapshotVersion: 2,
      persistedThroughRevision: 2,
    };

    const items = normalizeSessionConversationItems(
      createTaskMessageSnapshotState({
        taskId: "task-1",
        requestedSessionId: "session-1",
        response: snapshot,
      }).sourceMessages,
    );

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    expect(wrapper.findAll(".task-tool-call-group")).toHaveLength(1);
    expect(wrapper.text()).toContain("查看思考过程");
    expect(wrapper.text()).not.toContain("工具输出");
    expect(wrapper.text()).not.toContain("内部思考不应直接显示为正文");

    const toolToggle = wrapper.find("button.task-tool-call-group__toggle");
    expect(toolToggle.exists()).toBe(true);
    await toolToggle.trigger("click");

    expect(wrapper.text()).toContain("执行 ls *.c *.h");
    const detailToggle = wrapper.findAll("button").find((button) =>
      button.text().includes("执行 ls *.c *.h"),
    );
    expect(detailToggle).toBeTruthy();
    await detailToggle?.trigger("click");

    expect(wrapper.text()).toContain("Command exited with code 1");
  });

  it("shows failed assistant turns inside parallel candidates instead of only relying on the candidate header", () => {
    const items: TaskConversationParallelItem[] = [
      {
        key: "parallel-failed-candidate",
        role: "parallel",
        createdAt: "2026-03-22T10:00:00.000Z",
        raw: null,
        toolCalls: [],
        candidates: [
          {
            key: "candidate-failed-turn",
            index: 1,
            label: "候选 B",
            model: "gpt-5-mini",
            status: "failed",
            loading: false,
            canAdopt: false,
            isAdopted: false,
            isRecommended: false,
            items: [
              {
                key: "candidate-main-read",
                role: "assistant",
                text: "好的，我先显示 main.c 的内容。",
                toolCalls: [
                  {
                    key: "candidate-main-read-tool",
                    kind: "read",
                    label: "read",
                    stateLabel: "完成",
                    stateColor: "success",
                    filePath: "main.c",
                    inputPreview: "path: main.c",
                  },
                ],
                createdAt: "2026-03-22T10:00:00.000Z",
                raw: null,
                isStreaming: false,
              },
              {
                key: "candidate-main-read-output",
                role: "tool",
                text: "#include <stdio.h>\n\nint main() {\n    printf(\"BB\\n\");\n    return 0;\n}",
                toolCalls: [
                  {
                    key: "candidate-main-read-output-tool",
                    kind: "read",
                    label: "read",
                    stateLabel: "完成",
                    stateColor: "success",
                    filePath: "main.c",
                    outputPreview: "#include <stdio.h>",
                  },
                ],
                createdAt: "2026-03-22T10:00:01.000Z",
                raw: null,
                isStreaming: false,
              },
              {
                key: "candidate-failed-assistant",
                role: "assistant",
                status: "failed",
                errorText: "An unknown error occurred",
                text: "我已展示了两个C文件的内容，现在问用户下一步做什么。",
                toolCalls: [],
                createdAt: "2026-03-22T10:00:02.000Z",
                raw: null,
                isStreaming: false,
              },
            ],
          },
        ],
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    expect(wrapper.text()).toContain("候选 B");
    expect(wrapper.text()).toContain("读取 main.c");
    expect(wrapper.findAll(".chat-message-card__status-tag")).toHaveLength(1);
    expect(wrapper.find(".chat-message-card__status-tag").text()).toContain("失败");
    expect(wrapper.text()).toContain("An unknown error occurred");
  });

  it("re-emits file preview requests from grouped tool details", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-open-file",
        role: "assistant",
        text: "已查看文件",
        toolCalls: [
          {
            key: "tool-open-file",
            kind: "read_file",
            label: "read_file",
            stateLabel: "完成",
            stateColor: "success",
            filePath: "docs/architecture-overview.md",
            fileContent: "# overview",
          },
        ],
        createdAt: "2026-03-22T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    const groupToggle = wrapper.find("button.task-tool-call-group__toggle");
    expect(groupToggle).toBeTruthy();
    await groupToggle.trigger("click");

    const detailToggle = wrapper.findAll("button").find((button) =>
      button.text().includes("读取 architecture-overview.md"),
    );
    expect(detailToggle).toBeTruthy();
    await detailToggle?.trigger("click");

    const fileButton = wrapper.findAll("button").find((button) => button.text() === "docs/architecture-overview.md");
    expect(fileButton).toBeTruthy();
    await fileButton?.trigger("click");

    expect(wrapper.emitted("openFilePreview")).toEqual([
      [
        {
          filePath: "docs/architecture-overview.md",
          content: "# overview",
        },
      ],
    ]);
  });

  it("falls back to execCommand copy when clipboard api is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const execCommandSpy = vi.fn(() => true);
    document.execCommand = execCommandSpy;

    const items: TaskConversationMessageItem[] = [
      {
        key: "message-copy-1",
        role: "assistant",
        text: "需要复制的一段回复",
        toolCalls: [],
        createdAt: "2026-03-22T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    const copyButton = wrapper.findAll("button").find((button) => button.text() === "复制");
    expect(copyButton).toBeTruthy();

    await copyButton?.trigger("click");

    expect(execCommandSpy).toHaveBeenCalledWith("copy");
  });

  it("copies a single parallel candidate without affecting adopt action", async () => {
    const writeTextSpy = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextSpy },
    });

    const items: TaskConversationParallelItem[] = [
      {
        key: "parallel-1",
        role: "parallel",
        createdAt: "2026-03-22T10:00:00.000Z",
        raw: null,
        toolCalls: [],
        candidates: [
          {
            key: "candidate-1",
            index: 0,
            label: "候选 A",
            model: "github-copilot:gpt-4o",
            status: "completed",
            meta: "主模型候选",
            loading: false,
            canAdopt: true,
            isAdopted: false,
            isRecommended: true,
            items: [
              {
                key: "candidate-1-assistant",
                role: "assistant",
                text: "并行候选输出",
                toolCalls: [
                  {
                    key: "tool-a",
                    kind: "bash",
                    label: "bash",
                    stateLabel: "完成",
                    stateColor: "success",
                    command: "echo demo",
                    outputPreview: "demo",
                  },
                ],
                createdAt: "2026-03-22T10:00:01.000Z",
                raw: null,
                isStreaming: false,
              },
            ],
          },
        ],
        judgeSummary: "Judge 推荐候选 A",
        judgeReasoning: "响应更完整",
      },
    ];

    const wrapper = mount(ChatMessageList, {
      props: {
        items,
        loading: false,
        error: null,
      },
      global: {
        stubs: {
          ASpin: createPassThroughStub("ASpin"),
          AAlert: createPassThroughStub("AAlert"),
          AEmpty: createPassThroughStub("AEmpty"),
          ASpace: createPassThroughStub("ASpace"),
          AFlex: createPassThroughStub("AFlex"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          AButton: ButtonStub,
        },
      },
    });

    const copyButton = wrapper.findAll("button").find((button) => button.text() === "复制候选");
    expect(copyButton).toBeTruthy();

    await copyButton?.trigger("click");

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const copiedText = (writeTextSpy.mock.calls as unknown as Array<[string]>)[0]?.[0];
    expect(copiedText).toContain("候选: 候选 A");
    expect(copiedText).toContain("模型回复:");
    expect(copiedText).toContain("并行候选输出");
    expect(copiedText).toContain("工具: bash");
  });
});
