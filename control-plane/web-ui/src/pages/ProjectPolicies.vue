<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project ? `${project.name} / 审批策略` : '审批策略'"
      sub-title="配置项目默认审批策略与环境级审批覆盖，让审批规则不再混在项目设置里。"
      @back="$router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav :project-id="projectId" active-key="approval-policies" />

    <a-spin :spinning="loading" style="display: block">
      <div v-if="project">
        <a-alert
          v-if="!canManage"
          type="info"
          show-icon
          style="margin-bottom: 16px"
          message="你可以查看审批策略，但只有项目管理员、组织管理员或平台管理员可以修改。"
        />

        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :lg="10">
            <a-card size="small" title="当前绑定状态">
              <a-descriptions :column="1" bordered size="small">
                <a-descriptions-item label="项目默认模板">
                  <a-space direction="vertical" :size="2">
                    <span>{{ linkedPolicy?.name || '未绑定' }}</span>
                    <a-typography-text v-if="linkedPolicy" type="secondary">
                      {{ linkedPolicy.id }} · {{ approvalPolicyLabel(policyToApprovalPolicy(linkedPolicy.rules)) }}
                    </a-typography-text>
                  </a-space>
                </a-descriptions-item>
                <a-descriptions-item label="环境覆盖数量">
                  {{ environmentPolicyCount }}
                </a-descriptions-item>
                <a-descriptions-item label="快捷入口">
                  <a-space wrap>
                    <router-link :to="{ name: 'ProjectRoleExecution', params: { projectId } }">
                      <a-button size="small">角色执行</a-button>
                    </router-link>
                    <router-link :to="{ name: 'ProjectDetail', params: { projectId }, query: { tab: 'settings' } }">
                      <a-button size="small">项目设置</a-button>
                    </router-link>
                  </a-space>
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="14">
            <a-card size="small" title="策略说明">
              <a-space direction="vertical" :size="8">
                <a-typography-text type="secondary">
                  这里定义“什么情况需要审批”，只负责规则本身，不负责角色由谁执行。
                </a-typography-text>
                <a-typography-text type="secondary">
                  项目默认审批策略会写入项目级 policy template；环境覆盖只影响对应环境。
                </a-typography-text>
                <a-typography-text type="secondary">
                  任务详情里的审批阻断和回退，属于运行事实，应该在任务页查看，不在这里处理。
                </a-typography-text>
              </a-space>
            </a-card>
          </a-col>
        </a-row>

        <a-card size="small" title="项目默认审批策略">
          <a-form layout="vertical">
            <a-form-item label="审批策略模式">
              <a-select
                :value="form.approvalPolicy || undefined"
                placeholder="选择审批策略"
                :disabled="!canManage"
                @update:value="form.approvalPolicy = valueToApprovalPolicy($event)"
              >
                <a-select-option value="balanced">balanced: 平衡策略</a-select-option>
                <a-select-option value="strict">strict: 高风险优先审批</a-select-option>
                <a-select-option value="manual">manual: 关键动作全部人工审批</a-select-option>
              </a-select>
            </a-form-item>
          </a-form>
        </a-card>

        <a-card size="small" title="策略模板列表" style="margin-top: 16px">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 16px"
            message="审批策略页维护的实际载体是 policy templates。项目默认策略和环境覆盖在保存后都会同步成模板。"
          />

          <a-empty
            v-if="approvalTemplates.length === 0"
            description="当前还没有生成审批策略模板，首次保存后会自动创建。"
          />

          <a-space v-else direction="vertical" :size="8" :style="{ width: '100%' }">
            <a-card v-for="template in approvalTemplates" :key="template.id" size="small">
              <a-flex justify="space-between" align="flex-start" :gap="8">
                <div>
                  <div><strong>{{ template.name }}</strong></div>
                  <a-typography-text type="secondary">
                    {{ template.id }} · {{ policyScopeLabel(template) }}
                  </a-typography-text>
                </div>
                <a-space size="small" wrap>
                  <a-tag color="blue">{{ approvalPolicyLabel(policyToApprovalPolicy(template.rules)) }}</a-tag>
                  <a-tag>{{ template.appliesTo }}</a-tag>
                </a-space>
              </a-flex>
            </a-card>
          </a-space>
        </a-card>

        <a-card size="small" title="环境审批覆盖" style="margin-top: 16px">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 16px"
            message="未单独配置的环境会继承项目默认审批策略。"
          />

          <a-empty v-if="!environments.length && !environmentsLoading" description="当前项目还没有环境" />

          <a-spin :spinning="environmentsLoading">
            <a-row
              v-for="environment in environments"
              :key="environment.id"
              :gutter="[16, 12]"
              style="padding: 12px 0; border-bottom: 1px solid #f0f0f0"
            >
              <a-col :xs="24" :lg="10">
                <a-space wrap>
                  <strong>{{ environment.name }}</strong>
                  <a-tag>{{ environment.riskLevel }}</a-tag>
                  <a-tag :color="environment.requiresApproval ? 'orange' : 'green'">
                    {{ environment.requiresApproval ? '需要审批' : '可直通' }}
                  </a-tag>
                </a-space>
                <div style="margin-top: 4px">
                  <a-typography-text type="secondary">
                    {{ environmentPolicyTemplateLabel(environment.id) }}
                  </a-typography-text>
                </div>
              </a-col>

              <a-col :xs="24" :lg="14">
                <a-select
                  :value="form.environmentApprovalPolicies?.[environment.id]?.approvalPolicy || undefined"
                  placeholder="继承项目默认策略"
                  allow-clear
                  style="width: 100%"
                  :disabled="!canManage"
                  @update:value="updateEnvironmentApprovalPolicy(environment.id, valueToApprovalPolicy($event))"
                >
                  <a-select-option value="balanced">balanced: 平衡策略</a-select-option>
                  <a-select-option value="strict">strict: 高风险优先审批</a-select-option>
                  <a-select-option value="manual">manual: 关键动作全部人工审批</a-select-option>
                </a-select>
              </a-col>
            </a-row>
          </a-spin>
        </a-card>

        <a-space style="margin-top: 16px">
          <a-button @click="$router.push(`/projects/${projectId}`)">返回项目</a-button>
          <a-button v-if="canManage" type="primary" :loading="saving" @click="handleSave">保存审批策略</a-button>
        </a-space>
      </div>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import {
  type ApprovalPolicyMode,
  type Environment,
  type EnvironmentApprovalPolicyBinding,
  type PolicyTemplate,
  type Project,
  type ProjectSettings,
  createPolicy,
  getProject,
  listEnvironments,
  listPolicies,
  updatePolicy,
  updateProject,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

interface ProjectWithSettings extends Project {
  settings?: ProjectSettings | null;
}

const route = useRoute();
const authStore = useAuthStore();
const projectId = String(route.params.projectId || "");
const loading = ref(true);
const environmentsLoading = ref(false);
const saving = ref(false);
const project = ref<ProjectWithSettings | null>(null);
const environments = ref<Environment[]>([]);
const policies = ref<PolicyTemplate[]>([]);

const form = reactive<Pick<ProjectSettings, "approvalPolicy" | "environmentApprovalPolicies">>({
  approvalPolicy: undefined,
  environmentApprovalPolicies: {},
});

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") {
    return true;
  }
  const projectRole = authStore.user?.projects?.find((item) => item.id === projectId)?.role;
  return projectRole === "project_admin";
});

