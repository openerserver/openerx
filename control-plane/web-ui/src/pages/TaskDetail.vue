<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="3" style="margin: 0">
        任务
        <a-typography-text code style="font-size: 14px">{{
          taskId?.slice(0, 8)
        }}</a-typography-text>
      </a-typography-title>
    </a-flex>

    <a-row :gutter="[16, 16]">
      <!-- Task Graph -->
      <a-col :xs="24" :xl="12">
        <a-card title="任务图" size="small">
          <div style="height: 400px">
            <TaskGraph :task-id="taskId || ''" :events="taskEvents" />
          </div>
        </a-card>
      </a-col>

      <!-- Agent Console -->
      <a-col :xs="24" :xl="12">
        <a-card title="Agent 控制" size="small">
          <a-empty
            v-if="agentRuns.length === 0"
            description="暂无 Agent 运行"
          />
          <a-space v-else direction="vertical" style="width: 100%">
            <AgentConsole
              v-for="run in agentRuns"
              :key="run.id"
              :agent-run-id="run.id"
              :agent-type="run.type"
              :status="run.status"
            />
          </a-space>
        </a-card>
      </a-col>
    </a-row>

    <!-- Task Event Log -->
    <a-card title="任务事件" size="small" style="margin-top: 16px">
      <a-empty v-if="taskEvents.length === 0" description="暂无任务事件" />
      <a-table
        v-else
        :data-source="taskEvents.slice(0, 30)"
        :columns="eventColumns"
        :pagination="false"
        size="small"
        row-key="id"
        :scroll="{ y: 200 }"
      />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import { useRealtimeStore } from "../stores/realtime";
import { getTask } from "../lib/api";
import AgentConsole from "../components/AgentConsole.vue";
import TaskGraph from "../components/TaskGraph.vue";

const route = useRoute();
const realtimeStore = useRealtimeStore();

const taskId = computed(() => route.params.taskId as string | undefined);

watch(
  taskId,
  (id) => {
    if (id) {
      realtimeStore.subscribeTask(id);
      getTask(id).catch(() => {});
    }
  },
  { immediate: true },
);

const taskEvents = computed(() =>
  realtimeStore.events.filter((e) => e.taskId === taskId.value),
);

const agentEvents = computed(() =>
  taskEvents.value.filter((e) => e.type.startsWith("agent.")),
);

const agentRuns = computed(() => {
  const map = new Map<string, { id: string; status: string; type: string }>();
  for (const event of agentEvents.value) {
    if (event.agentRunId) {
      map.set(event.agentRunId, {
        id: event.agentRunId,
        status: event.type.split(".")[1] ?? "unknown",
        type: (event.data.agentType as string) || "unknown",
      });
    }
  }
  return Array.from(map.values());
});

const eventColumns = [
  {
    title: "时间",
    dataIndex: "ts",
    width: 100,
    customRender: ({ text }: { text: string }) =>
      new Date(text).toLocaleTimeString(),
  },
  { title: "类型", dataIndex: "type", width: 200 },
  {
    title: "数据",
    dataIndex: "data",
    ellipsis: true,
    customRender: ({ text }: { text: Record<string, unknown> }) =>
      JSON.stringify(text).slice(0, 80),
  },
];
</script>
