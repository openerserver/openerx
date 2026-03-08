<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="3" style="margin: 0">
        Agent 控制台
        <a-badge
          :count="runningCount"
          :number-style="{ backgroundColor: '#3b82f6' }"
          style="margin-left: 8px"
        />
      </a-typography-title>
      <a-space>
        <a-badge
          :status="realtimeStore.connected ? 'success' : 'error'"
          :text="realtimeStore.connected ? '实时连接' : '未连接'"
        />
        <a-button @click="refreshAgents" :loading="loading">刷新</a-button>
      </a-space>
    </a-flex>

    <!-- Quick Guidance Injection -->
    <a-card size="small" style="margin-bottom: 16px">
      <template #title>
        <a-flex align="center" :gap="8">
          <SendOutlined />
          <span>快速注入指令</span>
        </a-flex>
      </template>
      <a-flex :gap="12">
        <a-select
          v-model:value="selectedAgentId"
          style="width: 280px"
          placeholder="选择 Agent"
          :options="agentSelectOptions"
          allow-clear
        />
        <a-input
          v-model:value="quickGuidance"
          placeholder="输入指令内容（Agent 暂停时可用）..."
          style="flex: 1"
          @press-enter="handleQuickGuidance"
        />
        <a-radio-group v-model:value="guidanceMode" size="small">
          <a-radio-button value="reply">等待回复</a-radio-button>
          <a-radio-button value="noReply">仅注入</a-radio-button>
        </a-radio-group>
        <a-button
          type="primary"
          :loading="guidanceLoading"
          :disabled="!selectedAgentId || !quickGuidance.trim()"
          @click="handleQuickGuidance"
        >
          发送
        </a-button>
      </a-flex>
    </a-card>

    <!-- Agent Runs -->
    <a-row :gutter="[16, 16]">
      <!-- Agent list from API + realtime -->
      <a-col :xs="24" :xl="16">
        <a-card title="Agent 运行实例" size="small">
          <a-empty v-if="allAgentRuns.length === 0" description="暂无 Agent 运行实例">
            <template #image>
              <RobotOutlined style="font-size: 48px; color: #334155" />
            </template>
            <a-typography-paragraph type="secondary">
              当 AI Agent 被分配任务后，运行实例将显示在此处。
              您可以暂停、恢复、终止 Agent，或在暂停时注入指令。
            </a-typography-paragraph>
          </a-empty>

          <a-space v-else direction="vertical" style="width: 100%" :size="12">
            <a-card
              v-for="run in allAgentRuns"
              :key="run.agentRunId"
              size="small"
              :bordered="true"
              :class="{ 'selected-agent': selectedAgentId === run.agentRunId }"
              hoverable
              @click="selectedAgentId = run.agentRunId"
            >
              <template #title>
                <a-flex align="center" :gap="8">
                  <RobotOutlined />
                  <span>{{ run.agentType || 'Agent' }}</span>
                  <a-typography-text code style="font-size: 11px">
                    {{ run.agentRunId.slice(0, 12) }}
                  </a-typography-text>
                  <a-tag :color="statusColor(run.status)">{{ statusLabel(run.status) }}</a-tag>
                  <router-link
                    v-if="run.taskId"
                    :to="`/tasks/${run.taskId}`"
                    style="margin-left: auto; font-size: 12px"
                    @click.stop
                  >
                    任务 {{ run.taskId.slice(0, 8) }}
                  </router-link>
                </a-flex>
              </template>

              <!-- Control Buttons -->
              <a-flex :gap="8" wrap="wrap" style="margin-bottom: 8px">
                <a-button
                  v-if="run.status === 'running'"
                  size="small"
                  :loading="actionLoading === run.agentRunId"
                  @click.stop="handlePause(run.agentRunId)"
                >
                  <template #icon><PauseCircleOutlined /></template>
                  暂停
                </a-button>
                <a-button
                  v-if="run.status === 'paused'"
                  size="small"
                  type="primary"
                  :loading="actionLoading === run.agentRunId"
                  @click.stop="handleResume(run.agentRunId)"
                >
                  <template #icon><PlayCircleOutlined /></template>
                  恢复
                </a-button>
                <a-popconfirm
                  v-if="run.status === 'running' || run.status === 'paused'"
                  title="确定终止此 Agent？此操作不可恢复。"
                  @confirm="handleTerminate(run.agentRunId)"
                >
                  <a-button
                    size="small"
                    danger
                    :loading="actionLoading === run.agentRunId"
                    @click.stop
                  >
                    <template #icon><StopOutlined /></template>
                    终止
                  </a-button>
                </a-popconfirm>
                <a-tag v-if="run.status === 'completed'" color="green">已完成</a-tag>
                <a-tag v-if="run.status === 'stopped'" color="default">已停止</a-tag>
                <a-tag v-if="run.status === 'failed'" color="red">失败</a-tag>
              </a-flex>

              <!-- Inline Guidance (when paused) -->
              <a-input-search
                v-if="run.status === 'paused'"
                v-model:value="inlineGuidance[run.agentRunId]"
                placeholder="注入指令..."
                enter-button="发送"
                size="small"
                :loading="actionLoading === run.agentRunId"
                @search="handleInlineGuidance(run.agentRunId)"
                @click.stop
              />

              <!-- Recent events for this agent -->
              <div
                v-if="getAgentEvents(run.agentRunId).length > 0"
                style="margin-top: 8px; max-height: 100px; overflow-y: auto"
              >
                <div
                  v-for="evt in getAgentEvents(run.agentRunId).slice(0, 5)"
                  :key="evt.id"
                  style="font-size: 11px; color: #94a3b8; padding: 2px 0"
                >
                  <a-tag :color="eventColor(evt.type)" style="font-size: 10px">
                    {{ evt.type.split('.').pop() }}
                  </a-tag>
                  {{ formatTime(evt.ts) }}
                  <span v-if="evt.data?.content" style="color: #64748b; margin-left: 4px">
                    {{ String(evt.data.content).slice(0, 60) }}
                  </span>
                </div>
              </div>
            </a-card>
          </a-space>
        </a-card>
      </a-col>

      <!-- Right sidebar: event stream + stats -->
      <a-col :xs="24" :xl="8">
        <!-- Stats -->
        <a-card size="small" style="margin-bottom: 16px">
          <a-row :gutter="16">
            <a-col :span="8" style="text-align: center">
              <a-statistic
                title="运行中"
                :value="runningCount"
                :value-style="{ color: '#3b82f6' }"
              />
            </a-col>
            <a-col :span="8" style="text-align: center">
              <a-statistic
                title="已暂停"
                :value="pausedCount"
                :value-style="{ color: '#f59e0b' }"
              />
            </a-col>
            <a-col :span="8" style="text-align: center">
              <a-statistic
                title="已完成"
                :value="completedCount"
                :value-style="{ color: '#22c55e' }"
              />
            </a-col>
          </a-row>
        </a-card>

        <!-- Agent Event Stream -->
        <a-card title="Agent 事件流" size="small">
          <a-empty
            v-if="agentEvents.length === 0"
            description="等待 Agent 事件..."
          />
          <div v-else style="max-height: 500px; overflow-y: auto">
            <a-timeline mode="left">
              <a-timeline-item
                v-for="evt in agentEvents.slice(0, 50)"
                :key="evt.id"
                :color="eventColor(evt.type)"
              >
                <div style="font-size: 12px">
                  <a-tag :color="eventColor(evt.type)" style="font-size: 10px">
                    {{ evt.type }}
                  </a-tag>
                </div>
                <div style="font-size: 11px; color: #94a3b8">
                  {{ formatTime(evt.ts) }}
                  <span v-if="evt.agentRunId">
                    · {{ evt.agentRunId.slice(0, 8) }}
                  </span>
                </div>
                <div
                  v-if="evt.data && Object.keys(evt.data).length > 0"
                  style="font-size: 11px; color: #64748b; margin-top: 2px"
                >
                  {{ JSON.stringify(evt.data).slice(0, 80) }}
                </div>
              </a-timeline-item>
            </a-timeline>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from "vue";
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SendOutlined,
  RobotOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import {
  pauseAgent,
  resumeAgent,
  injectGuidance,
  terminateAgent,
  listAgentRuns,
} from "@/lib/api";
import { useRealtimeStore } from "@/stores/realtime";

