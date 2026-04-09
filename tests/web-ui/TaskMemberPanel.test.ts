import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { TaskMemberViewModel } from "../../control-plane/web-ui/src/lib/api";

vi.mock("ant-design-vue", () => ({
  ASpace: { template: "<div><slot /></div>" },
  ATag: { template: "<span><slot /></span>" },
}));

const view: TaskMemberViewModel = {
  taskId: "task-1",
  projectId: "proj-1",
  workflowStatus: "running",
  currentStageKey: "implement",
  currentStageLabel: "实现开发",
  summary: {
    managerCount: 1,
    userCount: 1,
    agentCount: 1,
    activeAgentCount: 1,
  },
  members: [
    {
      id: "manager-1",
      kind: "manager",
      displayName: "项目管理员",
      handle: "manager",
      identitySource: "human",
      intentSource: "original",
      responsibilityLabels: ["治理 / 授权 / 审批"],
      stageLabels: [],
      statusLabel: "已加入任务",
      statusTone: "default",
      summary: "负责管理介入、授权边界和最终责任兜底。",
      capabilityBadges: ["管理者成员"],
      runCount: 0,
      latestActivityAt: "2026-03-22T00:00:00.000Z",
    },
    {
      id: "agent-1",
      kind: "agent",
      displayName: "开发 Agent Alpha",
      handle: "oracle-enterprise",
      identitySource: "agent",
      intentSource: "derived",
      responsibilityLabels: ["开发 Agent"],
      stageLabels: ["实现开发"],
      statusLabel: "执行中",
      statusTone: "processing",
      summary: "负责 开发 Agent，关联 实现开发。",
      capabilityBadges: ["code", "review"],
      runCount: 2,
      latestActivityAt: "2026-03-22T01:00:00.000Z",
    },
  ],
};

describe("TaskMemberPanel", () => {
  it("renders expanded by default and lets the user collapse and expand the body", async () => {
    const { default: Panel } = await import(
      "../../control-plane/web-ui/src/components/task-detail/TaskMemberPanel.vue"
    );

    const wrapper = mount(Panel, {
      props: {
        view,
      },
    });

    expect(wrapper.find('[data-testid="task-member-panel-body"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("管理者成员");
    expect(wrapper.text()).toContain("开发 Agent Alpha");
    expect(wrapper.get('[data-testid="task-member-panel-toggle"]').text()).toBe("收起");

    await wrapper.get('[data-testid="task-member-panel-toggle"]').trigger("click");
    await nextTick();

    expect(wrapper.find('[data-testid="task-member-panel-body"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("开发 Agent Alpha");
    expect(wrapper.get('[data-testid="task-member-panel-toggle"]').text()).toBe("展开");

    await wrapper.get('[data-testid="task-member-panel-toggle"]').trigger("click");
    await nextTick();

    expect(wrapper.find('[data-testid="task-member-panel-body"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("开发 Agent Alpha");
  });
});