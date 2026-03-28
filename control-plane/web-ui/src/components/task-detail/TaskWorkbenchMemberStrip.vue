<template>
  <section class="task-workbench-member-strip">
    <div class="task-workbench-member-strip__header">
      <div>
        <div class="task-workbench-member-strip__eyebrow">{{ paneLabel }}</div>
        <div class="task-workbench-member-strip__title">{{ taskTitle }}</div>
      </div>
      <a-space size="small" wrap>
        <a-tag color="blue">{{ stageLabel }}</a-tag>
        <a-tag :color="workflowStatusColor">{{ workflowStatusLabel }}</a-tag>
      </a-space>
    </div>

    <div v-if="loading && !view" class="task-workbench-member-strip__empty">加载成员视图中...</div>
    <div v-else-if="!view" class="task-workbench-member-strip__empty">当前任务还没有可展示的成员协作信息。</div>

    <template v-else>
      <div class="task-workbench-member-strip__stats">
        <div class="task-workbench-member-strip__stat">
          <strong>{{ view.summary.managerCount }}</strong>
          <span>管理者</span>
        </div>
        <div class="task-workbench-member-strip__stat">
          <strong>{{ view.summary.userCount }}</strong>
          <span>普通成员</span>
        </div>
        <div class="task-workbench-member-strip__stat">
          <strong>{{ view.summary.agentCount }}</strong>
          <span>Agent</span>
        </div>
        <div class="task-workbench-member-strip__stat">
          <strong>{{ view.summary.activeAgentCount }}</strong>
          <span>活跃 Agent</span>
        </div>
      </div>

      <div class="task-workbench-member-strip__members">
        <article
          v-for="member in highlightedMembers"
          :key="member.id"
          class="task-workbench-member-strip__member"
        >
          <div class="task-workbench-member-strip__member-name">{{ member.displayName }}</div>
          <div class="task-workbench-member-strip__member-summary">{{ memberSummary(member) }}</div>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { TaskMemberViewMember, TaskMemberViewModel } from "../../lib/api";

const props = defineProps<{
  paneLabel: string;
  taskTitle: string;
  view: TaskMemberViewModel | null;
  loading?: boolean;
}>();

const highlightedMembers = computed(() => {
  const members = props.view?.members ?? [];
  const rank: Record<TaskMemberViewMember["kind"], number> = {
    manager: 0,
    user: 1,
    agent: 2,
  };
  return [...members]
    .sort((left, right) => {
      const kindDiff = rank[left.kind] - rank[right.kind];
      if (kindDiff !== 0) {
        return kindDiff;
      }
      return right.runCount - left.runCount;
    })
    .slice(0, 4);
});

const stageLabel = computed(() => props.view?.currentStageLabel || "阶段待同步");

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

function memberSummary(member: TaskMemberViewMember) {
  const responsibility = member.responsibilityLabels[0] || member.statusLabel;
  if (member.runCount > 0) {
    return `${responsibility} · ${member.runCount} 次运行`;
  }
  return responsibility;
}
</script>

<style scoped>
.task-workbench-member-strip {
  border: 1px solid #e8d7c4;
  border-radius: 12px;
  padding: 12px;
  background: linear-gradient(180deg, #fffdfa 0%, #f9f2ea 100%);
}

.task-workbench-member-strip__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.task-workbench-member-strip__eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9a6f44;
}

.task-workbench-member-strip__title {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 600;
  color: #3f2d1d;
}

.task-workbench-member-strip__empty {
  margin-top: 12px;
  font-size: 13px;
  color: #7a6a5a;
}

.task-workbench-member-strip__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.task-workbench-member-strip__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(154, 111, 68, 0.14);
}

.task-workbench-member-strip__stat strong {
  font-size: 16px;
  color: #2f2419;
}

.task-workbench-member-strip__stat span {
  font-size: 12px;
  color: #7a6a5a;
}

.task-workbench-member-strip__members {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.task-workbench-member-strip__member {
  border-radius: 10px;
  border: 1px solid rgba(154, 111, 68, 0.14);
  background: rgba(255, 255, 255, 0.88);
  padding: 8px 10px;
}

.task-workbench-member-strip__member-name {
  font-size: 13px;
  font-weight: 600;
  color: #332619;
}

.task-workbench-member-strip__member-summary {
  margin-top: 4px;
  font-size: 12px;
  color: #69594a;
  line-height: 1.5;
}

@media (max-width: 960px) {
  .task-workbench-member-strip__header {
    flex-direction: column;
  }

  .task-workbench-member-strip__stats,
  .task-workbench-member-strip__members {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>