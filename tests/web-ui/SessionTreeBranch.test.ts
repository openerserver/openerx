import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SessionTreeBranch from "../../control-plane/web-ui/src/components/SessionTreeBranch.vue";

describe("SessionTreeBranch", () => {
  it("renders parallel candidates as explicit parallel nodes instead of forks", () => {
    const wrapper = mount(SessionTreeBranch, {
      props: {
        node: {
          id: "branch-node:task-1:ses-candidate",
          branchNodeId: "branch-node:task-1:ses-candidate",
          runtimeSessionId: "ses-candidate",
          taskSessionId: "task-session:task-1:ses-candidate",
          parentRuntimeSessionId: "ses-root",
          parentTaskSessionId: "task-session:task-1:ses-root",
          forkedFromMessageId: null,
          forkedFromMessageRole: null,
          forkedFromMessagePreview: null,
          firstPromptAfterFork: null,
          branchName: "候选 A",
          sourceType: "parallel",
          isActive: false,
          title: "候选 A",
          summary: null,
          createdAt: "2026-04-08T14:00:01.000Z",
          updatedAt: "2026-04-08T14:00:11.000Z",
          children: [],
        },
        depth: 1,
        branchPath: "1",
        parentTitle: "主分支",
        parentSessionId: "ses-root",
        parentBranchLabel: "主线",
      },
      global: {
        stubs: {
          ATag: { template: "<span><slot /></span>" },
          ATooltip: { template: "<span><slot /></span>" },
          AButton: { template: "<button><slot /></button>" },
        },
      },
    });

    expect(wrapper.text()).toContain("并行候选");
    expect(wrapper.text()).toContain("并行来源");
    expect(wrapper.text()).toContain("与 主线（ses-root） 并行执行");
    expect(wrapper.text()).not.toContain("分叉节点");
    expect(wrapper.text()).not.toContain("分叉来源");
  });
});