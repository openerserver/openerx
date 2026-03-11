import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive } from "vue";
import TaskDetail from "../../control-plane/web-ui/src/pages/TaskDetail.vue";

const routeState = vi.hoisted(() => ({
  params: { taskId: "task-1" },
}));

const realtimeBase = vi.hoisted(() => ({
  events: [] as Array<{
    id: string;
    type: string;
    ts: string;
    taskId?: string;
    data: Record<string, unknown>;
  }>,
  subscribeTask: vi.fn(),
}));

const realtimeState = reactive(realtimeBase);

const apiMocks = vi.hoisted(() => ({
  continueTask: vi.fn(),
  getTask: vi.fn(),
  getTaskGovernance: vi.fn(),
  getTaskPipeline: vi.fn(),
  getTaskSessions: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
}));

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeState,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("../../control-plane/web-ui/src/components/AgentConsole.vue", () => ({
  default: defineComponent({ name: "AgentConsole", template: "<div />" }),
}));

vi.mock("../../control-plane/web-ui/src/components/TaskGraph.vue", () => ({
  default: defineComponent({ name: "TaskGraph", template: "<div />" }),
}));

vi.mock("../../control-plane/web-ui/src/components/TaskCodeChanges.vue", () => ({
  default: defineComponent({ name: "TaskCodeChanges", template: "<div />" }),
}));

