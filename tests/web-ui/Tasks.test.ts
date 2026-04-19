import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import type { Task } from "../../control-plane/web-ui/src/lib/api";
import Tasks from "../../control-plane/web-ui/src/pages/Tasks.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";
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
  listCommands: vi.fn(),
  getModelsList: vi.fn(),
  getOrchestrationStrategy: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  executeTask: vi.fn(),
  getTaskExecutionPreflight: vi.fn(),
  getTask: vi.fn(),
  updateTask: vi.fn(),
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
    props: ["dataSource", "columns", "pagination", "rowSelection"],
    emits: ["change"],
    setup(props, { slots, emit }) {
      return () => {
        const dataSource = (props.dataSource as Record<string, unknown>[] | undefined) ?? [];
        const pagination =
          props.pagination && typeof props.pagination === "object"
            ? (props.pagination as {
                current?: number;
                pageSize?: number;
                total?: number;
                showSizeChanger?: boolean;
                pageSizeOptions?: string[];
                showTotal?: (total: number, range: [number, number]) => string;
              })
            : undefined;
        const pageSize = Math.max(Number(pagination?.pageSize ?? dataSource.length ?? 1), 1);
        const current = Math.max(Number(pagination?.current ?? 1), 1);
        const total = Number(pagination?.total ?? dataSource.length);
        const startIndex = Math.max(0, (current - 1) * pageSize);
        const visibleRows = dataSource.slice(startIndex, startIndex + pageSize);
        const rangeStart = total === 0 ? 0 : startIndex + 1;
        const rangeEnd = total === 0 ? 0 : Math.min(total, startIndex + visibleRows.length);
        const summary =
          typeof pagination?.showTotal === "function"
            ? pagination.showTotal(total, [rangeStart, rangeEnd])
            : "";
        const pageSizeOptions = pagination?.pageSizeOptions ?? ["10", "20", "50", "100"];

        return h(
          "div",
          { "data-component": "ATable" },
          [
            visibleRows.length === 0
              ? slots.emptyText
                ? slots.emptyText()
                : []
              : visibleRows.flatMap((record) =>
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
            pagination
              ? h("div", { "data-component": "ATablePagination" }, [
                  summary
                    ? h("div", { "data-role": "pagination-total" }, summary)
                    : null,
                  pagination.showSizeChanger
                    ? h(
                        "select",
                        {
                          "data-role": "page-size",
                          value: String(pageSize),
                          onChange: (event: Event) => {
                            emit("change", {
                              current: 1,
                              pageSize: Number((event.target as HTMLSelectElement).value),
                            });
                          },
                        },
                        pageSizeOptions.map((option) =>
                          h("option", { key: option, value: option }, option),
                        ),
                      )
                    : null,
                ])
              : null,
          ],
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

async function mountPage(
  tasks = [makeTask()],
  listResponse: Partial<{ totalCount: number; limit: number; truncated: boolean }> = {},
) {
  const pinia = createPinia();
  setActivePinia(pinia);

  const authStore = useAuthStore();
  authStore.user = {
    id: "user-1",
    username: "admin",
    role: "admin",
  } as never;

  const projectStore = useProjectStore();
  projectStore.projects = [{ id: "proj-1", orgId: "org-1", name: "Default", slug: "default" }];
  projectStore.currentProjectId = "proj-1";

  apiMocks.listTasks.mockResolvedValue({
    data: tasks,
    totalCount: listResponse.totalCount ?? tasks.length,
    limit: listResponse.limit ?? TASK_LIST_LIMIT,
    truncated: listResponse.truncated ?? false,
  });
  apiMocks.listRepositories.mockResolvedValue({ data: [] });
  apiMocks.listCredentials.mockResolvedValue({ data: [] });
  apiMocks.listCommands.mockResolvedValue({ data: [] });
  apiMocks.getModelsList.mockResolvedValue({ data: [] });
  apiMocks.getOrchestrationStrategy.mockResolvedValue({
    data: {
      organizationSettings: {
        recommendedProfiles: [],
      },
    },
  });
  apiMocks.createTask.mockResolvedValue({ id: "task-created" });
  apiMocks.deleteTask.mockResolvedValue({});
  apiMocks.executeTask.mockResolvedValue({});
  apiMocks.getTaskExecutionPreflight.mockResolvedValue({
    taskId: "task-created",
    allowed: true,
    effectiveModel: "github-copilot:gpt-5-mini",
    policy: {
      providerId: "github-copilot",
      modelId: "gpt-5-mini",
      modelRoute: "github-copilot:gpt-5-mini",
      environment: "dev",
      costTier: "free",
      isPaid: false,
      defaultDecision: "allow",
      maxRequestsPerRun: 20,
      maxEstimatedCostUsdPerRun: 0,
      maxParallelCandidates: 4,
      allowJudge: true,
      allowHooks: true,
      suggestedModel: undefined,
    },
    preflight: {
      providerId: "github-copilot",
      modelId: "gpt-5-mini",
      requestCount: { min: 1, max: 1 },
      inputTokens: { min: 1, max: 1 },
      outputTokens: { min: 1, max: 1 },
      totalTokens: { min: 2, max: 2 },
      costUsd: { min: 0, max: 0 },
      riskDrivers: [],
      budgetHeadroom: { remainingUsd: null, enoughForSingleRun: true, enoughForSuiteRun: true },
      guardDecision: "allow",
      guardReason: "ok",
      generatedAt: "2026-03-10T00:00:00.000Z",
    },
  });
  apiMocks.getTask.mockResolvedValue(makeTask({ id: "task-created", status: "running" }));
  apiMocks.updateTask.mockResolvedValue({});
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
            return () =>
              h(
                "a",
                { "data-to": typeof props.to === "string" ? props.to : String(props.to ?? "") },
                slots.default ? slots.default() : undefined,
              );
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
  it("renders task rows directly from listTasks without hydrating per-task detail on first load", async () => {
    apiMocks.getTask.mockResolvedValue(
      makeTask({ id: "task-list-row", title: "Detail title should not appear" }),
    );

    const wrapper = await mountPage([
      makeTask({ id: "task-list-row", title: "List row title", status: "running" }),
    ]);

    expect(wrapper.text()).toContain("List row title");
    expect(wrapper.text()).not.toContain("Detail title should not appear");
    expect(apiMocks.getTask).not.toHaveBeenCalled();
  });

  it("shows true total count when backend reports a truncated task window", async () => {
    const tasks = Array.from({ length: 50 }, (_, index) =>
      makeTask({ id: `task-${index}`, title: `Task ${index}` }),
    );

    const wrapper = await mountPage(tasks, {
      totalCount: 80,
      limit: 50,
      truncated: true,
    });

    expect(apiMocks.listTasks).toHaveBeenCalledWith("proj-1", undefined);
    expect(wrapper.text()).toContain("共 80 个任务，当前窗口显示 50 个");
    expect(wrapper.text()).toContain("当前窗口显示 50 / 共 80 条任务");
    const pagination = wrapper.getComponent({ name: "ATable" }).props("pagination") as {
      total: number;
      showTotal: (total: number, range: [number, number]) => string;
    };
    expect(pagination.total).toBe(50);
    expect(pagination.showTotal(pagination.total, [1, 20])).toContain(
      "第 1-20 条，共 50 条，任务总数 80 条",
    );
  });

  it("updates the table page size when the user switches the per-page selector", async () => {
    const tasks = Array.from({ length: 30 }, (_, index) =>
      makeTask({ id: `task-${index}`, title: `Task ${index}` }),
    );

    const wrapper = await mountPage(tasks);

    const table = wrapper.getComponent({ name: "ATable" });
    let pagination = table.props("pagination") as {
      current: number;
      pageSize: number;
      total: number;
      showSizeChanger: boolean;
    };

    expect(pagination.current).toBe(1);
    expect(pagination.pageSize).toBe(20);
    expect(pagination.total).toBe(30);
    expect(pagination.showSizeChanger).toBe(true);

    table.vm.$emit("change", { current: 1, pageSize: 10 });
    await flushPromises();

    pagination = table.props("pagination") as {
      current: number;
      pageSize: number;
      total: number;
      showTotal: (total: number, range: [number, number]) => string;
    };

    expect(pagination.current).toBe(1);
    expect(pagination.pageSize).toBe(10);
    expect(pagination.showTotal(pagination.total, [1, 10])).toContain("第 1-10 条，共 30 条");
  });

  it("refetches the task list with the selected status filter", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-running", status: "running" })]);

    apiMocks.listTasks.mockResolvedValueOnce({
      data: [makeTask({ id: "task-done", status: "completed", title: "Completed task" })],
      totalCount: 1,
      limit: TASK_LIST_LIMIT,
      truncated: false,
    });

    const state = getSetupState(wrapper) as {
      setStatusFilter: (value: unknown) => void;
    };
    state.setStatusFilter("completed");
    await flushPromises();

    expect(apiMocks.listTasks).toHaveBeenLastCalledWith("proj-1", "completed");
    expect(wrapper.text()).toContain("当前状态共 1 个任务");
  });

  it("filters task list by search keyword", async () => {
    const wrapper = await mountPage([
      makeTask({ id: "task-alpha", title: "Alpha task", repoName: "repo-a" }),
      makeTask({ id: "task-beta", title: "Beta task", repoName: "repo-b" }),
    ]);

    const searchInput = wrapper.find('input[placeholder="搜索标题 / 仓库"]');
    await searchInput.setValue("beta");
    await flushPromises();

    const state = getSetupState(wrapper) as { filteredTasks: Task[] };
    expect(state.filteredTasks.map((task) => task.id)).toEqual(["task-beta"]);
  });

  it("starts pending task through preflight and returns the settled snapshot", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-exec", status: "pending" })]);

    const state = getSetupState(wrapper) as {
      attemptTaskExecution: (taskId: string) => Promise<Task | undefined | null>;
    };
    const latestTask = await state.attemptTaskExecution("task-exec");
    await flushPromises();

    expect(apiMocks.getTaskExecutionPreflight).toHaveBeenCalledWith("task-exec");
    expect(apiMocks.executeTask).toHaveBeenCalledWith("task-exec");
    expect(apiMocks.getTask).toHaveBeenCalledWith("task-exec");
    expect(latestTask?.status).toBe("running");
  });

  it("links completed task titles to the workbench task view", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-done", status: "completed" })]);

    const workbenchLink = wrapper.find('a[data-to="/workbench?task=task-done"]');
    expect(workbenchLink.exists()).toBe(true);
    expect(workbenchLink.text()).toContain("Fix login flow");
  });

  it("keeps explicit completed status for parallel tasks without a winner", async () => {
    const wrapper = await mountPage([
      makeTask({
        id: "task-awaiting-adoption",
        status: "completed",
        executionMode: "parallel",
        orchestrationKind: "parallel",
        currentRunCandidateCount: 2,
      }),
    ]);

    await flushPromises();

    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).not.toContain("待采纳");
  });

  it("downgrades model and retries when preflight asks for allow-with-downgrade", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    apiMocks.getTaskExecutionPreflight
      .mockResolvedValueOnce({
        taskId: "task-exec",
        allowed: false,
        effectiveModel: "github-copilot:gpt-5.4",
        policy: {
          providerId: "github-copilot",
          modelId: "gpt-5.4",
          modelRoute: "github-copilot:gpt-5.4",
          environment: "dev",
          costTier: "premium",
          isPaid: true,
          defaultDecision: "require-approval",
          maxRequestsPerRun: 2,
          maxEstimatedCostUsdPerRun: 5,
          maxParallelCandidates: 1,
          allowJudge: false,
          allowHooks: false,
          suggestedModel: "github-copilot:gpt-5-mini",
        },
        preflight: {
          providerId: "github-copilot",
          modelId: "gpt-5.4",
          requestCount: { min: 1, max: 2 },
          inputTokens: { min: 1, max: 2 },
          outputTokens: { min: 1, max: 2 },
          totalTokens: { min: 2, max: 4 },
          costUsd: { min: 1, max: 2 },
          riskDrivers: [],
          budgetHeadroom: { remainingUsd: 0, enoughForSingleRun: false, enoughForSuiteRun: false },
          guardDecision: "allow-with-downgrade",
          guardReason: "Retry with github-copilot:gpt-5-mini",
          generatedAt: "2026-03-10T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        taskId: "task-exec",
        allowed: true,
        effectiveModel: "github-copilot:gpt-5-mini",
        policy: {
          providerId: "github-copilot",
          modelId: "gpt-5-mini",
          modelRoute: "github-copilot:gpt-5-mini",
          environment: "dev",
          costTier: "free",
          isPaid: false,
          defaultDecision: "allow",
          maxRequestsPerRun: 20,
          maxEstimatedCostUsdPerRun: 0,
          maxParallelCandidates: 4,
          allowJudge: true,
          allowHooks: true,
          suggestedModel: undefined,
        },
        preflight: {
          providerId: "github-copilot",
          modelId: "gpt-5-mini",
          requestCount: { min: 1, max: 1 },
          inputTokens: { min: 1, max: 1 },
          outputTokens: { min: 1, max: 1 },
          totalTokens: { min: 2, max: 2 },
          costUsd: { min: 0, max: 0 },
          riskDrivers: [],
          budgetHeadroom: { remainingUsd: null, enoughForSingleRun: true, enoughForSuiteRun: true },
          guardDecision: "allow",
          guardReason: "ok",
          generatedAt: "2026-03-10T00:00:00.000Z",
        },
      });

    const wrapper = await mountPage([makeTask({ id: "task-exec", status: "pending" })]);

    const state = getSetupState(wrapper) as {
      attemptTaskExecution: (taskId: string) => Promise<Task | undefined | null>;
    };
    await state.attemptTaskExecution("task-exec");
    await flushPromises();

    expect(apiMocks.updateTask).toHaveBeenCalledWith("task-exec", {
      selectedModel: "github-copilot:gpt-5-mini",
    });
    expect(apiMocks.executeTask).toHaveBeenCalledWith("task-exec");
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

  it("deletes task from list action helper", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-run", status: "running" })]);

    const state = getSetupState(wrapper) as {
      handleDelete: (taskId: string) => Promise<void>;
    };
    await state.handleDelete("task-run");
    await flushPromises();

    expect(apiMocks.deleteTask).toHaveBeenCalledWith("task-run");
  });

  it("clears existing selection after single-row delete succeeds", async () => {
    const wrapper = await mountPage([
      makeTask({ id: "task-1", title: "Task 1" }),
      makeTask({ id: "task-2", title: "Task 2" }),
    ]);

    const state = getSetupState(wrapper) as {
      selectedTaskIds: string[];
      handleDelete: (taskId: string) => Promise<void>;
      handleTaskSelectionChange: (keys: string[]) => void;
    };

    state.handleTaskSelectionChange(["task-2"]);
    await flushPromises();

    expect(state.selectedTaskIds).toEqual(["task-2"]);

    await state.handleDelete("task-1");
    await flushPromises();

    expect(state.selectedTaskIds).toEqual([]);
  });

  it("supports selecting multiple tasks and deleting them together", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = await mountPage([
      makeTask({ id: "task-1", title: "Task 1" }),
      makeTask({ id: "task-2", title: "Task 2" }),
    ]);

    const table = wrapper.getComponent({ name: "ATable" });
    expect(table.props("rowSelection")).toBeTruthy();
    expect(wrapper.text()).toContain("勾选任务后可批量删除");

    const state = getSetupState(wrapper) as {
      selectedTaskIds: string[];
      handleTaskSelectionChange: (keys: string[]) => void;
      handleBulkDeleteClick: () => Promise<void>;
    };

    state.handleTaskSelectionChange(["task-1", "task-2"]);
    await flushPromises();

    expect(state.selectedTaskIds).toEqual(["task-1", "task-2"]);
    expect(wrapper.text()).toContain("已选 2 个任务，可批量删除");

    await state.handleBulkDeleteClick();
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(apiMocks.deleteTask).toHaveBeenNthCalledWith(1, "task-1");
    expect(apiMocks.deleteTask).toHaveBeenNthCalledWith(2, "task-2");
    expect(apiMocks.listTasks).toHaveBeenCalled();
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

  it("navigates to recommended scenarios from the header action", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-p", status: "pending" })]);

    const scenarioButton = wrapper
      .findAll("button")
      .find((node) => node.text().includes("推荐场景"));

    expect(scenarioButton).toBeTruthy();
    await scenarioButton!.trigger("click");
    await flushPromises();

    expect(routerMocks.push).toHaveBeenCalledWith("/projects/proj-1/recommended-scenarios");
  });

  it("navigates to task graph from the header action", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-sc", status: "pending" })]);

    const taskGraphButton = wrapper.findAll("button").find((node) => node.text().includes("任务总图"));

    expect(taskGraphButton).toBeTruthy();
    await taskGraphButton!.trigger("click");
    await flushPromises();

    expect(routerMocks.push).toHaveBeenCalledWith("/projects/proj-1/task-graph");
  });

  it("opens the create modal from the header action", async () => {
    const wrapper = await mountPage([makeTask({ id: "task-modal", status: "pending" })]);

    const state = getSetupState(wrapper) as {
      showCreateModal: boolean;
    };

    const createButton = wrapper.findAll("button").find((node) => node.text().includes("新建任务"));
    expect(createButton).toBeTruthy();
    await createButton!.trigger("click");
    await flushPromises();

    expect(state.showCreateModal).toBe(true);
  });
});
