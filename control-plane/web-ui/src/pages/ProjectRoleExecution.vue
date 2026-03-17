<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project ? `${project.name} / 角色执行` : '角色执行'"
      sub-title="配置当前项目中各角色由谁执行，以及它们会如何介入任务推进"
      @back="$router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav :project-id="projectId" active-key="role-execution" />

    <a-spin :spinning="loading" style="display: block">
      <div v-if="project">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :lg="8">
            <a-card size="small" title="当前概览">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="平台默认角色数">
                  {{ roleExecutionSummary?.totalRoles ?? roleRows.length }}
                </a-descriptions-item>
                <a-descriptions-item label="项目已定制角色数">
                  {{ roleExecutionSummary?.customizedRoles ?? projectOverrideCount }}
                </a-descriptions-item>
                <a-descriptions-item label="项目接管角色数">
                  {{ roleExecutionSummary?.takeoverRoles ?? takeoverRoleCount }}
                </a-descriptions-item>
                <a-descriptions-item label="高风险角色数">
                  {{ roleExecutionSummary?.riskyRoles ?? riskyRoleCount }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="16">
            <a-card size="small" title="配置说明">
              <a-space direction="vertical" :size="8">
                <a-typography-text type="secondary">
                  角色执行页只负责“这个项目里每个角色如何运行”，包括是否沿用平台默认、是否补充项目执行器，以及是否完全由项目接管。
                </a-typography-text>
                <a-typography-text type="secondary">
                  审批模板和环境级审批覆盖已经拆到独立的审批策略页；这里不再承载审批规则本身。
                </a-typography-text>
                <a-space wrap>
                  <router-link :to="{ name: 'ProjectApprovalPolicies', params: { projectId } }">
                    <a-button size="small">审批策略</a-button>
                  </router-link>
                  <router-link :to="{ name: 'ProjectDetail', params: { projectId }, query: { tab: 'settings' } }">
                    <a-button size="small">项目设置</a-button>
                  </router-link>
                </a-space>
              </a-space>
            </a-card>
          </a-col>
        </a-row>

        <a-card size="small" title="角色运行规则">
          <a-alert
            v-if="!canManageRoleOverrides"
            type="info"
            show-icon
            style="margin-bottom: 16px"
            message="当前账号可以查看角色运行规则；角色执行配置编辑仅对组织管理员或平台管理员开放。"
          />

          <a-alert
            v-if="roleOverrideLoadError"
            type="warning"
            show-icon
            style="margin-bottom: 16px"
            :message="roleOverrideLoadError"
          />

          <a-typography-paragraph type="secondary" style="margin-top: 0">
            在这里决定当前项目中的角色是继续沿用平台默认，还是增加项目专属执行器，或完全由项目接管。角色在任务中的实际阻断、审批和修正请求，会显示在任务详情页中。
          </a-typography-paragraph>

          <a-spin :spinning="roleLoading">
            <a-empty v-if="!canManageRoleOverrides && !roleRows.length" description="当前无需展示角色运行数据" />

            <a-table v-else :data-source="roleRows" :pagination="false" row-key="id" size="small">
              <a-table-column title="角色" key="role">
                <template #default="{ record }">
                  <a-space direction="vertical" :size="2">
                    <span>{{ record.name }}</span>
                    <a-typography-text type="secondary">{{ record.id }}</a-typography-text>
                  </a-space>
                </template>
              </a-table-column>

              <a-table-column title="当前模式" key="mode">
                <template #default="{ record }">
                  <a-space direction="vertical" :size="2">
                    <a-tag :color="modeTagColor(record)">{{ modeLabel(record) }}</a-tag>
                    <a-typography-text type="secondary">
                      {{ executionModeLabel(record.override?.defaultExecutionMode || record.defaultExecutionMode) }}
                    </a-typography-text>
                  </a-space>
                </template>
              </a-table-column>

              <a-table-column title="运行影响" key="impact">
                <template #default="{ record }">
                  <a-space direction="vertical" :size="2">
                    <a-typography-text>
                      {{ interventionSummary(record) }}
                    </a-typography-text>
                    <a-typography-text type="secondary">
                      阶段 {{ effectiveStages(record).join(' / ') || '未配置' }}
                    </a-typography-text>
                  </a-space>
                </template>
              </a-table-column>

              <a-table-column title="项目定制摘要" key="override">
                <template #default="{ record }">
                  <a-space direction="vertical" :size="2">
                    <a-typography-text type="secondary">
                      {{ overrideSummary(record) }}
                    </a-typography-text>
                  </a-space>
                </template>
              </a-table-column>

              <a-table-column title="操作" key="actions" :width="180">
                <template #default="{ record }">
                  <a-button
                    :data-testid="`role-override-open-${record.id}`"
                    size="small"
                    type="primary"
                    :disabled="!canManageRoleOverrides"
                    @click="openRoleOverrideEditor(record)"
                  >
                    {{ record.override ? '编辑角色执行' : '配置角色执行' }}
                  </a-button>
                </template>
              </a-table-column>
            </a-table>
          </a-spin>
        </a-card>
      </div>
    </a-spin>

    <a-drawer
      :open="roleEditorOpen"
      :width="720"
      placement="right"
      @close="closeRoleOverrideEditor"
    >
      <template #title>
        {{ editingRole ? `${editingRole.name} / 角色执行配置` : '角色执行配置' }}
      </template>

      <a-form layout="vertical">
        <a-card size="small" title="当前生效结果" style="margin-bottom: 16px">
          <a-descriptions :column="1" size="small" bordered>
            <a-descriptions-item label="当前模式">
              {{ editingRole ? modeLabel(editingRole) : '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="适用阶段">
              {{ editingRole ? effectiveStages(editingRole).join(' / ') || '未配置' : '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="运行影响">
              {{ editingRole ? interventionSummary(editingRole) : '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="最终修改执行者">
              开发者角色
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-alert
          type="info"
          show-icon
          style="margin-bottom: 16px"
          message="留空表示继续继承系统默认值；当前后端未提供删除 override 接口，因此已创建的项目定制只能改回空字段而不能物理删除。"
        />

        <a-row :gutter="[16, 0]">
          <a-col :xs="24" :lg="12">
            <a-form-item label="显示名称">
              <a-input
                data-testid="role-override-name-input"
                :value="roleOverrideForm.name"
                placeholder="留空继承系统名称"
                @update:value="roleOverrideForm.name = normalizeTextValue($event)"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-form-item label="配置模式">
              <a-select
                data-testid="role-override-bindings-mode-select"
                :value="roleOverrideForm.bindingsMode"
                allow-clear
                placeholder="默认 inherit"
                @update:value="roleOverrideForm.bindingsMode = valueToNullableEnum($event, ['inherit', 'replace'])"
              >
                <a-select-option value="inherit">补充项目执行器</a-select-option>
                <a-select-option value="replace">项目完全接管</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>

          <a-col :xs="24">
            <a-form-item label="说明">
              <a-textarea
                :value="roleOverrideForm.description"
                :rows="3"
                placeholder="留空继承系统描述"
                @update:value="roleOverrideForm.description = normalizeTextValue($event)"
              />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="12">
            <a-form-item label="适用阶段">
              <a-select
                mode="tags"
                :value="roleOverrideForm.allowedStages"
                style="width: 100%"
                placeholder="留空继承系统阶段列表"
                :options="stageOptions"
                @update:value="roleOverrideForm.allowedStages = arrayValue($event)"
              />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="12">
            <a-form-item label="风险等级">
              <a-select
                :value="roleOverrideForm.riskLevel"
                allow-clear
                placeholder="继承系统风险等级"
                @update:value="roleOverrideForm.riskLevel = valueToNullableEnum($event, ['low', 'medium', 'high', 'critical'])"
              >
                <a-select-option value="low">low</a-select-option>
                <a-select-option value="medium">medium</a-select-option>
                <a-select-option value="high">high</a-select-option>
                <a-select-option value="critical">critical</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>

          <a-col :xs="24">
            <a-collapse ghost>
              <a-collapse-panel key="advanced" header="高级定制">
                <a-row :gutter="[16, 0]">
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="状态">
                      <a-select
                        :value="roleOverrideForm.status"
                        allow-clear
                        placeholder="继承系统状态"
                        @update:value="roleOverrideForm.status = valueToNullableEnum($event, ['active', 'disabled', 'deprecated'])"
                      >
                        <a-select-option value="active">active</a-select-option>
                        <a-select-option value="disabled">disabled</a-select-option>
                        <a-select-option value="deprecated">deprecated</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="Owner Team">
                      <a-input
                        :value="roleOverrideForm.ownerTeam"
                        placeholder="留空继承"
                        @update:value="roleOverrideForm.ownerTeam = normalizeTextValue($event)"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="Permission Profile">
                      <a-input
                        :value="roleOverrideForm.permissionProfile"
                        placeholder="留空继承"
                        @update:value="roleOverrideForm.permissionProfile = normalizeTextValue($event)"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="Tool Profile">
                      <a-input
                        :value="roleOverrideForm.toolProfile"
                        placeholder="留空继承"
                        @update:value="roleOverrideForm.toolProfile = normalizeTextValue($event)"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="执行模式">
                      <a-select
                        :value="roleOverrideForm.defaultExecutionMode"
                        allow-clear
                        placeholder="继承系统执行模式"
                        @update:value="roleOverrideForm.defaultExecutionMode = valueToNullableEnum($event, ['single', 'parallel-review', 'round-robin'])"
                      >
                        <a-select-option value="single">single</a-select-option>
                        <a-select-option value="parallel-review">parallel-review</a-select-option>
                        <a-select-option value="round-robin">round-robin</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="聚合策略">
                      <a-select
                        :value="roleOverrideForm.aggregationStrategy"
                        allow-clear
                        placeholder="继承系统聚合策略"
                        @update:value="roleOverrideForm.aggregationStrategy = valueToNullableEnum($event, ['first-pass', 'majority', 'merge-summary', 'human-review'])"
                      >
                        <a-select-option value="first-pass">first-pass</a-select-option>
                        <a-select-option value="majority">majority</a-select-option>
                        <a-select-option value="merge-summary">merge-summary</a-select-option>
                        <a-select-option value="human-review">human-review</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="最大并发 Binding">
                      <a-input-number
                        :value="roleOverrideForm.maxActiveBindings"
                        :min="1"
                        style="width: 100%"
                        placeholder="继承系统值"
                        @update:value="roleOverrideForm.maxActiveBindings = valueToOptionalNumber($event)"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="Require Consensus">
                      <a-select
                        :value="booleanFieldValue(roleOverrideForm.requireConsensus)"
                        allow-clear
                        placeholder="继承系统设置"
                        @update:value="roleOverrideForm.requireConsensus = selectToBoolean($event)"
                      >
                        <a-select-option value="true">true</a-select-option>
                        <a-select-option value="false">false</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="写操作需审批">
                      <a-select
                        :value="booleanFieldValue(roleOverrideForm.requiresApprovalForWrite)"
                        allow-clear
                        placeholder="继承系统设置"
                        @update:value="roleOverrideForm.requiresApprovalForWrite = selectToBoolean($event)"
                      >
                        <a-select-option value="true">true</a-select-option>
                        <a-select-option value="false">false</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :lg="12">
                    <a-form-item label="输出 Schema ID">
                      <a-input
                        :value="roleOverrideForm.outputSchemaId"
                        placeholder="留空继承"
                        @update:value="roleOverrideForm.outputSchemaId = normalizeTextValue($event)"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24">
                    <a-form-item label="标签">
                      <a-select
                        mode="tags"
                        :value="roleOverrideForm.tagsJson"
                        style="width: 100%"
                        placeholder="留空继承系统标签"
                        @update:value="roleOverrideForm.tagsJson = arrayValue($event)"
                      />
                    </a-form-item>
                  </a-col>
                </a-row>
              </a-collapse-panel>
            </a-collapse>
          </a-col>
        </a-row>

        <a-card size="small" title="执行器列表" style="margin-bottom: 16px">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 12px"
            message="平台默认执行器只读展示；项目专属执行器用于在 inherit 下补充、或在 replace 下完全接管候选执行器。当前后端尚未提供删除执行器接口。"
          />

          <a-alert
            v-if="roleBindingLoadError"
            type="warning"
            show-icon
            style="margin-bottom: 12px"
            :message="roleBindingLoadError"
          />

          <a-alert
            v-if="roleOverrideForm.bindingsMode === 'replace' && projectRoleBindings.length === 0"
            type="warning"
            show-icon
            style="margin-bottom: 12px"
            message="当前已切到项目完全接管，但项目专属执行器仍为空。保存后该角色在当前项目下可能不可执行。"
          />

          <a-spin :spinning="bindingLoading">
            <a-row :gutter="[16, 16]">
              <a-col :xs="24" :lg="12">
                <a-typography-title :level="5" style="margin-top: 0">平台默认执行器</a-typography-title>
                <a-empty v-if="systemRoleBindings.length === 0" description="无平台默认执行器" />
                <a-space v-else direction="vertical" :size="8" style="width: 100%">
                  <a-card v-for="binding in systemRoleBindings" :key="binding.id" size="small">
                    <a-space direction="vertical" :size="2" style="width: 100%">
                      <a-space wrap>
                        <strong>{{ binding.label }}</strong>
                        <a-tag>{{ binding.bindingKey }}</a-tag>
                        <a-tag :color="binding.enabled ? 'green' : 'default'">{{ binding.enabled ? 'enabled' : 'disabled' }}</a-tag>
                      </a-space>
                      <a-typography-text type="secondary">
                        {{ binding.runtimeAgent }} · priority {{ binding.priority }}
                        <span v-if="binding.model"> · {{ binding.model }}</span>
                      </a-typography-text>
                    </a-space>
                  </a-card>
                </a-space>
              </a-col>

              <a-col :xs="24" :lg="12">
                <a-flex justify="space-between" align="center" style="margin-bottom: 8px">
                  <a-typography-title :level="5" style="margin: 0">项目专属执行器</a-typography-title>
                  <a-button
                    data-testid="project-binding-open-create"
                    size="small"
                    type="primary"
                    @click="openBindingEditor()"
                  >
                    新增执行器
                  </a-button>
                </a-flex>
                <a-empty v-if="projectRoleBindings.length === 0" description="当前项目还没有专属执行器" />
                <a-space v-else direction="vertical" :size="8" style="width: 100%">
                  <a-card v-for="binding in projectRoleBindings" :key="binding.id" size="small">
                    <a-flex justify="space-between" align="start" :gap="12">
                      <a-space direction="vertical" :size="2" style="width: 100%">
                        <a-space wrap>
                          <strong>{{ binding.label }}</strong>
                          <a-tag color="blue">{{ binding.bindingKey }}</a-tag>
                          <a-tag :color="binding.enabled ? 'green' : 'default'">{{ binding.enabled ? 'enabled' : 'disabled' }}</a-tag>
                        </a-space>
                        <a-typography-text type="secondary">
                          {{ binding.runtimeAgent }} · priority {{ binding.priority }}
                          <span v-if="binding.model"> · {{ binding.model }}</span>
                        </a-typography-text>
                        <a-typography-text v-if="binding.tagsJson?.length" type="secondary">
                          标签 {{ binding.tagsJson.join(' / ') }}
                        </a-typography-text>
                      </a-space>
                      <a-button size="small" @click="openBindingEditor(binding)">编辑</a-button>
                    </a-flex>
                  </a-card>
                </a-space>
              </a-col>
            </a-row>
          </a-spin>
        </a-card>

        <a-space>
          <a-button @click="closeRoleOverrideEditor">取消</a-button>
          <a-button
            data-testid="role-override-save-button"
            type="primary"
            :loading="savingRoleOverride"
            @click="saveRoleOverride"
          >
            保存并应用
          </a-button>
        </a-space>
      </a-form>
    </a-drawer>

    <a-modal
      :open="bindingEditorOpen"
      :title="editingBinding ? '编辑项目执行器' : '新增项目执行器'"
      :confirm-loading="savingBinding"
      ok-text="保存执行器"
      cancel-text="取消"
      @ok="saveBinding"
      @cancel="closeBindingEditor"
    >
      <a-form layout="vertical">
        <a-form-item label="执行器 Key" required>
          <a-input
            data-testid="binding-key-input"
            :value="bindingForm.bindingKey"
            placeholder="例如 release-primary"
            @update:value="bindingForm.bindingKey = normalizeBindingKey($event)"
          />
        </a-form-item>
        <a-form-item label="显示名称" required>
          <a-input
            data-testid="binding-label-input"
            :value="bindingForm.label"
            placeholder="例如 项目发布主执行器"
            @update:value="bindingForm.label = normalizeTextValue($event) || ''"
          />
        </a-form-item>
        <a-form-item label="Runtime Agent" required>
          <a-input
            data-testid="binding-runtime-agent-input"
            :value="bindingForm.runtimeAgent"
            placeholder="例如 oracle-enterprise"
            @update:value="bindingForm.runtimeAgent = normalizeTextValue($event) || ''"
          />
        </a-form-item>
        <a-row :gutter="[16, 0]">
          <a-col :xs="24" :lg="12">
            <a-form-item label="Priority" required>
              <a-input-number
                data-testid="binding-priority-input"
                :value="bindingForm.priority"
                :min="1"
                style="width: 100%"
                @update:value="bindingForm.priority = bindingPriorityValue($event)"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-form-item label="Enabled">
              <a-select
                data-testid="binding-enabled-select"
                :value="booleanFieldValue(bindingForm.enabled) || 'true'"
                @update:value="bindingForm.enabled = bindingBooleanValue($event)"
              >
                <a-select-option value="true">true</a-select-option>
                <a-select-option value="false">false</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="Model Route">
          <a-input
            data-testid="binding-model-input"
            :value="bindingForm.model"
            placeholder="可选，例如 github-copilot:gpt-5.4"
            @update:value="bindingForm.model = normalizeTextValue($event)"
          />
        </a-form-item>
        <a-form-item label="标签">
          <a-select
            mode="tags"
            :value="bindingForm.tagsJson"
            style="width: 100%"
            placeholder="可选标签"
            @update:value="bindingForm.tagsJson = arrayValue($event)"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  type ProjectRoleExecutionView,
  type RoleAgentBindingRecord,
  type RoleAgentProjectOverrideRecord,
  type RoleAgentRecord,
  type UpsertRoleAgentProjectOverrideInput,
  createRoleAgentBinding,
  getProjectRoleExecutionView,
  listRoleAgentBindings,
  updateRoleAgentBinding,
  upsertRoleAgentProjectOverride,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const authStore = useAuthStore();
const projectId = String(route.params.projectId || "");

const loading = ref(true);
const roleLoading = ref(false);
const bindingLoading = ref(false);
const roleOverrideLoadError = ref<string | null>(null);
const roleBindingLoadError = ref<string | null>(null);
const roleEditorOpen = ref(false);
const bindingEditorOpen = ref(false);
const savingRoleOverride = ref(false);
const savingBinding = ref(false);
const project = ref<ProjectRoleExecutionView["project"] | null>(null);
const roleExecutionSummary = ref<ProjectRoleExecutionView["summary"] | null>(null);
const roleAgents = ref<RoleAgentRecord[]>([]);
const roleOverrides = ref<Record<string, RoleAgentProjectOverrideRecord | null>>({});
const editingRole = ref<RoleRow | null>(null);
const editingBinding = ref<RoleAgentBindingRecord | null>(null);
const systemRoleBindings = ref<RoleAgentBindingRecord[]>([]);
const projectRoleBindings = ref<RoleAgentBindingRecord[]>([]);

type NullableBoolean = boolean | undefined;
type RoleRow = RoleAgentRecord & {
  override?: RoleAgentProjectOverrideRecord | null;
  allowedStages?: string[];
};

interface RoleOverrideFormState {
  name?: string;
  description?: string;
  status?: "active" | "disabled" | "deprecated";
  ownerTeam?: string;
  permissionProfile?: string;
  toolProfile?: string;
  defaultExecutionMode?: "single" | "parallel-review" | "round-robin";
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review";
  maxActiveBindings?: number;
  requireConsensus?: NullableBoolean;
  riskLevel?: "low" | "medium" | "high" | "critical";
  requiresApprovalForWrite?: NullableBoolean;
  allowedStages: string[];
  outputSchemaId?: string;
  tagsJson: string[];
  bindingsMode?: "inherit" | "replace";
}

interface RoleBindingFormState {
  bindingKey: string;
  runtimeAgent: string;
  label: string;
  enabled: boolean;
  priority: number;
  model?: string;
  tagsJson: string[];
}

const roleOverrideForm = ref<RoleOverrideFormState>(createEmptyRoleOverrideForm());
const bindingForm = ref<RoleBindingFormState>(createEmptyBindingForm());

const canManageRoleOverrides = computed(() => {
  const role = authStore.user?.role;
  return role === "org_admin" || role === "platform_admin";
});

const roleRows = computed<RoleRow[]>(() =>
  roleAgents.value
    .filter((item) => item.scope === "system")
    .map((item) => ({
      ...item,
      allowedStages: item.allowedStages || [],
      override: roleOverrides.value[item.id] || null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
);

const projectOverrideCount = computed(
  () => Object.values(roleOverrides.value).filter(Boolean).length,
);

const takeoverRoleCount = computed(
  () => roleRows.value.filter((item) => item.override?.bindingsMode === "replace").length,
);

const riskyRoleCount = computed(
  () =>
    roleRows.value.filter((item) => {
      const risk = item.override?.riskLevel || item.riskLevel;
      return risk === "high" || risk === "critical";
    }).length,
);

const stageOptions = computed(() => {
  const stageValues = new Set([
    "intake",
    "clarify",
    "design",
    "plan",
    "implement",
    "verify",
    "fix",
    "release",
    "post-release",
    "review",
    "retrospective",
  ]);

  for (const role of roleRows.value) {
    for (const stage of role.allowedStages || []) {
      if (stage) stageValues.add(stage);
    }
  }

  return Array.from(stageValues).map((value) => ({ value, label: value }));
});

onMounted(async () => {
  try {
    await loadRoleOverrides();
  } finally {
    loading.value = false;
  }
});

async function loadRoleOverrides() {
  roleLoading.value = true;
  roleOverrideLoadError.value = null;
  try {
    const roleExecutionView = await getProjectRoleExecutionView(projectId);
    project.value = roleExecutionView.project;
    roleExecutionSummary.value = roleExecutionView.summary;
    roleAgents.value = roleExecutionView.rows.map((item) => item.role);
    roleOverrides.value = Object.fromEntries(
      roleExecutionView.rows.map((item) => [item.role.id, item.override] as const),
    );
    roleOverrideLoadError.value = roleExecutionView.access.message || null;
  } catch (error) {
    roleOverrideLoadError.value = error instanceof Error ? error.message : "角色运行配置加载失败";
  } finally {
    roleLoading.value = false;
  }
}

async function loadRoleBindings(roleAgentId: string) {
  bindingLoading.value = true;
  roleBindingLoadError.value = null;
  try {
    const [systemResponse, projectResponse] = await Promise.all([
      listRoleAgentBindings(roleAgentId),
      listRoleAgentBindings(roleAgentId, projectId),
    ]);
    systemRoleBindings.value = systemResponse.data;
    projectRoleBindings.value = projectResponse.data;
  } catch (error) {
    roleBindingLoadError.value = error instanceof Error ? error.message : "项目执行器加载失败";
    systemRoleBindings.value = [];
    projectRoleBindings.value = [];
  } finally {
    bindingLoading.value = false;
  }
}

function createEmptyRoleOverrideForm(): RoleOverrideFormState {
  return {
    allowedStages: [],
    tagsJson: [],
  };
}

function createEmptyBindingForm(): RoleBindingFormState {
  return {
    bindingKey: "",
    runtimeAgent: "",
    label: "",
    enabled: true,
    priority: 1,
    tagsJson: [],
  };
}

function normalizeTextValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function valueToNullableEnum<T extends string>(value: unknown, allowedValues: T[]): T | undefined {
  return allowedValues.includes(String(value) as T) ? (String(value) as T) : undefined;
}

function valueToOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bindingPriorityValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return 1;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function booleanFieldValue(value: NullableBoolean | boolean) {
  if (value === true) return "true";
  if (value === false) return "false";
  return undefined;
}

function selectToBoolean(value: unknown): NullableBoolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function bindingBooleanValue(value: unknown) {
  return value !== "false";
}

function normalizeBindingKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function executionModeLabel(value?: string | null) {
  return value || "未配置";
}

function effectiveStages(role: RoleRow) {
  return role.override?.allowedStages?.length
    ? role.override.allowedStages
    : role.allowedStages || [];
}

function modeLabel(role: RoleRow) {
  if (role.override?.bindingsMode === "replace") return "项目接管";
  if (role.override) return "项目增强";
  return "平台默认";
}

function modeTagColor(role: RoleRow) {
  if (role.override?.bindingsMode === "replace") return "orange";
  if (role.override) return "blue";
  return "default";
}

function interventionSummary(role: RoleRow) {
  const risk = role.override?.riskLevel || role.riskLevel;
  const requiresApproval = role.override?.requiresApprovalForWrite ?? role.requiresApprovalForWrite;
  const stageText = effectiveStages(role).slice(0, 2).join(" / ");
  if (requiresApproval && (risk === "high" || risk === "critical")) {
    return `${stageText || "对应阶段"} 可阻断并请求审批`;
  }
  if (risk === "high" || risk === "critical") {
    return `${stageText || "对应阶段"} 可发起修正请求并阻断推进`;
  }
  return `${stageText || "对应阶段"} 提供建议与修正请求`;
}

function overrideSummary(role: RoleRow) {
  if (!role.override) {
    return "当前项目未做定制，完全沿用平台默认配置。";
  }

  const summary: string[] = [];
  if (role.override.name) summary.push(`名称: ${role.override.name}`);
  if (role.override.status) summary.push(`状态: ${role.override.status}`);
  if (role.override.defaultExecutionMode)
    summary.push(`执行: ${role.override.defaultExecutionMode}`);
  if (role.override.riskLevel) summary.push(`风险: ${role.override.riskLevel}`);
  if (role.override.allowedStages?.length) {
    summary.push(`阶段: ${role.override.allowedStages.join("/")}`);
  }
  if (role.override.bindingsMode === "replace") {
    summary.push("项目完全接管执行器");
  }
  return summary.join(" · ") || "该项目已存在角色定制，但当前没有显式字段覆盖。";
}

function nullToUndefined<T>(value: T | null | undefined) {
  return value ?? undefined;
}

function createRoleOverrideForm(role: RoleRow): RoleOverrideFormState {
  const override: Partial<RoleAgentProjectOverrideRecord> = role.override ?? {};
  const {
    name,
    description,
    status,
    ownerTeam,
    permissionProfile,
    toolProfile,
    defaultExecutionMode,
    aggregationStrategy,
    maxActiveBindings,
    requireConsensus,
    riskLevel,
    requiresApprovalForWrite,
    allowedStages,
    outputSchemaId,
    tagsJson,
    bindingsMode,
  } = override;

  return {
    name: nullToUndefined(name),
    description: nullToUndefined(description),
    status: nullToUndefined(status),
    ownerTeam: nullToUndefined(ownerTeam),
    permissionProfile: nullToUndefined(permissionProfile),
    toolProfile: nullToUndefined(toolProfile),
    defaultExecutionMode: nullToUndefined(defaultExecutionMode),
    aggregationStrategy: nullToUndefined(aggregationStrategy),
    maxActiveBindings: nullToUndefined(maxActiveBindings),
    requireConsensus: nullToUndefined(requireConsensus),
    riskLevel: nullToUndefined(riskLevel),
    requiresApprovalForWrite: nullToUndefined(requiresApprovalForWrite),
    allowedStages: allowedStages ?? [],
    outputSchemaId: nullToUndefined(outputSchemaId),
    tagsJson: tagsJson ?? [],
    bindingsMode: nullToUndefined(bindingsMode),
  };
}

function assignRoleOverride(roleAgentId: string, override: RoleAgentProjectOverrideRecord) {
  roleOverrides.value = {
    ...roleOverrides.value,
    [roleAgentId]: override,
  };
}

function appendStringField<T extends keyof UpsertRoleAgentProjectOverrideInput>(
  payload: UpsertRoleAgentProjectOverrideInput,
  key: T,
  value: UpsertRoleAgentProjectOverrideInput[T],
) {
  if (typeof value === "string" && value.length > 0) {
    payload[key] = value;
  }
}

function appendBooleanField<T extends keyof UpsertRoleAgentProjectOverrideInput>(
  payload: UpsertRoleAgentProjectOverrideInput,
  key: T,
  value: UpsertRoleAgentProjectOverrideInput[T],
) {
  if (typeof value === "boolean") {
    payload[key] = value;
  }
}

function appendNumberField<T extends keyof UpsertRoleAgentProjectOverrideInput>(
  payload: UpsertRoleAgentProjectOverrideInput,
  key: T,
  value: UpsertRoleAgentProjectOverrideInput[T],
) {
  if (typeof value === "number") {
    payload[key] = value;
  }
}

function appendStringArrayField<T extends keyof UpsertRoleAgentProjectOverrideInput>(
  payload: UpsertRoleAgentProjectOverrideInput,
  key: T,
  value: UpsertRoleAgentProjectOverrideInput[T],
) {
  if (Array.isArray(value) && value.length > 0) {
    payload[key] = value;
  }
}

function buildRoleOverridePayload(
  form: RoleOverrideFormState,
): UpsertRoleAgentProjectOverrideInput {
  const payload: UpsertRoleAgentProjectOverrideInput = {};

  appendStringField(payload, "name", form.name);
  appendStringField(payload, "description", form.description);
  appendStringField(payload, "status", form.status);
  appendStringField(payload, "ownerTeam", form.ownerTeam);
  appendStringField(payload, "permissionProfile", form.permissionProfile);
  appendStringField(payload, "toolProfile", form.toolProfile);
  appendStringField(payload, "defaultExecutionMode", form.defaultExecutionMode);
  appendStringField(payload, "aggregationStrategy", form.aggregationStrategy);
  appendNumberField(payload, "maxActiveBindings", form.maxActiveBindings);
  appendBooleanField(payload, "requireConsensus", form.requireConsensus);
  appendStringField(payload, "riskLevel", form.riskLevel);
  appendBooleanField(payload, "requiresApprovalForWrite", form.requiresApprovalForWrite);
  appendStringArrayField(payload, "allowedStages", form.allowedStages);
  appendStringField(payload, "outputSchemaId", form.outputSchemaId);
  appendStringArrayField(payload, "tagsJson", form.tagsJson);
  appendStringField(payload, "bindingsMode", form.bindingsMode);

  return payload;
}

async function openRoleOverrideEditor(role: RoleRow) {
  editingRole.value = role;
  roleOverrideForm.value = createRoleOverrideForm(role);
  roleEditorOpen.value = true;
  await loadRoleBindings(role.id);
}

function closeRoleOverrideEditor() {
  roleEditorOpen.value = false;
  bindingEditorOpen.value = false;
  editingRole.value = null;
  editingBinding.value = null;
  roleOverrideForm.value = createEmptyRoleOverrideForm();
  bindingForm.value = createEmptyBindingForm();
  systemRoleBindings.value = [];
  projectRoleBindings.value = [];
  roleBindingLoadError.value = null;
}

async function saveRoleOverride() {
  const role = editingRole.value;
  if (!role) {
    return;
  }

  const payload = buildRoleOverridePayload(roleOverrideForm.value);

  savingRoleOverride.value = true;
  try {
    const response = await upsertRoleAgentProjectOverride(role.id, projectId, payload);
    assignRoleOverride(role.id, response.data);
    message.success("项目角色执行配置已保存");
    closeRoleOverrideEditor();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "项目角色执行配置保存失败");
  } finally {
    savingRoleOverride.value = false;
  }
}

function openBindingEditor(binding?: RoleAgentBindingRecord) {
  editingBinding.value = binding ?? null;
  bindingForm.value = {
    bindingKey: binding?.bindingKey ?? "",
    runtimeAgent: binding?.runtimeAgent ?? "",
    label: binding?.label ?? "",
    enabled: binding?.enabled ?? true,
    priority: binding?.priority ?? 1,
    model: binding?.model ?? undefined,
    tagsJson: binding?.tagsJson ?? [],
  };
  bindingEditorOpen.value = true;
}

function closeBindingEditor() {
  bindingEditorOpen.value = false;
  editingBinding.value = null;
  bindingForm.value = createEmptyBindingForm();
}

async function saveBinding() {
  if (!editingRole.value) {
    return;
  }

  if (
    !bindingForm.value.bindingKey ||
    !bindingForm.value.label ||
    !bindingForm.value.runtimeAgent
  ) {
    message.error("请完整填写 bindingKey、显示名称和 Runtime Agent");
    return;
  }

  const payload = {
    projectId,
    bindingKey: bindingForm.value.bindingKey,
    runtimeAgent: bindingForm.value.runtimeAgent,
    label: bindingForm.value.label,
    enabled: bindingForm.value.enabled,
    priority: bindingForm.value.priority,
    ...(bindingForm.value.model ? { model: bindingForm.value.model } : {}),
    ...(bindingForm.value.tagsJson.length > 0 ? { tagsJson: bindingForm.value.tagsJson } : {}),
  };

  savingBinding.value = true;
  try {
    if (editingBinding.value) {
      await updateRoleAgentBinding(editingRole.value.id, editingBinding.value.id, payload);
    } else {
      await createRoleAgentBinding(editingRole.value.id, payload);
    }
    await loadRoleBindings(editingRole.value.id);
    message.success("项目执行器已保存");
    closeBindingEditor();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "项目执行器保存失败");
  } finally {
    savingBinding.value = false;
  }
}
</script>