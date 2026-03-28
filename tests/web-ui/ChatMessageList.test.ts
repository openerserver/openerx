import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import ChatMessageList from "../../control-plane/web-ui/src/components/task-detail-shared/ChatMessageList.vue";
import type {
  TaskConversationMessageItem,
  TaskConversationParallelItem,
} from "../../control-plane/web-ui/src/lib/message-normalize";

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
    expect(writeTextSpy.mock.calls[0]?.[0]).toContain("候选: 候选 A");
    expect(writeTextSpy.mock.calls[0]?.[0]).toContain("模型回复:");
    expect(writeTextSpy.mock.calls[0]?.[0]).toContain("并行候选输出");
    expect(writeTextSpy.mock.calls[0]?.[0]).toContain("工具: bash");
  });
});
