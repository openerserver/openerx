import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { useProjectStore } from "../../control-plane/web-ui/src/stores/project";
import { useTaskMonitorStore } from "../../control-plane/web-ui/src/stores/task-monitor";

const VUE_FLOW_EMITS = [
  "pane-ready",
  "node-drag-start",
  "node-drag",
  "node-drag-stop",
  "viewport-change",
  "viewport-change-end",
] as const;

type VueFlowEmitName = (typeof VUE_FLOW_EMITS)[number];
const VUE_FLOW_EMIT_OPTIONS = Object.fromEntries(VUE_FLOW_EMITS.map((eventName) => [eventName, (_payload?: unknown) => true]));

const apiMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  getTaskSessions: vi.fn(),
  getSessionMessages: vi.fn(),
  getTaskPipeline: vi.fn(),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
}));

const realtimeSubscribeTask = vi.fn();

const useRealtimeStoreMock = defineStore("realtime", {
  state: () => ({
    events: [] as Array<Record<string, unknown>>,
  }),
  actions: {
    subscribeTask(taskId: string) {
      realtimeSubscribeTask(taskId);
    },
  },
});

function prependRealtimeEvent(
  realtimeStore: ReturnType<typeof useRealtimeStoreMock>,
  event: Record<string, unknown>,
) {
  realtimeStore.events = [event, ...realtimeStore.events];
}

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: useRealtimeStoreMock,
}));

const VueFlowStub: any = {
  name: "VueFlow",
  inheritAttrs: false,
  props: {
    nodes: { type: Array, default: () => [] },
    edges: { type: Array, default: () => [] },
    defaultViewport: { type: Object, default: undefined },
    minZoom: { type: Number, default: undefined },
    maxZoom: { type: Number, default: undefined },
    nodesDraggable: { type: Boolean, default: undefined },
    elementsSelectable: { type: Boolean, default: undefined },
    fitViewOnInit: { type: Boolean, default: undefined },
  },
  emits: VUE_FLOW_EMIT_OPTIONS,
  setup(props: Record<string, unknown>, { slots, emit, attrs, expose }: any) {
    expose({
      emitFromTest(eventName: VueFlowEmitName, payload?: unknown) {
        emit(eventName, payload);
      },
    });

    queueMicrotask(() => {
      emit("pane-ready", { setViewport: vi.fn() });
    });

    return () =>
      h("div", {
        ...attrs,
        class: ["vue-flow-stub", attrs.class],
        style: [attrs.style, { width: "1280px", height: "820px", position: "relative" }],
      },
        ((props.nodes as Array<Record<string, unknown>>) || []).map((node) => {
          const slotContent = slots[`node-${String(node.type)}`]?.({ data: node.data });
          const normalizedChildren = Array.isArray(slotContent)
            ? slotContent
            : slotContent
              ? [slotContent]
              : [];

          return h("div", { class: "vue-flow-node", "data-node-id": String(node.id) }, normalizedChildren);
        }),
      );
  },
};

vi.mock("@vue-flow/core", () => ({
  VueFlow: VueFlowStub,
}));

vi.mock("@vue-flow/background", () => ({
  Background: defineComponent({ name: "Background", setup() { return () => h("div", { class: "background-stub" }); } }),
}));

vi.mock("@vue-flow/controls", () => ({
  Controls: defineComponent({ name: "Controls", setup() { return () => h("div", { class: "controls-stub" }); } }),
}));

vi.mock("ant-design-vue", () => {
  const buttonLike = defineComponent({
    name: "AButton",
    inheritAttrs: false,
    props: ["type", "size", "danger", "loading"],
    emits: ["click"],
    setup(props, { slots, emit, attrs }) {
      return () => h("button", { ...attrs, type: "button", disabled: Boolean(props.loading), onClick: (event: Event) => emit("click", event) }, slots.default?.());
    },
  });

  const selectLike = defineComponent({
    name: "ASelect",
    inheritAttrs: false,
    props: ["value"],
    emits: ["update:value", "focus"],
    setup(props, { slots, emit, attrs }) {
      return () => h("select", {
        ...attrs,
        value: props.value == null ? "" : String(props.value),
        onFocus: () => emit("focus"),
        onChange: (event: Event) => emit("update:value", (event.target as HTMLSelectElement).value || undefined),
      }, slots.default?.());
    },
  });

  const optionLike = defineComponent({
    name: "ASelectOption",
    props: ["value"],
    setup(props, { slots }) {
      return () => h("option", { value: props.value == null ? "" : String(props.value) }, slots.default?.());
    },
  });

  const inputLike = defineComponent({
    name: "AInputSearch",
    inheritAttrs: false,
    props: ["value"],
    emits: ["update:value"],
    setup(props, { emit, attrs }) {
      return () => h("input", {
        ...attrs,
        value: String(props.value ?? ""),
        onInput: (event: Event) => emit("update:value", (event.target as HTMLInputElement).value),
      });
    },
  });

  const simple = (name: string, tag = "div") => defineComponent({
    name,
    inheritAttrs: false,
    props: ["description"],
    setup(props, { slots, attrs }) {
      return () => h(tag, attrs, slots.default ? slots.default() : props.description);
    },
  });

  return {
    AButton: buttonLike,
    ASelect: selectLike,
    ASelectOption: optionLike,
    AInputSearch: inputLike,
    AEmpty: simple("AEmpty", "section"),
  };
});

function buildPipelineStage(
  id: string,
  label: string,
  status: string,
  startedAt: string,
  finishedAt: string | null,
) {
  return {
    id,
    type: "execution",
    label,
    status,
    order: 1,
    sourceType: "session.message",
    sourceId: null,
    agent: null,
    model: null,
    sessionId: "session-1",
    startedAt,
    finishedAt,
    durationMs: finishedAt ? 60000 : null,
    output: null,
    error: null,
    tokens: null,
    graphNodeId: null,
    dependsOn: [],
  };
}

