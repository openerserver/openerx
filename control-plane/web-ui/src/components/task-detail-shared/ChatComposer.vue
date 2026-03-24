<template>
  <div class="chat-composer">
    <a-space direction="vertical" style="width: 100%" size="middle">
      <div v-if="queuedItems.length > 0" class="chat-composer__queue-board">
        <a-flex justify="space-between" align="center" class="chat-composer__queue-header">
          <a-space size="small">
            <a-typography-text strong>待发送队列</a-typography-text>
            <a-tag color="gold">{{ queuedItems.length }}</a-tag>
          </a-space>
          <a-button type="text" size="small" @click="$emit('clearQueued')">清空</a-button>
        </a-flex>

        <div class="chat-composer__queue-list">
          <div v-for="(item, index) in queuedItems" :key="item.id" class="chat-composer__queue-item">
            <div class="chat-composer__queue-copy">
              <a-tag :color="index === 0 ? 'processing' : 'default'">{{ index === 0 ? '下一条' : `排队 ${index + 1}` }}</a-tag>
              <a-typography-paragraph :ellipsis="{ rows: 2, expandable: false }" class="chat-composer__queue-text">
                {{ item.prompt }}
              </a-typography-paragraph>
            </div>
            <a-button type="text" size="small" @click="$emit('removeQueued', item.id)">移除</a-button>
          </div>
        </div>
      </div>

      <a-textarea
        :value="prompt"
        :rows="4"
        :maxlength="50000"
        :disabled="inputDisabled"
        :placeholder="isExecuting ? '当前回复进行中，继续输入可进入队列；Enter 加入队列，Shift+Enter 换行' : '输入续跑指令，Enter 发送，Shift+Enter 换行'"
        @update:value="prompt = String($event ?? '')"
        @keydown="handleKeydown"
      />

      <a-flex justify="space-between" align="center" gap="small" wrap="wrap">
        <a-space size="small" wrap>
          <a-select
            :value="selectedModel"
            :options="modelOptions"
            :loading="modelsLoading"
            :disabled="modelSelectionDisabled"
            show-search
            style="width: 320px"
            placeholder="选择模型"
            @focus="$emit('refreshModels')"
            @update:value="$emit('update:selectedModel', String($event ?? ''))"
          />
          <a-tag v-if="isExecuting" color="processing">执行中</a-tag>
          <a-tag v-if="queueCount > 0" color="gold">已排队 {{ queueCount }}</a-tag>
        </a-space>

        <a-space size="small" wrap>
          <a-button :disabled="forkDisabled || !prompt.trim()" @click="emitFork">分叉</a-button>
          <a-button v-if="canTerminate" danger :disabled="actionDisabled" @click="$emit('terminate')">
            终止执行
          </a-button>
          <a-button type="primary" :disabled="actionDisabled || !prompt.trim()" @click="emitContinue">
            {{ isExecuting ? "加入队列" : "发送" }}
          </a-button>
        </a-space>
      </a-flex>

      <a-typography-text v-if="queueCount > 0" type="secondary" class="chat-composer__queue-hint">
        当前回复结束后，将自动继续发送排队中的输入。
      </a-typography-text>
    </a-space>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  inputDisabled: boolean;
  actionDisabled: boolean;
  modelSelectionDisabled: boolean;
  forkDisabled: boolean;
  isExecuting: boolean;
  canTerminate: boolean;
  modelOptions: Array<{ label: string; value: string }>;
  modelsLoading: boolean;
  selectedModel?: string;
  resetToken: number;
  queueCount: number;
  queuedItems: Array<{ id: string; prompt: string }>;
}>();

const emit = defineEmits<{
  (e: "continue", prompt: string): void;
  (e: "fork", prompt: string): void;
  (e: "terminate"): void;
  (e: "removeQueued", id: string): void;
  (e: "clearQueued"): void;
  (e: "update:selectedModel", model: string): void;
  (e: "refreshModels"): void;
}>();

const prompt = ref("");

watch(
  () => props.resetToken,
  () => {
    prompt.value = "";
  },
);

function emitContinue() {
  if (!prompt.value.trim()) {
    return;
  }
  emit("continue", prompt.value.trim());
}

function emitFork() {
  if (!prompt.value.trim()) {
    return;
  }
  emit("fork", prompt.value.trim());
}

function handleKeydown(event: KeyboardEvent) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing
  ) {
    return;
  }
  event.preventDefault();
  emitContinue();
}
</script>

<style scoped>
.chat-composer {
  flex: 0 0 auto;
  border-top: 1px solid #f0f0f0;
  padding-top: 12px;
  padding-bottom: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), #fff 24px);
}

.chat-composer__queue-hint {
  display: block;
  font-size: 12px;
}

.chat-composer__queue-board {
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(250, 250, 250, 0.95);
}

.chat-composer__queue-header {
  margin-bottom: 8px;
}

.chat-composer__queue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 144px;
  overflow-y: auto;
}

.chat-composer__queue-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff;
}

.chat-composer__queue-copy {
  min-width: 0;
  flex: 1;
}

.chat-composer__queue-text {
  margin: 6px 0 0;
  color: rgba(0, 0, 0, 0.72);
}
</style>