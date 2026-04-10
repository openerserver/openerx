import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const composableMocks = vi.hoisted(() => ({
  useTaskExecutionTrace: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskExecutionTrace", () => ({
  useTaskExecutionTrace: composableMocks.useTaskExecutionTrace,
}));

vi.mock("ant-design-vue", () => ({
  AFlex: { template: "<div><slot /></div>" },
  ASpace: { template: "<div><slot /></div>" },
  AButton: { template: "<button><slot /></button>" },
  ASpin: { template: "<div>spin</div>" },
  AAlert: {
    props: ["message", "description"],
    template: "<div><div>{{ message }}</div><div>{{ description }}</div><slot /></div>",
  },
  ATag: { template: "<span><slot /></span>" },
  ACard: { template: "<section><slot /></section>" },
  ARadioGroup: { template: "<div><slot /></div>" },
  ARadioButton: { template: "<button><slot /></button>" },
  ADivider: { template: "<hr />" },
  AEmpty: { props: ["description"], template: "<div>{{ description }}</div>" },
  ATypographyText: { template: "<span><slot /></span>" },
}));

describe("TaskExecutionTracePanel", () => {
  beforeEach(() => {
    composableMocks.useTaskExecutionTrace.mockReturnValue({
      trace: ref({
        taskId: "task-1",
        sessionId: "ses-1",
        segments: [],
        timeline: [
          {
            id: "tool-request-1",
            role: "tool-request",
            text: "bash\n调用: bun test tests/web-ui/ChatMessageList.test.ts",
            createdAt: "2026-03-14T08:04:00.000Z",
            raw: {
              source: "trace-message-tool-request",
              toolName: "bash",
              request: {
                status: "completed",
                command: "bun test tests/web-ui/ChatMessageList.test.ts",
                headline: "bun test tests/web-ui/ChatMessageList.test.ts",
                filePath: "tests/web-ui/ChatMessageList.test.ts",
              },
              rawPart: {
                tool: "bash",
                toolName: "bash",
                state: { status: "completed" },
              },
            },
            sourceEventTypes: ["runtime:tool-request:bash"],
          },
          {
            id: "tool-result-1",
            role: "tool-result",
            text: "bash 结果\n状态: failed\n输出: test failed",
            completedAt: "2026-03-14T08:04:20.000Z",
            raw: {
              source: "trace-message-tool-result",
              toolName: "bash",
              result: {
                status: "failed",
                headline: "bun test tests/web-ui/ChatMessageList.test.ts",
                output: "test failed",
                filePath: "tests/web-ui/ChatMessageList.test.ts",
              },
              rawPart: {
                tool: "bash",
                toolName: "bash",
                state: { status: "failed", error: "test failed" },
              },
            },
            sourceEventTypes: ["runtime:tool-result:bash"],
          },
        ],
        timelineMeta: { readSource: "task-domain-projection", cacheState: "complete" },
        snapshot: { currentStatus: "running" },
        truncated: false,
        hookExecutions: [],
        followupExecutions: [],
      }),
      loading: ref(false),
      error: ref(null),
      messageRoleFilter: ref("narrative"),
      expandedMessageRaw: ref({}),
      refresh: vi.fn(),
      filteredMessages: ref([
        {
          id: "tool-request-1",
          role: "tool-request",
          text: "bash\n调用: bun test tests/web-ui/ChatMessageList.test.ts",
          createdAt: "2026-03-14T08:04:00.000Z",
          raw: {
            source: "trace-message-tool-request",
            toolName: "bash",
            request: {
              status: "completed",
              command: "bun test tests/web-ui/ChatMessageList.test.ts",
              headline: "bun test tests/web-ui/ChatMessageList.test.ts",
              filePath: "tests/web-ui/ChatMessageList.test.ts",
            },
            rawPart: {
              tool: "bash",
              toolName: "bash",
              state: { status: "completed" },
            },
          },
          sourceEventTypes: ["runtime:tool-request:bash"],
        },
        {
          id: "tool-result-1",
          role: "tool-result",
          text: "bash 结果\n状态: failed\n输出: test failed",
          completedAt: "2026-03-14T08:04:20.000Z",
          raw: {
            source: "trace-message-tool-result",
            toolName: "bash",
            result: {
              status: "failed",
              headline: "bun test tests/web-ui/ChatMessageList.test.ts",
              output: "test failed",
              filePath: "tests/web-ui/ChatMessageList.test.ts",
            },
            rawPart: {
              tool: "bash",
              toolName: "bash",
              state: { status: "failed", error: "test failed" },
            },
          },
          sourceEventTypes: ["runtime:tool-result:bash"],
        },
      ]),
      summaryItems: ref([{ label: "时间线项", value: "2", tone: "purple" }]),
    });
  });

  it("renders shared tool summaries for tool timeline items", async () => {
    const { default: Panel } = await import(
      "../../control-plane/web-ui/src/components/task-detail-shared/TaskExecutionTracePanel.vue"
    );

    const wrapper = mount(Panel, {
      props: {
        taskId: "task-1",
        sessionId: "ses-1",
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("执行 bun test tests/web-ui/ChatMessageList.test.ts");
    expect(wrapper.text()).toContain("1 失败 · 涉及 web-ui/ChatMessageList.test.ts");
    expect(wrapper.text()).toContain("bash 结果");
  });

  it("shows the current trace filters for timeline roles", async () => {
    const { default: Panel } = await import(
      "../../control-plane/web-ui/src/components/task-detail-shared/TaskExecutionTracePanel.vue"
    );

    const wrapper = mount(Panel, {
      props: {
        taskId: "task-1",
        sessionId: "ses-1",
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("关键时间线");
    expect(wrapper.text()).toContain("全部时间线");
    expect(wrapper.text()).toContain("用户输入");
    expect(wrapper.text()).toContain("模型");
    expect(wrapper.text()).toContain("工具");
    expect(wrapper.text()).toContain("工具发起");
    expect(wrapper.text()).toContain("工具结果");
    expect(wrapper.text()).toContain("调试事件");
  });
});