function buildPipeline(options: {
  taskId: string;
  status: string;
  updatedAt: string;
  stages: ReturnType<typeof buildPipelineStage>[];
  currentStageId?: string | null;
  totalStages?: number;
  completedStages?: number;
  failedStages?: number;
}) {
  return {
    taskId: options.taskId,
    sessionId: "session-1",
    branchName: "main",
    status: options.status,
    createdAt: "2026-03-14T08:01:00.000Z",
    updatedAt: options.updatedAt,
    stages: options.stages,
    summary: {
      totalStages: options.totalStages ?? options.stages.length,
      completedStages: options.completedStages ?? options.stages.filter((stage) => stage.status === "completed").length,
      failedStages: options.failedStages ?? options.stages.filter((stage) => stage.status === "failed").length,
      currentStageId: options.currentStageId ?? null,
      totalTokens: { input: 0, output: 0 },
      totalDurationMs: 60000,
      replanCount: 0,
    },
  };
}

async function mountPage() {
  const { default: MultiTaskMonitor } = await import("../../control-plane/web-ui/src/pages/MultiTaskMonitor.vue");
  const pinia = createPinia();
  setActivePinia(pinia);

  const projectStore = useProjectStore();
  projectStore.projects = [{ id: "proj-1", orgId: "org-1", name: "Default", slug: "default" }];
  projectStore.currentProjectId = "proj-1";

  const taskMonitorStore = useTaskMonitorStore();
  taskMonitorStore.resetCanvas();

  const realtimeStore = useRealtimeStoreMock();
  realtimeStore.events = [];

  const attachTarget = document.createElement("div");
  attachTarget.style.width = "1440px";
  attachTarget.style.height = "960px";
  document.body.appendChild(attachTarget);

  const wrapper = mount(MultiTaskMonitor, {
    attachTo: attachTarget,
    global: {
      plugins: [pinia],
      stubs: {
        RouterLink: defineComponent({
          name: "RouterLink",
          props: ["to"],
          setup(_props, { slots }) {
            return () => h("a", {}, slots.default?.());
          },
        }),
      },
    },
  });

  await flushPromises();
  return { wrapper, taskMonitorStore, realtimeStore };
}

function emitFlowEvent(
  flow: { vm: { $emit: (eventName: VueFlowEmitName, payload?: unknown) => void; $?: { vnode?: { props?: Record<string, unknown> } } } },
  eventName: VueFlowEmitName,
  payload?: unknown,
) {
  const handlerName = `on${eventName
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("")}`;
  const handler = flow.vm.$?.vnode?.props?.[handlerName];

  if (typeof handler === "function") {
    handler(payload);
    return;
  }

  if (Array.isArray(handler)) {
    for (const candidate of handler) {
      if (typeof candidate === "function") {
        candidate(payload);
      }
    }
    return;
  }

  flow.vm.$emit(eventName, payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  realtimeSubscribeTask.mockReset();
  apiMocks.listProjects.mockResolvedValue([{ id: "proj-1", orgId: "org-1", name: "Default", slug: "default" }]);
  apiMocks.listTasks.mockResolvedValue({
    data: [
      {
        id: "task-1",
        projectId: "proj-1",
        userId: "user-1",
        title: "修复登录流程",
        prompt: "修复生产登录故障",
        status: "running",
        createdAt: "2026-03-14T08:00:00.000Z",
        startedAt: "2026-03-14T08:02:00.000Z",
      },
      {
        id: "task-2",
        projectId: "proj-1",
        userId: "user-1",
        title: "处理构建异常",
        prompt: "分析构建失败原因",
        status: "failed",
        createdAt: "2026-03-14T07:00:00.000Z",
        finishedAt: "2026-03-14T07:10:00.000Z",
      },
    ],
  });
  apiMocks.getTask.mockImplementation(async (taskId: string) => {
    if (taskId === "task-1") {
      return {
        id: taskId,
        projectId: "proj-1",
        userId: "user-1",
        title: "修复登录流程",
        prompt: "修复生产登录故障",
        status: "running",
        createdAt: "2026-03-14T08:00:00.000Z",
        startedAt: "2026-03-14T08:02:00.000Z",
      };
    }

    if (taskId === "task-2") {
      return {
        id: taskId,
        projectId: "proj-1",
        userId: "user-1",
        title: "处理构建异常",
        prompt: "分析构建失败原因",
        status: "failed",
        createdAt: "2026-03-14T07:00:00.000Z",
        startedAt: "2026-03-14T07:02:00.000Z",
        finishedAt: "2026-03-14T08:20:00.000Z",
      };
    }

    if (taskId === "task-3") {
      return {
        id: taskId,
        projectId: "proj-1",
        userId: "user-1",
        title: "补回归测试",
        prompt: "补充自动化回归测试",
        status: "running",
        createdAt: "2026-03-14T08:20:00.000Z",
        startedAt: "2026-03-14T08:21:00.000Z",
      };
    }

    return {
      id: taskId,
      projectId: "proj-1",
      userId: "user-1",
      title: "稳定发布流程",
      prompt: "收敛发布流程中的不稳定步骤",
      status: "running",
      createdAt: "2026-03-14T08:20:00.000Z",
      startedAt: "2026-03-14T08:21:00.000Z",
    };
  });
  apiMocks.getTaskSessions.mockResolvedValue({
    data: [
      {
        id: "session-1",
        title: "主分支",
        isActive: true,
        summary: null,
        createdAt: "2026-03-14T08:01:00.000Z",
        updatedAt: "2026-03-14T08:08:00.000Z",
      },
    ],
  });
  apiMocks.getSessionMessages.mockResolvedValue({
    data: [
      {
        info: {
          id: "message-0",
          role: "user",
          time: {
            created: "2026-03-14T08:03:30.000Z",
          },
        },
        parts: [
          {
            type: "text",
            text: "修复生产登录故障",
          },
        ],
      },
      {
        info: {
          id: "message-1",
          role: "assistant",
          agent: "oracle-enterprise",
          time: {
            created: "2026-03-14T08:04:00.000Z",
            completed: "2026-03-14T08:04:20.000Z",
          },
        },
        parts: [
          {
            type: "text",
            text: "已定位到登录态丢失的根因。",
          },
        ],
      },
    ],
  });
  apiMocks.getTaskPipeline.mockImplementation(async (taskId: string) => {
    if (taskId !== "task-1") {
      return null;
    }

    return {
      taskId: "task-1",
      sessionId: "session-1",
      branchName: "main",
      status: "running",
      createdAt: "2026-03-14T08:01:00.000Z",
      updatedAt: "2026-03-14T08:08:00.000Z",
      stages: [
        {
          id: "stage-1",
          type: "execution",
          label: "检索日志",
          status: "completed",
          order: 1,
          sourceType: "session.message",
          sourceId: null,
          agent: null,
          model: null,
          sessionId: "session-1",
          startedAt: "2026-03-14T08:03:00.000Z",
          finishedAt: "2026-03-14T08:04:00.000Z",
          durationMs: 60000,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: null,
          dependsOn: [],
        },
        {
          id: "stage-2",
          type: "execution",
          label: "修复认证链路",
          status: "running",
          order: 2,
          sourceType: "session.message",
          sourceId: null,
          agent: null,
          model: null,
          sessionId: "session-1",
          startedAt: "2026-03-14T08:05:00.000Z",
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
          tokens: null,
          graphNodeId: null,
          dependsOn: [],
        },
      ],
      summary: {
        totalStages: 2,
        completedStages: 1,
        failedStages: 0,
        currentStageId: "stage-2",
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 60000,
        replanCount: 0,
      },
    };
  });
});

