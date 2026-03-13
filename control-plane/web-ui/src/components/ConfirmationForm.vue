<template>
  <div class="confirmation-form">
    <div class="confirmation-form__header">
      <span class="confirmation-form__icon">☑</span>
      <span class="confirmation-form__title">快捷回复</span>
    </div>

    <div
      v-for="q in block.questions"
      :key="q.index"
      class="confirmation-form__question"
    >
      <div class="confirmation-form__question-title">
        {{ q.index }}. {{ q.title }}
      </div>

      <!-- Show description and option bullets as context (skip options for single-choice since they become buttons) -->
      <div v-if="q.description || (q.answerType !== 'single-choice' && q.options.length)" class="confirmation-form__context">
        <div v-if="q.description" class="confirmation-form__desc">{{ q.description }}</div>
        <ul v-if="q.answerType !== 'single-choice' && q.options.length" class="confirmation-form__context-list">
          <li v-for="(opt, oi) in q.options" :key="oi">{{ cleanMarkdown(opt.text) }}</li>
        </ul>
      </div>

      <!-- Yes/No type -->
      <template v-if="q.answerType === 'yes-no'">
        <div class="confirmation-form__choices">
          <button
            type="button"
            :class="[
              'confirmation-form__choice-btn',
              { 'confirmation-form__choice-btn--selected': answers.get(q.index) === '可以' },
            ]"
            @click="setAnswer(q.index, '可以')"
          >
            可以 / 是
          </button>
          <button
            type="button"
            :class="[
              'confirmation-form__choice-btn',
              { 'confirmation-form__choice-btn--selected': answers.get(q.index) === '不行' },
            ]"
            @click="setAnswer(q.index, '不行')"
          >
            不行 / 否
          </button>
          <button
            type="button"
            :class="[
              'confirmation-form__choice-btn confirmation-form__choice-btn--custom',
              { 'confirmation-form__choice-btn--selected': isCustomAnswer(q.index) },
            ]"
            @click="toggleCustomInput(q.index)"
          >
            自定义
          </button>
        </div>
      </template>

      <!-- Single choice (from options) -->
      <template v-else-if="q.answerType === 'single-choice' && q.options.length > 0">
        <div class="confirmation-form__choices">
          <button
            v-for="(opt, oi) in q.options"
            :key="oi"
            type="button"
            :class="[
              'confirmation-form__choice-btn',
              { 'confirmation-form__choice-btn--selected': answers.get(q.index) === opt.text },
            ]"
            @click="setAnswer(q.index, opt.text)"
          >
            {{ truncateOption(opt.text) }}
          </button>
          <button
            type="button"
            :class="[
              'confirmation-form__choice-btn confirmation-form__choice-btn--custom',
              { 'confirmation-form__choice-btn--selected': isCustomAnswer(q.index) },
            ]"
            @click="toggleCustomInput(q.index)"
          >
            自定义
          </button>
        </div>
      </template>

      <!-- Free text type -->
      <template v-else>
        <div class="confirmation-form__choices">
          <button
            type="button"
            :class="[
              'confirmation-form__choice-btn',
              { 'confirmation-form__choice-btn--selected': answers.get(q.index) === '可以' },
            ]"
            @click="setAnswer(q.index, '可以')"
          >
            可以 / 接受
          </button>
          <button
            type="button"
            :class="[
              'confirmation-form__choice-btn confirmation-form__choice-btn--custom',
              { 'confirmation-form__choice-btn--selected': isCustomAnswer(q.index) },
            ]"
            @click="toggleCustomInput(q.index)"
          >
            自定义
          </button>
        </div>
      </template>

      <!-- Custom input -->
      <div v-if="customInputVisible.has(q.index)" class="confirmation-form__custom-input">
        <input
          :value="customTexts.get(q.index) || ''"
          type="text"
          class="confirmation-form__input"
          placeholder="输入你的回答..."
          @input="onCustomInput(q.index, $event)"
          @keydown.enter="applyCustomText(q.index)"
        />
        <button
          type="button"
          class="confirmation-form__apply-btn"
          :disabled="!customTexts.get(q.index)?.trim()"
          @click="applyCustomText(q.index)"
        >
          确定
        </button>
      </div>

      <!-- Show current answer -->
      <div v-if="answers.has(q.index)" class="confirmation-form__current-answer">
        已选：{{ answers.get(q.index) }}
      </div>
    </div>

    <div class="confirmation-form__footer">
      <span class="confirmation-form__progress">
        已回答 {{ answers.size }} / {{ block.questions.length }}
      </span>
      <button
        type="button"
        class="confirmation-form__submit-btn"
        :disabled="answers.size === 0"
        @click="handleSubmit"
      >
        填入回复框
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { type ConfirmationBlock, composeConfirmationReply } from "../lib/confirmation-parser";

