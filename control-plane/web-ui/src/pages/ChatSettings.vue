<template>
  <div class="chat-settings-page">
    <a-flex justify="space-between" align="center" class="chat-settings-page__header">
      <div>
        <a-typography-title :level="3" class="chat-settings-page__title">编排策略控制台</a-typography-title>
        <a-typography-paragraph class="chat-settings-page__subtitle">
          通过自然语言生成仅针对 orchestration-strategy 的变更预览，用 Mermaid 与结构化摘要确认后再应用。
        </a-typography-paragraph>
      </div>
      <a-space>
        <a-select
          :value="selectedModel"
          class="chat-settings-page__model-select"
          :options="modelOptions"
          placeholder="选择强模型"
          @update:value="selectedModel = String($event ?? '')"
        />
        <a-tag color="blue">编排版本 {{ orchestrationVersion }}</a-tag>
      </a-space>
    </a-flex>

    <a-row :gutter="16">
      <a-col :xs="24" :xl="15">
        <a-card title="当前编排总览" class="chat-settings-page__card">
          <a-tabs
            :activeKey="activeCategory"
            :destroyInactiveTabPane="true"
            @update:activeKey="handleCategoryChange"
          >
            <a-tab-pane v-for="category in supportedCategories" :key="category" :tab="category">
              <MermaidRenderer v-if="activeCategory === category" :code="currentMermaid" />
            </a-tab-pane>
          </a-tabs>

          <a-alert
            type="info"
            show-icon
            class="chat-settings-page__info-alert"
            :message="`当前查看 ${activeCategory} 分类，以下摘要与预览都只围绕这一条编排链路。`"
          />
        </a-card>

        <a-card title="当前分类策略摘要" class="chat-settings-page__card">
          <a-empty v-if="!currentSummary" description="暂无编排摘要" />
          <a-descriptions v-else :column="1" size="small" bordered>
            <a-descriptions-item label="分类">
              {{ currentSummary.category }}
            </a-descriptions-item>
            <a-descriptions-item label="命中模板">
              {{ currentSummary.templateName }}
            </a-descriptions-item>
            <a-descriptions-item label="执行模式">
              {{ currentSummary.executionMode }}
            </a-descriptions-item>
            <a-descriptions-item label="Pipeline">
              {{ currentSummary.pipelineEnabled ? "已启用" : "已关闭" }}
            </a-descriptions-item>
            <a-descriptions-item label="Judge">
              {{ currentSummary.judgeEnabled ? "已启用" : "已关闭" }}
            </a-descriptions-item>
            <a-descriptions-item label="Judge Agent">
              {{ currentSummary.judgeAgent }}
            </a-descriptions-item>
            <a-descriptions-item label="Judge 模型">
              {{ currentSummary.judgeModel }}
            </a-descriptions-item>
            <a-descriptions-item label="主执行 Agent">
              {{ currentSummary.primaryAgents.join(", ") || "未指定" }}
            </a-descriptions-item>
            <a-descriptions-item label="主执行模型">
              {{ currentSummary.primaryModel }}
            </a-descriptions-item>
          </a-descriptions>

          <div v-if="currentSummary?.notes?.length" class="chat-settings-page__summary-notes">
            <a-tag v-for="note in currentSummary.notes" :key="note" color="cyan">{{ note }}</a-tag>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :xl="9">
        <a-card title="AI 编排助手" class="chat-settings-page__card">
          <div class="chat-settings-page__quick-actions">
            <a-typography-text type="secondary">快捷意图</a-typography-text>
            <a-space wrap>
              <a-button size="small" @click="handlePrefillIntent('parallelize')">改成并行执行</a-button>
              <a-button size="small" @click="handlePrefillIntent('enable-judge')">启用 judge</a-button>
              <a-button size="small" @click="handlePrefillIntent('judge-model')">更新 judge 模型</a-button>
              <a-button size="small" @click="handlePrefillIntent('template-review')">检查模板匹配</a-button>
            </a-space>
          </div>

          <a-alert
            v-if="errorMessage"
            type="warning"
            show-icon
            class="chat-settings-page__info-alert"
            :message="errorMessage"
          >
            <template #description>
              <a-button size="small" type="link" class="chat-settings-page__error-action" @click="handlePrefillRecommendedRewrite">
                回填推荐改写示例
              </a-button>
            </template>
          </a-alert>

          <div class="chat-settings-page__composer">
            <a-textarea
              :value="draftIntent"
              :rows="5"
              :placeholder="`例如：请把 ${activeCategory} 分类改成并行执行，并启用 judge。`"
              @update:value="draftIntent = String($event ?? '')"
              @keydown="handleComposerKeydown"
            />
            <a-flex justify="space-between" align="center" style="margin-top: 12px">
              <a-typography-text type="secondary">仅生成编排策略预览</a-typography-text>
              <a-button type="primary" :loading="sending" @click="handleSendIntent">生成预览</a-button>
            </a-flex>
          </div>

          <a-card v-if="orchestrationPreview" size="small" title="编排变更预览" class="chat-settings-page__preview-card">
            <a-alert type="info" show-icon :message="orchestrationPreview.explanation" style="margin-bottom: 12px" />
            <a-space wrap class="chat-settings-page__affected-categories">
              <a-tag v-for="category in orchestrationPreview.affectedCategories" :key="category" color="geekblue">
                影响 {{ category }}
              </a-tag>
            </a-space>

            <div v-if="previewRiskHints.length > 0" class="chat-settings-page__risk-list">
              <a-alert
                v-for="hint in previewRiskHints"
                :key="`${hint.level}-${hint.summary}`"
                :type="hint.level === 'high' ? 'warning' : 'info'"
                show-icon
                :message="`${hint.level.toUpperCase()} · ${hint.summary}`"
              />
            </div>

            <a-card v-if="previewCurrentDiff" size="small" class="chat-settings-page__diff-card">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="当前分类">
                  {{ previewCurrentDiff.category }}
                </a-descriptions-item>
                <a-descriptions-item label="模板">
                  {{ previewCurrentDiff.before.templateName }} -> {{ previewCurrentDiff.after.templateName }}
                </a-descriptions-item>
                <a-descriptions-item label="执行模式">
                  {{ previewCurrentDiff.before.executionMode }} -> {{ previewCurrentDiff.after.executionMode }}
                </a-descriptions-item>
                <a-descriptions-item label="Judge">
                  {{ previewCurrentDiff.before.judgeEnabled ? "已启用" : "已关闭" }} -> {{ previewCurrentDiff.after.judgeEnabled ? "已启用" : "已关闭" }}
                </a-descriptions-item>
                <a-descriptions-item label="主执行 Agent">
                  {{ previewCurrentDiff.before.primaryAgents.join(", ") || "未指定" }} ->
                  {{ previewCurrentDiff.after.primaryAgents.join(", ") || "未指定" }}
                </a-descriptions-item>
                <a-descriptions-item label="主执行模型">
                  {{ previewCurrentDiff.before.primaryModel }} -> {{ previewCurrentDiff.after.primaryModel }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>

            <a-tabs
              v-if="previewTabs.length > 0"
              :activeKey="previewCategory"
              :destroyInactiveTabPane="true"
              @update:activeKey="previewCategory = String($event ?? '')"
            >
              <a-tab-pane v-for="category in previewTabs" :key="category" :tab="category">
                <MermaidRenderer v-if="previewCategory === category" :code="orchestrationPreview.mermaidPreview[category] || ''" />
              </a-tab-pane>
            </a-tabs>

            <div class="chat-settings-page__change-list">
              <a-card v-for="change in changeCards" :key="change.id" size="small" class="chat-settings-page__change-card">
                <a-flex justify="space-between" align="start" gap="small">
                  <div>
                    <div class="chat-settings-page__change-title">{{ change.title }}</div>
                    <div class="chat-settings-page__change-summary">{{ change.summary }}</div>
                    <div class="chat-settings-page__change-detail">{{ change.beforeLabel }} -> {{ change.afterLabel }}</div>
                  </div>
                  <a-space direction="vertical" size="small" align="end">
                    <a-tag :color="change.riskLevel === 'high' ? 'red' : change.riskLevel === 'medium' ? 'orange' : 'green'">
                      {{ change.riskLevel }}
                    </a-tag>
                    <a-button size="small" type="link" @click="handleDismissChange(change.id)">排除</a-button>
                  </a-space>
                </a-flex>
              </a-card>
            </div>

            <a-flex justify="space-between" align="center" class="chat-settings-page__preview-actions">
              <a-typography-text type="secondary">
                Judge: {{ orchestrationPreview.judgeChange.afterEnabled ? "启用" : "关闭" }}
              </a-typography-text>
              <a-button type="primary" :loading="applying" @click="applyCurrentPreview">应用编排变更</a-button>
            </a-flex>
          </a-card>

          <a-card size="small" title="本轮会话" class="chat-settings-page__history-card">
            <a-empty v-if="messages.length === 0" description="还没有发起编排策略对话" />
            <div v-else class="chat-settings-page__messages">
              <div v-for="item in messages" :key="item.id" :class="messageClass(item.role)">
                <div class="chat-settings-page__message-meta">
                  <a-tag :color="item.role === 'user' ? 'blue' : 'geekblue'">
                    {{ item.role === "user" ? "你" : "编排助手" }}
                  </a-tag>
                  <span>{{ item.createdAt }}</span>
                </div>
                <MarkdownContent class="chat-settings-page__message-body" :content="item.content" />
              </div>
            </div>
          </a-card>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import type { Key } from "ant-design-vue/es/_util/type";
import { message } from "ant-design-vue";
import { storeToRefs } from "pinia";
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { useChatSettingsOrchestrationStore } from "../stores/chat-settings-orchestration";

const MermaidRenderer = defineAsyncComponent(() => import("../components/MermaidRenderer.vue"));
const MarkdownContent = defineAsyncComponent(() => import("../components/MarkdownContent.vue"));

const orchestrationStore = useChatSettingsOrchestrationStore();
const {
  activeCategory,
  applying,
  changeCards,
  currentMermaid,
  currentSummary,
  draftIntent,
  errorMessage,
  messages,
  orchestrationPreview,
  selectedModel,
  selectableModels,
  sending,
  supportedCategories,
} = storeToRefs(orchestrationStore);

const previewCategory = ref("deep");

const modelOptions = computed(() => selectableModels.value.map((item) => ({ label: item, value: item })));
const orchestrationVersion = computed(() => orchestrationStore.context?.orchestrationVersion || "-");
const previewTabs = computed(() => Object.keys(orchestrationPreview.value?.mermaidPreview || {}));
const previewRiskHints = computed(() => orchestrationPreview.value?.riskHints || []);
const recommendedRewriteExample = computed(() => orchestrationStore.buildRecommendedRewriteExample());
const previewCurrentDiff = computed(() => {
  if (!orchestrationPreview.value) {
    return null;
  }

  const category = orchestrationPreview.value.affectedCategories[0] || activeCategory.value;
  const before = orchestrationPreview.value.strategySummaryBefore?.find((item) => item.category === category);
  const after = orchestrationPreview.value.strategySummaryAfter?.find((item) => item.category === category);

  if (!before || !after) {
    return null;
  }

  return { category, before, after };
});

function messageClass(role: "user" | "assistant") {
  return [
    "chat-settings-page__message",
    role === "user" ? "chat-settings-page__message--user" : "chat-settings-page__message--assistant",
  ];
}

function handleCategoryChange(category: Key) {
  orchestrationStore.setActiveCategory(String(category || "deep"));
}

function handlePrefillIntent(templateType: string) {
  orchestrationStore.prefillIntent(templateType);
}

function handlePrefillRecommendedRewrite() {
  orchestrationStore.prefillRecommendedRewrite();
  message.info(`已回填推荐改写示例：${recommendedRewriteExample.value}`);
}

async function handleSendIntent() {
  try {
    await orchestrationStore.sendIntent();
    if (previewTabs.value.length > 0) {
      previewCategory.value = previewTabs.value[0];
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : "生成编排预览失败");
  }
}

async function applyCurrentPreview() {
  try {
    await orchestrationStore.applyPreview();
    message.success("编排策略已应用");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "应用编排变更失败");
  }
}

