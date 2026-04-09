import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import TaskExecutionControlCard from "../../control-plane/web-ui/src/components/task-detail/TaskExecutionControlCard.vue";

function createPassThroughStub(name: string) {
  return defineComponent({
    name,
    template: "<div><slot /></div>",
  });
}

function mountCard(props?: Partial<InstanceType<typeof TaskExecutionControlCard>["$props"]>) {
  return mount(TaskExecutionControlCard, {
    props: {
      executionMode: undefined,
      autoAdvance: false,
      isExecuting: true,
      executing: true,
      ...props,
    },
    global: {
      stubs: {
        ACard: createPassThroughStub("ACard"),
        AFlex: createPassThroughStub("AFlex"),
        ASpace: createPassThroughStub("ASpace"),
        ATag: createPassThroughStub("ATag"),
        ATooltip: createPassThroughStub("ATooltip"),
        ATypographyText: createPassThroughStub("ATypographyText"),
      },
    },
  });
}

describe("TaskExecutionControlCard", () => {
  it("shows model generation hint while assistant is still streaming", () => {
    const wrapper = mountCard({ isExecuting: true, executing: true });

    expect(wrapper.text()).toContain("执行中");
    expect(wrapper.text()).toContain("模型生成中…");
  });

  it("shows settling hint after assistant streaming has finished but task is still running", () => {
    const wrapper = mountCard({ isExecuting: true, executing: false });

    expect(wrapper.text()).toContain("执行中");
    expect(wrapper.text()).toContain("执行收尾中…");
    expect(wrapper.text()).not.toContain("模型生成中…");
  });
});