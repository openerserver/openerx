<template>
  <a-modal
    :open="open"
    title="选择执行模式"
    :confirm-loading="loading"
    ok-text="开始执行"
    cancel-text="取消"
    :width="640"
    @ok="handleOk"
    @update:open="$emit('update:open', $event)"
  >
    <a-form layout="vertical" style="margin-top: 16px">
      <a-form-item label="执行模式">
        <a-radio-group :value="mode" @update:value="handleModeChange">
          <a-radio value="single">单次执行</a-radio>
          <a-radio value="parallel">并行比较</a-radio>
          <a-radio value="sequential-chain">顺序编排</a-radio>
        </a-radio-group>
        <div style="margin-top: 4px">
          <a-typography-text type="secondary" style="font-size: 12px">
            {{ modeDescription }}
          </a-typography-text>
        </div>
      </a-form-item>

      <!-- Parallel: model candidates -->
      <template v-if="mode === 'parallel'">
        <a-form-item label="候选模型">
          <div style="display: flex; flex-direction: column; gap: 8px">
            <div v-for="(c, idx) in candidates" :key="idx" style="display: flex; gap: 8px; align-items: center">
              <a-select
                :value="c.model"
                placeholder="选择模型"
                show-search
                :filter-option="filterModelOption"
                style="flex: 1"
                :loading="modelsLoading"
                @update:value="updateCandidateModel(idx, $event)"
              >
                <a-select-option v-for="m in modelOptions" :key="m.value" :value="m.value">
                  {{ m.label }}
                </a-select-option>
              </a-select>
              <a-input
                :value="c.label"
                placeholder="标签（可选）"
                style="width: 140px"
                :maxlength="50"
                @update:value="updateCandidateLabel(idx, $event)"
              />
              <a-button
                v-if="candidates.length > 2"
                danger
                size="small"
                @click="removeCandidate(idx)"
              >
                删除
              </a-button>
            </div>
          </div>
          <a-button
            v-if="candidates.length < 5"
            type="dashed"
            size="small"
            style="margin-top: 8px"
            @click="addCandidate"
          >
            + 添加候选
          </a-button>
          <div style="margin-top: 4px">
            <a-typography-text type="secondary" style="font-size: 12px">
              选择 2-5 个模型同时执行同一任务，比较结果后择优采纳
            </a-typography-text>
          </div>
        </a-form-item>
      </template>

      <!-- Sequential chain: steps -->
      <template v-if="mode === 'sequential-chain'">
        <a-form-item label="执行步骤">
          <div style="display: flex; flex-direction: column; gap: 12px">
            <div
              v-for="(step, idx) in steps"
              :key="idx"
              style="padding: 12px; border: 1px solid #d9d9d9; border-radius: 8px; background: #fafafa"
            >
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                <a-typography-text strong>步骤 {{ idx + 1 }}</a-typography-text>
                <a-button
                  v-if="steps.length > 1"
                  danger
                  size="small"
                  @click="removeStep(idx)"
                >
                  删除
                </a-button>
              </div>
              <a-input
                :value="step.title"
                placeholder="步骤标题"
                style="margin-bottom: 8px"
                :maxlength="100"
                @update:value="updateStep(idx, 'title', $event)"
              />
              <a-textarea
                :value="step.instruction"
                placeholder="步骤指令（告诉模型这一步要做什么）"
                :rows="2"
                :maxlength="2000"
                style="margin-bottom: 8px"
                @update:value="updateStep(idx, 'instruction', $event)"
              />
              <a-select
                :value="step.model"
                placeholder="使用默认模型"
                allow-clear
                show-search
                :filter-option="filterModelOption"
                style="width: 100%"
                :loading="modelsLoading"
                @update:value="updateStep(idx, 'model', $event)"
              >
                <a-select-option v-for="m in modelOptions" :key="m.value" :value="m.value">
                  {{ m.label }}
                </a-select-option>
              </a-select>
            </div>
          </div>
          <a-button
            v-if="steps.length < 20"
            type="dashed"
            size="small"
            style="margin-top: 8px"
            @click="addStep"
          >
            + 添加步骤
          </a-button>
          <div style="margin-top: 4px">
            <a-typography-text type="secondary" style="font-size: 12px">
              按顺序串行执行每个步骤，前一步的产出会自动注入下一步的上下文
            </a-typography-text>
          </div>
        </a-form-item>
      </template>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ExecutionMode, ChainStepInput } from "../lib/api";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  modelOptions: Array<{ value: string; label: string }>;
  modelsLoading: boolean;
  filterModelOption: (input: string, option: { value?: string; label?: string }) => boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (
    e: "confirm",
    overrides: {
      mode: ExecutionMode;
      candidates?: Array<{ model: string; label?: string }>;
      steps?: ChainStepInput[];
    } | null,
  ): void;
}>();

