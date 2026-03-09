<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project ? `${project.name} / 策略` : '策略'"
      sub-title="查看项目默认策略与环境级策略绑定"
      @back="$router.push(`/projects/${projectId}`)"
    />

    <a-spin :spinning="loading" style="display: block">
      <a-row v-if="project" :gutter="[16, 16]">
        <a-col :xs="24" :lg="8">
          <a-card size="small" title="当前绑定">
            <a-descriptions :column="1" size="small" bordered>
              <a-descriptions-item label="项目默认模板">
                {{ defaultPolicy?.name || "未绑定" }}
              </a-descriptions-item>
              <a-descriptions-item label="环境覆盖数量">
                {{ environmentBindings.length }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="16">
          <a-card size="small" title="策略模板列表">
            <a-empty v-if="!policies.length" description="当前项目还没有策略模板" />

            <a-table v-else :data-source="policies" :pagination="false" row-key="id" size="small">
              <a-table-column title="名称" key="name">
                <template #default="{ record }">
                  <a-space direction="vertical" :size="2">
                    <span>{{ record.name }}</span>
                    <a-typography-text type="secondary">{{ record.id }}</a-typography-text>
                  </a-space>
                </template>
              </a-table-column>
              <a-table-column title="作用范围" key="scope">
                <template #default="{ record }">
                  <a-tag>{{ scopeLabel(record.appliesTo) }}</a-tag>
                </template>
              </a-table-column>
              <a-table-column title="审批模式" key="policy">
                <template #default="{ record }">
                  {{ approvalPolicyLabel(policyToApprovalPolicy(record.rules)) }}
                </template>
              </a-table-column>
              <a-table-column title="当前绑定" key="binding">
                <template #default="{ record }">
                  {{ bindingLabel(record.id) }}
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
import {
  type ApprovalPolicyMode,
  type Environment,
  type PolicyTemplate,
  type Project,
  getProject,
  listEnvironments,
  listPolicies,
} from "../lib/api";

const route = useRoute();
const projectId = String(route.params.projectId || "");

const loading = ref(true);
const project = ref<Project | null>(null);
const environments = ref<Environment[]>([]);
const policies = ref<PolicyTemplate[]>([]);

const defaultPolicy = computed(() => {
  const linkedId = project.value?.settings?.approvalPolicyTemplateId;
  return policies.value.find((item) => item.id === linkedId);
});

const environmentBindings = computed(() =>
  Object.entries(project.value?.settings?.environmentApprovalPolicies || {}),
);

onMounted(async () => {
  try {
    const [projectResult, environmentResult, policyResult] = await Promise.all([
      getProject(projectId),
      listEnvironments(projectId),
      listPolicies(projectId),
    ]);
    project.value = projectResult;
    environments.value = environmentResult;
    policies.value = policyResult;
  } finally {
    loading.value = false;
  }
});

function policyToApprovalPolicy(rules: Record<string, unknown>): ApprovalPolicyMode | undefined {
  const value = rules.approvalPolicy;
  if (value === "balanced" || value === "strict" || value === "manual") {
    return value;
  }
  return undefined;
}

function approvalPolicyLabel(policy: ApprovalPolicyMode | undefined) {
  if (policy === "balanced") return "balanced: 平衡策略";
  if (policy === "strict") return "strict: 高风险优先审批";
  if (policy === "manual") return "manual: 关键动作全部人工审批";
  return "未配置";
}

function scopeLabel(scope: PolicyTemplate["appliesTo"]) {
  if (scope === "all") return "项目默认";
  if (scope === "environment") return "环境";
  return "Agent";
}

function bindingLabel(policyId: string) {
  if (project.value?.settings?.approvalPolicyTemplateId === policyId) {
    return "项目默认策略";
  }

  const binding = Object.entries(project.value?.settings?.environmentApprovalPolicies || {}).find(
    ([, value]) => value.policyTemplateId === policyId,
  );
  if (!binding) {
    return "未绑定到项目设置";
  }

  const environment = environments.value.find((item) => item.id === binding[0]);
  return environment ? `环境: ${environment.name}` : `环境: ${binding[0]}`;
}
</script>