vi.mock("ant-design-vue", async () => {
  const vue = await import("vue");

  const simple = (name: string, tag = "div") =>
    vue.defineComponent({
      name,
      inheritAttrs: false,
      props: ["title", "description", "message", "open", "column", "dataSource", "columns"],
      emits: ["click", "ok", "cancel", "update:open"],
      setup(props, { slots, emit, attrs }) {
        return () =>
          vue.h(
            tag,
            {
              ...attrs,
              "data-component": name,
              onClick: (event: Event) => emit("click", event),
            },
            slots.default ? slots.default() : props.message || props.description || props.title,
          );
      },
    });

  const AButton = vue.defineComponent({
    name: "AButton",
    inheritAttrs: false,
    props: ["disabled", "loading", "type", "size"],
    emits: ["click"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        vue.h(
          "button",
          {
            ...attrs,
            type: "button",
            disabled: Boolean(props.disabled) || Boolean(props.loading),
            onClick: (event: Event) => emit("click", event),
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const ATextarea = vue.defineComponent({
    name: "ATextarea",
    inheritAttrs: false,
    props: ["value", "rows", "placeholder"],
    emits: ["update:value"],
    setup(props, { emit, attrs }) {
      return () =>
        vue.h("textarea", {
          ...attrs,
          value: String(props.value ?? ""),
          placeholder: props.placeholder,
          onInput: (event: Event) =>
            emit("update:value", (event.target as HTMLTextAreaElement).value),
        });
    },
  });

  type TableColumn = { key?: unknown; dataIndex?: unknown };

  function getColumnKey(column: TableColumn) {
    return String(column.key ?? column.dataIndex ?? "");
  }

  function getColumnDataIndex(column: TableColumn) {
    return typeof column.dataIndex === "string" ? column.dataIndex : "";
  }

  function renderTableCell(
    column: TableColumn,
    record: unknown,
    index: number,
    bodyCell:
      | ((args: { column: TableColumn; record: unknown; index: number }) => unknown[])
      | undefined,
  ) {
    const dataIndex = getColumnDataIndex(column);
    const slotContent = bodyCell ? bodyCell({ column, record, index }) : undefined;
    const fallback =
      dataIndex && typeof record === "object" && record
        ? (record as Record<string, unknown>)[dataIndex]
        : undefined;
    const children =
      slotContent && slotContent.length > 0 ? (slotContent as never[]) : String(fallback ?? "");

    return vue.h("div", { key: `${index}-${getColumnKey(column)}` }, children);
  }

  function renderTableRows(
    dataSource: unknown,
    columns: unknown,
    bodyCell:
      | ((args: { column: TableColumn; record: unknown; index: number }) => unknown[])
      | undefined,
  ) {
    if (!Array.isArray(dataSource) || !Array.isArray(columns)) {
      return [];
    }

    return dataSource.flatMap((record, index) =>
      columns.map((column) => renderTableCell(column as TableColumn, record, index, bodyCell)),
    );
  }

  const ATable = vue.defineComponent({
    name: "ATable",
    inheritAttrs: false,
    props: ["dataSource", "columns"],
    setup(props, { slots, attrs }) {
      return () =>
        vue.h(
          "div",
          { ...attrs, "data-component": "ATable" },
          renderTableRows(props.dataSource, props.columns, slots.bodyCell),
        );
    },
  });

  return {
    message: {
      success: vi.fn(),
      error: vi.fn(),
    },
    AButton,
    ATextarea,
    AFlex: simple("AFlex"),
    ATypographyTitle: simple("ATypographyTitle", "h3"),
    ATypographyText: simple("ATypographyText", "span"),
    ARow: simple("ARow"),
    ACol: simple("ACol"),
    ACard: simple("ACard"),
    AEmpty: simple("AEmpty"),
    ASpace: simple("ASpace"),
    ADescriptions: simple("ADescriptions"),
    ADescriptionsItem: simple("ADescriptionsItem"),
    ATag: simple("ATag", "span"),
    AProgress: simple("AProgress"),
    AAlert: simple("AAlert"),
    ASpin: simple("ASpin"),
    AList: simple("AList"),
    AListItem: simple("AListItem"),
    ASteps: simple("ASteps"),
    AStep: simple("AStep"),
    ACollapse: simple("ACollapse"),
    ACollapsePanel: simple("ACollapsePanel"),
    AModal: simple("AModal"),
    AForm: simple("AForm", "form"),
    AFormItem: simple("AFormItem"),
    ATable,
  };
});

function makeTask(strategy?: Record<string, unknown>) {
  return {
    id: "task-1",
    projectId: "proj-1",
    userId: "user-1",
    title: "Workflow task",
    prompt: "review workflow",
    status: "completed",
    sessionId: "ses-1",
    agentRunId: "run-1",
    selectedModel: "github-copilot:model-a",
    category: "quick",
    strategy: strategy ? JSON.stringify(strategy) : undefined,
    createdAt: "2026-03-10T12:00:00.000Z",
    startedAt: "2026-03-10T12:00:10.000Z",
    finishedAt: "2026-03-10T12:01:00.000Z",
  };
}

function makeTaskWithOverrides(overrides: Record<string, unknown> = {}) {
  return {
    ...makeTask(),
    ...overrides,
  };
}

async function mountPage() {
  const wrapper = mount(TaskDetail);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  realtimeState.events.splice(0, realtimeState.events.length);
  realtimeState.subscribeTask.mockReset();
  routeState.params.taskId = "task-1";
  apiMocks.getTaskPipeline.mockResolvedValue({ stages: [] });
  apiMocks.getTaskSessions.mockResolvedValue({ data: [] });
  apiMocks.getTaskGovernance.mockResolvedValue({
    overallRisk: "low",
    approvalRequired: false,
    violations: [],
  });
});

describe("TaskDetail", () => {
  it("subscribes to the task and refreshes when hooks event arrives", async () => {
    apiMocks.getTask.mockResolvedValueOnce(makeTask()).mockResolvedValueOnce(
      makeTask({
        selectedAgent: "build",
        hookExecutions: [
          {
            hookId: "post-1",
            trigger: "post-execution",
            status: "completed",
            agent: "build",
            result: "Looks good.",
            completedAt: "2026-03-10T12:01:10.000Z",
          },
        ],
      }),
    );

    const wrapper = await mountPage();

    expect(realtimeState.subscribeTask).toHaveBeenCalledWith("task-1");
    expect(apiMocks.getTask).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("编排决策");

    realtimeState.events.unshift({
      id: "evt-1",
      type: "task.hooks.updated",
      ts: new Date().toISOString(),
      taskId: "task-1",
      data: { phase: "postExecution" },
    });

    await nextTick();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(apiMocks.getTask).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Hook 执行记录");
    expect(wrapper.text()).toContain("Looks good.");
  });

  it("bootstraps task detail data when initial load is still pending and no realtime event has arrived", async () => {
    realtimeState.events.unshift({
      id: "evt-created",
      type: "task.created",
      ts: new Date().toISOString(),
      taskId: "task-1",
      data: { title: "Workflow task" },
    });

    apiMocks.getTask
      .mockResolvedValueOnce(
        makeTaskWithOverrides({
          status: "pending",
          sessionId: undefined,
          agentRunId: undefined,
          selectedModel: undefined,
          category: undefined,
          strategy: undefined,
        }),
      )
      .mockResolvedValueOnce(
        makeTask({
          selectedAgent: "build",
          hookExecutions: [
            {
              hookId: "post-1",
              trigger: "post-execution",
              status: "completed",
              agent: "build",
              result: "Settled without manual refresh.",
              completedAt: "2026-03-10T12:01:10.000Z",
            },
          ],
        }),
      );

    const wrapper = await mountPage();

    expect(apiMocks.getTask).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("暂无编排数据");

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(apiMocks.getTask).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Hook 执行记录");
    expect(wrapper.text()).toContain("Settled without manual refresh.");
  });

  it("renders parallel candidates with labels, winner tag and judge result", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            {
              label: "候选 1",
              agent: "build",
              model: "github-copilot:claude-sonnet-4",
              status: "completed",
              result: "Candidate one result",
            },
            {
              label: "候选 2",
              agent: "oracle-enterprise",
              status: "completed",
              result: "Candidate two result",
            },
          ],
          judgeResult: {
            winnerIndex: 1,
            scores: [82.5, 91.2],
            reasoning: "候选 2 更完整，风险更低。",
          },
        }),
        strategy: JSON.stringify({
          selectedAgent: "build",
          executionMode: "parallel",
          suggestedAgents: ["build", "oracle-enterprise"],
        }),
      }),
    );

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("并行执行候选");
    expect(wrapper.text()).toContain("候选 1");
    expect(wrapper.text()).toContain("候选 2");
    expect(wrapper.text()).toContain("获胜");
    expect(wrapper.text()).toContain("裁判评估结果");
    expect(wrapper.text()).toContain("候选 2 更完整，风险更低。");
    expect(wrapper.text()).toContain("候选 1: 82.5");
    expect(wrapper.text()).toContain("候选 2: 91.2");
  });

  it("falls back to generated candidate labels for legacy parallel execution plans", async () => {
    apiMocks.getTask.mockResolvedValueOnce(
      makeTaskWithOverrides({
        executionMode: "parallel",
        executionPlan: JSON.stringify({
          mode: "parallel",
          candidates: [
            {
              agent: "build",
              status: "completed",
            },
            {
              agent: "oracle-enterprise",
              status: "failed",
            },
          ],
        }),
        strategy: JSON.stringify({ executionMode: "parallel" }),
      }),
    );

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("候选 1");
    expect(wrapper.text()).toContain("候选 2");
  });
});
