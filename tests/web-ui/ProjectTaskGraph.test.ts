import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

const routeState = vi.hoisted(() => ({
  params: { projectId: "proj-default" },
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getProjectTaskGraphView: vi.fn(),
}));

const realtimeStoreMock = vi.hoisted(() => ({
  connected: true,
  events: [] as Array<Record<string, unknown>>,
  subscribeProject: vi.fn(),
}));

const VueFlowStub = defineComponent({
  name: "VueFlow",
  props: {
    nodes: { type: Array, default: () => [] },
    edges: { type: Array, default: () => [] },
  },
  emits: ["node-click"],
  setup(props, { slots, emit }) {
    return () =>
      h(
        "div",
        { class: "vue-flow-stub" },
        (props.nodes as Array<Record<string, unknown>>).map((node) => {
          const slot = slots[`node-${String(node.type)}`];
          return h(
            "div",
            {
              class: "vue-flow-stub__node",
              "data-node-id": String(node.id),
              onClick: () => emit("node-click", { event: { type: "click" }, node }),
            },
            slot ? slot({ data: node.data }) : String(node.id),
          );
        }),
      );
  },
});

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeStoreMock,
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

vi.mock("../../control-plane/web-ui/src/components/ProjectSectionNav.vue", () => ({
  default: defineComponent({
    name: "ProjectSectionNav",
    template: '<div data-testid="project-section-nav">项目导航</div>',
  }),
}));

const BackgroundStub = defineComponent({
  name: "Background",
  setup() {
    return () => h("div", { class: "background-stub" });
  },
});

const ControlsStub = defineComponent({
  name: "Controls",
  setup() {
    return () => h("div", { class: "controls-stub" });
  },
});

vi.mock("ant-design-vue", () => {
  const passThrough = (name: string) =>
    defineComponent({
      name,
      props: ["message", "description", "spinning", "title", "subTitle"],
      emits: ["back"],
      setup(props, { slots, emit }) {
        return () =>
          h("div", { class: name }, [
            props.title ? h("div", String(props.title)) : null,
            props.subTitle ? h("div", String(props.subTitle)) : null,
            props.message ? h("div", String(props.message)) : null,
            props.description ? h("div", String(props.description)) : null,
            name === "PageHeader"
              ? h("button", { type: "button", onClick: () => emit("back") }, "back")
              : null,
            slots.default?.(),
          ]);
      },
    });

  const Button = defineComponent({
    name: "Button",
    emits: ["click"],
    setup(_props, { slots, emit, attrs }) {
      return () => h("button", { ...attrs, type: "button", onClick: (event: Event) => emit("click", event) }, slots.default?.());
    },
  });

  const Input = defineComponent({
    name: "Input",
    props: ["value"],
    emits: ["update:value"],
    setup(props, { emit, attrs }) {
      return () =>
        h("input", {
          ...attrs,
          value: String(props.value ?? ""),
          onInput: (event: Event) => emit("update:value", (event.target as HTMLInputElement).value),
        });
    },
  });

  const Select = defineComponent({
    name: "Select",
    props: ["value"],
    emits: ["update:value"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        h(
          "select",
          {
            ...attrs,
            value: String(props.value ?? ""),
            onChange: (event: Event) => emit("update:value", (event.target as HTMLSelectElement).value),
          },
          slots.default?.(),
        );
    },
  });

  const SelectOption = defineComponent({
    name: "SelectOption",
    props: ["value"],
    setup(props, { slots }) {
      return () => h("option", { value: String(props.value ?? "") }, slots.default?.());
    },
  });

  const RadioGroup = defineComponent({
    name: "RadioGroup",
    setup(_props, { slots }) {
      return () => h("div", { class: "radio-group-stub" }, slots.default?.());
    },
  });

  const RadioButton = defineComponent({
    name: "RadioButton",
    setup(_props, { slots }) {
      return () => h("span", { class: "radio-button-stub" }, slots.default?.());
    },
  });

  return {
    PageHeader: passThrough("PageHeader"),
    Spin: passThrough("Spin"),
    Alert: passThrough("Alert"),
    Button,
    Input,
    Select,
    SelectOption,
    RadioGroup,
    RadioButton,
  };
});

