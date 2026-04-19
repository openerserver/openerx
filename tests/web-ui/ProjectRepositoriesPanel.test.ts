import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import ProjectRepositoriesPanel from "../../control-plane/web-ui/src/components/ProjectRepositoriesPanel.vue";
import { useAuthStore } from "../../control-plane/web-ui/src/stores/auth";

const apiMocks = vi.hoisted(() => ({
  archiveRepository: vi.fn(),
  createRepository: vi.fn(),
  listRepositories: vi.fn(),
  updateRepository: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

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
      props: ["message", "open", "title", "description", "loading"],
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

  const AButton = defineComponent({
    name: "AButton",
    inheritAttrs: false,
    props: ["loading", "danger", "type", "size", "disabled"],
    emits: ["click"],
    setup(props, { slots, emit, attrs }) {
      return () =>
        h(
          "button",
          {
            ...attrs,
            type: "button",
            disabled: Boolean(props.loading) || Boolean(props.disabled),
            onClick: (event: Event) => emit("click", event),
          },
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
    props: ["value"],
    setup(props, { slots }) {
      return () =>
        h("option", { value: String(props.value ?? "") }, slots.default ? slots.default() : undefined);
    },
  });

  const APopconfirm = defineComponent({
    name: "APopconfirm",
    inheritAttrs: false,
    emits: ["confirm"],
    setup(_props, { slots, attrs }) {
      return () => h("div", { ...attrs, class: "popconfirm-stub" }, slots.default?.());
    },
  });

  return {
    AAlert: simple("AAlert"),
    AButton,
    AEmpty: simple("AEmpty"),
    AFlex: simple("AFlex"),
    AForm: simple("AForm", "form"),
    AFormItem: simple("AFormItem"),
    AInput: inputLike("AInput"),
    AModal: simple("AModal"),
    APopconfirm,
    ASpace: simple("ASpace"),
    ASelect,
    ASelectOption,
    ATable,
    ATag: simple("ATag", "span"),
    ATextarea: inputLike("ATextarea", "textarea"),
    ATypographyText: simple("ATypographyText", "span"),
    ATypographyTitle: simple("ATypographyTitle", "h3"),
  };
});

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-1",
    projectId: "proj-default",
    name: "control-plane",
    provider: "github",
    remoteUrl: "https://github.com/example/control-plane.git",
    defaultBranch: "main",
    description: null,
    status: "active",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

async function mountPanel(
  repositories = [makeRepository()],
  options?: { useExistingMocks?: boolean },
) {
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

  if (!options?.useExistingMocks) {
    apiMocks.listRepositories.mockResolvedValue({ data: repositories });
    apiMocks.archiveRepository.mockResolvedValue({ ok: true });
    apiMocks.createRepository.mockResolvedValue({});
    apiMocks.updateRepository.mockResolvedValue({});
  }

  const wrapper = mount(ProjectRepositoriesPanel, {
    props: { projectId: "proj-default" },
    global: {
      plugins: [pinia],
      stubs: {
        teleport: true,
      },
    },
  });

  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("ProjectRepositoriesPanel", () => {
  it("supports selecting multiple repositories and deleting them together", async () => {
    const wrapper = await mountPanel([
      makeRepository({ id: "repo-1", name: "control-plane" }),
      makeRepository({ id: "repo-2", name: "web-ui", remoteUrl: "https://github.com/example/web-ui.git" }),
    ]);

    const checkboxes = wrapper.findAll("tbody .ant-checkbox-input");
    expect(checkboxes).toHaveLength(2);

    await checkboxes[0]!.setValue(true);
    await flushPromises();
    await checkboxes[1]!.setValue(true);
    await flushPromises();

    expect(wrapper.text()).toContain("已选 2 个仓库");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await wrapper.get('[data-testid="bulk-delete-repositories"]').trigger("click");
    await flushPromises();
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(apiMocks.archiveRepository).toHaveBeenNthCalledWith(1, "repo-1", "proj-default");
    expect(apiMocks.archiveRepository).toHaveBeenNthCalledWith(2, "repo-2", "proj-default");
    expect(apiMocks.listRepositories).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("勾选仓库后可批量删除");
  });

  it("retains only failed repository selections after bulk delete", async () => {
    apiMocks.listRepositories
      .mockResolvedValueOnce({
        data: [
          makeRepository({ id: "repo-1", name: "control-plane" }),
          makeRepository({ id: "repo-2", name: "web-ui", remoteUrl: "https://github.com/example/web-ui.git" }),
        ],
      })
      .mockResolvedValueOnce({
        data: [
          makeRepository({ id: "repo-2", name: "web-ui", remoteUrl: "https://github.com/example/web-ui.git" }),
        ],
      });
    apiMocks.archiveRepository.mockImplementation((repoId: string) => {
      if (repoId === "repo-1") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error("依赖任务仍在使用该仓库"));
    });

    const wrapper = await mountPanel(undefined, { useExistingMocks: true });

    const checkboxes = wrapper.findAll("tbody .ant-checkbox-input");
    expect(checkboxes).toHaveLength(2);
    await checkboxes[0]!.setValue(true);
    await flushPromises();
    await checkboxes[1]!.setValue(true);
    await flushPromises();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await wrapper.get('[data-testid="bulk-delete-repositories"]').trigger("click");
    await flushPromises();
    await flushPromises();

    const remainingCheckboxes = wrapper.findAll("tbody .ant-checkbox-input");
    expect(remainingCheckboxes).toHaveLength(1);
    expect((remainingCheckboxes[0]!.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain("已选 1 个仓库");
  });
});