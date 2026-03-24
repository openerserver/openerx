import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      trace: {
        sessionId: "ses-1",
        segments: [
          {
            type: "tool-call",
            label: "工具调用 search_code",
            content:
              "query: task domain projections | includePattern: control-plane/service/src/modules/tasks/**",
            toolName: "search_code",
            toolArgumentsSummary:
              "query: task domain projections | includePattern: control-plane/service/src/modules/tasks/**",
            toolStatus: "completed",
          },
          {
            type: "file-reference",
            label: "文件引用 docs/spec.md",
            content: "docs/spec.md:8-24",
            filePath: "docs/spec.md",
            fileRange: "8-24",
          },
          {
            type: "diff",
            label: "变更 Diff",
            content: "control-plane/service/src/modules/tasks/task-domain-projector.ts | +14 -3",
            filePath: "control-plane/service/src/modules/tasks/task-domain-projector.ts",
            diffSummary:
              "control-plane/service/src/modules/tasks/task-domain-projector.ts | +14 -3",
          },
        ],
        timeline: [],
        timelineMeta: { readSource: "task-domain-projection", cacheState: "complete" },
        snapshot: { currentStatus: "running" },
        truncated: false,
      },
      loading: false,
      error: null,
      segmentFilter: "all",
      messageRoleFilter: "all",
      expandedMessageRaw: {},
      refresh: vi.fn(),
      filteredSegments: [
        {
          type: "tool-call",
          label: "工具调用 search_code",
          content:
            "query: task domain projections | includePattern: control-plane/service/src/modules/tasks/**",
          toolName: "search_code",
          toolArgumentsSummary:
            "query: task domain projections | includePattern: control-plane/service/src/modules/tasks/**",
          toolStatus: "completed",
        },
        {
          type: "file-reference",
          label: "文件引用 docs/spec.md",
          content: "docs/spec.md:8-24",
          filePath: "docs/spec.md",
          fileRange: "8-24",
        },
        {
          type: "diff",
          label: "变更 Diff",
          content: "control-plane/service/src/modules/tasks/task-domain-projector.ts | +14 -3",
          filePath: "control-plane/service/src/modules/tasks/task-domain-projector.ts",
          diffSummary: "control-plane/service/src/modules/tasks/task-domain-projector.ts | +14 -3",
        },
      ],
      filteredMessages: [],
      summaryItems: [],
    });
  });

  it("renders specialized projection trace details for tool, file reference, and diff segments", async () => {
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

    expect(wrapper.text()).toContain("completed");
    expect(wrapper.text()).toContain("docs/spec.md");
    expect(wrapper.text()).toContain("L8-24");
    expect(wrapper.text()).toContain("参数");
    expect(wrapper.text()).toContain("includePattern");
    expect(wrapper.text()).toContain("变更");
    expect(wrapper.text()).toContain("+14 -3");
  });
});
