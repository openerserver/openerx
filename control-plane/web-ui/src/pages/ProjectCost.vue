<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project ? `${project.name} / 成本` : '成本'"
      sub-title="查看项目当前绑定的预算配置和使用状态"
      @back="$router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav :project-id="projectId" active-key="cost" />

    <a-spin :spinning="loading" style="display: block">
      <a-row v-if="project" :gutter="[16, 16]">
        <a-col :xs="24" :lg="8">
          <a-card size="small" title="当前绑定预算">
            <a-descriptions :column="1" size="small" bordered>
              <a-descriptions-item label="预算配置">
                {{ linkedBudget ? `${linkedBudget.period} / $${linkedBudget.limit}` : "未绑定" }}
              </a-descriptions-item>
              <a-descriptions-item label="当前状态">
                <a-tag v-if="linkedBudget" :color="statusColor(linkedBudget.status)">
                  {{ statusLabel(linkedBudget.status) }}
                </a-tag>
                <span v-else>未配置</span>
              </a-descriptions-item>
              <a-descriptions-item label="使用率">
                {{ linkedBudget ? `${Math.round(linkedBudget.usage * 100)}%` : "-" }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="16">
          <a-card size="small" title="预算配置列表">
            <a-empty v-if="!budgetConfigs.length" description="当前项目还没有预算配置" />

            <a-table v-else :data-source="budgetConfigs" :pagination="false" row-key="id" size="small">
              <a-table-column title="周期" data-index="period" key="period" />
              <a-table-column title="额度" key="limit">
                <template #default="{ record }">${{ record.limit }}</template>
              </a-table-column>
              <a-table-column title="使用率" key="usage">
                <template #default="{ record }">{{ Math.round(record.usage * 100) }}%</template>
              </a-table-column>
              <a-table-column title="当前状态" key="status">
                <template #default="{ record }">
                  <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
                </template>
              </a-table-column>
              <a-table-column title="当前绑定" key="binding">
                <template #default="{ record }">
                  {{ project.settings?.budgetConfigId === record.id ? "项目当前预算" : "历史/备用配置" }}
                </template>
              </a-table-column>
            </a-table>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { type BudgetConfig, type Project, getProject, listBudgetConfigs } from "../lib/api";

const route = useRoute();
const projectId = String(route.params.projectId || "");

const loading = ref(true);
const project = ref<Project | null>(null);
const budgetConfigs = ref<BudgetConfig[]>([]);

const linkedBudget = computed(() => {
  const linkedId = project.value?.settings?.budgetConfigId;
  return budgetConfigs.value.find((item) => item.id === linkedId);
});

onMounted(async () => {
  try {
    const [projectResult, budgetResult] = await Promise.all([
      getProject(projectId),
      listBudgetConfigs(projectId),
    ]);
    project.value = projectResult;
    budgetConfigs.value = budgetResult;
  } finally {
    loading.value = false;
  }
});

function statusColor(status: BudgetConfig["status"]) {
  if (status === "ok") return "green";
  if (status === "warn") return "gold";
  if (status === "throttle") return "orange";
  return "red";
}

function statusLabel(status: BudgetConfig["status"]) {
  if (status === "ok") return "正常";
  if (status === "warn") return "预警";
  if (status === "throttle") return "限流";
  return "阻断";
}
</script>