const mode = ref<ExecutionMode>("single");

const candidates = ref<Array<{ model: string; label: string }>>([
  { model: "", label: "候选 A" },
  { model: "", label: "候选 B" },
]);

const steps = ref<Array<{ title: string; instruction: string; model: string | undefined }>>([
  { title: "", instruction: "", model: undefined },
]);

watch(
  () => props.open,
  (open) => {
    if (open) {
      mode.value = "single";
      candidates.value = [
        { model: "", label: "候选 A" },
        { model: "", label: "候选 B" },
      ];
      steps.value = [{ title: "", instruction: "", model: undefined }];
    }
  },
);

const modeDescription = computed(() => {
  switch (mode.value) {
    case "single":
      return "使用当前任务配置的模型执行一次";
    case "parallel":
      return "同时用多个模型执行同一任务，产出完成后对比选优";
    case "sequential-chain":
      return "按顺序串行执行多个步骤，每一步的产出会注入下一步上下文";
  }
});

function handleModeChange(value: unknown) {
  mode.value = value as ExecutionMode;
}

function updateCandidateModel(idx: number, value: unknown) {
  candidates.value[idx].model = value != null ? String(value) : "";
}

function updateCandidateLabel(idx: number, value: unknown) {
  candidates.value[idx].label = value != null ? String(value) : "";
}

function addCandidate() {
  const labels = "ABCDEFGHIJ";
  const idx = candidates.value.length;
  candidates.value.push({ model: "", label: `候选 ${labels[idx] || idx + 1}` });
}

function removeCandidate(idx: number) {
  candidates.value.splice(idx, 1);
}

function updateStep(idx: number, field: "title" | "instruction" | "model", value: unknown) {
  const v = value != null ? String(value) : "";
  if (field === "model") {
    steps.value[idx].model = v || undefined;
  } else {
    steps.value[idx][field] = v;
  }
}

function addStep() {
  steps.value.push({ title: "", instruction: "", model: undefined });
}

function removeStep(idx: number) {
  steps.value.splice(idx, 1);
}

function handleOk() {
  if (mode.value === "single") {
    emit("confirm", null);
    return;
  }

  if (mode.value === "parallel") {
    const validCandidates = candidates.value.filter((c) => c.model);
    if (validCandidates.length < 2) {
      return;
    }
    emit("confirm", {
      mode: "parallel",
      candidates: validCandidates.map((c) => ({
        model: c.model,
        ...(c.label ? { label: c.label } : {}),
      })),
    });
    return;
  }

  if (mode.value === "sequential-chain") {
    const validSteps = steps.value.filter((s) => s.title && s.instruction);
    if (validSteps.length === 0) {
      return;
    }
    emit("confirm", {
      mode: "sequential-chain",
      steps: validSteps.map((s, i) => ({
        id: `step-${i + 1}`,
        title: s.title,
        instruction: s.instruction,
        ...(s.model ? { model: s.model } : {}),
      })),
    });
    return;
  }
}
</script>
