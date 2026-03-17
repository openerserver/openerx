import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  type ChatSettingsCurrentContext,
  type ChatSettingsPendingPatch,
  type OrchestrationCategorySummary,
  type OrchestrationPreviewModel,
  applyChatSettingsPatch,
  chatWithChatSettings,
  getChatSettingsCurrentContext,
} from "../lib/api";
import {
  ORCHESTRATION_CATEGORIES,
  buildOrchestrationContext,
  buildPreviewFromPatch,
} from "../lib/chat-settings-orchestration-adapter";

export interface OrchestrationUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  patch?: ChatSettingsPendingPatch;
}

function nowLabel() {
  return new Date().toLocaleString();
}

function resolveRewriteCategory(messages: OrchestrationUiMessage[], activeCategory: string) {
  const lastUserMessage =
    [...messages].reverse().find((item) => item.role === "user")?.content || "";
  const matchedCategory = ORCHESTRATION_CATEGORIES.find((category) =>
    lastUserMessage.toLowerCase().includes(category),
  );
  return matchedCategory || activeCategory;
}

export const useChatSettingsOrchestrationStore = defineStore("chat-settings-orchestration", () => {
  const context = ref<
    | (ChatSettingsCurrentContext & {
        orchestrationVersion: string;
        categorySummaries: OrchestrationCategorySummary[];
        supportedCategories: string[];
      })
    | null
  >(null);
  const activeCategory = ref("deep");
  const selectedModel = ref<string>();
  const draftIntent = ref("");
  const messages = ref<OrchestrationUiMessage[]>([]);
  const conversationId = ref<string>();
  const sending = ref(false);
  const applying = ref(false);
  const applyingIndex = ref<number | null>(null);
  const pendingPatch = ref<ChatSettingsPendingPatch | null>(null);
  const orchestrationPreview = ref<OrchestrationPreviewModel | null>(null);
  const errorMessage = ref("");

  const availableModels = computed(() => context.value?.models || []);
  const selectableModels = computed(() =>
    availableModels.value.filter((item) => {
      const normalized = item.trim().toLowerCase();
      return ["claude-sonnet-4", "claude-opus-4", "gpt-4o", "o3-mini", "gemini-2.5-pro"].some(
        (marker) => normalized.includes(marker),
      );
    }),
  );
  const categorySummaries = computed(() => context.value?.categorySummaries || []);
  const currentSummary = computed(
    () =>
      categorySummaries.value.find((item) => item.category === activeCategory.value) ||
      categorySummaries.value[0] ||
      null,
  );
  const mermaidByCategory = computed(() => context.value?.mermaidByCategory || {});
  const currentMermaid = computed(() => mermaidByCategory.value[activeCategory.value] || "");
  const changeCards = computed(() => orchestrationPreview.value?.changeCards || []);
  const supportedCategories = computed(
    () => context.value?.supportedCategories || [...ORCHESTRATION_CATEGORIES],
  );

  async function loadContext() {
    const response = await getChatSettingsCurrentContext();
    context.value = buildOrchestrationContext(response.data);
    if (!supportedCategories.value.includes(activeCategory.value)) {
      activeCategory.value = supportedCategories.value[0] || "deep";
    }
    if (!selectedModel.value || !selectableModels.value.includes(selectedModel.value)) {
      selectedModel.value = selectableModels.value[0];
    }
  }

  function setActiveCategory(category: string) {
    activeCategory.value = category;
  }

  function prefillIntent(templateType: string) {
    if (templateType === "parallelize") {
      draftIntent.value = `请把 ${activeCategory.value} 分类改成并行执行，并保持其他分类策略不变。`;
      return;
    }
    if (templateType === "enable-judge") {
      draftIntent.value = `请为 ${activeCategory.value} 分类启用 judge，并保持当前 judge agent 与模型约束。`;
      return;
    }
    if (templateType === "judge-model") {
      draftIntent.value = `请更新 ${activeCategory.value} 分类的 judge 模型，优先使用更强的模型，并保持其他编排策略不变。`;
      return;
    }
    draftIntent.value = `请检查 ${activeCategory.value} 分类的模板匹配与主执行链路，并给出仅针对编排策略的优化建议。`;
  }

  function buildRecommendedRewriteExample() {
    const category = resolveRewriteCategory(messages.value, activeCategory.value);
    return `请只修改 ${category} 分类，并保持其他分类不变。执行模式请明确写为 single 或 parallel；如果需要 pipeline，请单独说明开启或关闭 pipeline。请返回可直接应用的 orchestration-strategy patch。`;
  }

  function prefillRecommendedRewrite() {
    draftIntent.value = buildRecommendedRewriteExample();
  }

  async function sendIntent() {
    const content = draftIntent.value.trim();
    if (!content) {
      return;
    }

    messages.value.push({
      id: `user-${Date.now()}`,
      role: "user",
      content,
      createdAt: nowLabel(),
    });

    sending.value = true;
    errorMessage.value = "";
    draftIntent.value = "";

    try {
      const response = await chatWithChatSettings({
        conversationId: conversationId.value,
        message: content,
        model: selectedModel.value,
      });

      conversationId.value = response.data.conversationId;
      const patch = response.data.patch;
      pendingPatch.value = patch;

      messages.value.push({
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response.data.message,
        createdAt: nowLabel(),
        patch,
      });

      if (context.value && patch.configType === "orchestration-strategy") {
        orchestrationPreview.value =
          patch.orchestrationPreview || buildPreviewFromPatch(context.value.strategy, patch);
        const nextCategory = orchestrationPreview.value.affectedCategories[0];
        if (nextCategory) {
          activeCategory.value = nextCategory;
        }
      } else {
        orchestrationPreview.value = null;
        errorMessage.value =
          "当前页面只聚焦编排策略；这次建议未返回 orchestration-strategy patch。";
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "生成编排预览失败，请重试。";
      throw error;
    } finally {
      sending.value = false;
    }
  }

  async function applyPreview() {
    if (!conversationId.value || !pendingPatch.value) {
      return;
    }

    applying.value = true;
    applyingIndex.value = pendingPatch.value.index;
    errorMessage.value = "";

    try {
      await applyChatSettingsPatch({
        conversationId: conversationId.value,
        patchIndex: pendingPatch.value.index,
        configVersion: context.value?.orchestrationVersion || pendingPatch.value.configVersion,
        pendingPatch: pendingPatch.value,
      });
      await loadContext();
      orchestrationPreview.value = null;
      pendingPatch.value = null;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "应用编排变更失败，请重试。";
      throw error;
    } finally {
      applying.value = false;
      applyingIndex.value = null;
    }
  }

  function dismissChangeCard(changeId: string) {
    if (!orchestrationPreview.value) {
      return;
    }

    orchestrationPreview.value = {
      ...orchestrationPreview.value,
      changeCards: orchestrationPreview.value.changeCards.filter((item) => item.id !== changeId),
    };
  }

  function clearPreview() {
    pendingPatch.value = null;
    orchestrationPreview.value = null;
  }

  return {
    context,
    activeCategory,
    selectedModel,
    draftIntent,
    messages,
    conversationId,
    sending,
    applying,
    applyingIndex,
    pendingPatch,
    orchestrationPreview,
    errorMessage,
    availableModels,
    selectableModels,
    categorySummaries,
    currentSummary,
    mermaidByCategory,
    currentMermaid,
    changeCards,
    supportedCategories,
    loadContext,
    setActiveCategory,
    prefillIntent,
    buildRecommendedRewriteExample,
    prefillRecommendedRewrite,
    sendIntent,
    applyPreview,
    dismissChangeCard,
    clearPreview,
  };
});