interface AgentRun {
  agentRunId: string;
  subSessionId?: string;
  status: string;
  taskId: string;
  agentType?: string;
}

const realtimeStore = useRealtimeStore();
const loading = ref(false);
const actionLoading = ref<string | null>(null);
const guidanceLoading = ref(false);

const registeredRuns = ref<AgentRun[]>([]);
const selectedAgentId = ref<string | undefined>(undefined);
const quickGuidance = ref("");
const guidanceMode = ref<"reply" | "noReply">("reply");
const inlineGuidance = reactive<Record<string, string>>({});

// Merge API-registered runs with runs discovered from WebSocket events
const allAgentRuns = computed(() => {
  const map = new Map<string, AgentRun>();

  // API-registered runs take priority
  for (const run of registeredRuns.value) {
    map.set(run.agentRunId, run);
  }

  // Discover additional runs from realtime events
  for (const evt of realtimeStore.events) {
    if (evt.type.startsWith("agent.") && evt.agentRunId && !map.has(evt.agentRunId)) {
      map.set(evt.agentRunId, {
        agentRunId: evt.agentRunId,
        status: deriveStatus(evt.type),
        taskId: evt.taskId || "",
        agentType: (evt.data?.agentType as string) || "Agent",
      });
    }
    // Update status from newer events
    if (evt.type.startsWith("agent.") && evt.agentRunId && map.has(evt.agentRunId)) {
      const existing = map.get(evt.agentRunId)!;
      const derivedStatus = deriveStatus(evt.type);
      if (derivedStatus !== "unknown") {
        existing.status = derivedStatus;
      }
      if (!existing.agentType && evt.data?.agentType) {
        existing.agentType = evt.data.agentType as string;
      }
    }
  }

  // Sort: running first, then paused, then others
  const order: Record<string, number> = { running: 0, paused: 1, stopped: 2, completed: 3, failed: 4 };
  return Array.from(map.values()).sort(
    (a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5),
  );
});