function buildTask(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    projectId: "proj-default",
    userId: "user-1",
    title: `任务 ${id}`,
    prompt: `处理 ${id}`,
    status: "running",
    createdAt: "2026-03-16T08:00:00.000Z",
    currentStageLabel: "Implement",
    ...overrides,
  };
}

async function mountPage() {
  const { default: Page } = await import("../../control-plane/web-ui/src/pages/ProjectTaskGraph.vue");
  const wrapper = mount(Page, {
    global: {
      stubs: {
        RouterLink: true,
        "router-link": true,
        VueFlow: VueFlowStub,
        Background: BackgroundStub,
        Controls: ControlsStub,
      },
    },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

describe("ProjectTaskGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.params = { projectId: "proj-default" };
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
  });

  it("folds large stage groups by default", async () => {
    apiMocks.getProjectTaskGraphView.mockResolvedValue({
      project: {
        id: "proj-default",
        name: "Default Project",
        slug: "default-project",
        description: "项目级任务总图测试",
      },
      tasks: [
        buildTask("task-1", { status: "blocked" }),
        buildTask("task-2", { status: "waiting_approval" }),
        buildTask("task-3"),
        buildTask("task-4"),
        buildTask("task-5"),
        buildTask("task-6"),
        buildTask("task-7"),
        buildTask("task-8"),
      ],
      edges: [],
      capabilities: {
        supportsDependsOn: false,
        supportsBlocks: false,
        supportsSpawnedFrom: false,
      },
      refreshedAt: "2026-03-16T08:30:00.000Z",
    });

    const wrapper = await mountPage();

    expect(apiMocks.getProjectTaskGraphView).toHaveBeenCalledWith("proj-default");
    expect(realtimeStoreMock.subscribeProject).toHaveBeenCalledWith("proj-default");
    expect(wrapper.text()).toContain("Default Project / 任务总图");
    expect(wrapper.html()).toContain("+2 更多任务");
    expect(wrapper.text()).toContain("任务总数");
  });

  it("expands grouped tasks and opens inspector for a selected task", async () => {
    apiMocks.getProjectTaskGraphView.mockResolvedValue({
      project: {
        id: "proj-default",
        name: "Default Project",
        slug: "default-project",
        description: "项目级任务总图测试",
      },
      tasks: [
        buildTask("task-1", { status: "blocked" }),
        buildTask("task-2", { status: "waiting_approval" }),
        buildTask("task-3"),
        buildTask("task-4"),
        buildTask("task-5"),
        buildTask("task-6"),
        buildTask("task-7", { prompt: "隐藏任务 7 的说明", repoName: "repo-7", workingBranch: "feature/7" }),
        buildTask("task-8", { prompt: "隐藏任务 8 的说明" }),
      ],
      edges: [],
      capabilities: {
        supportsDependsOn: false,
        supportsBlocks: false,
        supportsSpawnedFrom: false,
      },
      refreshedAt: "2026-03-16T08:30:00.000Z",
    });

    const wrapper = await mountPage();

    expect(wrapper.find('[data-node-id="group-implement"]').exists()).toBe(true);

    await wrapper.get('[data-node-id="group-implement"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("任务 task-7");

    await wrapper.get('[data-node-id="task-7"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="project-task-graph-inspector"]').text()).toContain("隐藏任务 7 的说明");
    expect(wrapper.text()).toContain("repo-7 · feature/7");

    const detailButton = wrapper.findAll("button").find((button) => button.text().includes("打开任务详情"));
    await detailButton?.trigger("click");

    expect(routerState.push).toHaveBeenCalledWith("/tasks/task-7");
  });
});