function handleDismissChange(changeId: string) {
  orchestrationStore.dismissChangeCard(changeId);
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    void handleSendIntent();
  }
}

onMounted(async () => {
  try {
    await orchestrationStore.loadContext();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "加载编排策略失败");
  }
});

defineExpose({
  draftIntent,
  handleCategoryChange,
  handlePrefillIntent,
  handleSendIntent,
  applyCurrentPreview,
});
</script>

<style scoped>
.chat-settings-page {
  padding: 24px;
  min-height: 100%;
  background:
    radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 28%),
    linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
}

.chat-settings-page__header {
  margin-bottom: 16px;
}

.chat-settings-page__title {
  margin-bottom: 4px !important;
}

.chat-settings-page__subtitle {
  margin-bottom: 0;
  color: #667085;
  max-width: 760px;
}

.chat-settings-page__card {
  margin-bottom: 16px;
  border-radius: 18px;
}

.chat-settings-page__info-alert {
  margin-top: 12px;
}

.chat-settings-page__error-action {
  padding-left: 0;
  margin-top: 4px;
}

.chat-settings-page__summary-notes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.chat-settings-page__quick-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.chat-settings-page__composer {
  padding-top: 4px;
}

.chat-settings-page__preview-card,
.chat-settings-page__history-card {
  margin-top: 16px;
}

