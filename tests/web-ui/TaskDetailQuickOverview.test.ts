import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";

import TaskDetailQuickOverview from "../../control-plane/web-ui/src/components/task-detail/TaskDetailQuickOverview.vue";

describe("TaskDetailQuickOverview", () => {
  it("does not render the legacy complete-task button for running tasks", () => {
    const wrapper = mount(TaskDetailQuickOverview, {
      props: {
        workflowSummary: {
          currentStage: "执行中",
          status: "running",
        },
        workflowStages: [],
        executionMode: undefined,
        autoAdvance: false,
        isExecuting: true,
        executing: true,
      },
      global: {
        stubs: {
          TaskExecutionControlCard: defineComponent({
            name: "TaskExecutionControlCard",
            template: '<div data-testid="execution-control-card" />',
          }),
          TaskCompletionActionsCard: defineComponent({
            name: "TaskCompletionActionsCard",
            template: '<div data-testid="completion-actions-card">完成任务</div>',
          }),
        },
      },
    });

    expect(wrapper.find('[data-testid="task-detail-quick-overview"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="execution-control-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="completion-actions-card"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("完成任务");
  });
});