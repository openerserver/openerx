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
      <a-empty v-if="!task?.category && !strategy && !task?.selectedModel" description="暂无编排数据" />
      <a-descriptions v-else :column="{ xs: 1, sm: 2, lg: 4 }" bordered size="small">
        <a-descriptions-item label="执行模型">
          <a-tag v-if="task?.selectedModel" color="cyan">{{ task.selectedModel }}</a-tag>
          <a-typography-text v-else type="secondary">项目/系统默认</a-typography-text>
        </a-descriptions-item>
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
        <a-descriptions-item label="实际执行 Agent">
          <a-tag v-if="strategy?.selectedAgent" color="geekblue">{{ strategy.selectedAgent }}</a-tag>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="执行模式">
          <a-tag :color="(task?.executionMode || strategy?.executionMode) === 'parallel' ? 'volcano' : 'blue'">
            {{ (task?.executionMode || strategy?.executionMode) === 'parallel' ? '并行竞争' : '单一执行' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="推荐 Agents">
          <a-tag v-for="agent in (strategy?.suggestedAgents || [])" :key="agent" color="purple">
            {{ agent }}
          </a-tag>
          <span v-if="!strategy?.suggestedAgents?.length">-</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- Execution Plan Candidates -->
    <a-card
      v-if="executionPlan && executionPlan.candidates.length > 1"
      title="并行执行候选"
      size="small"
      style="margin-top: 16px"
    >
      <a-table
        :data-source="executionPlan.candidates"
        :columns="candidateColumns"
        :pagination="false"
        size="small"
        row-key="label"
      >
        <template #bodyCell="{ column, record, index }">
          <template v-if="column.dataIndex === 'label'">
            <a-space>
              <span>{{ record.label }}</span>
              <a-tag v-if="executionPlan?.judgeResult?.winnerIndex === index" color="gold">获胜</a-tag>
            </a-space>
          </template>
          <template v-else-if="column.dataIndex === 'agent'">
            <a-tag color="geekblue">{{ record.agent }}</a-tag>
            <a-tag v-if="record.model" color="cyan" style="margin-left: 4px">{{ record.model }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'status'">
            <a-tag :color="candidateStatusColor(record.status)">{{ candidateStatusLabel(record.status) }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'score'">
            <span v-if="executionPlan?.judgeResult?.scores?.[index] != null">
              {{ executionPlan.judgeResult.scores[index].toFixed(1) }}
            </span>
            <span v-else>-</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- Judge Result -->
    <a-card
      v-if="executionPlan?.judgeResult"
      title="裁判评估结果"
      size="small"
      style="margin-top: 16px"
    >
      <a-descriptions :column="{ xs: 1, sm: 2 }" bordered size="small">
        <a-descriptions-item label="获胜方案">
          <a-tag color="gold">
            {{ executionPlan.candidates[executionPlan.judgeResult.winnerIndex]?.label || `候选 #${executionPlan.judgeResult.winnerIndex}` }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="评分">
          <a-space>
            <span v-for="(score, idx) in executionPlan.judgeResult.scores" :key="idx">
              <a-tag :color="idx === executionPlan.judgeResult.winnerIndex ? 'gold' : 'default'">
                {{ executionPlan.candidates[idx]?.label || `#${idx}` }}: {{ score.toFixed(1) }}
              </a-tag>
            </span>
          </a-space>
        </a-descriptions-item>
        <a-descriptions-item label="评估理由">
          <pre style="white-space: pre-wrap; font-size: 12px; max-height: 200px; overflow: auto">{{ executionPlan.judgeResult.reasoning }}</pre>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- Hook Executions -->
    <a-card
      v-if="strategy?.hookExecutions?.length"
      title="Hook 执行记录"
      size="small"
      style="margin-top: 16px"
    >
      <a-table
        :data-source="strategy.hookExecutions"
        :columns="hookColumns"
        :pagination="false"
        size="small"
        row-key="hookId"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'trigger'">
            <a-tag>{{ hookTriggerLabel(record.trigger) }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'status'">
            <a-tag :color="evaluationStatusColor(record.status)">{{ evaluationStatusLabel(record.status) }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'agent'">
            <a-tag color="blue">{{ record.agent }}</a-tag>
          </template>
          <template v-else-if="column.dataIndex === 'result'">
            <a-typography-text v-if="record.error" type="danger">{{ record.error }}</a-typography-text>
            <a-typography-paragraph
              v-else-if="record.result"
              :ellipsis="{ rows: 2, expandable: true }"
              :content="record.result"
              style="margin: 0; font-size: 12px"
            />
            <span v-else>-</span>
          </template>
          <template v-else-if="column.dataIndex === 'decision'">
            <template v-if="record.decision">
              <a-tag :color="record.decision.action === 'allow' ? 'green' : record.decision.action === 'rewrite-prompt' ? 'orange' : 'red'">{{ record.decision.action }}</a-tag>
              <a-typography-text v-if="record.decision.reason" style="font-size: 11px; display: block; margin-top: 4px">{{ record.decision.reason }}</a-typography-text>
            </template>
            <span v-else>-</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- Code Context -->
    <a-card v-if="task?.repoId" title="代码上下文" size="small" style="margin-top: 16px">
      <a-descriptions :column="{ xs: 1, sm: 2 }" bordered size="small">
        <a-descriptions-item label="仓库">
          {{ task.repoName || task.repoId }}
        </a-descriptions-item>
        <a-descriptions-item label="远程地址">
          <a-typography-text v-if="task.remoteUrl" copyable>{{ task.remoteUrl }}</a-typography-text>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="工作分支">
          <a-tag v-if="task.workingBranch" color="blue">{{ task.workingBranch }}</a-tag>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="工作目录">
          <a-typography-text v-if="task.workspaceRoot" code>{{ task.workspaceRoot }}</a-typography-text>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="基线版本">
          <a-typography-text v-if="task.baseRevision" code>{{ task.baseRevision?.slice(0, 12) }}</a-typography-text>
          <span v-else>-</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- Identity Snapshot -->
    <a-card v-if="task?.credentialId || task?.gitAuthorName || task?.gitAuthorEmail" title="身份快照" size="small" style="margin-top: 16px">
      <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
        任务发起人不一定等于最终 Git Author。执行凭证决定仓库访问权限，Author/Committer 决定提交显示身份。
      </a-typography-text>
      <a-descriptions :column="{ xs: 1, sm: 2 }" bordered size="small">
        <a-descriptions-item label="执行凭证">
          <a-tag v-if="task.credentialLabel" color="blue">{{ task.credentialLabel }}</a-tag>
          <a-typography-text v-if="task.credentialId" type="secondary" style="margin-left: 4px">
            ({{ task.credentialId.slice(0, 8) }})
          </a-typography-text>
          <span v-if="!task.credentialLabel && !task.credentialId">-</span>
        </a-descriptions-item>
        <a-descriptions-item label="Author">
          <span v-if="task.gitAuthorName || task.gitAuthorEmail">
            {{ task.gitAuthorName || '' }}
            <a-typography-text v-if="task.gitAuthorEmail" type="secondary">
              &lt;{{ task.gitAuthorEmail }}&gt;
            </a-typography-text>
          </span>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="Committer">
          <span v-if="task.gitCommitterName || task.gitCommitterEmail">
            {{ task.gitCommitterName || '' }}
            <a-typography-text v-if="task.gitCommitterEmail" type="secondary">
              &lt;{{ task.gitCommitterEmail }}&gt;
            </a-typography-text>
          </span>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="最终分支">
          <a-tag v-if="task.finalBranchName" color="cyan">{{ task.finalBranchName }}</a-tag>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="最终提交">
          <a-typography-text v-if="task.finalCommitSha" code copyable>{{ task.finalCommitSha.slice(0, 12) }}</a-typography-text>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item v-if="task.changesSummary" label="变更摘要">
          <a-space>
            <a-tag color="green">+{{ task.changesSummary.totalInsertions || 0 }}</a-tag>
            <a-tag color="red">-{{ task.changesSummary.totalDeletions || 0 }}</a-tag>
            <a-typography-text type="secondary">
              {{ task.changesSummary.filesAdded || 0 }} 新增 ·
              {{ task.changesSummary.filesModified || 0 }} 修改 ·
              {{ task.changesSummary.filesDeleted || 0 }} 删除
            </a-typography-text>
          </a-space>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- Code Changes -->
    <a-card title="代码变更" size="small" style="margin-top: 16px">
      <TaskCodeChanges v-if="taskId" :task-id="taskId" />
    </a-card>

    <!-- Governance Summary -->
    <a-card title="治理评估" size="small" style="margin-top: 16px">
      <a-spin v-if="governanceLoading" />
      <a-empty v-else-if="!governance" description="暂无治理数据" />
      <div v-else>
        <a-descriptions :column="{ xs: 1, sm: 2 }" bordered size="small">
          <a-descriptions-item label="风险等级">
            <a-tag :color="riskColor(governance.overallRisk)">{{ riskLabel(governance.overallRisk) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="需要审批">
            <a-tag :color="governance.approvalRequired ? 'red' : 'green'">
              {{ governance.approvalRequired ? '是' : '否' }}
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>
        <div v-if="governance.violations.length > 0" style="margin-top: 12px">
          <a-typography-text strong>命中规则</a-typography-text>
          <a-list size="small" :data-source="governance.violations" style="margin-top: 8px">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-tag :color="riskColor(item.level)">{{ item.level }}</a-tag>
                <a-typography-text strong>{{ item.ruleName }}</a-typography-text>
                <a-typography-text type="secondary" style="margin-left: 8px">{{ item.detail }}</a-typography-text>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </div>
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
          <a-textarea
            :value="continuePrompt"
            :rows="4"
            placeholder="输入续跑指令..."
            @update:value="continuePrompt = String($event ?? '')"
          />
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
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  type GovernanceSummary,
  type PipelineStage,
  type SessionInfo,
  type Task,
  continueTask,
  getTask,
  getTaskGovernance,
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

// Governance
const governance = ref<GovernanceSummary | null>(null);
const governanceLoading = ref(false);

// Continue modal
const showContinueModal = ref(false);
const continuePrompt = ref("");
const continuing = ref(false);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let bootstrapRefreshToken = 0;
const BOOTSTRAP_REFRESH_ATTEMPTS = 8;
const BOOTSTRAP_REFRESH_INTERVAL_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshTaskData(
  id: string,
  options: {
    task?: boolean;
    pipeline?: boolean;
    sessions?: boolean;
    governance?: boolean;
  } = {
    task: true,
    pipeline: true,
    sessions: true,
    governance: true,
  },
) {
  const jobs: Promise<unknown>[] = [];

  if (options.task !== false) {
    jobs.push(
      getTask(id)
        .then((t) => {
          task.value = t;
        })
        .catch(() => {}),
    );
  }

  if (options.pipeline) {
    jobs.push(
      getTaskPipeline(id)
        .then((r) => {
          pipelineStages.value = r.stages;
        })
        .catch(() => {}),
    );
  }

  if (options.sessions) {
    jobs.push(
      getTaskSessions(id)
        .then((r) => {
          sessions.value = r.data;
        })
        .catch(() => {}),
    );
  }

  if (options.governance) {
    governanceLoading.value = true;
    jobs.push(
      getTaskGovernance(id)
        .then((r) => {
          governance.value = r;
        })
        .catch(() => {})
        .finally(() => {
          governanceLoading.value = false;
        }),
    );
  }

  await Promise.all(jobs);
}

function shouldBootstrapRefresh() {
  if (!taskId.value) {
    return false;
  }

  const hasExecutionSignals = taskEvents.value.some((event) =>
    [
      "agent.started",
      "agent.completed",
      "task.completed",
      "task.continued",
      "task.hooks.updated",
      "session.updated",
      "message.updated",
    ].includes(event.type),
  );

  if (!task.value) {
    return !hasExecutionSignals;
  }

  return Boolean(
    !task.value.strategy &&
      !task.value.agentRunId &&
      !task.value.sessionId &&
      sessions.value.length === 0 &&
      !hasExecutionSignals,
  );
}

async function bootstrapTaskRefresh(id: string) {
  const token = ++bootstrapRefreshToken;

  for (let attempt = 0; attempt < BOOTSTRAP_REFRESH_ATTEMPTS; attempt += 1) {
    if (token !== bootstrapRefreshToken || taskId.value !== id) {
      return;
    }

    if (!shouldBootstrapRefresh()) {
      return;
    }

    await sleep(BOOTSTRAP_REFRESH_INTERVAL_MS);

    if (token !== bootstrapRefreshToken || taskId.value !== id) {
      return;
    }

    await refreshTaskData(id, {
      task: true,
      pipeline: false,
      sessions: true,
      governance: false,
    });
  }
}

function scheduleTaskRefresh(reason: string) {
  if (!taskId.value) {
    return;
  }

  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  const delay = reason === "task.hooks.updated" ? 0 : 250;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshTaskData(taskId.value as string, {
      task: true,
      pipeline: reason === "task.continued",
      sessions: reason !== "agent.started",
      governance:
        reason === "task.completed" ||
        reason === "task.continued" ||
        reason === "task.hooks.updated",
    });
  }, delay);
}

const taskEvents = computed(() => realtimeStore.events.filter((e) => e.taskId === taskId.value));

const displayedTaskEvents = computed(() =>
  taskEvents.value.slice(0, 30).map((event, index) => ({
    ...event,
    tableKey: event.id || `${event.ts}-${event.type}-${index}`,
    data: event.data && typeof event.data === "object" ? event.data : {},
  })),
);

const agentEvents = computed(() => taskEvents.value.filter((e) => e.type.startsWith("agent.")));

watch(
  taskId,
  (id) => {
    if (id) {
      realtimeStore.subscribeTask(id);
      void refreshTaskData(id).then(() => bootstrapTaskRefresh(id));
    }
  },
  { immediate: true },
);

watch(
  () => taskEvents.value[0]?.id,
  () => {
    const latestEvent = taskEvents.value[0];
    if (!latestEvent) {
      return;
    }

    if (
      latestEvent.type === "agent.started" ||
      latestEvent.type === "task.completed" ||
      latestEvent.type === "task.continued" ||
      latestEvent.type === "task.hooks.updated"
    ) {
      scheduleTaskRefresh(latestEvent.type);
    }
  },
);

onUnmounted(() => {
  bootstrapRefreshToken += 1;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
});

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
      selectedAgent?: string;
      selectedTemplateId?: string;
      executionMode?: string;
      hookExecutions?: Array<{
        hookId: string;
        trigger: string;
        status: string;
        agent: string;
        result?: string;
        error?: string;
        startedAt?: string;
        completedAt?: string;
        decision?: {
          action: string;
          reason?: string;
          rewrittenPrompt?: string;
        };
      }>;
    };
  } catch {
    return null;
  }
});

const executionPlan = computed(() => {
  if (!task.value?.executionPlan) return null;
  try {
    const parsed = JSON.parse(task.value.executionPlan) as {
      mode: string;
      candidates: Array<{
        label?: string;
        agent: string;
        model?: string;
        sessionId?: string;
        agentRunId?: string;
        status: string;
        result?: string;
      }>;
      judgeResult?: {
        winnerIndex: number;
        scores: number[];
        reasoning: string;
      };
    };
    return {
      ...parsed,
      candidates: parsed.candidates.map((candidate, index) => ({
        ...candidate,
        label: candidate.label || `候选 ${index + 1}`,
      })),
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

function riskColor(level: string) {
  const map: Record<string, string> = {
    low: "green",
    medium: "orange",
    high: "red",
    critical: "magenta",
  };
  return map[level] || "default";
}

function riskLabel(level: string) {
  const map: Record<string, string> = {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
    critical: "严重",
  };
  return map[level] || level;
}

function evaluationStatusColor(status: string) {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  return "default";
}

function evaluationStatusLabel(status: string) {
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "skipped") return "跳过";
  return status;
}

function formatTime(ts: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

const candidateColumns = [
  { title: "方案", dataIndex: "label", key: "label" },
  { title: "Agent / 模型", dataIndex: "agent", key: "agent" },
  { title: "状态", dataIndex: "status", key: "status" },
  { title: "评分", dataIndex: "score", key: "score" },
];

function candidateStatusColor(status: string) {
  const map: Record<string, string> = {
    pending: "default",
    running: "processing",
    completed: "green",
    failed: "red",
    winner: "gold",
  };
  return map[status] || "default";
}

function candidateStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    winner: "获胜",
  };
  return map[status] || status;
}

const hookColumns = [
  { title: "触发点", dataIndex: "trigger", key: "trigger" },
  { title: "Agent", dataIndex: "agent", key: "agent" },
  { title: "状态", dataIndex: "status", key: "status" },
  { title: "决策", dataIndex: "decision", key: "decision", width: 160 },
  { title: "结果", dataIndex: "result", key: "result", width: 400 },
];

function hookTriggerLabel(trigger: string) {
  const map: Record<string, string> = {
    "pre-execution": "执行前",
    "post-execution": "执行后",
    "on-failure": "失败时",
    "pre-resume": "续跑前",
    "pre-judge": "裁判前",
    "post-judge": "裁判后",
  };
  return map[trigger] || trigger;
}

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
          : (existing?.type ?? "Agent"),
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
