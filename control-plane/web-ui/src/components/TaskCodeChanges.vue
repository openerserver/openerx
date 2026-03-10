<template>
  <div>
    <a-empty v-if="!loading && changes.length === 0" description="暂无代码变更记录" />
    <a-spin v-else-if="loading" />
    <div v-else>
      <a-card
        v-for="change in changes"
        :key="change.id"
        size="small"
        style="margin-bottom: 12px"
      >
        <template #title>
          <a-space>
            <a-tag :color="sourceColor(change.changeSource)">{{ sourceLabel(change.changeSource) }}</a-tag>
            <span>{{ change.summary || '变更记录' }}</span>
          </a-space>
        </template>
        <template #extra>
          <a-typography-text type="secondary">{{ formatTime(change.createdAt) }}</a-typography-text>
        </template>

        <a-table
          v-if="fileMap[change.id]"
          :data-source="fileMap[change.id]"
          :columns="fileColumns"
          :pagination="false"
          size="small"
          row-key="id"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'changeType'">
              <a-tag :color="changeTypeColor(record.changeType)">{{ changeTypeLabel(record.changeType) }}</a-tag>
            </template>
            <template v-if="column.key === 'stats'">
              <span style="color: #52c41a">+{{ record.insertions }}</span>
              <span style="color: #ff4d4f; margin-left: 8px">-{{ record.deletions }}</span>
            </template>
          </template>
        </a-table>
        <a-button v-else type="link" size="small" @click="loadFiles(change.id)">加载文件列表</a-button>
      </a-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { type CodeChange, type FileChange, getChangeFiles, getTaskChanges } from "../lib/api";

const props = defineProps<{ taskId: string }>();

const loading = ref(false);
const changes = ref<CodeChange[]>([]);
const fileMap = reactive<Record<string, FileChange[]>>({});

const fileColumns = [
  { title: "文件路径", dataIndex: "filePath", key: "filePath", ellipsis: true },
  { title: "变更类型", key: "changeType", width: 100 },
  { title: "统计", key: "stats", width: 120 },
];

onMounted(async () => {
  loading.value = true;
  try {
    const result = await getTaskChanges(props.taskId);
    changes.value = result.data || [];
    // Auto-load files for the first change
    if (changes.value.length > 0) {
      await loadFiles(changes.value[0].id);
    }
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
});

async function loadFiles(changeId: string) {
  try {
    const result = await getChangeFiles(props.taskId, changeId);
    fileMap[changeId] = result.data || [];
  } catch {
    fileMap[changeId] = [];
  }
}

function sourceColor(source: string) {
  const map: Record<string, string> = {
    runtime_diff: "blue",
    task_snapshot: "green",
    git_commit: "purple",
  };
  return map[source] || "default";
}

function sourceLabel(source: string) {
  const map: Record<string, string> = {
    runtime_diff: "运行时差异",
    task_snapshot: "任务快照",
    git_commit: "Git 提交",
  };
  return map[source] || source;
}

function changeTypeColor(type: string) {
  const map: Record<string, string> = {
    added: "green",
    modified: "blue",
    deleted: "red",
    renamed: "orange",
  };
  return map[type] || "default";
}

function changeTypeLabel(type: string) {
  const map: Record<string, string> = {
    added: "新增",
    modified: "修改",
    deleted: "删除",
    renamed: "重命名",
  };
  return map[type] || type;
}

function formatTime(ts: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}
</script>
