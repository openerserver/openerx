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
            <TaskGraph :task-id="taskId || ''" :events="taskEvents" :fallback-status="task?.status" />
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

    <!-- Orchestration Decisions -->
    <a-card title="编排决策" size="small" style="margin-top: 16px">
      <a-empty v-if="!task?.category && !strategy" description="暂无编排数据" />
      <a-descriptions v-else :column="{ xs: 1, sm: 2, lg: 4 }" bordered size="small">
        <a-descriptions-item label="意图分类">
          <a-tag color="blue">{{ categoryLabels[task?.category || ''] || task?.category || '-' }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="复杂度">
          <a-tag :color="complexityColors[strategy?.complexity || ''] || 'default'">
            {{ strategy?.complexity || '-' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="置信度">
          <a-progress
            :percent="Math.round((strategy?.confidence ?? 0) * 100)"
            :stroke-color="(strategy?.confidence ?? 0) >= 0.6 ? '#52c41a' : '#faad14'"
            size="small"
            style="width: 120px"
          />
        </a-descriptions-item>
        <a-descriptions-item label="需要规划">
          <a-tag :color="strategy?.requiresPlan ? 'orange' : 'green'">
            {{ strategy?.requiresPlan ? '是' : '否' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="推荐 Agents" :span="{ xs: 1, sm: 2, lg: 4 }">
          <a-tag v-for="agent in (strategy?.suggestedAgents || [])" :key="agent" color="purple">
            {{ agent }}
          </a-tag>
          <span v-if="!strategy?.suggestedAgents?.length">-</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- Planning Pipeline -->
    <a-card title="规划流水线" size="small" style="margin-top: 16px">
      <a-empty v-if="pipelineStages.length === 0" description="暂无规划数据" />
      <a-steps v-else :current="pipelineCurrentStep" size="small" style="margin-bottom: 12px">
        <a-step
          v-for="stage in pipelineStages"
          :key="stage.agent"
          :title="stage.label"
          :status="stage.status === 'completed' ? 'finish' : stage.status === 'running' ? 'process' : 'wait'"
        />
      </a-steps>
      <a-collapse v-if="pipelineStages.some(s => s.output)" size="small">
        <a-collapse-panel
          v-for="stage in pipelineStages.filter(s => s.output)"
          :key="stage.agent"
          :header="`${stage.label} 输出 (${stage.messageCount} 条消息)`"
        >
          <pre style="white-space: pre-wrap; font-size: 12px; max-height: 300px; overflow: auto">{{ stage.output }}</pre>
        </a-collapse-panel>
      </a-collapse>
    </a-card>

    <!-- Session History & Continue -->
    <a-card title="会话历史" size="small" style="margin-top: 16px">
      <template #extra>
        <a-button
          size="small"
          type="primary"
          :disabled="!task?.sessionId || task?.status === 'running'"
          @click="showContinueModal = true"
        >续跑</a-button>
      </template>
      <a-empty v-if="sessions.length === 0" description="暂无会话记录" />
      <a-table
        v-else
        :data-source="sessions"
        :columns="sessionColumns"
        :pagination="false"
        size="small"
        row-key="id"
      />
    </a-card>

    <a-modal
      :open="showContinueModal"
      title="继续执行任务"
      @ok="handleContinue"
      @cancel="showContinueModal = false"
      okText="发送"
      cancelText="取消"
      :confirmLoading="continuing"
    >
      <a-form layout="vertical">
        <a-form-item label="补充指令">
          <a-textarea v-model:value="continuePrompt" :rows="4" placeholder="输入续跑指令..." />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Task Event Log -->
    <a-card title="任务事件" size="small" style="margin-top: 16px">
      <a-empty v-if="taskEvents.length === 0" description="暂无任务事件" />
      <a-table
        v-else
          :data-source="displayedTaskEvents"
        :columns="eventColumns"
        :pagination="false"
        size="small"
          row-key="tableKey"
        :scroll="{ y: 200 }"
      />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AgentConsole from "../components/AgentConsole.vue";
import TaskGraph from "../components/TaskGraph.vue";
import {
  type PipelineStage,
  type SessionInfo,
  type Task,
  continueTask,
  getTask,
  getTaskPipeline,
  getTaskSessions,
} from "../lib/api";
import { useRealtimeStore } from "../stores/realtime";

const route = useRoute();
const realtimeStore = useRealtimeStore();

const taskId = computed(() => route.params.taskId as string | undefined);
const task = ref<Task | null>(null);

// Pipeline
const pipelineStages = ref<PipelineStage[]>([]);
const pipelineCurrentStep = computed(() => {
  const idx = pipelineStages.value.findIndex((s) => s.status !== "completed");
  return idx === -1 ? pipelineStages.value.length : idx;
});

// Sessions
const sessions = ref<SessionInfo[]>([]);

// Continue modal
const showContinueModal = ref(false);
const continuePrompt = ref("");
const continuing = ref(false);

watch(
  taskId,
  (id) => {
    if (id) {
      realtimeStore.subscribeTask(id);
      getTask(id)
        .then((t) => {
          task.value = t;
        })
        .catch(() => {});
      getTaskPipeline(id)
        .then((r) => {
          pipelineStages.value = r.stages;
        })
        .catch(() => {});
      getTaskSessions(id)
        .then((r) => {
          sessions.value = r.data;
        })
        .catch(() => {});
    }
  },
  { immediate: true },
);

async function handleContinue() {
  if (!taskId.value || !continuePrompt.value.trim()) return;
  continuing.value = true;
  try {
    await continueTask(taskId.value, continuePrompt.value);
    message.success("续跑指令已发送");
    showContinueModal.value = false;
    continuePrompt.value = "";
    // Refresh task
    const t = await getTask(taskId.value);
    task.value = t;
  } catch (e) {
    message.error(`续跑失败: ${e}`);
  } finally {
    continuing.value = false;
  }
}

const strategy = computed(() => {
  if (!task.value?.strategy) return null;
  try {
    return JSON.parse(task.value.strategy) as {
      complexity?: string;
      suggestedAgents?: string[];
      requiresPlan?: boolean;
      confidence?: number;
    };
  } catch {
    return null;
  }
});

const categoryLabels: Record<string, string> = {
  quick: "快速查询",
  deep: "深度开发",
  ops: "运维操作",
  security: "安全审计",
  architecture: "架构设计",
};

const complexityColors: Record<string, string> = {
  low: "green",
  medium: "orange",
  high: "red",
};

type AgentRunStatus = "running" | "paused" | "completed" | "failed" | "stopped";

function normalizeAgentEventStatus(eventType?: string): AgentRunStatus | undefined {
  const statusMap: Record<string, AgentRunStatus> = {
    "agent.started": "running",
    "agent.running": "running",
    "agent.resumed": "running",
    "agent.paused": "paused",
    "agent.completed": "completed",
    "agent.failed": "failed",
    "agent.stopped": "stopped",
  };

  return eventType ? statusMap[eventType] : undefined;
}

function normalizeTaskStatus(status?: string): AgentRunStatus | undefined {
  const statusMap: Record<string, AgentRunStatus> = {
    running: "running",
    paused: "paused",
    completed: "completed",
    failed: "failed",
    stopped: "stopped",
  };

  return status ? statusMap[status] : undefined;
}

const sessionColumns = [
  { title: "Session ID", dataIndex: "id", width: 180, ellipsis: true },
  { title: "标题", dataIndex: "title", ellipsis: true },
  {
    title: "状态",
    dataIndex: "isActive",
    width: 80,
    customRender: ({ text }: { text: boolean }) => (text ? "当前" : "历史"),
  },
  {
    title: "变更",
    dataIndex: "summary",
    width: 150,
    customRender: ({
      text,
    }: {
      text: { additions: number; deletions: number; files: number } | null;
    }) => (text ? `+${text.additions} -${text.deletions} (${text.files} 文件)` : "-"),
  },
  {
    title: "创建时间",
    dataIndex: "createdAt",
    width: 160,
    customRender: ({ text }: { text?: string }) => (text ? new Date(text).toLocaleString() : "-"),
  },
];

const taskEvents = computed(() => realtimeStore.events.filter((e) => e.taskId === taskId.value));

const displayedTaskEvents = computed(() =>
  taskEvents.value.slice(0, 30).map((event, index) => ({
    ...event,
    tableKey: event.id || `${event.ts}-${event.type}-${index}`,
    data: event.data && typeof event.data === "object" ? event.data : {},
  })),
);

const agentEvents = computed(() => taskEvents.value.filter((e) => e.type.startsWith("agent.")));

const agentRuns = computed(() => {
  const runs = new Map<
    string,
    { id: string; status: AgentRunStatus; type: string; updatedAt: number }
  >();

  if (task.value?.agentRunId) {
    runs.set(task.value.agentRunId, {
      id: task.value.agentRunId,
      status: normalizeTaskStatus(task.value.status) ?? "running",
      type: "Agent",
      updatedAt: task.value.startedAt ? Date.parse(task.value.startedAt) : 0,
    });
  }

  for (const event of [...agentEvents.value].reverse()) {
    if (!event.agentRunId) {
      continue;
    }

    const existing = runs.get(event.agentRunId);
    runs.set(event.agentRunId, {
      id: event.agentRunId,
      status: normalizeAgentEventStatus(event.type) ?? existing?.status ?? "running",
      type:
        typeof event.data.agentType === "string"
          ? event.data.agentType
          : existing?.type ?? "Agent",
      updatedAt: Date.parse(event.ts),
    });
  }

  const order: Record<AgentRunStatus, number> = {
    running: 0,
    paused: 1,
    completed: 2,
    failed: 3,
    stopped: 4,
  };

  return Array.from(runs.values())
    .sort((left, right) => {
      const statusOrder = order[left.status] - order[right.status];
      if (statusOrder !== 0) {
        return statusOrder;
      }

      return right.updatedAt - left.updatedAt;
    })
    .map(({ updatedAt: _updatedAt, ...run }) => run);
});

const eventColumns = [
  {
    title: "时间",
    dataIndex: "ts",
    width: 100,
    customRender: ({ text }: { text?: string }) =>
      text ? new Date(text).toLocaleTimeString() : "-",
  },
  { title: "类型", dataIndex: "type", width: 200 },
  {
    title: "数据",
    dataIndex: "data",
    ellipsis: true,
    customRender: ({ text }: { text?: Record<string, unknown> }) => {
      const serialized = JSON.stringify(text ?? {});
      return serialized.length > 80 ? `${serialized.slice(0, 80)}...` : serialized;
    },
  },
];
</script>
