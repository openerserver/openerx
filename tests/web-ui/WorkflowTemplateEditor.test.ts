import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  params: { templateId: "tpl-1" } as Record<string, string>,
}));

const routerState = vi.hoisted(() => ({
  push: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  getWorkflowTemplateEditorView: vi.fn(),
  updateWorkflowTemplateStage: vi.fn(),
  createWorkflowTemplateStage: vi.fn(),
  updateWorkflowTemplate: vi.fn(),
  deleteWorkflowTemplateStage: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => routerState,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => apiMocks);

vi.mock("../../control-plane/web-ui/src/components/MermaidRenderer.vue", () => ({
  __esModule: true,
  __isTeleport: false,
  __isKeepAlive: false,
  default: {
    name: "MermaidRenderer",
    props: ["code"],
    template: '<div data-testid="mermaid">{{ code }}</div>',
  },
}));

vi.mock("ant-design-vue", () => ({
  message: messageMocks,
}));

const InputStub = {
  props: ["value", "placeholder", "disabled"],
  emits: ["update:value"],
  template:
    '<input :value="value" :placeholder="placeholder" :disabled="disabled" @input="$emit(\'update:value\', $event.target.value)" />',
};

const TextareaStub = {
  props: ["value", "rows", "placeholder"],
  emits: ["update:value"],
  template:
    '<textarea :value="value" :rows="rows" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />',
};

const SelectStub = {
  props: ["value", "options", "mode"],
  emits: ["update:value", "change"],
  computed: {
    normalizedValue(this: { value?: unknown }): string[] {
      return Array.isArray(this.value)
        ? this.value.map((item: unknown) => String(item))
        : this.value !== undefined && this.value !== null && this.value !== ""
          ? [String(this.value)]
          : [];
    },
  },
  methods: {
    onChange(
      this: {
        mode?: string;
        $emit: (event: "update:value" | "change", value: string | string[]) => void;
      },
      event: Event,
    ) {
      const target = event.target as HTMLSelectElement;
      if (this.mode === "multiple" || this.mode === "tags") {
        const values = Array.from(target.selectedOptions).map((item) => item.value);
        this.$emit("update:value", values);
        this.$emit("change", values);
        return;
      }
      this.$emit("update:value", target.value);
      this.$emit("change", target.value);
    },
  },
  template: `
    <select :multiple="mode === 'multiple' || mode === 'tags'" @change="onChange">
      <option value=""></option>
      <option
        v-for="option in options || []"
        :key="option.value"
        :value="option.value"
        :selected="normalizedValue.includes(String(option.value))"
      >
        {{ option.label }}
      </option>
    </select>
  `,
};

const ButtonStub = {
  emits: ["click"],
  template: '<button @click="$emit(\'click\', $event)"><slot /></button>',
};

const CheckboxStub = {
  props: ["checked"],
  emits: ["update:checked"],
  template:
    '<label><input type="checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked)" /><slot /></label>',
};

const ContainerStub = {
  template: "<div><slot /></div>",
};

const AlertStub = {
  props: ["message"],
  template: '<div class="alert"><slot />{{ message }}</div>',
};

const EmptyStub = {
  props: ["description"],
  template: '<div class="empty">{{ description }}</div>',
};

const TypographyTextStub = {
  template: "<span><slot /></span>",
};

const TypographyParagraphStub = {
  template: "<p><slot /></p>",
};

const PageHeaderStub = {
  props: ["title", "subTitle"],
  template: '<div><h1>{{ title }}</h1><div>{{ subTitle }}</div><slot /></div>',
};

function buildEditorView(stages: Array<Record<string, unknown>>) {
  return {
    template: {
      id: "tpl-1",
      name: "研发模板",
      description: "template",
      category: "delivery",
      enabled: true,
      selectableByProjects: true,
      defaultRolesJson: [],
      defaultCollaborationMode: "team",
      defaultAutopilotLevel: "L1",
      defaultBossParticipationMode: "advisory",
      forceBossParticipation: false,
    },
    stages,
    availableRoles: [
      { id: "role.pm", name: "项目经理" },
      { id: "role.arch", name: "架构师" },
    ],
    stageCatalog: [
      { key: "clarify", label: "需求澄清", description: "clarify" },
      { key: "design", label: "方案设计", description: "design" },
    ],
    diagnostics: {
      duplicateStageKeys: [],
      missingConfiguredStages: [],
      hasCustomStages: false,
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createWrapper() {
  return mountAsync();
}

async function mountAsync() {
  const { default: Page } = await import(
    "../../control-plane/web-ui/src/pages/WorkflowTemplateEditor.vue"
  );
  const wrapper = mount(Page, {
    global: {
      stubs: {
        "a-page-header": PageHeaderStub,
        "a-alert": AlertStub,
        "a-spin": ContainerStub,
        "a-row": ContainerStub,
        "a-col": ContainerStub,
        "a-card": ContainerStub,
        "a-space": ContainerStub,
        "a-form": ContainerStub,
        "a-form-item": ContainerStub,
        "a-input": InputStub,
        "a-textarea": TextareaStub,
        "a-select": SelectStub,
        "a-button": ButtonStub,
        "a-checkbox": CheckboxStub,
        "a-divider": ContainerStub,
        "a-empty": EmptyStub,
        "a-tag": ContainerStub,
        "a-tabs": ContainerStub,
        "a-tab-pane": ContainerStub,
        "a-typography-text": TypographyTextStub,
        "a-typography-paragraph": TypographyParagraphStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("WorkflowTemplateEditor", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    routeState.params = { templateId: "tpl-1" };
    apiMocks.updateWorkflowTemplate.mockResolvedValue({});
    apiMocks.deleteWorkflowTemplateStage.mockResolvedValue({});
  });

  it("saves stage initialTaskDefinition payload", async () => {
    apiMocks.getWorkflowTemplateEditorView.mockImplementation(async () =>
      clone(
        buildEditorView([
          {
            id: "stage-1",
            templateId: "tpl-1",
            stageKey: "clarify",
            name: "需求澄清",
            enabled: true,
            mode: "single",
            primaryRoleAgentId: "role.pm",
            participantRoleAgentIdsJson: [],
            entryCriteriaJson: [],
            exitCriteriaJson: ["范围明确"],
            orderIndex: 0,
            initialTaskDefinitionJson: {
              version: 1,
              titleTemplate: "需求澄清：初始任务",
              goalTemplate: "梳理范围与约束",
              instructionTemplate: "先收集背景，再给出澄清问题清单。",
              doneWhen: ["范围明确"],
              outputContract: {
                summaryLabel: "clarify-summary",
                artifactKeys: ["scope"],
                requireStageCompleteMarker: true,
              },
            },
          },
        ]),
      ),
    );
    apiMocks.updateWorkflowTemplateStage.mockResolvedValue({});

    const wrapper = await createWrapper();
    const setupState = (wrapper.vm as unknown as { $: { setupState: Record<string, unknown> } }).$.setupState as {
      saveStage: (stage: Record<string, unknown>, index: number) => Promise<void>;
      stageDrafts: { value?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    };
    const stageDrafts = Array.isArray(setupState.stageDrafts)
      ? setupState.stageDrafts
      : (setupState.stageDrafts.value ?? []);

    expect(stageDrafts).toHaveLength(1);
    void setupState.saveStage(stageDrafts[0]!, 0);
    await flushPromises();

    expect(apiMocks.updateWorkflowTemplateStage).toHaveBeenCalledWith(
      "tpl-1",
      "stage-1",
      expect.objectContaining({
        initialTaskDefinition: expect.objectContaining({
          version: 1,
          titleTemplate: "需求澄清：初始任务",
          goalTemplate: "梳理范围与约束",
          instructionTemplate: "先收集背景，再给出澄清问题清单。",
          doneWhen: ["范围明确"],
          outputContract: expect.objectContaining({
            summaryLabel: "clarify-summary",
            artifactKeys: ["scope"],
            requireStageCompleteMarker: true,
          }),
        }),
      }),
    );
  }, 10_000);

  it("creates new stage with generated initialTaskDefinition", async () => {
    apiMocks.getWorkflowTemplateEditorView.mockImplementation(async () => clone(buildEditorView([])));
    apiMocks.createWorkflowTemplateStage.mockResolvedValue({});

    const wrapper = await createWrapper();
    const stageSelect = wrapper
      .findAll("select")
      .find((item) => item.text().includes("需求澄清 (clarify)") && item.text().includes("方案设计 (design)"));
    expect(stageSelect).toBeTruthy();
    await stageSelect!.setValue("design");
    await flushPromises();

    const addButton = wrapper
      .findAll("button")
      .find((item) => item.text().includes("新增阶段"));
    expect(addButton).toBeTruthy();
    await addButton?.trigger("click");
    await flushPromises();

    expect(apiMocks.createWorkflowTemplateStage).toHaveBeenCalledWith(
      "tpl-1",
      expect.objectContaining({
        stageKey: "design",
        name: "方案设计",
        primaryRoleAgentId: "role.pm",
        initialTaskDefinition: expect.objectContaining({
          version: 1,
          titleTemplate: "方案设计：初始任务",
          goalTemplate: "完成 方案设计 阶段的首个任务目标，并输出可用于后续推进的阶段摘要。",
          instructionTemplate: "请聚焦 方案设计 阶段目标，结合当前任务和已有上下文，输出结构化结果，并在完成时给出阶段摘要。",
        }),
      }),
    );
  });

  it("blocks save when initial task title template is empty", async () => {
    apiMocks.getWorkflowTemplateEditorView.mockImplementation(async () =>
      clone(
        buildEditorView([
          {
            id: "stage-1",
            templateId: "tpl-1",
            stageKey: "clarify",
            name: "需求澄清",
            enabled: true,
            mode: "single",
            primaryRoleAgentId: "role.pm",
            participantRoleAgentIdsJson: [],
            entryCriteriaJson: [],
            exitCriteriaJson: [],
            orderIndex: 0,
            initialTaskDefinitionJson: {
              version: 1,
              titleTemplate: "需求澄清：初始任务",
              goalTemplate: "梳理范围",
              instructionTemplate: "输出澄清结论",
            },
          },
        ]),
      ),
    );

    const wrapper = await createWrapper();
    const titleInput = wrapper
      .findAll("input")
      .find((item) => (item.element as HTMLInputElement).value === "需求澄清：初始任务");
    expect(titleInput).toBeTruthy();
    await titleInput!.setValue("");
    await flushPromises();

    const saveButton = wrapper
      .findAll("button")
      .find((item) => item.text().includes("保存阶段"));
    expect(saveButton).toBeTruthy();
    await saveButton?.trigger("click");
    await flushPromises();

    expect(apiMocks.updateWorkflowTemplateStage).not.toHaveBeenCalled();
  });
});