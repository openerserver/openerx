import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import TaskDetailPhaseBlockList from "../../control-plane/web-ui/src/components/task-detail-v3/TaskDetailPhaseBlockList.vue";
import { normalizeSessionConversationItems } from "../../control-plane/web-ui/src/lib/message-normalize";

function createPassThroughStub(name: string) {
  return defineComponent({
    name,
    props: ["message", "description", "color", "type"],
    template: "<div><slot />{{ message }}{{ description }}</div>",
  });
}

const ButtonStub = defineComponent({
  name: "AButton",
  emits: ["click"],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>',
});

describe("TaskDetailPhaseBlockList", () => {
  it("renders native phase-local blocks and emits adopt from parallel candidates", async () => {
    const wrapper = mount(TaskDetailPhaseBlockList, {
      props: {
        defaultAssistantModel: "gpt-5.4",
        blocks: [
          {
            key: "phase-block:phase-1",
            phaseId: "phase-1",
            phaseIndex: 1,
            phaseKind: "parallel",
            triggerType: "execute",
            status: "awaiting_adoption",
            createdAt: "2026-04-16T10:00:00.000Z",
            items: [
              {
                key: "user-1",
                role: "user",
                text: "先做并行比较",
                toolCalls: [],
                createdAt: "2026-04-16T10:00:01.000Z",
                raw: null,
              },
              {
                key: "parallel-1",
                role: "parallel",
                createdAt: "2026-04-16T10:00:02.000Z",
                candidates: [
                  {
                    key: "candidate-a",
                    index: 0,
                    label: "候选 A",
                    model: "gpt-5.4",
                    status: "completed",
                    loading: false,
                    items: [
                      {
                        key: "assistant-a",
                        role: "assistant",
                        text: "候选 A 回复",
                        toolCalls: [],
                        createdAt: "2026-04-16T10:00:03.000Z",
                        raw: null,
                      },
                    ],
                    canAdopt: true,
                    isAdopted: false,
                    isRecommended: true,
                  },
                  {
                    key: "candidate-b",
                    index: 1,
                    label: "候选 B",
                    model: "claude-opus-4.6",
                    status: "completed",
                    loading: false,
                    items: [
                      {
                        key: "assistant-b",
                        role: "assistant",
                        text: "候选 B 回复",
                        toolCalls: [],
                        createdAt: "2026-04-16T10:00:04.000Z",
                        raw: null,
                      },
                    ],
                    canAdopt: false,
                    isAdopted: true,
                    isRecommended: false,
                  },
                ],
                raw: { phaseId: "phase-1" },
                toolCalls: [],
              },
            ],
          },
        ],
      },
      global: {
        stubs: {
          AAlert: createPassThroughStub("AAlert"),
          AButton: ButtonStub,
          AFlex: createPassThroughStub("AFlex"),
          ASpace: createPassThroughStub("ASpace"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          TaskToolCallGroup: defineComponent({
            name: "TaskToolCallGroup",
            props: { toolCalls: { type: Array, default: () => [] } },
            template: '<div class="tool-call-group-stub">{{ toolCalls.length }}</div>',
          }),
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("并行");
    expect(wrapper.text()).toContain("待采纳");
    expect(wrapper.text()).toContain("执行");
    expect(wrapper.text()).toContain("先做并行比较");
    expect(wrapper.text()).toContain("展开审计详情");

    const expandAuditButton = wrapper.findAll("button").find((node) => node.text().includes("展开审计详情"));
    expect(expandAuditButton).toBeTruthy();
    await expandAuditButton?.trigger("click");

    expect(wrapper.text()).toContain("候选 A 回复");
    expect(wrapper.text()).toContain("候选 B 回复");
    expect(wrapper.text()).toContain("Judge 推荐");
    expect(wrapper.text()).toContain("已采纳");

    const adoptButton = wrapper.findAll("button").find((node) => node.text().includes("采纳为回复"));
    expect(adoptButton).toBeTruthy();
    await adoptButton?.trigger("click");

    expect(wrapper.emitted("adoptCandidate")).toEqual([[0]]);
  });

  it("renders original user input directly inside phase blocks", async () => {
    const wrapper = mount(TaskDetailPhaseBlockList, {
      props: {
        defaultAssistantModel: "gpt-5.4",
        blocks: [
          {
            key: "phase-block:phase-user-final-sent",
            phaseId: "phase-user-final-sent",
            phaseIndex: 1,
            phaseKind: "sequential_chain",
            triggerType: "execute",
            status: "running",
            createdAt: "2026-04-16T10:00:00.000Z",
            items: [
              {
                key: "user-final-sent-1",
                role: "user",
                text: "简短输入",
                userInputText: "简短输入",
                finalSentText: "简短输入\n补充上下文",
                toolCalls: [],
                createdAt: "2026-04-16T10:00:01.000Z",
                raw: null,
                isStreaming: false,
              },
            ],
          },
        ],
      },
      global: {
        stubs: {
          AAlert: createPassThroughStub("AAlert"),
          AButton: ButtonStub,
          AFlex: createPassThroughStub("AFlex"),
          ASpace: createPassThroughStub("ASpace"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          TaskToolCallGroup: defineComponent({
            name: "TaskToolCallGroup",
            props: { toolCalls: { type: Array, default: () => [] } },
            template: '<div class="tool-call-group-stub">{{ toolCalls.length }}</div>',
          }),
        },
      },
    });

    await flushPromises();

    expect(wrapper.find(".task-detail-phase-card__plain").text()).toBe("简短输入");
    expect(wrapper.text()).not.toContain("补充上下文");
    expect(wrapper.text()).not.toContain("查看完整发送内容");
    expect(wrapper.text()).not.toContain("收起完整发送内容");
  });

  it("renders the original task instead of the pre-execution review wrapper in phase blocks", async () => {
    const fullPrompt = [
      "Execution context:",
      "- task: task-1",
      "",
      "请只完成当前阶段的目标。",
      "",
      "Pre-execution assessment from the configured review agent:",
      "",
      "先梳理需求，再决定是否进入编码。",
      "",
      "Original task:",
      "",
      "/start-work 请先梳理需求和边界条件，再实现功能代码。",
    ].join("\n");
    const processedUserInput = [
      "Pre-execution assessment from the configured review agent:",
      "",
      "先梳理需求，再决定是否进入编码。",
      "",
      "Original task:",
      "",
      "/start-work 请先梳理需求和边界条件，再实现功能代码。",
    ].join("\n");
    const items = normalizeSessionConversationItems([
      {
        id: "user-review-wrapped-1",
        role: "user",
        text: fullPrompt,
        textContent: fullPrompt,
        summaryText: fullPrompt,
        userInputText: processedUserInput,
        finalSentText: processedUserInput,
        createdAt: "2026-04-19T09:18:16.353Z",
        info: {
          id: "user-review-wrapped-1",
          role: "user",
          time: {
            created: "2026-04-19T09:18:16.353Z",
            completed: "2026-04-19T09:18:16.353Z",
          },
        },
        parts: [{ type: "text", text: fullPrompt }],
      },
    ]);

    const wrapper = mount(TaskDetailPhaseBlockList, {
      props: {
        defaultAssistantModel: "gpt-5.4",
        blocks: [
          {
            key: "phase-block:phase-review-wrapped",
            phaseId: "phase-review-wrapped",
            phaseIndex: 1,
            phaseKind: "sequential_chain",
            triggerType: "execute",
            status: "completed",
            createdAt: "2026-04-19T09:18:16.353Z",
            items,
          },
        ],
      },
      global: {
        stubs: {
          AAlert: createPassThroughStub("AAlert"),
          AButton: ButtonStub,
          AFlex: createPassThroughStub("AFlex"),
          ASpace: createPassThroughStub("ASpace"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          TaskToolCallGroup: defineComponent({
            name: "TaskToolCallGroup",
            props: { toolCalls: { type: Array, default: () => [] } },
            template: '<div class="tool-call-group-stub">{{ toolCalls.length }}</div>',
          }),
        },
      },
    });

    await flushPromises();

    expect(wrapper.find(".task-detail-phase-card__plain").text()).toBe(
      "/start-work 请先梳理需求和边界条件，再实现功能代码。",
    );
    expect(wrapper.text()).not.toContain(
      "Pre-execution assessment from the configured review agent:",
    );
  });

  it("renders workflow context details inside a collapsible workflow card", async () => {
    const wrapper = mount(TaskDetailPhaseBlockList, {
      props: {
        defaultAssistantModel: "gpt-5.4",
        blocks: [
          {
            key: "phase-block:phase-workflow-card",
            phaseId: "phase-workflow-card",
            phaseIndex: 1,
            phaseKind: "sequential_chain",
            triggerType: "execute",
            status: "completed",
            createdAt: "2026-04-19T09:18:16.353Z",
            items: [
              {
                key: "workflow-card-1",
                role: "workflow",
                createdAt: "2026-04-19T09:18:16.353Z",
                variant: "context",
                label: "工作流消息",
                hint: "当前阶段与执行上下文",
                toolCalls: [],
                raw: null,
                steps: [
                  {
                    agentName: "当前工作流",
                    sessionId: "session-1",
                    items: [
                      {
                        key: "workflow-message-1",
                        role: "workflow",
                        text: "- task: task-1\n\nPre-execution assessment from the configured review agent:\n\n先梳理需求，再决定是否进入编码。",
                        toolCalls: [],
                        createdAt: "2026-04-19T09:18:16.353Z",
                        raw: null,
                      },
                    ],
                  },
                ],
              } as any,
            ],
          },
        ],
      },
      global: {
        stubs: {
          AAlert: createPassThroughStub("AAlert"),
          AButton: ButtonStub,
          AFlex: createPassThroughStub("AFlex"),
          ASpace: createPassThroughStub("ASpace"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          TaskToolCallGroup: defineComponent({
            name: "TaskToolCallGroup",
            props: { toolCalls: { type: Array, default: () => [] } },
            template: '<div class="tool-call-group-stub">{{ toolCalls.length }}</div>',
          }),
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("工作流消息");
    expect(wrapper.text()).toContain("Pre-execution assessment from the configured review agent:");
    expect(wrapper.text()).toContain("先梳理需求，再决定是否进入编码。");

    const toggleButton = wrapper.findAll("button").find((node) => node.text().includes("收起"));
    expect(toggleButton).toBeTruthy();
    await toggleButton?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("展开详情");
    expect(wrapper.text()).not.toContain("先梳理需求，再决定是否进入编码。");
  });

  it("renders workflow context collapsed under the preceding user input", async () => {
    const wrapper = mount(TaskDetailPhaseBlockList, {
      props: {
        defaultAssistantModel: "gpt-5.4",
        blocks: [
          {
            key: "phase-block:phase-user-workflow-inline",
            phaseId: "phase-user-workflow-inline",
            phaseIndex: 1,
            phaseKind: "sequential_chain",
            triggerType: "execute",
            status: "completed",
            createdAt: "2026-04-19T09:18:16.353Z",
            items: [
              {
                key: "user-inline-1",
                role: "user",
                text: "/start-work 请先梳理需求和边界条件，再实现功能代码。",
                userInputText: "/start-work 请先梳理需求和边界条件，再实现功能代码。",
                toolCalls: [],
                createdAt: "2026-04-19T09:18:16.353Z",
                raw: null,
              },
              {
                key: "workflow-inline-1",
                role: "workflow",
                createdAt: "2026-04-19T09:18:17.353Z",
                variant: "context",
                label: "工作流消息",
                hint: "当前阶段与执行上下文",
                toolCalls: [],
                raw: null,
                steps: [
                  {
                    agentName: "当前工作流",
                    sessionId: "session-inline-1",
                    items: [
                      {
                        key: "workflow-inline-message-1",
                        role: "workflow",
                        text: "Pre-execution assessment from the configured review agent:\n\n先梳理需求，再决定是否进入编码。",
                        toolCalls: [],
                        createdAt: "2026-04-19T09:18:17.353Z",
                        raw: null,
                      },
                    ],
                  },
                ],
              } as any,
              {
                key: "assistant-inline-1",
                role: "assistant",
                text: "先给出边界条件和实现方案。",
                toolCalls: [],
                createdAt: "2026-04-19T09:18:18.353Z",
                raw: null,
              },
            ],
          },
        ],
      },
      global: {
        stubs: {
          AAlert: createPassThroughStub("AAlert"),
          AButton: ButtonStub,
          AFlex: createPassThroughStub("AFlex"),
          ASpace: createPassThroughStub("ASpace"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          TaskToolCallGroup: defineComponent({
            name: "TaskToolCallGroup",
            props: { toolCalls: { type: Array, default: () => [] } },
            template: '<div class="tool-call-group-stub">{{ toolCalls.length }}</div>',
          }),
        },
      },
    });

    await flushPromises();

    const cards = wrapper.findAll("article.task-detail-phase-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.text()).toContain("/start-work 请先梳理需求和边界条件，再实现功能代码。");
    expect(cards[0]?.text()).toContain("工作流消息");
    expect(cards[0]?.text()).toContain("Pre-execution assessment from the configured review agent:");
    expect(cards[1]?.text()).toContain("先给出边界条件和实现方案。");
  });

  it("keeps thinking-only assistant content inside the thinking collapse", async () => {
    const wrapper = mount(TaskDetailPhaseBlockList, {
      props: {
        defaultAssistantModel: "gpt-5.4",
        blocks: [
          {
            key: "phase-block:phase-thinking-only",
            phaseId: "phase-thinking-only",
            phaseIndex: 1,
            phaseKind: "sequential_chain",
            triggerType: "execute",
            status: "running",
            createdAt: "2026-04-19T09:18:16.353Z",
            items: [
              {
                key: "assistant-thinking-only-1",
                role: "assistant",
                text: undefined,
                thinkingText: "先分析现有状态，再决定下一步。",
                toolCalls: [],
                createdAt: "2026-04-19T09:18:17.353Z",
                raw: null,
                isStreaming: true,
              },
            ],
          },
        ],
      },
      global: {
        stubs: {
          AAlert: createPassThroughStub("AAlert"),
          AButton: ButtonStub,
          AFlex: createPassThroughStub("AFlex"),
          ASpace: createPassThroughStub("ASpace"),
          ATag: createPassThroughStub("ATag"),
          ATypographyText: createPassThroughStub("ATypographyText"),
          TaskToolCallGroup: defineComponent({
            name: "TaskToolCallGroup",
            props: { toolCalls: { type: Array, default: () => [] } },
            template: '<div class="tool-call-group-stub">{{ toolCalls.length }}</div>',
          }),
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("查看思考过程");
    expect(wrapper.text()).not.toContain("暂无文本内容");

    const thinkingToggle = wrapper.findAll("button").find((node) => node.text().includes("查看思考过程"));
    expect(thinkingToggle).toBeTruthy();
    await thinkingToggle?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("先分析现有状态，再决定下一步。");
  });
});