const props = defineProps<{
  block: ConfirmationBlock;
}>();

const emit = defineEmits<{
  (e: "submit", reply: string): void;
}>();

const answers = reactive(new Map<number, string>());
const customInputVisible = reactive(new Set<number>());
const customTexts = reactive(new Map<number, string>());
const presetAnswers = ref(new Set<string>(["可以", "不行", "可以 / 接受"]));

function setAnswer(index: number, value: string) {
  answers.set(index, value);
  customInputVisible.delete(index);
}

function isCustomAnswer(index: number): boolean {
  const ans = answers.get(index);
  if (!ans) return customInputVisible.has(index);
  // Check if this answer matches a preset or an option
  if (presetAnswers.value.has(ans)) return false;
  const q = props.block.questions.find((q) => q.index === index);
  if (q?.options.some((o) => o.text === ans)) return false;
  return true;
}

function toggleCustomInput(index: number) {
  if (customInputVisible.has(index)) {
    customInputVisible.delete(index);
  } else {
    customInputVisible.add(index);
  }
}

function handleCustomInput(index: number, value: string) {
  customTexts.set(index, value);
}

function applyCustomText(index: number) {
  const text = customTexts.get(index)?.trim();
  if (text) {
    answers.set(index, text);
    customInputVisible.delete(index);
  }
}

function onCustomInput(index: number, event: Event) {
  const target = event.target as HTMLInputElement;
  handleCustomInput(index, target.value);
}

function cleanMarkdown(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`([^`]+)`/g, "$1");
}

function truncateOption(text: string): string {
  const clean = cleanMarkdown(text);
  return clean.length > 40 ? `${clean.slice(0, 37)}...` : clean;
}

function handleSubmit() {
  const reply = composeConfirmationReply(props.block.questions, answers);
  emit("submit", reply);
}
</script>

<style scoped>
.confirmation-form {
  margin-top: 10px;
  border: 1px solid #d9c7b1;
  border-radius: 8px;
  background: #fffdf9;
  padding: 12px 14px;
}

.confirmation-form__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #5f4b39;
}

.confirmation-form__icon {
  font-size: 15px;
}

.confirmation-form__question {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #eadfce;
}

.confirmation-form__question:last-of-type {
  border-bottom: none;
  margin-bottom: 8px;
}

.confirmation-form__question-title {
  font-size: 13px;
  font-weight: 600;
  color: #302419;
  margin-bottom: 4px;
}

.confirmation-form__context {
  margin-bottom: 6px;
  padding: 6px 10px;
  background: #f8f2e9;
  border-radius: 6px;
  font-size: 12px;
  color: #5f4b39;
  line-height: 1.5;
}

.confirmation-form__desc {
  margin-bottom: 2px;
}

.confirmation-form__context-list {
  margin: 2px 0 0;
  padding-left: 18px;
  list-style: disc;
}

.confirmation-form__context-list li {
  margin-bottom: 1px;
}

.confirmation-form__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.confirmation-form__choice-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid #d9c7b1;
  border-radius: 14px;
  background: #fff;
  color: #5f4b39;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.5;
}

.confirmation-form__choice-btn:hover {
  border-color: #4b74d1;
  color: #4b74d1;
  background: #f0f4ff;
}

.confirmation-form__choice-btn--selected {
  border-color: #4b74d1;
  background: #4b74d1;
  color: #fff;
}

.confirmation-form__choice-btn--selected:hover {
  background: #5c84de;
  color: #fff;
}

.confirmation-form__choice-btn--custom {
  border-style: dashed;
}

.confirmation-form__custom-input {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.confirmation-form__input {
  flex: 1;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid #d9c7b1;
  border-radius: 6px;
  background: #fff;
  color: #302419;
  outline: none;
  transition: border-color 0.15s;
}

.confirmation-form__input:focus {
  border-color: #4b74d1;
}

.confirmation-form__apply-btn {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid #4b74d1;
  border-radius: 6px;
  background: #4b74d1;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}

.confirmation-form__apply-btn:hover:not(:disabled) {
  background: #5c84de;
}

.confirmation-form__apply-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.confirmation-form__current-answer {
  margin-top: 4px;
  font-size: 11px;
  color: #4b74d1;
  font-style: italic;
}

.confirmation-form__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid #eadfce;
}

.confirmation-form__progress {
  font-size: 12px;
  color: #7b6650;
}

.confirmation-form__submit-btn {
  padding: 5px 16px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: #4b74d1;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}

.confirmation-form__submit-btn:hover:not(:disabled) {
  background: #5c84de;
}

.confirmation-form__submit-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