.chat-settings-page__affected-categories {
  margin-bottom: 12px;
}

.chat-settings-page__risk-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.chat-settings-page__diff-card {
  margin-bottom: 12px;
  border-radius: 14px;
}

.chat-settings-page__change-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.chat-settings-page__change-card {
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
}

.chat-settings-page__change-title {
  font-weight: 600;
  color: #0f172a;
}

.chat-settings-page__change-summary {
  margin-top: 4px;
  color: #334155;
}

.chat-settings-page__change-detail {
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}

.chat-settings-page__preview-actions {
  margin-top: 12px;
}

.chat-settings-page__messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 36vh;
  overflow: auto;
}

.chat-settings-page__message {
  padding: 12px;
  border-radius: 14px;
}

.chat-settings-page__message--user {
  background: rgba(15, 118, 110, 0.08);
  border: 1px solid rgba(15, 118, 110, 0.14);
}

.chat-settings-page__message--assistant {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.26);
}

.chat-settings-page__message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #667085;
  font-size: 12px;
}

.chat-settings-page__message-body :deep(p:last-child) {
  margin-bottom: 0;
}

.chat-settings-page__model-select {
  min-width: 320px;
}

@media (max-width: 1200px) {
  .chat-settings-page__model-select {
    min-width: 220px;
  }
}
</style>