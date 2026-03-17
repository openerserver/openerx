import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getOrchestrationStrategy: vi.fn(),
  updateOrchestrationStrategy: vi.fn(),
  getProject: vi.fn(),
  getProjectOrchestrationView: vi.fn(),
  getProjectBossOperationsView: vi.fn(),
  getProjectWorkflowTemplateView: vi.fn(),
  listWorkflowTemplateStages: vi.fn(),
  updateProjectWorkflowTemplateBinding: vi.fn(),
  updateProject: vi.fn(),
  getTask: vi.fn(),
  getTaskOperatingState: vi.fn(),
  getTaskOperatingMode: vi.fn(),
  updateTaskOperatingMode: vi.fn(),
  deleteTaskOperatingMode: vi.fn(),
  getTaskBossDecisions: vi.fn(),
  getTaskEscalations: vi.fn(),
  getTaskWorkflowView: vi.fn(),
  toApiError: vi.fn((error: unknown) => (error instanceof Error ? error : null)),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const authStoreState = vi.hoisted(() => ({
  user: {
    role: "org_admin",
    projects: [{ id: "proj-default", role: "project_admin" }],
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
  RouterLink: {
    name: "RouterLink",
    props: ["to"],
    template: '<a :href="typeof to === \'string\' ? to : \'#\'"><slot /></a>',
  },
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("../../control-plane/web-ui/src/stores/auth", () => ({
  useAuthStore: () => authStoreState,
}));

vi.mock("../../control-plane/web-ui/src/components/ProjectSectionNav.vue", () => ({
  default: {
    name: "ProjectSectionNav",
    template: '<div data-testid="project-section-nav">项目导航</div>',
  },
}));

vi.mock("ant-design-vue", () => ({
  message: messageMocks,
}));

describe("Operating mode pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads organization operating settings and saves merged strategy", async () => {
    routeState.params = {};
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        categoryAgentMap: {},
        categoryModelMap: {},
        enablePipeline: true,
        hooks: [],
        templates: [],
        judge: {
          enabled: false,
          agent: "",
          model: "",
          promptTemplate: "",
          timeoutMs: 30000,
          selectionStrategy: "judge-pick",
        },
        organizationSettings: {
          defaultCollaborationMode: "solo",
          defaultAutopilotLevel: "L1",
          defaultBossParticipationMode: "advisory",
          allowProjectModeOverride: true,
          allowTaskModeOverride: true,
          requireHumanApprovalForL2: true,
          hybridEscalationRules: [],
          recommendedProfiles: [],
        },
      },
    });

    const { default: Page } = await import("../../control-plane/web-ui/src/pages/OrganizationOperatingSettings.vue");
    const wrapper = mount(Page, {
      global: {
        stubs: {
          MermaidRenderer: true,
          RouterLink: true,
          "router-link": true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("组织运行策略");

    const saveButton = wrapper.findAll("button").find((item) => item.text().includes("保存组织运行策略"));
    await saveButton?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateOrchestrationStrategy).toHaveBeenCalledTimes(1);
  }, 10000);

  it("loads project operating mode and saves project settings", async () => {
    routeState.params = { projectId: "proj-default" };
    apiMocks.getProject.mockResolvedValueOnce({
      id: "proj-default",
      orgId: "org-1",
      name: "Default Project",
      slug: "default-project",
      settings: {
        collaborationMode: "team",
        autopilotLevel: "L1",
        bossParticipationMode: "advisory",
      },
    });
    apiMocks.getProjectOrchestrationView.mockResolvedValueOnce({
      project: { id: "proj-default", name: "Default Project", slug: "default-project" },
      workflowTemplateId: "tpl-1",
      currentTemplate: { id: "tpl-1", name: "Template 1" },
      selectableTemplates: [],
      access: { canManage: true },
      roleCapabilities: [],
      scenarios: { current: { source: "current", template: null, stages: [] }, candidate: null },
    });
    apiMocks.updateProject.mockResolvedValueOnce({
      id: "proj-default",
      orgId: "org-1",
      name: "Default Project",
      slug: "default-project",
      settings: {
        collaborationMode: "team",
        autopilotLevel: "L1",
        bossParticipationMode: "advisory",
      },
    });

    const { default: Page } = await import("../../control-plane/web-ui/src/pages/ProjectOperatingMode.vue");
    const wrapper = mount(Page);
    await flushPromises();

    expect(wrapper.text()).toContain("运行档位");

    const saveButton = wrapper.findAll("button").find((item) => item.text().includes("保存项目档位"));
    await saveButton?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateProject).toHaveBeenCalledWith(
      "proj-default",
      expect.objectContaining({ settings: expect.any(Object) }),
    );
  });

  it("loads task operating console and shows parsed boss decisions", async () => {
    routeState.params = { taskId: "task-1" };
    apiMocks.getTask.mockResolvedValueOnce({
      id: "task-1",
      projectId: "proj-default",
      userId: "user-1",
      title: "Task 1",
      prompt: "Do something",
      status: "running",
      createdAt: "2026-03-15T09:00:00.000Z",
    });
    apiMocks.getTaskOperatingState.mockResolvedValueOnce({
      collaborationMode: "team",
      autopilotLevel: "L1",
      bossParticipationMode: "advisory",
      operatingModeSource: "project-default",
      currentStageKey: "implementation",
      currentStageStatus: "running",
    });
    apiMocks.getTaskBossDecisions.mockResolvedValueOnce({
      data: [
        {
          id: "d1",
          ts: "2026-03-15T10:00:00.000Z",
          decisionType: "select-template",
          reason: "老板在阶段 verify 升级后根据阶段策略，自动切换到模板 tpl-approval。",
          metadata: {
            source: "stage-policy",
            trigger: "stage-waiting-approval",
            selectedTemplateId: "tpl-approval",
            stagePolicyNote: "高风险阶段进入审批模板。",
            governanceReason: "Need approval",
          },
        },
      ],
    });
    apiMocks.getTaskEscalations.mockResolvedValueOnce({
      data: [
        {
          id: "e1",
          ts: "2026-03-15T11:00:00.000Z",
          reason: "Need approval",
          status: "pending",
        },
      ],
    });
    apiMocks.getTaskWorkflowView.mockResolvedValueOnce({
      taskId: "task-1",
      workflow: { templateId: "tpl-1", currentStage: "implementation", status: "running", stages: [] },
      roleConclusions: [],
      developerChangeRequests: [],
    });

    const { default: Page } = await import("../../control-plane/web-ui/src/pages/TaskOperatingConsole.vue");
    const wrapper = mount(Page);
    await flushPromises();

    expect(wrapper.text()).toContain("Task 1 / 组织运行详情");
    expect(wrapper.text()).toContain("老板在阶段 verify 升级后根据阶段策略，自动切换到模板 tpl-approval。");
    expect(wrapper.text()).toContain("阶段策略命中");
    expect(wrapper.text()).toContain("升级后二次治理");
    expect(wrapper.text()).toContain("模板 tpl-approval");
    expect(wrapper.text()).toContain("阶段策略：高风险阶段进入审批模板。 · 治理触发：Need approval");
    expect(wrapper.text()).toContain("Need approval");
  });

  it("loads task operating override and saves task-specific mode", async () => {
    routeState.params = { taskId: "task-1" };
    apiMocks.getTask.mockResolvedValueOnce({
      id: "task-1",
      projectId: "proj-default",
      userId: "user-1",
      title: "Task 1",
      prompt: "Do something",
      status: "running",
      createdAt: "2026-03-15T09:00:00.000Z",
    });
    apiMocks.getTaskOperatingState.mockResolvedValueOnce({
      collaborationMode: "team",
      autopilotLevel: "L1",
      bossParticipationMode: "advisory",
      operatingModeSource: "project-default",
    });
    apiMocks.getTaskOperatingMode.mockResolvedValueOnce({ data: null });
    apiMocks.updateTaskOperatingMode.mockResolvedValueOnce({
      ok: true,
      data: {
        collaborationMode: "team",
        autopilotLevel: "L1",
        bossParticipationMode: "advisory",
        selectedTemplateId: null,
        source: "task-override",
      },
    });
    apiMocks.getTask.mockResolvedValueOnce({
      id: "task-1",
      projectId: "proj-default",
      userId: "user-1",
      title: "Task 1",
      prompt: "Do something",
      status: "running",
      createdAt: "2026-03-15T09:00:00.000Z",
    });
    apiMocks.getTaskOperatingState.mockResolvedValueOnce({
      collaborationMode: "team",
      autopilotLevel: "L1",
      bossParticipationMode: "advisory",
      operatingModeSource: "task-override",
    });
    apiMocks.getTaskOperatingMode.mockResolvedValueOnce({
      data: {
        collaborationMode: "team",
        autopilotLevel: "L1",
        bossParticipationMode: "advisory",
        selectedTemplateId: null,
        source: "task-override",
      },
    });

    const { default: Page } = await import("../../control-plane/web-ui/src/pages/TaskOperatingOverride.vue");
    const wrapper = mount(Page);
    await flushPromises();

    const saveButton = wrapper.findAll("button").find((item) => item.text().includes("保存任务级覆盖"));
    await saveButton?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateTaskOperatingMode).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ source: "task-override" }),
    );
  });

  it("loads scenario recommendation launcher and routes back to tasks", async () => {
    routeState.params = { projectId: "proj-default" };
    apiMocks.getProject.mockResolvedValueOnce({
      id: "proj-default",
      orgId: "org-1",
      name: "Default Project",
      slug: "default-project",
      settings: {
        collaborationMode: "team",
        autopilotLevel: "L1",
        bossParticipationMode: "advisory",
      },
    });
    apiMocks.getOrchestrationStrategy.mockResolvedValueOnce({
      data: {
        organizationSettings: {
          recommendedProfiles: [
            {
              scenarioKey: "release-guard",
              collaborationMode: "team",
              autopilotLevel: "L1",
              bossParticipationMode: "advisory",
              templateHints: ["tpl-release"],
              requiredRoleHints: ["reviewer"],
              reason: "Release window",
            },
          ],
        },
      },
    });

    const { default: Page } = await import("../../control-plane/web-ui/src/pages/RecommendedScenarios.vue");
    const wrapper = mount(Page);
    await flushPromises();

    expect(wrapper.find('[data-testid="project-section-nav"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("任务创建前，从平台推荐场景中选择一组运行模式，并直接带入任务创建器");
    expect(wrapper.text()).toContain("项目运行档位");

    const actionButton = wrapper.findAll("button").find((item) => item.text().includes("带入新建任务"));
    await actionButton?.trigger("click");

    expect(routerState.push).toHaveBeenCalledWith({
      path: "/tasks",
      query: {
        projectId: "proj-default",
        scenarioKey: "release-guard",
        openCreate: "1",
      },
    });
  });

  it("loads boss operations center and shows timeline plus attention tasks", async () => {
    routeState.params = { projectId: "proj-default" };
    apiMocks.getProjectBossOperationsView.mockResolvedValueOnce({
      project: { id: "proj-default", name: "Default Project", slug: "default-project" },
      summary: {
        totalTasks: 2,
        tasksWithBossDecisions: 2,
        totalBossDecisions: 2,
        openEscalations: 1,
        blockedTasks: 1,
        waitingApprovalTasks: 1,
        tasksNeedingAttention: 2,
        manualOverrides: 1,
      },
      timeline: [
        {
          id: "decision-select-template-1",
          ts: "2026-03-16T09:58:00.000Z",
          decisionType: "select-template",
          reason: "老板在阶段 release 升级后根据阶段策略，自动切换到模板 tpl-release。",
          metadata: {
            source: "stage-policy",
            trigger: "stage-waiting-approval",
            selectedTemplateId: "tpl-release",
            stagePolicyNote: "高风险发布阶段统一切到发布审批模板。",
            governanceReason: "Release approval pending",
          },
          taskId: "task-1",
          taskTitle: "Release candidate",
          taskStatus: "running",
          workflowStatus: "waiting-approval",
          currentStageKey: "release",
          openEscalationCount: 1,
        },
        {
          id: "decision-1",
          ts: "2026-03-16T10:00:00.000Z",
          decisionType: "request-approval",
          reason: "Need release approval",
          taskId: "task-1",
          taskTitle: "Release candidate",
          taskStatus: "running",
          workflowStatus: "waiting-approval",
          currentStageKey: "release",
          openEscalationCount: 1,
        },
      ],
      overrideHistory: [
        {
          id: "decision-override-1",
          ts: "2026-03-16T10:06:00.000Z",
          decisionType: "manual-override",
          reason: "人工覆盖任务运行档位：solo / L1 / advisory -> team / L2 / advisory / tpl-release",
          taskId: "task-1",
          taskTitle: "Release candidate",
          taskStatus: "running",
          workflowStatus: "waiting-approval",
          currentStageKey: "release",
          actorId: "user-1",
          overrideAction: "manual-override",
          previousMode: {
            collaborationMode: "solo",
            autopilotLevel: "L1",
            bossParticipationMode: "advisory",
            selectedTemplateId: null,
            source: "project-default",
          },
          nextMode: {
            collaborationMode: "team",
            autopilotLevel: "L2",
            bossParticipationMode: "advisory",
            selectedTemplateId: "tpl-release",
            source: "task-override",
          },
        },
      ],
      escalations: [
        {
          id: "esc-1",
          ts: "2026-03-16T10:05:00.000Z",
          reason: "Release approval pending",
          status: "open",
          taskId: "task-1",
          taskTitle: "Release candidate",
          taskStatus: "running",
          workflowStatus: "waiting-approval",
          currentStageKey: "release",
        },
      ],
      attentionTasks: [
        {
          taskId: "task-1",
          taskTitle: "Release candidate",
          taskStatus: "running",
          workflowStatus: "waiting-approval",
          currentStageKey: "release",
          currentStageLabel: "发布执行",
          currentStageStatus: "waiting-approval",
          openEscalationCount: 1,
          bossDecisionCount: 1,
          latestDecisionType: "request-approval",
          latestDecisionReason: "Need release approval",
          latestDecisionTs: "2026-03-16T10:00:00.000Z",
        },
      ],
    });

    const { default: Page } = await import("../../control-plane/web-ui/src/pages/BossOperationsCenter.vue");
    const wrapper = mount(Page);
    await flushPromises();

    expect(wrapper.text()).toContain("Default Project / 老板经营视图");
    expect(wrapper.text()).toContain("Need release approval");
    expect(wrapper.text()).toContain("Release candidate");
    expect(wrapper.text()).toContain("人工覆盖历史");
    expect(wrapper.text()).toContain("user-1");
    expect(wrapper.text()).toContain("阶段策略命中");
    expect(wrapper.text()).toContain("升级后二次治理");
    expect(wrapper.text()).toContain("模板 tpl-release");
    expect(wrapper.text()).toContain("阶段策略：高风险发布阶段统一切到发布审批模板。 · 治理触发：Release approval pending");
  });

  it("loads project workflow template page with governance settings", async () => {
    routeState.params = { projectId: "proj-default" };
    apiMocks.getProjectWorkflowTemplateView.mockResolvedValueOnce({
      project: { id: "proj-default", name: "Default Project", slug: "default-project" },
      currentTemplate: {
        id: "tpl-1",
        name: "默认交付模板",
        description: "标准交付模板",
        category: "delivery",
        enabled: true,
        selectableByProjects: true,
        defaultCollaborationMode: "team",
        defaultAutopilotLevel: "L1",
        defaultBossParticipationMode: "advisory",
        forceBossParticipation: false,
        stageOrderJson: ["clarify", "implement", "release"],
        defaultRolesJson: ["role.product", "role.developer"],
        version: 1,
        createdAt: "2026-03-16T08:00:00.000Z",
        updatedAt: "2026-03-16T08:00:00.000Z",
      },
      workflowTemplateId: "tpl-1",
      currentTemplateSource: "bound",
      stages: [
        {
          id: "stage-1",
          templateId: "tpl-1",
          stageKey: "clarify",
          name: "需求澄清",
          enabled: true,
          mode: "single",
          primaryRoleAgentId: "role.product",
          participantRoleAgentIdsJson: [],
          orderIndex: 0,
        },
      ],
      selectableTemplates: [
        {
          id: "tpl-1",
          name: "默认交付模板",
          description: "标准交付模板",
          category: "delivery",
          enabled: true,
          selectableByProjects: true,
          defaultCollaborationMode: "team",
          defaultAutopilotLevel: "L1",
          defaultBossParticipationMode: "advisory",
          forceBossParticipation: false,
          stageOrderJson: ["clarify", "implement", "release"],
          defaultRolesJson: ["role.product", "role.developer"],
          version: 1,
          createdAt: "2026-03-16T08:00:00.000Z",
          updatedAt: "2026-03-16T08:00:00.000Z",
        },
      ],
      projectSettings: {
        preferredTemplateId: "tpl-1",
        allowBossAutoTemplateSwitch: true,
      },
      currentTemplatePolicy: {
        defaultCollaborationMode: "team",
        defaultAutopilotLevel: "L1",
        defaultBossParticipationMode: "advisory",
        forceBossParticipation: false,
      },
      stageCatalog: [
        { key: "clarify", label: "需求澄清", description: "澄清需求" },
      ],
      access: {
        canManage: true,
        message: null,
      },
    });

    const { default: Page } = await import("../../control-plane/web-ui/src/pages/ProjectWorkflowTemplate.vue");
    const wrapper = mount(Page, {
      global: {
        stubs: {
          RouterLink: true,
          "router-link": true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("老板自动切模板");
    expect(wrapper.text()).toContain("模板级组织策略");
    expect(wrapper.text()).toContain("team");
  });
});