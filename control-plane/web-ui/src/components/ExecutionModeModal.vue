<template>
  <a-modal
    :open="open"
    title="选择执行模式"
    :confirm-loading="loading"
    ok-text="保存配置"
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

        <a-card size="small" :bordered="false" :body-style="{ padding: '12px' }" style="margin-bottom: 16px; background: #fafafa">
          <a-flex justify="space-between" align="center" style="margin-bottom: 8px">
            <a-space size="small">
              <a-typography-text strong>裁判评选</a-typography-text>
              <a-tag v-if="judge.enabled" color="processing">已启用</a-tag>
            </a-space>
            <a-switch :checked="judge.enabled" @update:checked="updateJudgeEnabled" />
          </a-flex>

          <a-typography-text type="secondary" style="font-size: 12px; display: block; margin-bottom: 8px">
            候选全部完成后，自动让 Judge 对每个结果评分并选出最佳方案。
          </a-typography-text>

          <div v-if="judge.enabled" style="display: flex; flex-direction: column; gap: 12px">
            <a-form-item label="Judge Agent" style="margin-bottom: 0">
              <a-input
                :value="judge.agent"
                placeholder="例如 prometheus-enterprise"
                :maxlength="100"
                @update:value="updateJudgeField('agent', $event)"
              />
            </a-form-item>

            <a-form-item label="Judge 模型" style="margin-bottom: 0">
              <a-select
                :value="judge.model || undefined"
                placeholder="选择 Judge 使用的模型"
                show-search
                allow-clear
                :filter-option="filterModelOption"
                :loading="modelsLoading"
                @update:value="updateJudgeField('model', $event)"
              >
                <a-select-option v-for="m in modelOptions" :key="m.value" :value="m.value">
                  {{ m.label }}
                </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="评选策略" style="margin-bottom: 0">
              <a-radio-group :value="judge.selectionStrategy" @update:value="updateJudgeSelectionStrategy">
                <a-radio value="judge-pick">裁判直接指定最佳候选</a-radio>
                <a-radio value="highest-score">按评分最高者自动胜出</a-radio>
              </a-radio-group>
            </a-form-item>

            <a-collapse size="small" ghost>
              <a-collapse-panel key="advanced" header="高级设置">
                <a-form-item label="评审 Prompt 模板" style="margin-bottom: 12px">
                  <a-textarea
                    :value="judge.promptTemplate"
                    :rows="6"
                    :maxlength="12000"
                    placeholder="可使用 {{taskTitle}}、{{taskPrompt}}、{{candidateResults}} 变量"
                    @update:value="updateJudgeField('promptTemplate', $event)"
                  />
                </a-form-item>

                <a-form-item label="超时时间（秒）" style="margin-bottom: 0">
                  <a-input-number
                    :value="Math.max(10, Math.round(judge.timeoutMs / 1000))"
                    :min="10"
                    :max="120"
                    :step="5"
                    style="width: 100%"
                    @update:value="updateJudgeTimeout"
                  />
                </a-form-item>
              </a-collapse-panel>
            </a-collapse>
          </div>
        </a-card>
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
import type { ExecutionMode, ChainStepInput, JudgeConfig } from "../lib/api";
import { DEFAULT_JUDGE_CONFIG } from "../lib/taskExecutionMode";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  modelOptions: Array<{ value: string; label: string }>;
  modelsLoading: boolean;
  filterModelOption: (input: string, option?: unknown) => boolean;
  initialMode?: ExecutionMode;
  initialCandidates?: Array<{ model: string; label?: string }>;
  initialSteps?: ChainStepInput[];
  initialJudge?: JudgeConfig;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (
    e: "confirm",
    overrides: {
      mode: ExecutionMode;
      candidates?: Array<{ model: string; label?: string }>;
      steps?: ChainStepInput[];
      judge?: JudgeConfig;
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

const judge = ref<JudgeConfig>({ ...DEFAULT_JUDGE_CONFIG });

watch(
  () => props.open,
  (open) => {
    if (open) {
      mode.value = props.initialMode ?? "single";
      candidates.value = buildCandidateDefaults(props.initialCandidates);
      steps.value = buildStepDefaults(props.initialSteps);
      judge.value = buildJudgeDefaults(props.initialJudge);
    }
  },
);

function buildCandidateDefaults(
  initialCandidates?: Array<{ model: string; label?: string }>,
) {
  if (Array.isArray(initialCandidates) && initialCandidates.length > 0) {
    return initialCandidates.slice(0, 5).map((candidate, index) => ({
      model: candidate.model,
      label: candidate.label || `候选 ${String.fromCharCode(65 + index)}`,
    }));
  }

  return [
    { model: "", label: "候选 A" },
    { model: "", label: "候选 B" },
  ];
}

function buildStepDefaults(initialSteps?: ChainStepInput[]) {
  if (Array.isArray(initialSteps) && initialSteps.length > 0) {
    return initialSteps.slice(0, 20).map((step) => ({
      title: step.title,
      instruction: step.instruction,
      model: step.model,
    }));
  }

  return [{ title: "", instruction: "", model: undefined }];
}

function buildJudgeDefaults(initialJudge?: JudgeConfig): JudgeConfig {
  return {
    ...DEFAULT_JUDGE_CONFIG,
    ...(initialJudge ?? {}),
  };
}

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

function updateJudgeEnabled(value: boolean | string | number) {
  judge.value = {
    ...judge.value,
    enabled: Boolean(value),
  };
}

function updateJudgeField(field: "agent" | "model" | "promptTemplate", value: unknown) {
  const nextValue = value != null ? String(value) : "";
  judge.value = {
    ...judge.value,
    [field]: nextValue,
  };
}

function updateJudgeSelectionStrategy(value: unknown) {
  judge.value = {
    ...judge.value,
    selectionStrategy: value === "highest-score" ? "highest-score" : "judge-pick",
  };
}

function updateJudgeTimeout(value: unknown) {
  const nextSeconds = typeof value === "number" && Number.isFinite(value) ? value : 30;
  judge.value = {
    ...judge.value,
    timeoutMs: Math.max(10, Math.min(120, Math.round(nextSeconds))) * 1000,
  };
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
      judge: {
        ...judge.value,
      },
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
