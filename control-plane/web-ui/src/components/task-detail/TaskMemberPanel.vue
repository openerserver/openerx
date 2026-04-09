<template>
  <section class="task-member-panel">
    <div class="task-member-panel__header">
      <div>
        <div class="task-member-panel__title">任务成员</div>
        <div class="task-member-panel__subtitle">按成员优先模型聚合当前任务的人类成员与 Agent 成员。</div>
      </div>
      <div class="task-member-panel__header-actions">
        <a-space size="small" wrap>
          <a-tag color="blue">当前阶段 {{ view?.currentStageLabel || "未命名阶段" }}</a-tag>
          <a-tag :color="workflowStatusColor">{{ workflowStatusLabel }}</a-tag>
        </a-space>
        <button
          type="button"
          class="task-member-panel__toggle"
          :aria-expanded="!collapsed"
          :aria-label="collapsed ? '展开任务成员' : '收起任务成员'"
          data-testid="task-member-panel-toggle"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? "展开" : "收起" }}
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="task-member-panel__body" data-testid="task-member-panel-body">
      <div v-if="loading && !view" class="task-member-panel__empty">加载成员视图中...</div>
      <div v-else-if="!view || view.members.length === 0" class="task-member-panel__empty">
        当前任务还没有可展示的成员信息。
      </div>

      <template v-else>
        <div class="task-member-panel__stats">
          <div class="task-member-panel__stat">
            <div class="task-member-panel__stat-value">{{ view.summary.managerCount }}</div>
            <div class="task-member-panel__stat-label">管理者成员</div>
          </div>
          <div class="task-member-panel__stat">
            <div class="task-member-panel__stat-value">{{ view.summary.userCount }}</div>
            <div class="task-member-panel__stat-label">普通用户成员</div>
          </div>
          <div class="task-member-panel__stat">
            <div class="task-member-panel__stat-value">{{ view.summary.agentCount }}</div>
            <div class="task-member-panel__stat-label">Agent 成员</div>
          </div>
          <div class="task-member-panel__stat">
            <div class="task-member-panel__stat-value">{{ view.summary.activeAgentCount }}</div>
            <div class="task-member-panel__stat-label">活跃 Agent</div>
          </div>
        </div>

        <section v-for="section in sections" :key="section.key" class="task-member-panel__section">
          <div class="task-member-panel__section-title">{{ section.label }}</div>
          <div class="task-member-panel__member-list">
            <article
              v-for="member in section.items"
              :key="member.id"
              class="task-member-panel__member"
              :data-kind="member.kind"
            >
              <div class="task-member-panel__member-header">
                <div>
                  <div class="task-member-panel__member-name">{{ member.displayName }}</div>
                  <div v-if="member.handle" class="task-member-panel__member-handle">
                    {{ member.handle }}
                  </div>
                </div>
                <a-tag :color="statusToneColor(member.statusTone)">{{ member.statusLabel }}</a-tag>
              </div>

              <div class="task-member-panel__meta">
                分工：{{ member.responsibilityLabels.join(" / ") || "未分配" }}
              </div>
              <div v-if="member.stageLabels.length > 0" class="task-member-panel__meta">
                关联阶段：{{ member.stageLabels.join(" / ") }}
              </div>
              <div class="task-member-panel__meta">{{ member.summary }}</div>
              <div v-if="member.runCount > 0" class="task-member-panel__meta">
                运行记录：{{ member.runCount }} 次
                <span v-if="member.latestActivityAt">，最近活动 {{ formatTime(member.latestActivityAt) }}</span>
              </div>

              <a-space v-if="member.capabilityBadges.length > 0" size="small" wrap>
                <a-tag v-for="badge in member.capabilityBadges" :key="badge" color="default">
                  {{ badge }}
                </a-tag>
              </a-space>
            </article>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskMemberViewMember, TaskMemberViewModel } from "../../lib/api";

const props = defineProps<{
  view: TaskMemberViewModel | null;
  loading?: boolean;
}>();

const collapsed = ref(false);

const sections = computed(() => {
  const groups: Array<{ key: TaskMemberViewMember["kind"]; label: string }> = [
    { key: "manager", label: "管理者成员" },
    { key: "user", label: "普通用户成员" },
    { key: "agent", label: "Agent 成员" },
  ];
  const members = props.view?.members ?? [];
  return groups
    .map((group) => ({
      ...group,
      items: members.filter((member) => member.kind === group.key),
    }))
    .filter((group) => group.items.length > 0);
});

const workflowStatusLabel = computed(() => {
  switch (props.view?.workflowStatus) {
    case "running":
      return "运行中";
    case "blocked":
      return "阻塞中";
    case "waiting-approval":
      return "待审批";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "待开始";
  }
});

const workflowStatusColor = computed(() => {
  switch (props.view?.workflowStatus) {
    case "running":
      return "processing";
    case "blocked":
    case "failed":
      return "error";
    case "waiting-approval":
      return "warning";
    case "completed":
      return "success";
    default:
      return "default";
  }
});

function statusToneColor(tone: TaskMemberViewMember["statusTone"]) {
  switch (tone) {
    case "processing":
      return "processing";
    case "success":
      return "success";
    case "warning":
      return "warning";
    default:
      return "default";
  }
}

function formatTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
</script>

<style scoped>
.task-member-panel {
  margin-bottom: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: linear-gradient(180deg, #fcfcfd 0%, #f8fafc 100%);
  padding: 14px;
}

.task-member-panel__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.task-member-panel__header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.task-member-panel__title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.task-member-panel__subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.task-member-panel__toggle {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  color: #2563eb;
  cursor: pointer;
}

.task-member-panel__toggle:hover {
  color: #1d4ed8;
}

.task-member-panel__body {
  display: block;
}

.task-member-panel__empty {
  font-size: 13px;
  color: #6b7280;
  padding: 8px 0;
}

.task-member-panel__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.task-member-panel__stat {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px;
  background: #ffffff;
}

.task-member-panel__stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

.task-member-panel__stat-label {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.task-member-panel__section + .task-member-panel__section {
  margin-top: 12px;
}

.task-member-panel__section-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.task-member-panel__member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-member-panel__member {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  padding: 10px;
}

.task-member-panel__member-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.task-member-panel__member-name {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.task-member-panel__member-handle {
  margin-top: 2px;
  font-size: 12px;
  color: #6b7280;
}

.task-member-panel__meta {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
}

@media (max-width: 960px) {
  .task-member-panel__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task-member-panel__header {
    flex-direction: column;
  }

  .task-member-panel__header-actions {
    width: 100%;
    align-items: flex-start;
  }
}
</style>