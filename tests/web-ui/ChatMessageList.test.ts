import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import ChatMessageList from "../../control-plane/web-ui/src/components/task-detail-shared/ChatMessageList.vue";
import type { TaskConversationMessageItem } from "../../control-plane/web-ui/src/lib/message-normalize";

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

describe("ChatMessageList tool cards", () => {
  it("keeps tool details collapsed by default and expands on demand", async () => {
    const items: TaskConversationMessageItem[] = [
      {
        key: "message-1",
        role: "assistant",
        text: undefined,
        toolCalls: [
          {
            key: "tool-1",
            kind: "bash",
            label: "bash",
            stateLabel: "完成",
            stateColor: "success",
            command: "ls -la",
            inputPreview: "args: ['-la']",
            outputPreview: "total 8",
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

    expect(wrapper.text()).toContain("工具调用");
    expect(wrapper.text()).toContain("展开详情");
    expect(wrapper.text()).not.toContain("参数");
    expect(wrapper.text()).not.toContain("输出");
    expect(wrapper.text()).not.toContain("args: ['-la']");
    expect(wrapper.text()).not.toContain("total 8");

    const toggle = wrapper.find(".chat-tool-call__toggle");
    await toggle.trigger("click");

    expect(wrapper.text()).toContain("收起详情");
    expect(wrapper.text()).toContain("调用");
    expect(wrapper.text()).toContain("参数");
    expect(wrapper.text()).toContain("输出");
    expect(wrapper.text()).toContain("args: ['-la']");
    expect(wrapper.text()).toContain("total 8");
  });
});