const linkedPolicy = computed(() => resolveLinkedPolicy(policies.value));
const approvalTemplates = computed(() =>
  policies.value.filter(
    (item) => item.type === "command_level" && item.rules.source === "project-settings",
  ),
);
const environmentPolicyCount = computed(
  () => Object.keys(form.environmentApprovalPolicies || {}).length,
);

onMounted(async () => {
  loading.value = true;
  environmentsLoading.value = true;
  try {
    const [projectResult, environmentsResult, policiesResult] = await Promise.all([
      getProject(projectId),
      listEnvironments(projectId),
      listPolicies(projectId),
    ]);

    project.value = projectResult as ProjectWithSettings;
    environments.value = environmentsResult;
    policies.value = policiesResult;

    const resolvedLinkedPolicy = resolveLinkedPolicy(policies.value);
    form.approvalPolicy = resolvedLinkedPolicy
      ? policyToApprovalPolicy(resolvedLinkedPolicy.rules)
      : project.value.settings?.approvalPolicy;
    form.environmentApprovalPolicies = syncEnvironmentApprovalPolicies(
      policies.value,
      environments.value,
      project.value.settings?.environmentApprovalPolicies,
    );
  } catch (error) {
    project.value = null;
    message.error(`审批策略加载失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    loading.value = false;
    environmentsLoading.value = false;
  }
});

async function handleSave() {
  if (!project.value) return;

  saving.value = true;
  try {
    const linked = await upsertApprovalPolicy();
    const environmentApprovalPolicies = await upsertEnvironmentPolicies();
    const mergedSettings: ProjectSettings = {
      ...(project.value.settings || {}),
      ...(linked?.id ? { approvalPolicyTemplateId: linked.id } : {}),
      ...(form.approvalPolicy ? { approvalPolicy: form.approvalPolicy } : {}),
      environmentApprovalPolicies,
    };

    await updateProject(projectId, { settings: mergedSettings });
    project.value = {
      ...project.value,
      settings: mergedSettings,
    };
    message.success("审批策略已保存");
  } catch (error) {
    message.error(`审批策略保存失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    saving.value = false;
  }
}

function valueToApprovalPolicy(value: unknown): ApprovalPolicyMode | undefined {
  if (value === "balanced" || value === "strict" || value === "manual") {
    return value;
  }
  return undefined;
}

function resolveLinkedPolicy(items: PolicyTemplate[]) {
  const linkedId = project.value?.settings?.approvalPolicyTemplateId;
  if (linkedId) {
    return items.find((item) => item.id === linkedId);
  }

  return items.find(
    (item) =>
      item.type === "command_level" &&
      item.appliesTo === "all" &&
      (item.name === "Project Default Approval Policy" || item.rules.source === "project-settings"),
  );
}

function resolveEnvironmentLinkedPolicy(
  environmentId: string,
  items: PolicyTemplate[],
  bindings?: ProjectSettings["environmentApprovalPolicies"],
) {
  const linkedId = bindings?.[environmentId]?.policyTemplateId;
  if (linkedId) {
    return items.find((item) => item.id === linkedId);
  }

  return items.find(
    (item) =>
      item.type === "command_level" &&
      item.appliesTo === "environment" &&
      item.rules.source === "project-settings" &&
      item.rules.environmentId === environmentId,
  );
}

function policyToApprovalPolicy(rules: Record<string, unknown>) {
  const value = rules.approvalPolicy;
  if (value === "balanced" || value === "strict" || value === "manual") {
    return value;
  }
  return undefined;
}

async function upsertApprovalPolicy() {
  if (!form.approvalPolicy) {
    return resolveLinkedPolicy(policies.value);
  }

  const existing = resolveLinkedPolicy(policies.value);
  const payload = {
    name: "Project Default Approval Policy",
    rules: {
      source: "project-settings",
      approvalPolicy: form.approvalPolicy,
    },
    appliesTo: "all" as const,
  };

  if (existing) {
    const updated = await updatePolicy(existing.id, payload);
    policies.value = policies.value.map((item) => (item.id === updated.id ? updated : item));
    return updated;
  }

  const created = await createPolicy({
    projectId,
    type: "command_level",
    ...payload,
  });
  policies.value = [...policies.value, created];
  return created;
}

async function upsertEnvironmentPolicies() {
  const nextBindings: Record<string, EnvironmentApprovalPolicyBinding> = {};

  for (const environment of environments.value) {
    const selectedPolicy = form.environmentApprovalPolicies?.[environment.id]?.approvalPolicy;
    if (!selectedPolicy) {
      continue;
    }

    const existing = resolveEnvironmentLinkedPolicy(
      environment.id,
      policies.value,
      form.environmentApprovalPolicies,
    );
    const payload = {
      name: `${environment.name} Approval Policy`,
      rules: {
        source: "project-settings",
        environmentId: environment.id,
        environmentName: environment.name,
        approvalPolicy: selectedPolicy,
      },
      appliesTo: "environment" as const,
    };

    if (existing) {
      const updated = await updatePolicy(existing.id, payload);
      policies.value = policies.value.map((item) => (item.id === updated.id ? updated : item));
      nextBindings[environment.id] = {
        approvalPolicy: selectedPolicy,
        policyTemplateId: updated.id,
      };
      continue;
    }

    const created = await createPolicy({
      projectId,
      type: "command_level",
      ...payload,
    });
    policies.value = [...policies.value, created];
    nextBindings[environment.id] = {
      approvalPolicy: selectedPolicy,
      policyTemplateId: created.id,
    };
  }

  form.environmentApprovalPolicies = nextBindings;
  return nextBindings;
}

function cloneEnvironmentApprovalPolicies(value?: ProjectSettings["environmentApprovalPolicies"]) {
  return Object.fromEntries(
    Object.entries(value || {}).map(([environmentId, binding]) => [environmentId, { ...binding }]),
  );
}

function syncEnvironmentApprovalPolicies(
  policyItems: PolicyTemplate[],
  environmentItems: Environment[],
  existingBindings?: ProjectSettings["environmentApprovalPolicies"],
) {
  const nextBindings = cloneEnvironmentApprovalPolicies(existingBindings);

  for (const environment of environmentItems) {
    const linkedTemplate = resolveEnvironmentLinkedPolicy(
      environment.id,
      policyItems,
      nextBindings,
    );
    const approvalPolicy = linkedTemplate
      ? policyToApprovalPolicy(linkedTemplate.rules)
      : undefined;

    if (approvalPolicy) {
      nextBindings[environment.id] = {
        approvalPolicy,
        policyTemplateId: linkedTemplate?.id,
      };
      continue;
    }

    if (!nextBindings[environment.id]?.approvalPolicy) {
      delete nextBindings[environment.id];
    }
  }

  return nextBindings;
}

function updateEnvironmentApprovalPolicy(
  environmentId: string,
  approvalPolicy: ApprovalPolicyMode | undefined,
) {
  const nextBindings = cloneEnvironmentApprovalPolicies(form.environmentApprovalPolicies);

  if (!approvalPolicy) {
    delete nextBindings[environmentId];
    form.environmentApprovalPolicies = nextBindings;
    return;
  }

  nextBindings[environmentId] = {
    ...nextBindings[environmentId],
    approvalPolicy,
  };
  form.environmentApprovalPolicies = nextBindings;
}

function environmentPolicyTemplateLabel(environmentId: string) {
  const linkedTemplate = resolveEnvironmentLinkedPolicy(
    environmentId,
    policies.value,
    form.environmentApprovalPolicies,
  );
  if (linkedTemplate) {
    return `当前模板: ${linkedTemplate.name} (${linkedTemplate.id})`;
  }
  return "当前模板: 继承项目默认策略";
}

function policyScopeLabel(template: PolicyTemplate) {
  if (template.appliesTo === "all") {
    return "项目默认模板";
  }

  if (template.appliesTo === "environment") {
    const environmentName =
      typeof template.rules.environmentName === "string"
        ? template.rules.environmentName
        : "指定环境";
    return `环境覆盖模板 · ${environmentName}`;
  }

  return "其他模板";
}

function approvalPolicyLabel(policy: ApprovalPolicyMode | undefined) {
  if (policy === "balanced") return "balanced: 平衡策略";
  if (policy === "strict") return "strict: 高风险优先审批";
  if (policy === "manual") return "manual: 关键动作全部人工审批";
  return "未配置";
}
</script>
