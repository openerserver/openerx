<template>
  <div style="padding: 24px">
    <a-typography-title :level="3">
      Dashboard
      <a-typography-text
        v-if="projectStore.currentProject"
        type="secondary"
        style="font-size: 14px; margin-left: 12px"
      >
        {{ projectStore.currentProject.name }}
      </a-typography-text>
    </a-typography-title>

    <a-row :gutter="[16, 16]">
      <!-- Active Tasks -->
      <a-col :xs="24" :lg="8">
        <a-card title="活跃任务" size="small">
          <a-empty v-if="activeTasks.length === 0" description="暂无活跃任务" />
          <a-list v-else :data-source="activeTasks" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <router-link :to="`/workbench?task=${item.taskId}`">
                  <a-space>
                    <a-typography-text code>{{
                      item.taskId.slice(0, 8)
                    }}</a-typography-text>
                    <a-tag>{{ item.lastEvent }}</a-tag>
                  </a-space>
                </router-link>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- Agent Activity -->
      <a-col :xs="24" :lg="8">
        <a-card title="Agent 活动" size="small">
          <a-empty v-if="agentEvents.length === 0" description="暂无 Agent 活动" />
          <a-list v-else :data-source="agentEvents" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-space>
                  <a-tag :color="statusColor(item.type.split('.')[1])">
                    {{ item.type.split(".")[1] }}
                  </a-tag>
                  <a-typography-text type="secondary" style="font-size: 12px">
                    {{ item.agentRunId?.slice(0, 8) }}
                  </a-typography-text>
                  <a-typography-text
                    type="secondary"
                    style="font-size: 11px; margin-left: auto"
                  >
                    {{ formatTime(item.ts) }}
                  </a-typography-text>
                </a-space>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- Pending Approvals -->
      <a-col :xs="24" :lg="8">
        <a-card size="small">
          <template #title>
            待审批
            <a-badge
              :count="approvals.length"
              :number-style="{ backgroundColor: '#3b82f6' }"
              style="margin-left: 8px"
            />
          </template>
          <ApprovalPanel :approvals="approvals" @resolved="loadApprovals" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Event Stream -->
    <a-card title="事件流" size="small" style="margin-top: 16px">
      <a-empty v-if="events.length === 0" description="等待事件..." />
      <div v-else style="max-height: 260px; overflow-y: auto">
        <a-table
          :data-source="events.slice(0, 50)"
          :columns="eventColumns"
          :pagination="false"
          size="small"
          row-key="id"
        />
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { listApprovals } from "../lib/api";
import { useProjectStore } from "../stores/project";
import { useRealtimeStore } from "../stores/realtime";

const realtimeStore = useRealtimeStore();
const projectStore = useProjectStore();
const approvals = ref<unknown[]>([]);

const events = computed(() => {
  if (!projectStore.currentProjectId) return [];
  return realtimeStore.events.filter((event) => event.projectId === projectStore.currentProjectId);
});

async function loadApprovals() {
  try {
    approvals.value = (await listApprovals("pending")) as unknown[];
  } catch {
    approvals.value = [];
  }
}

onMounted(async () => {
  if (projectStore.projects.length === 0) {
    await projectStore.loadProjects();
  }
  await loadApprovals();
});

const activeTasks = computed(() => {
  const map = new Map<string, { taskId: string; lastEvent: string; lastUpdate: string }>();
  for (const e of events.value) {
    if (
      (e.type === "task.created" || e.type === "task.node.updated") &&
      e.taskId &&
      !map.has(e.taskId)
    ) {
      map.set(e.taskId, {
        taskId: e.taskId,
        lastEvent: e.type,
        lastUpdate: e.ts,
      });
    }
  }
  return Array.from(map.values());
});

const agentEvents = computed(() =>
  events.value.filter((e) => e.type.startsWith("agent.")).slice(0, 10),
);

const eventColumns = [
  {
    title: "时间",
    dataIndex: "ts",
    width: 100,
    customRender: ({ text }: { text: string }) => formatTime(text),
  },
  { title: "类型", dataIndex: "type", width: 180 },
  {
    title: "数据",
    dataIndex: "data",
    ellipsis: true,
    customRender: ({ text }: { text: Record<string, unknown> }) =>
      JSON.stringify(text).slice(0, 100),
  },
];

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString();
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    started: "blue",
    running: "blue",
    paused: "orange",
    completed: "green",
    failed: "red",
    stopped: "default",
  };
  return map[status] || "default";
}
</script>
