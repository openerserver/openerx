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
    template:
      '<div class="alert"><div>{{ message }}</div><div>{{ description }}</div><slot /></div>',
  },
  ATag: { template: "<span><slot /></span>" },
  ACard: { template: "<section><slot /></section>" },
  AEmpty: { props: ["description"], template: "<div>{{ description }}</div>" },
  ATypographyText: { template: "<span><slot /></span>" },
}));

describe("TaskFollowupPanel", () => {
  beforeEach(() => {
    composableMocks.useTaskExecutionTrace.mockReturnValue({
      trace: ref(null),
      loading: ref(false),
      error: ref<string | null>(null),
      refresh: vi.fn(async () => undefined),
    });
  });

  it("shows top-level warnings for template-missing and failed follow-ups", async () => {
    composableMocks.useTaskExecutionTrace.mockReturnValue({
      trace: ref({
        followupExecutions: [
          {
            templateId: "post-review",
            triggerHookId: "hook-1",
            status: "failed",
            failureType: "template-missing",
            agent: "reviewer",
            model: "github-copilot:gpt-4o",
            prompt: "review",
            error: "未找到启用模板 post-review",
            completedAt: "2026-03-26T06:00:00.000Z",
          },
          {
            templateId: "post-audit",
            triggerHookId: "hook-2",
            status: "failed",
            failureType: "runtime-error",
            agent: "auditor",
            model: "github-copilot:gpt-4o",
            prompt: "audit",
            error: "runtime exploded",
            completedAt: "2026-03-26T06:05:00.000Z",
          },
        ],
      }),
      loading: ref(false),
      error: ref<string | null>(null),
      refresh: vi.fn(async () => undefined),
    });

    const { default: Panel } = await import(
      "../../control-plane/web-ui/src/components/task-detail/TaskFollowupPanel.vue"
    );

    const wrapper = mount(Panel, {
      props: {
        taskId: "task-1",
        sessionId: "ses-1",
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("存在需要处理的 follow-up 问题");
    expect(wrapper.text()).toContain("请前往设置页的编排策略检查 Follow-up 模板配置");
    expect(wrapper.text()).toContain("缺少已启用的 follow-up 模板");
    expect(wrapper.text()).toContain("未找到启用模板 post-review");
    expect(wrapper.text()).toContain("Follow-up 执行失败");
    expect(wrapper.text()).toContain("runtime exploded");
  });
});