const agentSelectOptions = computed(() =>
  allAgentRuns.value
    .filter((r) => r.status === "running" || r.status === "paused")
    .map((r) => ({
      value: r.agentRunId,
      label: `${r.agentType || "Agent"} (${r.agentRunId.slice(0, 8)}) - ${statusLabel(r.status)}`,
    })),
);

const agentEvents = computed(() =>
  realtimeStore.events.filter(
    (e) => e.type.startsWith("agent.") || e.type === "guidance.injected",
  ),
);

const runningCount = computed(() => allAgentRuns.value.filter((r) => r.status === "running").length);
const pausedCount = computed(() => allAgentRuns.value.filter((r) => r.status === "paused").length);
const completedCount = computed(
  () => allAgentRuns.value.filter((r) => r.status === "completed" || r.status === "stopped").length,
);

function getAgentEvents(agentRunId: string) {
  return realtimeStore.events.filter((e) => e.agentRunId === agentRunId);
}

function deriveStatus(eventType: string): string {
  const map: Record<string, string> = {
    "agent.started": "running",
    "agent.running": "running",
    "agent.paused": "paused",
    "agent.resumed": "running",
    "agent.completed": "completed",
    "agent.failed": "failed",
    "agent.stopped": "stopped",
  };
  return map[eventType] || "unknown";
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    running: "blue",
    paused: "orange",
    completed: "green",
    failed: "red",
    stopped: "default",
  };
  return map[status] || "default";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止",
  };
  return map[status] || status;
}

function eventColor(type: string) {
  if (type.includes("started") || type.includes("running") || type.includes("resumed")) return "blue";
  if (type.includes("paused")) return "orange";
  if (type.includes("completed")) return "green";
  if (type.includes("failed") || type.includes("stopped")) return "red";
  if (type.includes("guidance")) return "purple";
  return "default";
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString();
}

async function refreshAgents() {
  loading.value = true;
  try {
    registeredRuns.value = await listAgentRuns();
  } catch {
    // Might fail if no agents registered yet
    registeredRuns.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleAction(agentRunId: string, action: () => Promise<unknown>) {
  actionLoading.value = agentRunId;
  try {
    await action();
  } catch (e) {
    message.error(String(e));
  } finally {
    actionLoading.value = null;
  }
}

async function handlePause(agentRunId: string) {
  await handleAction(agentRunId, () => pauseAgent(agentRunId));
}

async function handleResume(agentRunId: string) {
  await handleAction(agentRunId, () => resumeAgent(agentRunId));
}

async function handleTerminate(agentRunId: string) {
  await handleAction(agentRunId, () => terminateAgent(agentRunId));
}

async function handleInlineGuidance(agentRunId: string) {
  const text = inlineGuidance[agentRunId]?.trim();
  if (!text) return;
  await handleAction(agentRunId, () => injectGuidance(agentRunId, text));
  inlineGuidance[agentRunId] = "";
  message.success("指令已发送");
}

async function handleQuickGuidance() {
  if (!selectedAgentId.value || !quickGuidance.value.trim()) return;
  guidanceLoading.value = true;
  try {
    await injectGuidance(selectedAgentId.value, quickGuidance.value, guidanceMode.value);
    message.success("指令已发送");
    quickGuidance.value = "";
  } catch (e) {
    message.error(String(e));
  } finally {
    guidanceLoading.value = false;
  }
}

onMounted(() => refreshAgents());
</script>

<style scoped>
.selected-agent {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 1px #3b82f6;
}
</style>
