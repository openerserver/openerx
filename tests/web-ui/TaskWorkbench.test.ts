import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaskWorkbench from "../../control-plane/web-ui/src/pages/TaskWorkbench.vue";
import { useWorkbenchStore } from "../../control-plane/web-ui/src/stores/workbench";

const pushMock = vi.hoisted(() => vi.fn());

const apiMocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  listTasks: vi.fn(),
  getWorkbenchLayout: vi.fn(),
  saveWorkbenchLayout: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: pushMock }),
}));

function createSlotStub(name: string, tag = "div") {
  return defineComponent({
    name,
    props: {
      description: { type: String, default: "" },
      disabled: { type: Boolean, default: false },
    },
    setup(props, { slots, attrs }) {
      return () =>
        h(tag, attrs, [
          props.description ? h("span", props.description) : null,
          slots.tab?.(),
          slots.default?.(),
          slots.overlay?.(),
        ]);
    },
  });
}

const ButtonStub = defineComponent({
  name: "AButton",
  props: {
    disabled: { type: Boolean, default: false },
  },
  emits: ["click"],
  setup(props, { slots, emit, attrs }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          disabled: props.disabled,
          onClick: () => emit("click"),
        },
        slots.default?.(),
      );
  },
});

const TabsStub = defineComponent({
  name: "ATabs",
  setup(_, { slots }) {
    return () => h("div", { class: "tabs-stub" }, slots.default?.());
  },
});

const TabPaneStub = defineComponent({
  name: "ATabPane",
  setup(_, { slots }) {
    return () =>
      h("section", { class: "tab-pane-stub" }, [
        h("div", { class: "tab-pane-stub__tab" }, slots.tab?.()),
        h("div", { class: "tab-pane-stub__body" }, slots.default?.()),
      ]);
  },
});

vi.mock("ant-design-vue", () => ({
  AFlex: createSlotStub("AFlex"),
  ASpace: createSlotStub("ASpace"),
  ARadioGroup: createSlotStub("ARadioGroup"),
  ARadioButton: createSlotStub("ARadioButton", "label"),
  ASelect: createSlotStub("ASelect"),
  ASelectOption: createSlotStub("ASelectOption", "option"),
  ACard: createSlotStub("ACard", "section"),
  AEmpty: createSlotStub("AEmpty", "section"),
  ATabs: TabsStub,
  ATabPane: TabPaneStub,
  ADropdown: createSlotStub("ADropdown"),
  AMenu: createSlotStub("AMenu"),
  AMenuItem: createSlotStub("AMenuItem", "button"),
  AMenuDivider: createSlotStub("AMenuDivider", "hr"),
  ABadge: createSlotStub("ABadge", "span"),
  ATag: createSlotStub("ATag", "span"),
  ARow: createSlotStub("ARow"),
  ACol: createSlotStub("ACol"),
  ATypographyTitle: defineComponent({
    name: "ATypographyTitle",
    setup(_, { slots, attrs }) {
      return () => h("h3", attrs, slots.default?.());
    },
  }),
  AButton: ButtonStub,
  Button: ButtonStub,
  Modal: {
    confirm: vi.fn(),
  },
  message: {
    info: vi.fn(),
    success: vi.fn(),
  },
  notification: {
    warning: vi.fn(),
    close: vi.fn(),
  },
}));

async function mountWorkbench() {
  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mount(TaskWorkbench, {
    global: {
      plugins: [pinia],
    },
  });

  await flushPromises();
  return {
    wrapper,
    workbench: useWorkbenchStore(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.mockReset();
  apiMocks.getTask.mockResolvedValue({ id: "", title: "", status: "pending" });
  apiMocks.listTasks.mockResolvedValue({ data: [] });
  apiMocks.getWorkbenchLayout.mockResolvedValue({ data: null });
  apiMocks.saveWorkbenchLayout.mockResolvedValue({ ok: true });
  apiMocks.listProjects.mockResolvedValue([]);
});

describe("TaskWorkbench regression", () => {
  it("renders the reverted single-pane layout and does not show multi-pane composer UI", async () => {
    const { wrapper, workbench } = await mountWorkbench();

    workbench.openTask("task-primary", "主任务", "running");
    await nextTick();
    await flushPromises();

    expect(wrapper.text()).toContain("主视图");
    expect(wrapper.text()).toContain("主任务");
    expect(wrapper.text()).toContain("加入主窗");
    expect(wrapper.text()).toContain("加入副窗");
    expect(wrapper.text()).not.toContain("待分配窗口");
    expect(wrapper.text()).not.toContain("选择模型");
    expect(wrapper.text()).not.toContain("⌘+Enter");
    expect(wrapper.findAll("iframe")).toHaveLength(1);
    expect(wrapper.find("iframe").attributes("src")).toBe("/tasks/task-primary?embedded=1&workbench=1");
  });

  it("restores the legacy split view when a secondary task is opened", async () => {
    const { wrapper, workbench } = await mountWorkbench();

    workbench.openTask("task-primary", "主任务", "running");
    workbench.openTaskInSecondary("task-secondary", "副任务", "completed");
    workbench.setSplitMode(true);
    await nextTick();
    await flushPromises();

    expect(wrapper.text()).toContain("主窗");
    expect(wrapper.text()).toContain("副窗");
    expect(wrapper.text()).toContain("设为主窗");
    expect(wrapper.text()).toContain("退出分屏");
    const frames = wrapper.findAll("iframe");
    expect(frames).toHaveLength(2);
    expect(frames[0]?.attributes("src")).toBe("/tasks/task-primary?embedded=1&workbench=1");
    expect(frames[1]?.attributes("src")).toBe("/tasks/task-secondary?embedded=1&workbench=1");
  });

  it("keeps workbench tabs in a single-line overflow layout for long labels", async () => {
    const { wrapper, workbench } = await mountWorkbench();

    workbench.openTask("task-1", "这是一个非常长的任务标题用于验证工作台标签不会因为内容过长而自动换行撑高导航栏", "running");
    workbench.openTask("task-2", "第二个超长标签用于验证标签导航仍然保持单行并交给横向溢出处理", "pending");
    await nextTick();
    await flushPromises();

    const tabs = wrapper.find(".task-workbench-tabs");
    expect(tabs.exists()).toBe(true);
    expect(wrapper.findAll(".task-workbench-tabs__title")).toHaveLength(2);
    expect(wrapper.find(".task-workbench-tabs__tab-content").classes()).toContain("task-workbench-tabs__tab-content");
  });
});