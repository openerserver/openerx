import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import TaskDetailPhaseBlockList from "../../control-plane/web-ui/src/components/task-detail-v3/TaskDetailPhaseBlockList.vue";

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

    expect(wrapper.text()).toContain("阶段 1");
    expect(wrapper.text()).toContain("并行");
    expect(wrapper.text()).toContain("先做并行比较");
    expect(wrapper.text()).toContain("候选 A 回复");
    expect(wrapper.text()).toContain("候选 B 回复");
    expect(wrapper.text()).toContain("Judge 推荐");
    expect(wrapper.text()).toContain("已采纳");

    const adoptButton = wrapper.findAll("button").find((node) => node.text().includes("采纳为回复"));
    expect(adoptButton).toBeTruthy();
    await adoptButton?.trigger("click");

    expect(wrapper.emitted("adoptCandidate")).toEqual([[0]]);
  });
});