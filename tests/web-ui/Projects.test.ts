import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../control-plane/web-ui/src/lib/api";
import Projects from "../../control-plane/web-ui/src/pages/Projects.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

const modalMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  archiveProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  listOrgs: vi.fn(),
  listProjects: vi.fn(),
  listProjectOverview: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("vue-router", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("ant-design-vue", async () => {
  const vue = await import("vue");
  const { defineComponent, h } = vue;

  const inputLike = (name: string, tag: "input" | "textarea" = "input") =>
    defineComponent({
      name,
      inheritAttrs: false,
      props: ["value"],
      emits: ["update:value", "change"],
      setup(props, { emit, attrs }) {
        return () =>
          h(tag, {
            ...attrs,
            value: String(props.value ?? ""),
            onInput: (event: Event) =>
              emit("update:value", (event.target as HTMLInputElement | HTMLTextAreaElement).value),
            onChange: (event: Event) => emit("change", event),
          });
      },
    });

  const buttonLike = defineComponent({
    name: "AButton",
    inheritAttrs: false,
    props: ["loading"],
    emits: ["click"],
    setup(props, { emit, slots, attrs }) {
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

  const simple = (name: string, tag = "div") =>
    defineComponent({
      name,
      inheritAttrs: false,
      props: ["open", "title", "confirmLoading"],
      emits: ["ok", "update:open", "change", "click"],
      setup(props, { slots, emit, attrs }) {
        return () =>
          h(
            tag,
            {
              ...attrs,
              "data-component": name,
              "data-open": String(Boolean(props.open)),
              onClick: (event: Event) => emit("click", event),
            },
            [
              slots.default ? slots.default() : undefined,
              h("button", {
                type: "button",
                "data-testid": `${name}-ok`,
                onClick: () => emit("ok"),
              }),
            ],
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
            value: String(props.value ?? ""),
            onChange: (event: Event) =>
              emit("update:value", (event.target as HTMLSelectElement).value),
          },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const ASelectOption = defineComponent({
    name: "ASelectOption",
    inheritAttrs: false,
    props: ["value"],
    setup(props, { slots }) {
      return () =>
        h(
          "option",
          { value: String(props.value ?? "") },
          slots.default ? slots.default() : undefined,
        );
    },
  });

  const ATable = defineComponent({
    name: "ATable",
    props: ["dataSource", "columns", "rowSelection"],
    setup(props, { slots }) {
      return () => {
        const rows = (props.dataSource as Array<Record<string, unknown>> | undefined) ?? [];
        const rowSelection = props.rowSelection as
          | {
              selectedRowKeys?: Array<string | number>;
              onChange?: (
                keys: Array<string | number>,
                rows: Array<Record<string, unknown>>,
              ) => void;
              getCheckboxProps?: (record: Record<string, unknown>) => { disabled?: boolean };
            }
          | undefined;
        const selectedKeys = new Set(
          (rowSelection?.selectedRowKeys ?? []).map((key) => String(key)),
        );
        return h(
          "div",
          { "data-component": "ATable" },
          rows.flatMap((record) => {
            const recordId = String(record.id ?? "");
            const checkboxProps = rowSelection?.getCheckboxProps?.(record) ?? {};
            const selectionControls = rowSelection
              ? [
                  h("input", {
                    type: "checkbox",
                    "data-testid": `select-row-${recordId}`,
                    checked: selectedKeys.has(recordId),
                    disabled: Boolean(checkboxProps.disabled),
                    onChange: (event: Event) => {
                      const checked = (event.target as HTMLInputElement).checked;
                      const nextKeys = new Set(selectedKeys);
                      if (checked) {
                        nextKeys.add(recordId);
                      } else {
                        nextKeys.delete(recordId);
                      }
                      const orderedKeys = Array.from(nextKeys);
                      rowSelection.onChange?.(
                        orderedKeys,
                        rows.filter((item) => orderedKeys.includes(String(item.id ?? ""))),
                      );
                    },
                  }),
                ]
              : [];

            return [
              ...selectionControls,
              ...(((props.columns as Array<Record<string, unknown>> | undefined) ?? []).map(
                (column) =>
                  h(
                    "div",
                    {
                      class: "table-cell",
                      "data-column-key": String(column.key ?? column.dataIndex ?? ""),
                      "data-record-id": recordId,
                    },
                    slots.bodyCell ? slots.bodyCell({ column, record }) : undefined,
                  ),
              ) as Array<ReturnType<typeof h>>),
            ];
          }),
        );
      };
    },
  });

  const ARouterLink = defineComponent({
    name: "RouterLink",
    props: ["to"],
    setup(_props, { slots }) {
      return () => h("a", {}, slots.default ? slots.default() : undefined);
    },
  });

  return {
    Modal: modalMocks,
    message: messageMocks,
    AButton: buttonLike,
    AInput: inputLike("AInput"),
    ATextarea: inputLike("ATextarea", "textarea"),
    AInputSearch: inputLike("AInputSearch"),
    ASelect,
    ASelectOption,
    AModal: simple("AModal"),
    AForm: simple("AForm"),
    AFormItem: simple("AFormItem"),
    ATable,
    ACard: simple("ACard"),
    AAlert: simple("AAlert"),
    ATag: simple("ATag", "span"),
    ATooltip: simple("ATooltip", "span"),
    ASpace: simple("ASpace"),
    AFlex: simple("AFlex"),
    ATypographyTitle: simple("ATypographyTitle", "h3"),
    ATypographyText: simple("ATypographyText", "span"),
    AProgress: simple("AProgress", "progress"),
    ADropdown: simple("ADropdown"),
    AMenu: simple("AMenu"),
    AMenuItem: simple("AMenuItem"),
    ASwitch: defineComponent({
      name: "ASwitch",
      props: ["checked"],
      emits: ["update:checked"],
      setup(props, { emit }) {
        return () =>
          h("input", {
            type: "checkbox",
            checked: Boolean(props.checked),
            onChange: (event: Event) =>
              emit("update:checked", (event.target as HTMLInputElement).checked),
          });
      },
    }),
    RouterLink: ARouterLink,
  };
});

function getSetupState(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  return (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState;
}

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);

  const authStore = useAuthStore();
  authStore.setUser({
    id: "user-1",
    username: "admin",
    displayName: "Admin",
    role: "org_admin",
    accountStatus: "active",
    mustChangePassword: false,
    projects: [{ id: "proj-default", role: "project_admin", name: "Default Project" }],
  });

  const wrapper = mount(Projects, {
    global: {
      plugins: [pinia],
      stubs: {
        RouterLink: {
          props: ["to"],
          template: "<a><slot /></a>",
        },
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();

  apiMocks.listProjects.mockResolvedValue([
    {
      id: "proj-default",
      orgId: "org-default",
      name: "Default Project",
      slug: "default-project",
    },
    {
      id: "proj-alpha-api",
      orgId: "org-default",
      name: "Alpha API",
      slug: "alpha-api",
    },
    {
      id: "proj-alpha-web",
      orgId: "org-default",
      name: "Alpha Web",
      slug: "alpha-web",
    },
  ]);
  apiMocks.listOrgs.mockResolvedValue([
    {
      id: "org-default",
      name: "Default Org",
      slug: "default",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
  ]);
  apiMocks.listProjectOverview.mockResolvedValue({
    data: [
      {
        id: "proj-default",
        orgId: "org-default",
        orgName: "Default Org",
        name: "Default Project",
        slug: "default-project",
        description: "seed project",
        projectStatus: "healthy",
        completionPercent: 100,
        completedCount: 5,
        totalRequiredCount: 5,
        risks: [],
        runningTasks: 0,
        activeSessionCount: 0,
        parallelTaskCount: 0,
        sequentialChainTaskCount: 0,
        recentTimelineItemCount: 0,
        failedTaskCount: 1,
        pendingApprovals: 0,
        failedTasksToday: 0,
        lastActivityAt: "2026-03-17T10:00:00.000Z",
        isCurrentUserManager: true,
        settings: {
          projectGroupKey: "existing-group",
          projectGroupLabel: "现有项目组",
        },
      },
      {
        id: "proj-alpha-api",
        orgId: "org-default",
        orgName: "Default Org",
        name: "Alpha API",
        slug: "alpha-api",
        description: "alpha api",
        projectStatus: "healthy",
        completionPercent: 100,
        completedCount: 5,
        totalRequiredCount: 5,
        risks: [],
        runningTasks: 0,
        activeSessionCount: 0,
        parallelTaskCount: 0,
        sequentialChainTaskCount: 0,
        recentTimelineItemCount: 0,
        failedTaskCount: 0,
        pendingApprovals: 0,
        failedTasksToday: 0,
        lastActivityAt: "2026-03-17T09:00:00.000Z",
        isCurrentUserManager: true,
        settings: null,
      },
      {
        id: "proj-alpha-web",
        orgId: "org-default",
        orgName: "Default Org",
        name: "Alpha Web",
        slug: "alpha-web",
        description: "alpha web",
        projectStatus: "healthy",
        completionPercent: 100,
        completedCount: 5,
        totalRequiredCount: 5,
        risks: [],
        runningTasks: 0,
        activeSessionCount: 0,
        parallelTaskCount: 0,
        sequentialChainTaskCount: 0,
        recentTimelineItemCount: 0,
        failedTaskCount: 0,
        pendingApprovals: 0,
        failedTasksToday: 0,
        lastActivityAt: "2026-03-17T08:00:00.000Z",
        isCurrentUserManager: true,
        settings: null,
      },
    ],
    summary: {
      totalProjects: 3,
      pendingConfigCount: 0,
      riskCount: 0,
      activeProjectCount: 0,
      runningTaskCount: 0,
      activeSessionCount: 0,
      parallelTaskCount: 0,
      sequentialChainTaskCount: 0,
      failedTaskCount: 1,
      recentTimelineItemCount: 0,
    },
    total: 3,
    page: 1,
  });
  apiMocks.createProject.mockResolvedValue({
    id: "proj-created",
    orgId: "org-default",
    name: "Created Project",
    slug: "created-project",
  } satisfies Project);
  apiMocks.deleteProject.mockResolvedValue({
    ok: true,
    id: "proj-default",
    deletedTaskCount: 0,
  });
  apiMocks.updateProject.mockResolvedValue({
    id: "proj-default",
    orgId: "org-default",
    name: "Updated Project",
    slug: "default-project",
  } satisfies Project);
});

describe("Projects page", () => {
  it("shows explicit and derived project group tags in the overview table", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("现有项目组");
    expect(wrapper.text()).toContain("显式");
    expect(wrapper.text()).toContain("alpha");
    expect(wrapper.text()).toContain("派生");
    expect(wrapper.text()).toContain("活跃项目");
    expect(wrapper.text()).toContain("并行 / 链式任务");
    expect(wrapper.text()).toContain("失败任务 / 24h 明细");
    expect(wrapper.text()).toContain("并行 0 / 链式 0 / 明细 0");
  });

  it("includes explicit project group settings when creating a project", async () => {
    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      createForm: {
        orgId: string;
        name: string;
        slug: string;
        description: string;
        projectGroupKey: string;
        projectGroupLabel: string;
      };
      handleCreate: () => Promise<void>;
    };

    setupState.createForm.orgId = "org-default";
    setupState.createForm.name = "Core Platform";
    setupState.createForm.slug = "core-platform";
    setupState.createForm.description = "核心平台项目";
    setupState.createForm.projectGroupKey = "core-platform";
    setupState.createForm.projectGroupLabel = "核心平台";

    await setupState.handleCreate();

    expect(apiMocks.createProject).toHaveBeenCalledWith({
      orgId: "org-default",
      name: "Core Platform",
      slug: "core-platform",
      description: "核心平台项目",
      settings: {
        projectGroupKey: "core-platform",
        projectGroupLabel: "核心平台",
      },
    });
  });

  it("persists explicit project group settings when editing a project", async () => {
    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      overviewRows: Array<Record<string, unknown>>;
      editForm: {
        name: string;
        description: string;
        projectGroupKey: string;
        projectGroupLabel: string;
      };
      openEdit: (record: Record<string, unknown>) => void;
      handleEdit: () => Promise<void>;
    };

    const firstRow = setupState.overviewRows[0];
    expect(firstRow).toBeDefined();
    if (!firstRow) throw new Error("Expected first overview row");
    setupState.openEdit(firstRow);
    expect(setupState.editForm.projectGroupKey).toBe("existing-group");
    expect(setupState.editForm.projectGroupLabel).toBe("现有项目组");

    setupState.editForm.name = "Default Project";
    setupState.editForm.description = "updated desc";
    setupState.editForm.projectGroupKey = "core-platform";
    setupState.editForm.projectGroupLabel = "核心平台";

    await setupState.handleEdit();

    expect(apiMocks.updateProject).toHaveBeenCalledWith("proj-default", {
      name: "Default Project",
      description: "updated desc",
      settings: {
        projectGroupKey: "core-platform",
        projectGroupLabel: "核心平台",
      },
    });
  });

  it("clears project group settings on edit when both fields are emptied", async () => {
    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      overviewRows: Array<Record<string, unknown>>;
      editForm: {
        name: string;
        description: string;
        projectGroupKey: string;
        projectGroupLabel: string;
      };
      openEdit: (record: Record<string, unknown>) => void;
      handleEdit: () => Promise<void>;
    };

    const firstRow = setupState.overviewRows[0];
    expect(firstRow).toBeDefined();
    if (!firstRow) throw new Error("Expected first overview row");
    setupState.openEdit(firstRow);
    setupState.editForm.name = "Default Project";
    setupState.editForm.description = "updated desc";
    setupState.editForm.projectGroupKey = "";
    setupState.editForm.projectGroupLabel = "";

    await setupState.handleEdit();

    expect(apiMocks.updateProject).toHaveBeenCalledWith("proj-default", {
      name: "Default Project",
      description: "updated desc",
      settings: {
        projectGroupKey: null,
        projectGroupLabel: null,
      },
    });
  });

  it("supports selecting multiple projects and deleting them together", async () => {
    const wrapper = await mountPage();
    const setupState = getSetupState(wrapper) as {
      runProjectDeletion: (projectIds: string[]) => Promise<void>;
    };

    const rowCheckboxes = wrapper.findAll("tbody .ant-checkbox-input");
    expect(rowCheckboxes.length).toBeGreaterThanOrEqual(2);

    await rowCheckboxes[0]?.setValue(true);
    await flushPromises();
    await rowCheckboxes[1]?.setValue(true);
    await flushPromises();

    expect(wrapper.text()).toContain("已选 2 个项目");

  await setupState.runProjectDeletion(["proj-default", "proj-alpha-api"]);
  await flushPromises();
    await flushPromises();

    expect(apiMocks.deleteProject).toHaveBeenCalledTimes(2);
    expect(apiMocks.deleteProject).toHaveBeenNthCalledWith(1, "proj-default");
    expect(apiMocks.deleteProject).toHaveBeenNthCalledWith(2, "proj-alpha-api");
    expect(apiMocks.listProjects).toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("已选 2 个项目");
  });
});