describe("MultiTaskMonitor", () => {
  it("automatically opens running tasks when the page loads", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    await flushPromises();

    expect(taskMonitorStore.nodes).toHaveLength(1);
    expect(taskMonitorStore.nodes[0]?.taskId).toBe("task-1");
    expect(wrapper.text()).toContain("修复登录流程");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).not.toContain("处理构建异常");
  });

  it("adds tasks onto the canvas and renders live assistant replies with summaries", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-1");
    await flushPromises();

    expect(taskMonitorStore.nodes).toHaveLength(1);
    expect(wrapper.text()).toContain("修复登录流程");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).toContain("实时回复");
    expect(wrapper.text()).toContain("用户输入");
    expect(wrapper.text()).toContain("修复生产登录故障");
    expect(wrapper.text()).toContain("已定位到登录态丢失的根因");
    expect(wrapper.text()).not.toContain("当前会话");

    const overviewButton = wrapper.findAll("button").find((item) => item.text().includes("展开概览"));
    await overviewButton?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("当前会话");
    expect(wrapper.text()).toContain("主分支");
    expect(wrapper.text()).toContain("当前阶段");
    expect(wrapper.text()).toContain("修复认证链路");
    expect(wrapper.text()).toContain("任务状态");
  });

  it("imports running tasks from the toolbar", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    const buttons = wrapper.findAll("button");
    const importButton = buttons.find((item) => item.text().includes("导入运行中"));
    await importButton?.trigger("click");
    await flushPromises();

    expect(taskMonitorStore.nodes.some((node) => node.taskId === "task-1")).toBe(true);
    expect(taskMonitorStore.nodes.some((node) => node.taskId === "task-2")).toBe(false);
    expect(wrapper.text()).toContain("修复登录流程");
    expect(wrapper.text()).not.toContain("处理构建异常");
  });

  it("places newly opened monitor windows into free positions instead of overlapping", async () => {
    const { taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    expect(taskMonitorStore.nodes).toHaveLength(2);

    const [firstNode, secondNode] = taskMonitorStore.nodes;
    expect(firstNode).toBeTruthy();
    expect(secondNode).toBeTruthy();
    expect(
      secondNode!.x >= firstNode!.x + Math.max(firstNode!.width, 350) + 28
      || secondNode!.y >= firstNode!.y + firstNode!.height + 28,
    ).toBe(true);
  });

  it("defaults to free layout and hides structured layout choices", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    expect(taskMonitorStore.layoutMode).toBe("free");
    expect(wrapper.find(".monitor-toolbar__layout-mode").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("按状态");
    expect(wrapper.text()).not.toContain("按阶段");
    expect(wrapper.text()).not.toContain("按时间");
  });

  it("keeps auto-placed free-layout cards snapped to stable columns", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });

    try {
      const { taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.addTaskNode("task-3");
      await flushPromises();

      const sortedX = taskMonitorStore.nodes
        .map((node) => node.x)
        .sort((left, right) => left - right);

      expect(sortedX).toEqual([28, 406, 784]);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("wraps auto-placed free-layout cards onto aligned rows", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.addTaskNode("task-3");
      await flushPromises();

      const sortedNodes = taskMonitorStore.nodes
        .map((node) => ({ x: node.x, y: node.y }))
        .sort((left, right) => left.y - right.y || left.x - right.x);

      expect(sortedNodes[0]?.y).toBe(28);
      expect(sortedNodes[1]?.y).toBe(28);
      expect(sortedNodes[2]?.x).toBe(28);
      expect(sortedNodes[2]?.y).toBeGreaterThan(sortedNodes[1]?.y || 0);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("uses the tallest card in a row to place the next row without overlap", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { taskMonitorStore } = await mountPage();

      const firstNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-1");
      expect(firstNode).toBeTruthy();

      taskMonitorStore.setNodeSize(firstNode!.id, 350, 520);
      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.addTaskNode("task-3");
      await flushPromises();

      const thirdNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-3");
      expect(thirdNode).toBeTruthy();
      expect(thirdNode!.x).toBe(28);
      expect(thirdNode!.y).toBe(576);
      expect(thirdNode!.y).toBeGreaterThanOrEqual(firstNode!.y + firstNode!.height + 28);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("snaps dragged free-layout cards onto the nearest grid slot", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(draggedNode).toBeTruthy();

      emitFlowEvent(wrapper.findComponent({ name: "VueFlow" }) as never, "node-drag-stop", {
        node: {
          id: draggedNode!.id,
          position: { x: 463, y: 177 },
        },
      });
      await flushPromises();

      expect(draggedNode!.x).toBe(406);
      expect(draggedNode!.y).toBe(28);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("lets both shorter and taller cards reach the same free-layout slot", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.addTaskNode("task-3");
      await flushPromises();

      const firstNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-1");
      const shorterNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      const tallerNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-3");
      expect(firstNode).toBeTruthy();
      expect(shorterNode).toBeTruthy();
      expect(tallerNode).toBeTruthy();

      taskMonitorStore.setNodePosition(firstNode!.id, 28, 28);
      taskMonitorStore.setNodeSize(firstNode!.id, 350, 320);
      taskMonitorStore.setNodePosition(shorterNode!.id, 28, 376);
      taskMonitorStore.setNodeSize(shorterNode!.id, 350, 320);
      taskMonitorStore.setNodePosition(tallerNode!.id, 28, 724);
      taskMonitorStore.setNodeSize(tallerNode!.id, 350, 520);
      await flushPromises();

      const flow = wrapper.findComponent({ name: "VueFlow" });

      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: shorterNode!.id,
          position: { x: shorterNode!.x, y: shorterNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: shorterNode!.id,
          position: { x: 444, y: 40 },
        },
      });
      emitFlowEvent(flow as never, "node-drag-stop", {
        node: {
          id: shorterNode!.id,
          position: { x: 444, y: 40 },
        },
      });
      await flushPromises();

      expect(shorterNode!.x).toBe(406);
      expect(shorterNode!.y).toBe(28);

      taskMonitorStore.setNodePosition(firstNode!.id, 28, 28);
      taskMonitorStore.setNodeSize(firstNode!.id, 350, 320);
      taskMonitorStore.setNodePosition(shorterNode!.id, 28, 376);
      taskMonitorStore.setNodeSize(shorterNode!.id, 350, 320);
      taskMonitorStore.setNodePosition(tallerNode!.id, 28, 724);
      taskMonitorStore.setNodeSize(tallerNode!.id, 350, 520);
      await flushPromises();

      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: tallerNode!.id,
          position: { x: tallerNode!.x, y: tallerNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: tallerNode!.id,
          position: { x: 444, y: 40 },
        },
      });
      emitFlowEvent(flow as never, "node-drag-stop", {
        node: {
          id: tallerNode!.id,
          position: { x: 444, y: 40 },
        },
      });
      await flushPromises();

      expect(tallerNode!.x).toBe(406);
      expect(tallerNode!.y).toBe(28);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("keeps the preview target aligned with the final drop slot", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: draggedNode!.x, y: draggedNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 463, y: 177 },
        },
      });
      await flushPromises();

      const targetPreview = wrapper.find('[data-preview-type="target"]');
      expect(targetPreview.exists()).toBe(true);
      expect(targetPreview.attributes("style") || "").toContain("left: 406px");
      expect(targetPreview.attributes("style") || "").toContain("top: 28px");

      emitFlowEvent(flow as never, "node-drag-stop", {
        node: {
          id: draggedNode!.id,
          position: { x: 463, y: 177 },
        },
      });
      await flushPromises();

      expect(draggedNode!.x).toBe(406);
      expect(draggedNode!.y).toBe(28);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("keeps drop resolution stable while the viewport moves during dragging", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: draggedNode!.x, y: draggedNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 463, y: 177 },
        },
      });
      await flushPromises();

      taskMonitorStore.setViewport({ x: -320, y: -140, zoom: 1.4 });
      await flushPromises();

      const targetPreview = wrapper.find('[data-preview-type="target"]');
      expect(targetPreview.exists()).toBe(true);
      expect(targetPreview.attributes("style") || "").toContain("left: 248px");

      emitFlowEvent(flow as never, "node-drag-stop", {
        node: {
          id: draggedNode!.id,
          position: { x: 463, y: 177 },
        },
      });
      await flushPromises();

      expect(draggedNode!.x).toBe(406);
      expect(draggedNode!.y).toBe(28);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("normalizes screen-space drag positions when the viewport is zoomed", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.setViewport({ x: 0, y: 0, zoom: 1.5 });
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: 609, y: 42 },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 42, y: 564 },
        },
      });
      await flushPromises();

      const targetPreview = wrapper.find('[data-preview-type="target"]');
      expect(targetPreview.exists()).toBe(true);
      expect(targetPreview.attributes("style") || "").toContain("left: 42px");
      expect(targetPreview.attributes("style") || "").toContain("top: 564px");

      emitFlowEvent(flow as never, "node-drag-stop", {
        node: {
          id: draggedNode!.id,
          position: { x: 42, y: 564 },
        },
      });
      await flushPromises();

      expect(draggedNode!.x).toBe(28);
      expect(draggedNode!.y).toBe(376);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("shows drag preview and swap highlight when crossing into an occupied column", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: draggedNode!.x, y: draggedNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 44, y: 40 },
        },
      });
      await flushPromises();

      expect(wrapper.find('[data-preview-type="target"]').exists()).toBe(true);
      expect(wrapper.find('[data-preview-type="target"]').text()).toContain("交换到这里");
      expect(wrapper.find('[data-preview-type="swap"]').exists()).toBe(true);

      const swapTargetNode = wrapper.findAll(".monitor-node").find((node) => node.text().includes("修复登录流程"));
      expect(swapTargetNode?.classes()).toContain("monitor-node--swap-target");
      expect(swapTargetNode?.classes()).toContain("monitor-node--preview-shifted");

      const draggedNodeCard = wrapper.findAll(".monitor-node").find((node) => node.text().includes("处理构建异常"));
      expect(draggedNodeCard?.classes()).toContain("monitor-node--magnetic");
      expect(draggedNodeCard?.attributes("style") || "").not.toContain("--monitor-node-drag-magnetic-offset-x: 0px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("positions swap preview boxes in the current viewport coordinates", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.setViewport({ x: -120, y: -80, zoom: 1.25 });
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: draggedNode!.x, y: draggedNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 44, y: 40 },
        },
      });
      await flushPromises();

      const targetPreview = wrapper.find('[data-preview-type="target"]');
      const swapPreview = wrapper.find('[data-preview-type="swap"]');

      expect(targetPreview.exists()).toBe(true);
      expect(swapPreview.exists()).toBe(true);
      expect(targetPreview.attributes("style") || "").toContain("left: -85px");
      expect(targetPreview.attributes("style") || "").toContain("top: -45px");
      expect(targetPreview.attributes("style") || "").toContain("width: 438px");
      expect(swapPreview.attributes("style") || "").toContain("left: 388px");
      expect(swapPreview.attributes("style") || "").toContain("top: -45px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("updates preview positions immediately during viewport zoom changes", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: draggedNode!.x, y: draggedNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 44, y: 40 },
        },
      });
      await flushPromises();

      emitFlowEvent(flow as never, "viewport-change", { x: -120, y: -80, zoom: 1.25 });
      await flushPromises();

      const targetPreview = wrapper.find('[data-preview-type="target"]');
      expect(targetPreview.exists()).toBe(true);
      expect(targetPreview.attributes("style") || "").toContain("left: -85px");
      expect(targetPreview.attributes("style") || "").toContain("top: -45px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("swaps cards when dropping onto an occupied grid slot", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      await flushPromises();

      const runningNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-1");
      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(runningNode).toBeTruthy();
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: draggedNode!.x, y: draggedNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 44, y: 40 },
        },
      });
      emitFlowEvent(flow as never, "node-drag-stop", {
        node: {
          id: draggedNode!.id,
          position: { x: 44, y: 40 },
        },
      });
      await flushPromises();

      expect(draggedNode!.x).toBe(28);
      expect(draggedNode!.y).toBe(28);
      expect(runningNode!.x).toBe(406);
      expect(runningNode!.y).toBe(28);
      expect(wrapper.find('[data-preview-type="target"]').exists()).toBe(false);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("shows the same swap preview when exchanging across rows", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.addTaskNode("task-3");
      await flushPromises();

      const draggedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-3");
      expect(draggedNode).toBeTruthy();

      const flow = wrapper.findComponent({ name: "VueFlow" });
      emitFlowEvent(flow as never, "node-drag-start", {
        node: {
          id: draggedNode!.id,
          position: { x: draggedNode!.x, y: draggedNode!.y },
        },
      });
      emitFlowEvent(flow as never, "node-drag", {
        node: {
          id: draggedNode!.id,
          position: { x: 46, y: 36 },
        },
      });
      await flushPromises();

      expect(wrapper.find(".monitor-free-layout-preview-row--source").exists()).toBe(true);
      expect(wrapper.find(".monitor-free-layout-preview-row--target").exists()).toBe(true);

      const swapTargetNode = wrapper.findAll(".monitor-node").find((node) => node.text().includes("修复登录流程"));
      expect(swapTargetNode?.classes()).toContain("monitor-node--swap-target");
      expect(swapTargetNode?.classes()).toContain("monitor-node--preview-shifted");
      expect(swapTargetNode?.attributes("style") || "").toContain("--monitor-node-swap-offset-y");

      const shiftedMiddleNode = wrapper.findAll(".monitor-node").find((node) => node.text().includes("处理构建异常"));
      expect(shiftedMiddleNode?.classes()).toContain("monitor-node--preview-shifted");
      expect(shiftedMiddleNode?.attributes("style") || "").toContain("--monitor-node-preview-offset-y: 348px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("compacts free-layout slots after removing a window", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      taskMonitorStore.addTaskNode("task-3");
      await flushPromises();

      const removedNodeCard = wrapper.findAll(".monitor-node").find((node) => node.text().includes("处理构建异常"));
      expect(removedNodeCard).toBeTruthy();

      const removeButton = removedNodeCard?.findAll("button").find((button) => button.text().includes("移除"));
      expect(removeButton).toBeTruthy();
      await removeButton?.trigger("click");
      await flushPromises();
      await flushPromises();

      const remainingNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-3");
      expect(remainingNode).toBeTruthy();
      expect(taskMonitorStore.nodes.some((node) => node.taskId === "task-2")).toBe(false);
      expect(remainingNode!.x).toBe(406);
      expect(remainingNode!.y).toBe(28);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("repairs free-layout overlaps against the canvas width on resize", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();
    const canvasShell = wrapper.find(".monitor-canvas-shell").element as HTMLElement;

    Object.defineProperty(canvasShell, "clientWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(canvasShell, "clientHeight", {
      configurable: true,
      value: 640,
    });

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    window.dispatchEvent(new Event("resize"));
    await flushPromises();
    await flushPromises();

    const [firstNode, secondNode] = taskMonitorStore.nodes;
    expect(firstNode).toBeTruthy();
    expect(secondNode).toBeTruthy();
    expect(secondNode!.x >= firstNode!.x + Math.max(firstNode!.width, 350) + 28 || secondNode!.y >= firstNode!.y + firstNode!.height + 28).toBe(true);
    expect(secondNode!.x).toBeLessThanOrEqual(304);
  });

  it("switches to status layout mode and renders structure sections", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    taskMonitorStore.setLayoutMode("status");
    await flushPromises();
    await flushPromises();

    const sections = wrapper.findAll(".monitor-structure-section");
    const runningNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-1");
    const failedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");

    expect(wrapper.text()).toContain("按状态");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).toContain("异常");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.text()).toContain("运行中");
    expect(sections[1]?.text()).toContain("异常");
    expect(runningNode?.width).toBe(350);
    expect(failedNode?.width).toBe(350);
    expect(runningNode).toBeTruthy();
    expect(failedNode).toBeTruthy();
    expect((failedNode?.y || 0) > (runningNode?.y || 0)).toBe(true);
    expect(Math.abs((failedNode?.x || 0) - (runningNode?.x || 0))).toBeLessThanOrEqual(1);

    const flow = wrapper.findComponent({ name: "VueFlow" });
    expect(flow.props("nodesDraggable")).toBe(false);
  });

  it("keeps a unified card width across free, status, stage, and time layouts", async () => {
    const { taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    expect(taskMonitorStore.nodes.every((node) => node.width === 350)).toBe(true);

    taskMonitorStore.setLayoutMode("status");
    await flushPromises();
    await flushPromises();
    expect(taskMonitorStore.nodes.every((node) => node.width === 350)).toBe(true);

    taskMonitorStore.setLayoutMode("stage");
    await flushPromises();
    await flushPromises();
    expect(taskMonitorStore.nodes.every((node) => node.width === 350)).toBe(true);

    taskMonitorStore.setLayoutMode("time");
    await flushPromises();
    await flushPromises();
    expect(taskMonitorStore.nodes.every((node) => node.width === 350)).toBe(true);
  });

  it("normalizes persisted baseline and snapshot widths to the unified card width", async () => {
    const { taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    const [firstNode] = taskMonitorStore.nodes;
    expect(firstNode).toBeTruthy();

    taskMonitorStore.setNodeSize(firstNode!.id, 320, firstNode!.height);
    taskMonitorStore.freeLayoutSnapshot[firstNode!.id] = {
      x: firstNode!.x,
      y: firstNode!.y,
      width: 320,
      height: firstNode!.height,
    };
    taskMonitorStore.freeLayoutBaseline[firstNode!.id] = {
      x: firstNode!.x,
      y: firstNode!.y,
      width: 320,
      height: firstNode!.height,
    };

    const changed = taskMonitorStore.normalizePersistedWindowWidth(350);

    expect(changed).toBe(true);
    expect(firstNode!.width).toBe(350);
    expect(taskMonitorStore.freeLayoutSnapshot[firstNode!.id]?.width).toBe(350);
    expect(taskMonitorStore.freeLayoutBaseline[firstNode!.id]?.width).toBe(350);
  });

  it("removes whole-card collapse while keeping overview collapse available", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-1", { collapsed: true });
    await flushPromises();

    const buttonTexts = wrapper.findAll("button").map((button) => button.text().trim()).filter(Boolean);

    expect(wrapper.text()).toContain("任务概览");
    expect(wrapper.text()).toContain("实时回复");
    expect(buttonTexts).not.toContain("折叠");
    expect(buttonTexts).not.toContain("展开");
    expect(buttonTexts).toContain("展开概览");
  });

  it("switches to time layout mode and places newer activity first", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    taskMonitorStore.setLayoutMode("time");
    await flushPromises();
    await flushPromises();

    const sections = wrapper.findAll(".monitor-structure-section");
    const runningNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-1");
    const failedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");

    expect(wrapper.text()).toContain("按时间");
    expect(wrapper.text()).toContain("最近活跃");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.text()).toContain("最近活跃");
    expect(failedNode).toBeTruthy();
    expect(runningNode).toBeTruthy();
    expect(
      (failedNode?.y || 0) < (runningNode?.y || 0)
      || ((failedNode?.y || 0) === (runningNode?.y || 0) && (failedNode?.x || 0) <= (runningNode?.x || 0)),
    ).toBe(true);
  });

  it("switches to stage layout mode and places unknown stages into the fallback section", async () => {
    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    taskMonitorStore.setLayoutMode("stage");
    await flushPromises();
    await flushPromises();

    const sections = wrapper.findAll(".monitor-structure-section");

    expect(wrapper.text()).toContain("按阶段");
    expect(wrapper.text()).toContain("修复认证链路");
    expect(wrapper.text()).toContain("未识别");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.text()).toContain("修复认证链路");
    expect(sections[1]?.text()).toContain("未识别");
  });

  it("treats progress summaries without a real current stage as fallback stage groups", async () => {
    apiMocks.getTaskPipeline.mockImplementation(async (taskId: string) => {
      if (taskId === "task-2") {
        return {
          taskId: "task-2",
          sessionId: "session-1",
          branchName: "main",
          status: "failed",
          createdAt: "2026-03-14T07:00:00.000Z",
          updatedAt: "2026-03-14T07:10:00.000Z",
          stages: [
            {
              id: "stage-a",
              type: "execution",
              label: "下载依赖",
              status: "completed",
              order: 1,
              sourceType: "session.message",
              sourceId: null,
              agent: null,
              model: null,
              sessionId: "session-1",
              startedAt: "2026-03-14T07:01:00.000Z",
              finishedAt: "2026-03-14T07:03:00.000Z",
              durationMs: 120000,
              output: null,
              error: null,
              tokens: null,
              graphNodeId: null,
              dependsOn: [],
            },
          ],
          summary: {
            totalStages: 3,
            completedStages: 1,
            failedStages: 1,
            currentStageId: null,
            totalTokens: { input: 0, output: 0 },
            totalDurationMs: 120000,
            replanCount: 0,
          },
        };
      }

      return {
        taskId: "task-1",
        sessionId: "session-1",
        branchName: "main",
        status: "running",
        createdAt: "2026-03-14T08:01:00.000Z",
        updatedAt: "2026-03-14T08:08:00.000Z",
        stages: [
          {
            id: "stage-1",
            type: "execution",
            label: "检索日志",
            status: "completed",
            order: 1,
            sourceType: "session.message",
            sourceId: null,
            agent: null,
            model: null,
            sessionId: "session-1",
            startedAt: "2026-03-14T08:03:00.000Z",
            finishedAt: "2026-03-14T08:04:00.000Z",
            durationMs: 60000,
            output: null,
            error: null,
            tokens: null,
            graphNodeId: null,
            dependsOn: [],
          },
          {
            id: "stage-2",
            type: "execution",
            label: "修复认证链路",
            status: "running",
            order: 2,
            sourceType: "session.message",
            sourceId: null,
            agent: null,
            model: null,
            sessionId: "session-1",
            startedAt: "2026-03-14T08:05:00.000Z",
            finishedAt: null,
            durationMs: null,
            output: null,
            error: null,
            tokens: null,
            graphNodeId: null,
            dependsOn: [],
          },
        ],
        summary: {
          totalStages: 2,
          completedStages: 1,
          failedStages: 0,
          currentStageId: "stage-2",
          totalTokens: { input: 0, output: 0 },
          totalDurationMs: 60000,
          replanCount: 0,
        },
      };
    });

    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    taskMonitorStore.setLayoutMode("stage");
    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("未识别");
    expect(wrapper.text()).not.toContain("1/3 个任务");
    expect(wrapper.text()).toContain("阶段信息不完整时暂时归并到这里");
  });

  it("keeps multiple real stages as separate sections and leaves fallback last", async () => {
    apiMocks.getTaskPipeline.mockImplementation(async (taskId: string) => {
      if (taskId === "task-1") {
        return buildPipeline({
          taskId,
          status: "running",
          updatedAt: "2026-03-14T08:08:00.000Z",
          stages: [
            buildPipelineStage("stage-1", "检索日志", "completed", "2026-03-14T08:03:00.000Z", "2026-03-14T08:04:00.000Z"),
            buildPipelineStage("stage-2", "修复认证链路", "running", "2026-03-14T08:05:00.000Z", null),
          ],
          currentStageId: "stage-2",
        });
      }

      if (taskId === "task-3") {
        return buildPipeline({
          taskId,
          status: "running",
          updatedAt: "2026-03-14T08:18:00.000Z",
          stages: [
            buildPipelineStage("stage-3", "生成基线", "completed", "2026-03-14T08:10:00.000Z", "2026-03-14T08:11:00.000Z"),
            buildPipelineStage("stage-4", "补回归用例", "running", "2026-03-14T08:12:00.000Z", null),
          ],
          currentStageId: "stage-4",
        });
      }

      return null;
    });

    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    taskMonitorStore.addTaskNode("task-3");
    await flushPromises();

    taskMonitorStore.setLayoutMode("stage");
    await flushPromises();
    await flushPromises();

    const sections = wrapper.findAll(".monitor-structure-section");

    expect(sections).toHaveLength(3);
    expect(sections[0]?.text()).toContain("补回归用例");
    expect(sections[1]?.text()).toContain("修复认证链路");
    expect(sections[2]?.text()).toContain("未识别");
  });

  it("aggregates tasks with the same current stage into one section", async () => {
    apiMocks.getTaskPipeline.mockImplementation(async (taskId: string) => {
      if (taskId === "task-1" || taskId === "task-3") {
        return buildPipeline({
          taskId,
          status: "running",
          updatedAt: taskId === "task-1" ? "2026-03-14T08:08:00.000Z" : "2026-03-14T08:18:00.000Z",
          stages: [
            buildPipelineStage(`${taskId}-stage-1`, "准备上下文", "completed", "2026-03-14T08:03:00.000Z", "2026-03-14T08:04:00.000Z"),
            buildPipelineStage(`${taskId}-stage-2`, "修复认证链路", "running", "2026-03-14T08:05:00.000Z", null),
          ],
          currentStageId: `${taskId}-stage-2`,
        });
      }

      return null;
    });

    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-3");
    await flushPromises();

    taskMonitorStore.setLayoutMode("stage");
    await flushPromises();
    await flushPromises();

    const sections = wrapper.findAll(".monitor-structure-section");

    expect(sections).toHaveLength(1);
    expect(sections[0]?.text()).toContain("修复认证链路");
    expect(sections[0]?.text()).toContain("2 个任务");
  });

  it("sorts stage sections stably by title when activity timestamps tie", async () => {
    apiMocks.getTask.mockImplementation(async (taskId: string) => {
      if (taskId === "task-4") {
        return {
          id: taskId,
          projectId: "proj-1",
          userId: "user-1",
          title: "稳定发布流程",
          prompt: "收敛发布流程中的不稳定步骤",
          status: "running",
          createdAt: "2026-03-14T08:00:00.000Z",
          startedAt: "2026-03-14T08:02:00.000Z",
        };
      }

      if (taskId === "task-1") {
        return {
          id: taskId,
          projectId: "proj-1",
          userId: "user-1",
          title: "修复登录流程",
          prompt: "修复生产登录故障",
          status: "running",
          createdAt: "2026-03-14T08:00:00.000Z",
          startedAt: "2026-03-14T08:02:00.000Z",
        };
      }

      if (taskId === "task-2") {
        return {
          id: taskId,
          projectId: "proj-1",
          userId: "user-1",
          title: "处理构建异常",
          prompt: "分析构建失败原因",
          status: "failed",
          createdAt: "2026-03-14T07:00:00.000Z",
          startedAt: "2026-03-14T07:02:00.000Z",
          finishedAt: "2026-03-14T08:20:00.000Z",
        };
      }

      return {
        id: taskId,
        projectId: "proj-1",
        userId: "user-1",
        title: "补回归测试",
        prompt: "补充自动化回归测试",
        status: "running",
        createdAt: "2026-03-14T08:20:00.000Z",
        startedAt: "2026-03-14T08:21:00.000Z",
      };
    });

    apiMocks.getTaskPipeline.mockImplementation(async (taskId: string) => {
      if (taskId === "task-1") {
        return buildPipeline({
          taskId,
          status: "running",
          updatedAt: "2026-03-14T08:18:00.000Z",
          stages: [buildPipelineStage("alpha-stage", "A 阶段", "running", "2026-03-14T08:12:00.000Z", null)],
          currentStageId: "alpha-stage",
        });
      }

      if (taskId === "task-4") {
        return buildPipeline({
          taskId,
          status: "running",
          updatedAt: "2026-03-14T08:18:00.000Z",
          stages: [buildPipelineStage("beta-stage", "B 阶段", "running", "2026-03-14T08:12:00.000Z", null)],
          currentStageId: "beta-stage",
        });
      }

      return null;
    });

    const { wrapper, taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-4");
    await flushPromises();

    taskMonitorStore.setLayoutMode("stage");
    await flushPromises();
    await flushPromises();

    const sections = wrapper.findAll(".monitor-structure-section");
    const sectionTitles = sections.map((section) => section.find(".monitor-structure-section__header strong").text());
    const expectedTitles = ["A 阶段", "B 阶段"].sort((left, right) => left.localeCompare(right, "zh-CN"));

    expect(sections).toHaveLength(2);
    expect(sectionTitles).toEqual(expectedTitles);
  });

  it("restores user positions when switching back to free layout", async () => {
    const { taskMonitorStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-2");
    await flushPromises();

    const runningNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-1");
    expect(runningNode).toBeTruthy();

    taskMonitorStore.setNodePosition(runningNode!.id, 720, 420);
    const savedX = runningNode!.x;
    const savedY = runningNode!.y;

    taskMonitorStore.setLayoutMode("status");
    await flushPromises();
    await flushPromises();

    expect(runningNode!.x).not.toBe(savedX);

    taskMonitorStore.setLayoutMode("free");
    await flushPromises();
    await flushPromises();

    expect(runningNode!.x).toBe(savedX);
    expect(runningNode!.y).toBe(savedY);
  });

  it("resets free layout by compacting from the current top-left window", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    try {
      const { wrapper, taskMonitorStore } = await mountPage();

      taskMonitorStore.addTaskNode("task-2");
      await flushPromises();

      const runningNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-1");
      const failedNode = taskMonitorStore.nodes.find((node) => node.taskId === "task-2");
      expect(runningNode).toBeTruthy();
      expect(failedNode).toBeTruthy();

      taskMonitorStore.setNodePosition(runningNode!.id, 760, 460);
      await flushPromises();

      const resetButton = wrapper.findAll("button").find((item) => item.text().includes("重置布局"));
      expect(resetButton).toBeTruthy();

      await resetButton?.trigger("click");
      await flushPromises();
      await flushPromises();

      expect(failedNode!.x).toBe(28);
      expect(failedNode!.y).toBe(28);
      expect(runningNode!.x).toBe(406);
      expect(runningNode!.y).toBe(28);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("prefers completed pipeline state over a stale running task status", async () => {
    apiMocks.getTask.mockImplementation(async (taskId: string) => ({
      id: taskId,
      projectId: "proj-1",
      userId: "user-1",
      title: "修复登录流程",
      prompt: "修复生产登录故障",
      status: "running",
      createdAt: "2026-03-14T08:00:00.000Z",
      startedAt: "2026-03-14T08:02:00.000Z",
      finishedAt: "2026-03-14T08:12:00.000Z",
    }));

    apiMocks.getTaskPipeline.mockResolvedValue(buildPipeline({
      taskId: "task-1",
      status: "completed",
      updatedAt: "2026-03-14T08:12:00.000Z",
      stages: [
        buildPipelineStage("stage-1", "检索日志", "completed", "2026-03-14T08:03:00.000Z", "2026-03-14T08:04:00.000Z"),
        buildPipelineStage("stage-2", "修复认证链路", "completed", "2026-03-14T08:05:00.000Z", "2026-03-14T08:12:00.000Z"),
      ],
      currentStageId: null,
      completedStages: 2,
      totalStages: 2,
    }));

    const { wrapper } = await mountPage();

    await flushPromises();

    const runningNodes = wrapper.findAll(".monitor-node--running");
    const completedNodes = wrapper.findAll(".monitor-node--completed");

    expect(runningNodes).toHaveLength(0);
    expect(completedNodes.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).not.toContain("运行中主执行");
  });

  it("marks the window completed once the assistant reply finished and the session is no longer active", async () => {
    apiMocks.getTask.mockImplementation(async (taskId: string) => ({
      id: taskId,
      projectId: "proj-1",
      userId: "user-1",
      title: "修复登录流程",
      prompt: "修复生产登录故障",
      status: "running",
      result: "已输出最终答复",
      createdAt: "2026-03-14T08:00:00.000Z",
      startedAt: "2026-03-14T08:02:00.000Z",
    }));

    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "session-1",
          title: "主分支",
          isActive: false,
          summary: null,
          createdAt: "2026-03-14T08:01:00.000Z",
          updatedAt: "2026-03-14T08:12:00.000Z",
        },
      ],
    });

    apiMocks.getTaskPipeline.mockResolvedValue(null);

    const { wrapper } = await mountPage();

    await flushPromises();

    expect(wrapper.findAll(".monitor-node--running")).toHaveLength(0);
    expect(wrapper.findAll(".monitor-node--completed").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("已完成");
  });

  it("marks the window completed when the latest visible assistant reply has already finished", async () => {
    apiMocks.getTask.mockImplementation(async (taskId: string) => ({
      id: taskId,
      projectId: "proj-1",
      userId: "user-1",
      title: "修复登录流程",
      prompt: "修复生产登录故障",
      status: "running",
      createdAt: "2026-03-14T08:00:00.000Z",
      startedAt: "2026-03-14T08:02:00.000Z",
    }));

    apiMocks.getTaskSessions.mockResolvedValue({
      data: [
        {
          id: "session-1",
          title: "主分支",
          isActive: true,
          summary: null,
          createdAt: "2026-03-14T08:01:00.000Z",
          updatedAt: "2026-03-14T08:12:00.000Z",
        },
      ],
    });

    apiMocks.getTaskPipeline.mockResolvedValue(null);

    const { wrapper } = await mountPage();

    await flushPromises();

    expect(wrapper.findAll(".monitor-node--running")).toHaveLength(0);
    expect(wrapper.findAll(".monitor-node--completed").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("已完成");
  });

  it("keeps the monitor card stable when realtime assistant events arrive", async () => {
    const { wrapper, taskMonitorStore, realtimeStore } = await mountPage();

    taskMonitorStore.addTaskNode("task-1");
    await flushPromises();

    prependRealtimeEvent(realtimeStore, {
      id: "evt-message-updated",
      type: "message.updated",
      ts: "2026-03-14T08:05:00.000Z",
      taskId: "task-1",
      sessionId: "session-1",
      data: {
        rawType: "message.updated",
        info: {
          id: "message-stream-1",
          role: "assistant",
          agent: "oracle-enterprise",
          time: {
            created: "2026-03-14T08:05:00.000Z",
          },
        },
      },
    });
    prependRealtimeEvent(realtimeStore, {
      id: "evt-message-part",
      type: "message.part.updated",
      ts: "2026-03-14T08:05:01.000Z",
      taskId: "task-1",
      sessionId: "session-1",
      data: {
        rawType: "message.part.updated",
        part: {
          messageID: "message-stream-1",
          type: "text",
          text: "正在持续输出",
        },
      },
    });

    prependRealtimeEvent(realtimeStore, {
      id: "evt-message-part-2",
      type: "message.part.updated",
      ts: "2026-03-14T08:05:02.000Z",
      taskId: "task-1",
      sessionId: "session-1",
      data: {
        rawType: "message.part.updated",
        part: {
          messageID: "message-stream-1",
          type: "text",
          text: "修复进展。",
        },
      },
    });
    prependRealtimeEvent(realtimeStore, {
      id: "evt-message-updated-complete",
      type: "message.updated",
      ts: "2026-03-14T08:05:03.000Z",
      taskId: "task-1",
      sessionId: "session-1",
      data: {
        rawType: "message.updated",
        info: {
          id: "message-stream-1",
          role: "assistant",
          agent: "oracle-enterprise",
          time: {
            created: "2026-03-14T08:05:00.000Z",
            completed: "2026-03-14T08:05:03.000Z",
          },
        },
      },
    });

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("修复登录流程");
    expect(wrapper.text()).toContain("实时回复");
    expect(wrapper.text()).toContain("已定位到登录态丢失的根因");
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).not.toContain("生成中");
  });
});