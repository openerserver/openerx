import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import type { Task } from "../../control-plane/web-ui/src/lib/api";
import Tasks from "../../control-plane/web-ui/src/pages/Tasks.vue";
import { useProjectStore } from "../../control-plane/web-ui/src/stores/project";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const routeMocks = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}));

const TASK_LIST_LIMIT = 200;

const apiMocks = vi.hoisted(() => ({
  TASK_LIST_LIMIT: 200,
  listProjects: vi.fn(),
  listTasks: vi.fn(),
  listRepositories: vi.fn(),
  listCredentials: vi.fn(),
  getOrchestrationStrategy: vi.fn(),
  createTask: vi.fn(),
  executeTask: vi.fn(),
  getTask: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRouter: () => routerMocks,
  useRoute: () => routeMocks,
}));

vi.mock("ant-design-vue", () => {
  const inputLike = (name: string, tag: "input" | "textarea" = "input") =>
    defineComponent({
      name,
      inheritAttrs: false,
      props: ["value"],
      emits: ["update:value"],
      setup(props, { emit, attrs }) {
        return () =>
          h(tag, {
            ...attrs,
            value: String(props.value ?? ""),
            onInput: (event: Event) =>
              emit("update:value", (event.target as HTMLInputElement | HTMLTextAreaElement).value),
          });
      },
    });

  const simple = (name: string, tag = "div") =>
    defineComponent({
      name,
      inheritAttrs: false,
      props: ["message", "open", "title", "description"],
      emits: ["click", "ok", "confirm", "update:open"],
      setup(props, { slots, emit, attrs }) {
        return () =>
          h(
            tag,
            {
              ...attrs,
              "data-component": name,
              onClick: (event: Event) => emit("click", event),
            },
            slots.message
              ? slots.message()
              : slots.default
                ? slots.default()
                : props.message || props.description,
          );
      },
    });

  const ATable = defineComponent({
    name: "ATable",
    props: ["dataSource", "columns"],
    setup(props, { slots }) {
      return () => {
        const dataSource = (props.dataSource as Record<string, unknown>[] | undefined) ?? [];
        if (dataSource.length === 0) {
          return h("div", { "data-component": "ATable" }, slots.emptyText ? slots.emptyText() : []);
        }
        return h(
          "div",
          { "data-component": "ATable" },
          dataSource.flatMap((record) =>
            ((props.columns as Record<string, unknown>[] | undefined) ?? []).map((column) =>
              h(
                "div",
                {
                  class: "table-cell",
                  "data-column-key": String(column.key ?? column.dataIndex ?? ""),
                  "data-record-id": String(record.id ?? ""),
                },
                slots.bodyCell ? slots.bodyCell({ column, record }) : undefined,
              ),
            ),
          ),
        );
      };
    },
  });

  const AButton = defineComponent({
    name: "AButton",
    inheritAttrs: false,
    props: ["loading", "type", "danger", "size"],
    emits: ["click"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        h(
          "button",
          {
            ...attrs,
            type: "button",
            disabled: Boolean(props.loading),
            onClick: (event: Event) => emit("click", event),
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const ASelect = defineComponent({
    name: "ASelect",
    inheritAttrs: false,
    props: ["value"],
    emits: ["update:value"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        h(
          "select",
          {
            ...attrs,
            value: props.value == null ? "" : String(props.value),
            onChange: (event: Event) => {
              const value = (event.target as HTMLSelectElement).value;
              emit("update:value", value === "" ? undefined : value);
            },
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const ASelectOption = defineComponent({
    name: "ASelectOption",
    props: ["value"],
    setup(props, { slots }) {
      return () =>
        h("option", { value: props.value == null ? "" : String(props.value) }, slots.default?.());
    },
  });

  const APopconfirm = defineComponent({
    name: "APopconfirm",
    inheritAttrs: false,
    emits: ["confirm"],
    setup(_props, { slots, emit, attrs }) {
      return () =>
        h(
          "div",
          {
            ...attrs,
            class: "popconfirm-stub",
            onClick: () => emit("confirm"),
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  return {
    message: messageMocks,
    ATable,
    AButton,
    ASelect,
    ASelectOption,
    AInput: inputLike("AInput"),
    AInputSearch: inputLike("AInputSearch"),
    ATextarea: inputLike("ATextarea", "textarea"),
    APopconfirm,
    AAlert: simple("AAlert"),
    AEmpty: simple("AEmpty"),
    ATag: simple("ATag", "span"),
    ASpace: simple("ASpace"),
    AFlex: simple("AFlex"),
    AModal: simple("AModal"),
    AForm: simple("AForm", "form"),
    AFormItem: simple("AFormItem"),
    ATypographyTitle: simple("ATypographyTitle", "h3"),
    ATypographyText: simple("ATypographyText", "span"),
    ACollapse: simple("ACollapse"),
    ACollapsePanel: simple("ACollapsePanel"),
    ARow: simple("ARow"),
    ACol: simple("ACol"),
    ASelectOptGroup: simple("ASelectOptGroup"),
    ARadioGroup: simple("ARadioGroup"),
    ARadio: simple("ARadio", "label"),
  };
});

vi.mock("@ant-design/icons-vue", () => ({
  PlusOutlined: { name: "PlusOutlined", template: "<span />" },
}));

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    projectId: "proj-1",
    userId: "user-1",
    title: "Fix login flow",
    prompt: "fix login bug",
    status: "pending",
    repoName: "web-ui",
    createdAt: "2026-03-10T00:00:00.000Z",
    startedAt: "2026-03-10T00:01:00.000Z",
    finishedAt: "2026-03-10T00:02:30.000Z",
    ...overrides,
  };
}

async function mountPage(tasks = [makeTask()]) {
  const pinia = createPinia();
  setActivePinia(pinia);

  const projectStore = useProjectStore();
  projectStore.projects = [{ id: "proj-1", orgId: "org-1", name: "Default", slug: "default" }];
  projectStore.currentProjectId = "proj-1";

  apiMocks.listTasks.mockResolvedValue({ data: tasks });
  apiMocks.listRepositories.mockResolvedValue({ data: [] });
  apiMocks.listCredentials.mockResolvedValue({ data: [] });
  apiMocks.getOrchestrationStrategy.mockResolvedValue({
    data: {
      organizationSettings: {
        recommendedProfiles: [],
      },
    },
  });
  apiMocks.createTask.mockResolvedValue({ id: "task-created" });
  apiMocks.executeTask.mockResolvedValue({});
  apiMocks.getTask.mockResolvedValue(makeTask({ id: "task-created", status: "running" }));
  apiMocks.updateTaskStatus.mockResolvedValue({});

  const wrapper = mount(Tasks, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      stubs: {
        teleport: true,
        RouterLink: defineComponent({
          name: "RouterLink",
          props: ["to"],
          setup(props, { slots }) {
            return () => h("a", { "data-to": typeof props.to === "string" ? props.to : String(props.to ?? "") }, slots.default ? slots.default() : undefined);
          },
        }),
      },
    },
  });

  await flushPromises();
  return wrapper;
}

function getSetupState(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  return (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
}

beforeEach(() => {
  vi.clearAllMocks();
  routerMocks.push.mockReset();
  routerMocks.replace.mockReset();
  routeMocks.query = {};
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("Tasks page", () => {
  it("shows truncation warning when task count hits backend limit", async () => {
    const tasks = Array.from({ length: TASK_LIST_LIMIT }, (_, index) =>
      makeTask({ id: `task-${index}`, title: `Task ${index}` }),
    );

    const wrapper = await mountPage(tasks);

    expect(apiMocks.listTasks).toHaveBeenCalledWith("proj-1");
    expect(wrapper.text()).toContain(`当前仅显示最近 ${TASK_LIST_LIMIT} 条任务`);
  });

  it("filters task list by search keyword", async () => {
    const wrapper = await mountPage([
      makeTask({ id: "task-alpha", title: "Alpha task", repoName: "repo-a" }),
      makeTask({ id: "task-beta", title: "Beta task", repoName: "repo-b" }),
    ]);

    const searchInput = wrapper.find('input[placeholder="搜索标题 / 仓库"]');
    await searchInput.setValue("beta");
    await flushPromises();

    const rowTexts = wrapper.findAll("tbody tr").map((node) => node.text().replace(/\s+/g, ""));
    expect(rowTexts.some((text) => text.includes("Betatask"))).toBe(true);
    expect(rowTexts.some((text) => text.includes("Alphatask"))).toBe(false);
  });

  it("executes pending task and refreshes the list", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-exec", status: "pending" })]);

    const state = getSetupState(wrapper) as {
      handleExecute: (taskId: string) => Promise<void>;
    };
    await state.handleExecute("task-exec");
    await flushPromises();

    expect(apiMocks.executeTask).toHaveBeenCalledWith("task-exec");
    expect(apiMocks.getTask).toHaveBeenCalledWith("task-exec");
    expect(apiMocks.listTasks).toHaveBeenCalledTimes(2);
  });

  it("keeps locally created task in running state when immediate execute settles after list refresh", async () => {
    const wrapper = await mountPage([]);

    apiMocks.createTask.mockResolvedValueOnce({ id: "task-created" });
    apiMocks.executeTask.mockResolvedValueOnce({});
    apiMocks.getTask.mockResolvedValueOnce(
      makeTask({
        id: "task-created",
        title: "Immediate execute task",
        prompt: "run immediately",
        status: "running",
        startedAt: "2026-03-10T00:00:30.000Z",
      }),
    );
    apiMocks.listTasks.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
      data: [
        makeTask({
          id: "task-created",
          title: "Immediate execute task",
          prompt: "run immediately",
          status: "pending",
          startedAt: undefined,
          finishedAt: undefined,
        }),
      ],
    });

    const state = getSetupState(wrapper) as {
      createForm: {
        title: string;
        prompt: string;
        autoExecute: boolean;
      };
      handleCreate: () => Promise<void>;
      filteredTasks: Task[];
    };

    state.createForm.title = "Immediate execute task";
    state.createForm.prompt = "run immediately";
    state.createForm.autoExecute = true;

    await state.handleCreate();
    await flushPromises();

    expect(apiMocks.executeTask).toHaveBeenCalledWith("task-created");
    expect(state.filteredTasks[0]?.status).toBe("running");
  });

  it("cancels running task from list action", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-run", status: "running" })]);

    const state = getSetupState(wrapper) as {
      handleCancel: (taskId: string) => Promise<void>;
    };
    await state.handleCancel("task-run");
    await flushPromises();

    expect(apiMocks.updateTaskStatus).toHaveBeenCalledWith("task-run", "cancelled");
  });

  it("loads built-in task templates when localStorage is empty", async () => {
    const wrapper = await mountPage([]);

    const state = getSetupState(wrapper) as {
      taskTemplates: Array<{ name: string; title: string; prompt: string }>;
    };

    expect(state.taskTemplates.length).toBeGreaterThan(0);
    expect(state.taskTemplates.map((template) => template.name)).toContain("常规缺陷修复");
  });

  it("saves task template to localStorage", async () => {
    const wrapper = await mountPage([]);

    const state = getSetupState(wrapper) as {
      createForm: { title: string; prompt: string };
      saveAsTemplate: () => void;
    };
    state.createForm.title = "常规修复模板";
    state.createForm.prompt = "请先复现问题，再提交最小修复。\n补充验证步骤。";
    await flushPromises();

    state.saveAsTemplate();
    await flushPromises();

    expect(localStorage.getItem("openerx-task-templates")).toContain("常规修复模板");
  });

  it("shows a multi task monitor shortcut for each task row", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-monitor", title: "Monitor me" })]);

    const monitorLink = wrapper.find('a[data-to="/multi-task-monitor?task=task-monitor"]');
    expect(monitorLink.exists()).toBe(true);
    expect(monitorLink.text()).toContain("监控台");
  });

  it("applies recommended scenario from route query into create form", async () => {
    routeMocks.query = {
      projectId: "proj-1",
      scenarioKey: "release-guard",
      openCreate: "1",
    };
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
              requiredRoleHints: [],
              reason: "Release window",
            },
          ],
        },
      },
    });

    const wrapper = await mountPage([]);
    const state = getSetupState(wrapper) as {
      createForm: { operatingMode?: { scenarioKey?: string; selectedTemplateId?: string | null } };
    };

    expect(state.createForm.operatingMode?.scenarioKey).toBe("release-guard");
    expect(state.createForm.operatingMode?.selectedTemplateId).toBe("tpl-release");
  });

  it("sends task operating mode when creating a task", async () => {
    const wrapper = await mountPage([]);
    const state = getSetupState(wrapper) as {
      createForm: {
        title: string;
        prompt: string;
        autoExecute: boolean;
        operatingMode?: Record<string, unknown>;
      };
      handleCreate: () => Promise<void>;
    };

    state.createForm.title = "Scenario task";
    state.createForm.prompt = "use recommended mode";
    state.createForm.autoExecute = false;
    state.createForm.operatingMode = {
      collaborationMode: "team",
      autopilotLevel: "L1",
      bossParticipationMode: "advisory",
      selectedTemplateId: "tpl-release",
      scenarioKey: "release-guard",
      source: "task-override",
    };

    await state.handleCreate();
    await flushPromises();

    expect(apiMocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        operatingMode: expect.objectContaining({
          scenarioKey: "release-guard",
          selectedTemplateId: "tpl-release",
        }),
      }),
    );
  });

  it("applies relation context from route query and sends it on task creation", async () => {
    routeMocks.query = {
      projectId: "proj-1",
      openCreate: "1",
      spawnedFromTaskId: "task-parent",
      dependsOnTaskId: "task-parent,task-upstream",
      blocksTaskId: "task-blocked",
    };

    const wrapper = await mountPage([]);
    const state = getSetupState(wrapper) as {
      createForm: {
        title: string;
        prompt: string;
        autoExecute: boolean;
        relationContext?: {
          spawnedFromTaskId?: string;
          dependsOnTaskIds?: string[];
          blocksTaskIds?: string[];
        };
      };
      handleCreate: () => Promise<void>;
    };

    expect(state.createForm.relationContext).toEqual({
      spawnedFromTaskId: "task-parent",
      dependsOnTaskIds: ["task-parent", "task-upstream"],
      blocksTaskIds: ["task-blocked"],
    });

    state.createForm.title = "Follow-up task";
    state.createForm.prompt = "continue from parent";
    state.createForm.autoExecute = false;

    await state.handleCreate();
    await flushPromises();

    expect(apiMocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        relationContext: {
          spawnedFromTaskId: "task-parent",
          dependsOnTaskIds: ["task-parent", "task-upstream"],
          blocksTaskIds: ["task-blocked"],
        },
      }),
    );
  });
});
