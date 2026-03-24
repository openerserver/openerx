<template>
  <div style="padding: 24px">
    <a-page-header
      :title="templateForm.name || editorView?.template?.name || '工作流模板编辑器'"
      :sub-title="editorView?.template?.id || '阶段骨架与编辑器联调页'"
      @back="$router.push({ name: 'WorkflowTemplatesAdmin' })"
    />

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="当前编辑器支持模板基础信息维护，以及阶段的新增、编辑、删除和排序。"
    />

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />

      <template v-if="editorView?.template">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="8">
            <a-card size="small" title="阶段路径">
              <a-space direction="vertical" style="width: 100%" :size="12">
                <div
                  v-for="(stage, index) in stageDrafts"
                  :key="stage.id"
                  style="padding: 12px; border: 1px solid #f0f0f0; border-radius: 12px"
                >
                  <a-space direction="vertical" :size="2" style="width: 100%">
                    <a-space style="justify-content: space-between; width: 100%">
                      <a-typography-text strong>{{ stage.name || '未命名阶段' }}</a-typography-text>
                      <a-space>
                        <a-button size="small" :disabled="index === 0 || reordering" @click="moveStage(index, -1)">
                          上移
                        </a-button>
                        <a-button
                          size="small"
                          :disabled="index === stageDrafts.length - 1 || reordering"
                          @click="moveStage(index, 1)"
                        >
                          下移
                        </a-button>
                      </a-space>
                    </a-space>
                    <a-typography-text type="secondary">{{ stage.stageKey }}</a-typography-text>
                    <a-space wrap>
                      <a-tag :color="stage.enabled ? 'green' : 'default'">{{ stage.enabled ? '启用' : '停用' }}</a-tag>
                      <a-tag>{{ stage.mode }}</a-tag>
                    </a-space>
                  </a-space>
                </div>
              </a-space>
            </a-card>

            <a-card size="small" title="可视化预览" style="margin-top: 16px">
              <a-alert
                type="info"
                show-icon
                style="margin-bottom: 12px"
                message="这里使用流程图而不是统计图，直接回答阶段如何流转、角色如何介入。"
              />

              <a-tabs :activeKey="activeDiagramTab" :destroyInactiveTabPane="true" @update:activeKey="activeDiagramTab = String($event ?? 'stage-flow')">
                <a-tab-pane key="stage-flow" tab="阶段流转图">
                  <MermaidRenderer v-if="activeDiagramTab === 'stage-flow'" :code="stageFlowMermaid" />
                </a-tab-pane>
                <a-tab-pane key="role-map" tab="角色介入图">
                  <MermaidRenderer v-if="activeDiagramTab === 'role-map'" :code="roleMapMermaid" />
                </a-tab-pane>
              </a-tabs>
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="16">
            <a-card size="small" title="模板信息" style="margin-bottom: 16px">
              <a-form layout="vertical">
                <a-row :gutter="16">
                  <a-col :xs="24" :md="12">
                    <a-form-item label="模板名称">
                      <a-input
                        :value="templateForm.name"
                        placeholder="例如：默认研发交付模板"
                        @update:value="templateForm.name = String($event ?? '')"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="分类">
                      <a-input
                        :value="templateForm.category"
                        placeholder="例如：delivery"
                        @update:value="templateForm.category = String($event ?? '')"
                      />
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-form-item label="模板描述">
                  <a-textarea
                    :value="templateForm.description"
                    :rows="3"
                    @update:value="templateForm.description = String($event ?? '')"
                  />
                </a-form-item>
                <a-row :gutter="16">
                  <a-col :xs="24" :md="12">
                    <a-form-item label="默认角色">
                      <a-select
                        :value="templateForm.defaultRoles"
                        mode="multiple"
                        :options="roleOptions"
                        placeholder="选择模板默认角色"
                        @update:value="templateForm.defaultRoles = Array.isArray($event) ? $event.map((item) => String(item)) : []"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="模板级组织策略">
                      <a-row :gutter="12">
                        <a-col :xs="24" :md="12">
                          <a-select
                            :value="templateForm.defaultCollaborationMode || undefined"
                            allow-clear
                            :options="collaborationOptions"
                            placeholder="默认协作模式"
                            @update:value="templateForm.defaultCollaborationMode = toOptionalOperatingValue($event)"
                          />
                        </a-col>
                        <a-col :xs="24" :md="12">
                          <a-select
                            :value="templateForm.defaultAutopilotLevel || undefined"
                            allow-clear
                            :options="autopilotOptions"
                            placeholder="默认自动托管等级"
                            @update:value="templateForm.defaultAutopilotLevel = toOptionalOperatingValue($event)"
                          />
                        </a-col>
                      </a-row>
                      <a-row :gutter="12" style="margin-top: 12px">
                        <a-col :xs="24" :md="12">
                          <a-select
                            :value="templateForm.defaultBossParticipationMode || undefined"
                            allow-clear
                            :options="bossModeOptions"
                            placeholder="默认老板参与方式"
                            @update:value="templateForm.defaultBossParticipationMode = toOptionalOperatingValue($event)"
                          />
                        </a-col>
                        <a-col :xs="24" :md="12">
                          <a-checkbox
                            :checked="templateForm.forceBossParticipation"
                            @update:checked="templateForm.forceBossParticipation = Boolean($event)"
                          >
                            强制老板参与
                          </a-checkbox>
                        </a-col>
                      </a-row>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="模板状态">
                      <a-space direction="vertical">
                        <a-checkbox
                          :checked="templateForm.enabled"
                          @update:checked="templateForm.enabled = Boolean($event)"
                        >
                          启用模板
                        </a-checkbox>
                        <a-checkbox
                          :checked="templateForm.selectableByProjects"
                          @update:checked="templateForm.selectableByProjects = Boolean($event)"
                        >
                          允许项目绑定
                        </a-checkbox>
                      </a-space>
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-space>
                  <a-button type="primary" :loading="savingTemplate" @click="saveTemplate">保存模板</a-button>
                  <a-typography-text type="secondary">诊断：{{ diagnosticsSummary }}</a-typography-text>
                </a-space>
              </a-form>
            </a-card>

            <a-card size="small" title="阶段编辑" style="margin-bottom: 16px">
              <a-space direction="vertical" style="width: 100%" :size="16">
                <a-card v-for="(stage, index) in stageDrafts" :key="stage.id" size="small">
                  <a-row :gutter="16">
                    <a-col :xs="24" :md="12">
                      <a-form-item label="阶段 Key">
                        <a-select
                          :value="stage.stageKey"
                          show-search
                          :options="stageCatalogOptions"
                          placeholder="选择阶段 Key"
                          @update:value="stage.stageKey = String($event ?? '')"
                          @change="handleStageKeyChange(stage)"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :xs="24" :md="12">
                      <a-form-item label="阶段名称">
                        <a-input
                          :value="stage.name"
                          placeholder="例如：需求澄清"
                          @update:value="stage.name = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                  </a-row>

                  <a-row :gutter="16">
                    <a-col :xs="24" :md="8">
                      <a-form-item label="执行模式">
                        <a-select :value="stage.mode" :options="modeOptions" @update:value="setStageMode(stage, $event)" />
                      </a-form-item>
                    </a-col>
                    <a-col :xs="24" :md="8">
                      <a-form-item label="主责角色">
                        <a-select
                          :value="stage.primaryRoleAgentId"
                          :options="roleOptions"
                          @update:value="stage.primaryRoleAgentId = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :xs="24" :md="8">
                      <a-form-item label="参与角色">
                        <a-select
                          :value="stage.participantRoleAgentIds"
                          mode="multiple"
                          :options="roleOptions"
                          placeholder="选择协同角色"
                          @update:value="stage.participantRoleAgentIds = Array.isArray($event) ? $event.map((item) => String(item)) : []"
                        />
                      </a-form-item>
                    </a-col>
                  </a-row>

                  <a-space style="justify-content: space-between; width: 100%">
                    <a-space>
                      <a-checkbox :checked="stage.enabled" @update:checked="stage.enabled = Boolean($event)">
                        启用该阶段
                      </a-checkbox>
                      <a-typography-text type="secondary">顺序 {{ index + 1 }}</a-typography-text>
                    </a-space>
                    <a-space>
                      <a-button size="small" :loading="stage.saving" @click="saveStage(stage, index)">保存阶段</a-button>
                      <a-button
                        size="small"
                        danger
                        :loading="stage.deleting"
                        @click="removeStage(stage.id)"
                      >
                        删除阶段
                      </a-button>
                    </a-space>
                  </a-space>

                  <a-divider style="margin: 16px 0 12px" />

                  <a-card size="small" title="预设模板" style="margin-bottom: 12px">
                    <template v-if="stagePresetOptions(stage).length > 0">
                      <a-space wrap>
                        <a-button
                          v-for="preset in stagePresetOptions(stage)"
                          :key="preset.key"
                          size="small"
                          @click="applyStagePreset(stage, preset.key)"
                        >
                          应用 {{ preset.label }}
                        </a-button>
                      </a-space>
                    </template>
                    <a-typography-paragraph v-else type="secondary" style="margin-bottom: 0">
                      当前阶段没有内置预设。verify 和 release 阶段会提供常用 Gate / Approval 模板。
                    </a-typography-paragraph>
                  </a-card>

                  <a-row :gutter="16">
                    <a-col :xs="24" :lg="12">
                      <a-form-item label="进入条件">
                        <a-textarea
                          :value="toMultiline(stage.entryCriteria)"
                          :rows="4"
                          placeholder="每行一条，例如：需求已确认"
                          @update:value="setEntryCriteria(stage, $event)"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :xs="24" :lg="12">
                      <a-form-item label="退出条件">
                        <a-textarea
                          :value="toMultiline(stage.exitCriteria)"
                          :rows="4"
                          placeholder="每行一条，例如：评审通过"
                          @update:value="setExitCriteria(stage, $event)"
                        />
                      </a-form-item>
                    </a-col>
                  </a-row>

                  <a-card size="small" title="阶段初始任务定义" style="margin-bottom: 12px">
                    <a-row :gutter="16">
                      <a-col :xs="24" :md="12">
                        <a-form-item label="任务标题模板" extra="输入控件：单行输入。校验：必填。">
                          <a-input
                            :value="stage.initialTaskDefinition.titleTemplate"
                            placeholder="例如：Clarify：澄清需求范围"
                            @update:value="stage.initialTaskDefinition.titleTemplate = String($event ?? '')"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :md="12">
                        <a-form-item label="默认执行模式" extra="输入控件：下拉选择。校验：可为空，留空时沿用阶段模式。">
                          <a-select
                            :value="stage.initialTaskDefinition.defaultExecutionMode"
                            :options="initialTaskExecutionModeOptions"
                            @update:value="stage.initialTaskDefinition.defaultExecutionMode = normalizeInitialTaskExecutionMode($event)"
                          />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-row :gutter="16">
                      <a-col :xs="24" :md="12">
                        <a-form-item label="任务目标模板" extra="输入控件：多行文本。校验：必填。">
                          <a-textarea
                            :value="stage.initialTaskDefinition.goalTemplate"
                            :rows="3"
                            placeholder="说明这个阶段首个任务要达成什么目标"
                            @update:value="stage.initialTaskDefinition.goalTemplate = String($event ?? '')"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :md="12">
                        <a-form-item label="任务完成条件" extra="输入控件：多行文本，每行一条。校验：可选。">
                          <a-textarea
                            :value="toMultiline(stage.initialTaskDefinition.doneWhen)"
                            :rows="3"
                            placeholder="每行一条，例如：范围和约束已经明确"
                            @update:value="setInitialTaskDoneWhen(stage.initialTaskDefinition, $event)"
                          />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-form-item label="首轮指令模板" extra="输入控件：多行文本。校验：必填。">
                      <a-textarea
                        :value="stage.initialTaskDefinition.instructionTemplate"
                        :rows="5"
                        placeholder="填写该阶段初始任务启动时发给模型的主指令"
                        @update:value="stage.initialTaskDefinition.instructionTemplate = String($event ?? '')"
                      />
                    </a-form-item>

                    <a-card
                      v-if="stage.initialTaskDefinition.defaultExecutionMode === 'parallel'"
                      size="small"
                      title="默认候选模型"
                      style="margin-bottom: 12px"
                    >
                      <a-space direction="vertical" style="width: 100%" :size="12">
                        <a-alert
                          type="info"
                          show-icon
                          message="输入控件：模型与标签。校验：并行模式下至少 2 个候选模型，且 model 必填。"
                        />
                        <a-empty v-if="stage.initialTaskDefinition.defaultCandidates.length === 0" description="当前未配置默认候选模型" />
                        <a-card
                          v-for="(candidate, candidateIndex) in stage.initialTaskDefinition.defaultCandidates"
                          :key="candidate.key"
                          size="small"
                        >
                          <a-row :gutter="16">
                            <a-col :xs="24" :md="12">
                              <a-form-item label="模型 ID">
                                <a-input
                                  :value="candidate.model"
                                  placeholder="例如：gpt-5.4 / claude-sonnet"
                                  @update:value="candidate.model = String($event ?? '')"
                                />
                              </a-form-item>
                            </a-col>
                            <a-col :xs="24" :md="12">
                              <a-form-item label="展示标签">
                                <a-input
                                  :value="candidate.label"
                                  placeholder="例如：主方案 / 对照方案"
                                  @update:value="candidate.label = String($event ?? '')"
                                />
                              </a-form-item>
                            </a-col>
                          </a-row>
                          <a-button danger size="small" @click="removeInitialTaskCandidate(stage.initialTaskDefinition, candidateIndex)">
                            删除候选模型
                          </a-button>
                        </a-card>
                        <a-button size="small" @click="addInitialTaskCandidate(stage.initialTaskDefinition)">
                          新增候选模型
                        </a-button>
                      </a-space>
                    </a-card>

                    <a-card
                      v-if="stage.initialTaskDefinition.defaultExecutionMode === 'sequential-chain'"
                      size="small"
                      title="默认步骤"
                      style="margin-bottom: 12px"
                    >
                      <a-space direction="vertical" style="width: 100%" :size="12">
                        <a-alert
                          type="info"
                          show-icon
                          message="输入控件：步骤标题、指令、模型。校验：sequential-chain 模式至少 1 步，且标题和指令必填。"
                        />
                        <a-empty v-if="stage.initialTaskDefinition.defaultSteps.length === 0" description="当前未配置默认步骤" />
                        <a-card
                          v-for="(step, stepIndex) in stage.initialTaskDefinition.defaultSteps"
                          :key="step.id"
                          size="small"
                        >
                          <a-row :gutter="16">
                            <a-col :xs="24" :md="8">
                              <a-form-item label="步骤标题">
                                <a-input
                                  :value="step.title"
                                  placeholder="例如：先做需求分析"
                                  @update:value="step.title = String($event ?? '')"
                                />
                              </a-form-item>
                            </a-col>
                            <a-col :xs="24" :md="8">
                              <a-form-item label="步骤模型">
                                <a-input
                                  :value="step.model"
                                  placeholder="可选，留空则沿用当前模型"
                                  @update:value="step.model = String($event ?? '')"
                                />
                              </a-form-item>
                            </a-col>
                            <a-col :xs="24" :md="8">
                              <a-form-item label="步骤 ID">
                                <a-input :value="step.id" disabled />
                              </a-form-item>
                            </a-col>
                          </a-row>
                          <a-form-item label="步骤指令">
                            <a-textarea
                              :value="step.instruction"
                              :rows="3"
                              placeholder="填写该步骤的执行指令"
                              @update:value="step.instruction = String($event ?? '')"
                            />
                          </a-form-item>
                          <a-button danger size="small" @click="removeInitialTaskStep(stage.initialTaskDefinition, stepIndex)">
                            删除步骤
                          </a-button>
                        </a-card>
                        <a-button size="small" @click="addInitialTaskStep(stage.initialTaskDefinition)">
                          新增步骤
                        </a-button>
                      </a-space>
                    </a-card>

                    <a-row :gutter="16">
                      <a-col :xs="24" :md="12">
                        <a-form-item label="摘要标签" extra="输入控件：单行输入。校验：可选。">
                          <a-input
                            :value="stage.initialTaskDefinition.outputContract.summaryLabel"
                            placeholder="例如：clarify-summary"
                            @update:value="stage.initialTaskDefinition.outputContract.summaryLabel = String($event ?? '')"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :md="12">
                        <a-form-item label="产物键列表" extra="输入控件：标签输入。校验：可选。">
                          <a-select
                            :value="stage.initialTaskDefinition.outputContract.artifactKeys"
                            mode="tags"
                            placeholder="输入 artifact key，例如 scope、constraints"
                            @update:value="stage.initialTaskDefinition.outputContract.artifactKeys = Array.isArray($event) ? $event.map((item) => String(item)) : []"
                          />
                        </a-form-item>
                      </a-col>
                    </a-row>

                    <a-space direction="vertical" style="width: 100%" :size="8">
                      <a-typography-text type="secondary">上下文与输出约束</a-typography-text>
                      <a-space wrap>
                        <a-checkbox
                          :checked="stage.initialTaskDefinition.contextBindings.includeProjectBrief"
                          @update:checked="stage.initialTaskDefinition.contextBindings.includeProjectBrief = Boolean($event)"
                        >
                          注入项目背景
                        </a-checkbox>
                        <a-checkbox
                          :checked="stage.initialTaskDefinition.contextBindings.includePreviousStageSummary"
                          @update:checked="stage.initialTaskDefinition.contextBindings.includePreviousStageSummary = Boolean($event)"
                        >
                          注入前序阶段摘要
                        </a-checkbox>
                        <a-checkbox
                          :checked="stage.initialTaskDefinition.contextBindings.includeCurrentStageExitCriteria"
                          @update:checked="stage.initialTaskDefinition.contextBindings.includeCurrentStageExitCriteria = Boolean($event)"
                        >
                          注入当前阶段退出条件
                        </a-checkbox>
                        <a-checkbox
                          :checked="stage.initialTaskDefinition.outputContract.requireStageCompleteMarker"
                          @update:checked="stage.initialTaskDefinition.outputContract.requireStageCompleteMarker = Boolean($event)"
                        >
                          要求输出 [STAGE_COMPLETE]
                        </a-checkbox>
                      </a-space>
                    </a-space>
                  </a-card>

                  <a-card size="small" title="Gate 配置" style="margin-bottom: 12px">
                    <a-space direction="vertical" style="width: 100%" :size="12">
                      <a-empty v-if="stage.gates.length === 0" description="当前未配置 Gate" />
                      <a-card v-for="(gate, gateIndex) in stage.gates" :key="gate.key" size="small">
                        <a-row :gutter="16">
                          <a-col :xs="24" :md="8">
                            <a-form-item label="Gate 名称">
                              <a-input :value="gate.name" @update:value="gate.name = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                          <a-col :xs="24" :md="8">
                            <a-form-item label="Gate 类型">
                              <a-select :value="gate.type" :options="gateTypeOptions" @update:value="gate.type = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                          <a-col :xs="24" :md="8">
                            <a-form-item label="评估角色">
                              <a-select
                                :value="gate.evaluatorRole"
                                allow-clear
                                :options="roleOptions"
                                @update:value="gate.evaluatorRole = String($event ?? '')"
                              />
                            </a-form-item>
                          </a-col>
                        </a-row>
                        <a-form-item label="Gate 说明">
                          <a-textarea :value="gate.description" :rows="2" @update:value="gate.description = String($event ?? '')" />
                        </a-form-item>
                        <a-space style="justify-content: space-between; width: 100%">
                          <a-checkbox :checked="gate.required" @update:checked="gate.required = Boolean($event)">
                            阻断型 Gate
                          </a-checkbox>
                          <a-button danger size="small" @click="removeGate(stage, gateIndex)">删除 Gate</a-button>
                        </a-space>
                      </a-card>
                      <a-button size="small" @click="addGate(stage)">新增 Gate</a-button>
                    </a-space>
                  </a-card>

                  <a-card size="small" title="Approval 配置" style="margin-bottom: 12px">
                    <a-space direction="vertical" style="width: 100%" :size="12">
                      <a-empty v-if="stage.approvals.length === 0" description="当前未配置 Approval" />
                      <a-card v-for="(approval, approvalIndex) in stage.approvals" :key="approval.key" size="small">
                        <a-row :gutter="16">
                          <a-col :xs="24" :md="8">
                            <a-form-item label="审批名称">
                              <a-input :value="approval.name" @update:value="approval.name = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                          <a-col :xs="24" :md="8">
                            <a-form-item label="审批角色">
                              <a-select
                                :value="approval.approverRole"
                                allow-clear
                                :options="roleOptions"
                                @update:value="approval.approverRole = String($event ?? '')"
                              />
                            </a-form-item>
                          </a-col>
                          <a-col :xs="24" :md="8">
                            <a-form-item label="说明">
                              <a-input :value="approval.note" @update:value="approval.note = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                        </a-row>
                        <a-space style="justify-content: space-between; width: 100%">
                          <a-checkbox :checked="approval.required" @update:checked="approval.required = Boolean($event)">
                            必须审批
                          </a-checkbox>
                          <a-button danger size="small" @click="removeApproval(stage, approvalIndex)">删除 Approval</a-button>
                        </a-space>
                      </a-card>
                      <a-button size="small" @click="addApproval(stage)">新增 Approval</a-button>
                    </a-space>
                  </a-card>

                  <a-card size="small" title="二次治理模板策略" style="margin-bottom: 12px">
                    <a-row :gutter="16">
                      <a-col :xs="24" :md="12">
                        <a-form-item label="阻断后切换模板 ID">
                          <a-input
                            :value="stage.stageTemplateStrategy.onBlockedTemplateId"
                            placeholder="例如：tpl-security-remediation"
                            @update:value="stage.stageTemplateStrategy.onBlockedTemplateId = String($event ?? '')"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :md="12">
                        <a-form-item label="待审批后切换模板 ID">
                          <a-input
                            :value="stage.stageTemplateStrategy.onWaitingApprovalTemplateId"
                            placeholder="例如：tpl-release-approval"
                            @update:value="stage.stageTemplateStrategy.onWaitingApprovalTemplateId = String($event ?? '')"
                          />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-form-item label="阶段策略说明">
                      <a-textarea
                        :value="stage.stageTemplateStrategy.note"
                        :rows="2"
                        placeholder="说明这个阶段触发二次治理切换的原因"
                        @update:value="stage.stageTemplateStrategy.note = String($event ?? '')"
                      />
                    </a-form-item>
                  </a-card>

                  <a-card size="small" title="失败策略">
                    <a-row :gutter="16">
                      <a-col :xs="24" :md="8">
                        <a-form-item label="失败动作">
                          <a-select
                            :value="stage.failurePolicy.action"
                            :options="failureActionOptions"
                            @update:value="stage.failurePolicy.action = String($event ?? '')"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :md="8">
                        <a-form-item label="回退阶段">
                          <a-select
                            :value="stage.failurePolicy.fallbackStageKey"
                            allow-clear
                            :options="stageCatalogOptions"
                            @update:value="stage.failurePolicy.fallbackStageKey = String($event ?? '')"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :md="8">
                        <a-form-item label="人工接管">
                          <a-checkbox
                            :checked="stage.failurePolicy.allowManualOverride"
                            @update:checked="stage.failurePolicy.allowManualOverride = Boolean($event)"
                          >
                            允许人工接管
                          </a-checkbox>
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-form-item label="失败说明">
                      <a-textarea
                        :value="stage.failurePolicy.note"
                        :rows="2"
                        placeholder="例如：验证失败后退回 implement 并通知负责人"
                        @update:value="stage.failurePolicy.note = String($event ?? '')"
                      />
                    </a-form-item>
                  </a-card>
                </a-card>
              </a-space>
            </a-card>

            <a-card size="small" title="新增阶段">
              <a-form layout="vertical">
                <a-row :gutter="16">
                  <a-col :xs="24" :md="8">
                    <a-form-item label="阶段 Key">
                      <a-select
                        :value="newStage.stageKey"
                        show-search
                        :options="stageCatalogOptions"
                        placeholder="选择阶段"
                        @update:value="newStage.stageKey = String($event ?? '')"
                        @change="handleNewStageKeyChange"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="8">
                    <a-form-item label="阶段名称">
                      <a-input :value="newStage.name" @update:value="newStage.name = String($event ?? '')" />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="8">
                    <a-form-item label="执行模式">
                      <a-select :value="newStage.mode" :options="modeOptions" @update:value="setNewStageMode($event)" />
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-row :gutter="16">
                  <a-col :xs="24" :md="12">
                    <a-form-item label="主责角色">
                      <a-select
                        :value="newStage.primaryRoleAgentId"
                        :options="roleOptions"
                        @update:value="newStage.primaryRoleAgentId = String($event ?? '')"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="参与角色">
                      <a-select
                        :value="newStage.participantRoleAgentIds"
                        mode="multiple"
                        :options="roleOptions"
                        @update:value="newStage.participantRoleAgentIds = Array.isArray($event) ? $event.map((item) => String(item)) : []"
                      />
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-row :gutter="16">
                  <a-col :xs="24" :md="12">
                    <a-form-item label="阻断后切换模板 ID">
                      <a-input
                        :value="newStage.stageTemplateStrategy.onBlockedTemplateId"
                        placeholder="可选"
                        @update:value="newStage.stageTemplateStrategy.onBlockedTemplateId = String($event ?? '')"
                      />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="待审批后切换模板 ID">
                      <a-input
                        :value="newStage.stageTemplateStrategy.onWaitingApprovalTemplateId"
                        placeholder="可选"
                        @update:value="newStage.stageTemplateStrategy.onWaitingApprovalTemplateId = String($event ?? '')"
                      />
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-form-item label="阶段策略说明">
                  <a-textarea
                    :value="newStage.stageTemplateStrategy.note"
                    :rows="2"
                    @update:value="newStage.stageTemplateStrategy.note = String($event ?? '')"
                  />
                </a-form-item>
                <a-card size="small" title="阶段初始任务定义" style="margin-bottom: 16px">
                  <a-row :gutter="16">
                    <a-col :xs="24" :md="12">
                      <a-form-item label="任务标题模板" extra="输入控件：单行输入。校验：必填。">
                        <a-input
                          :value="newStage.initialTaskDefinition.titleTemplate"
                          @update:value="newStage.initialTaskDefinition.titleTemplate = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :xs="24" :md="12">
                      <a-form-item label="默认执行模式" extra="输入控件：下拉选择。校验：可为空，留空时沿用阶段模式。">
                        <a-select
                          :value="newStage.initialTaskDefinition.defaultExecutionMode"
                          :options="initialTaskExecutionModeOptions"
                          @update:value="newStage.initialTaskDefinition.defaultExecutionMode = normalizeInitialTaskExecutionMode($event)"
                        />
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-row :gutter="16">
                    <a-col :xs="24" :md="12">
                      <a-form-item label="任务目标模板" extra="输入控件：多行文本。校验：必填。">
                        <a-textarea
                          :value="newStage.initialTaskDefinition.goalTemplate"
                          :rows="3"
                          @update:value="newStage.initialTaskDefinition.goalTemplate = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :xs="24" :md="12">
                      <a-form-item label="任务完成条件" extra="输入控件：多行文本，每行一条。校验：可选。">
                        <a-textarea
                          :value="toMultiline(newStage.initialTaskDefinition.doneWhen)"
                          :rows="3"
                          @update:value="setInitialTaskDoneWhen(newStage.initialTaskDefinition, $event)"
                        />
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-form-item label="首轮指令模板" extra="输入控件：多行文本。校验：必填。">
                    <a-textarea
                      :value="newStage.initialTaskDefinition.instructionTemplate"
                      :rows="5"
                      @update:value="newStage.initialTaskDefinition.instructionTemplate = String($event ?? '')"
                    />
                  </a-form-item>
                  <a-row :gutter="16">
                    <a-col :xs="24" :md="12">
                      <a-form-item label="摘要标签" extra="输入控件：单行输入。校验：可选。">
                        <a-input
                          :value="newStage.initialTaskDefinition.outputContract.summaryLabel"
                          @update:value="newStage.initialTaskDefinition.outputContract.summaryLabel = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :xs="24" :md="12">
                      <a-form-item label="产物键列表" extra="输入控件：标签输入。校验：可选。">
                        <a-select
                          :value="newStage.initialTaskDefinition.outputContract.artifactKeys"
                          mode="tags"
                          @update:value="newStage.initialTaskDefinition.outputContract.artifactKeys = Array.isArray($event) ? $event.map((item) => String(item)) : []"
                        />
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-space wrap style="margin-bottom: 12px">
                    <a-checkbox
                      :checked="newStage.initialTaskDefinition.contextBindings.includeProjectBrief"
                      @update:checked="newStage.initialTaskDefinition.contextBindings.includeProjectBrief = Boolean($event)"
                    >
                      注入项目背景
                    </a-checkbox>
                    <a-checkbox
                      :checked="newStage.initialTaskDefinition.contextBindings.includePreviousStageSummary"
                      @update:checked="newStage.initialTaskDefinition.contextBindings.includePreviousStageSummary = Boolean($event)"
                    >
                      注入前序阶段摘要
                    </a-checkbox>
                    <a-checkbox
                      :checked="newStage.initialTaskDefinition.contextBindings.includeCurrentStageExitCriteria"
                      @update:checked="newStage.initialTaskDefinition.contextBindings.includeCurrentStageExitCriteria = Boolean($event)"
                    >
                      注入当前阶段退出条件
                    </a-checkbox>
                    <a-checkbox
                      :checked="newStage.initialTaskDefinition.outputContract.requireStageCompleteMarker"
                      @update:checked="newStage.initialTaskDefinition.outputContract.requireStageCompleteMarker = Boolean($event)"
                    >
                      要求输出 [STAGE_COMPLETE]
                    </a-checkbox>
                  </a-space>

                  <a-card
                    v-if="newStage.initialTaskDefinition.defaultExecutionMode === 'parallel'"
                    size="small"
                    title="默认候选模型"
                    style="margin-bottom: 12px"
                  >
                    <a-space direction="vertical" style="width: 100%" :size="12">
                      <a-card
                        v-for="(candidate, candidateIndex) in newStage.initialTaskDefinition.defaultCandidates"
                        :key="candidate.key"
                        size="small"
                      >
                        <a-row :gutter="16">
                          <a-col :xs="24" :md="12">
                            <a-form-item label="模型 ID">
                              <a-input :value="candidate.model" @update:value="candidate.model = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                          <a-col :xs="24" :md="12">
                            <a-form-item label="展示标签">
                              <a-input :value="candidate.label" @update:value="candidate.label = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                        </a-row>
                        <a-button danger size="small" @click="removeInitialTaskCandidate(newStage.initialTaskDefinition, candidateIndex)">
                          删除候选模型
                        </a-button>
                      </a-card>
                      <a-button size="small" @click="addInitialTaskCandidate(newStage.initialTaskDefinition)">
                        新增候选模型
                      </a-button>
                    </a-space>
                  </a-card>

                  <a-card
                    v-if="newStage.initialTaskDefinition.defaultExecutionMode === 'sequential-chain'"
                    size="small"
                    title="默认步骤"
                    style="margin-bottom: 12px"
                  >
                    <a-space direction="vertical" style="width: 100%" :size="12">
                      <a-card
                        v-for="(step, stepIndex) in newStage.initialTaskDefinition.defaultSteps"
                        :key="step.id"
                        size="small"
                      >
                        <a-row :gutter="16">
                          <a-col :xs="24" :md="8">
                            <a-form-item label="步骤标题">
                              <a-input :value="step.title" @update:value="step.title = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                          <a-col :xs="24" :md="8">
                            <a-form-item label="步骤模型">
                              <a-input :value="step.model" @update:value="step.model = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                          <a-col :xs="24" :md="8">
                            <a-form-item label="步骤 ID">
                              <a-input :value="step.id" disabled />
                            </a-form-item>
                          </a-col>
                        </a-row>
                        <a-form-item label="步骤指令">
                          <a-textarea :value="step.instruction" :rows="3" @update:value="step.instruction = String($event ?? '')" />
                        </a-form-item>
                        <a-button danger size="small" @click="removeInitialTaskStep(newStage.initialTaskDefinition, stepIndex)">
                          删除步骤
                        </a-button>
                      </a-card>
                      <a-button size="small" @click="addInitialTaskStep(newStage.initialTaskDefinition)">
                        新增步骤
                      </a-button>
                    </a-space>
                  </a-card>
                </a-card>
                <a-space>
                  <a-checkbox :checked="newStage.enabled" @update:checked="newStage.enabled = Boolean($event)">
                    创建后立即启用
                  </a-checkbox>
                  <a-button type="primary" :loading="creatingStage" @click="addStage">新增阶段</a-button>
                </a-space>
              </a-form>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, defineAsyncComponent, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import {
  type WorkflowTemplateEditorView,
  type WorkflowTemplateStageInitialTaskDefinition,
  createWorkflowTemplateStage,
  deleteWorkflowTemplateStage,
  getWorkflowTemplateEditorView,
  updateWorkflowTemplate,
  updateWorkflowTemplateStage,
} from "../lib/api";

const MermaidRenderer = defineAsyncComponent(() => import("../components/MermaidRenderer.vue"));

type StageDraft = {
  id: string;
  stageKey: string;
  name: string;
  enabled: boolean;
  mode: "single" | "parallel" | "sequential-chain";
  primaryRoleAgentId: string;
  participantRoleAgentIds: string[];
  entryCriteria: string[];
  exitCriteria: string[];
  initialTaskDefinition: InitialTaskDefinitionDraft;
  gates: GateDraft[];
  approvals: ApprovalDraft[];
  stageTemplateStrategy: StageTemplateStrategyDraft;
  failurePolicy: FailurePolicyDraft;
  orderIndex: number;
  saving?: boolean;
  deleting?: boolean;
};

type GateDraft = {
  key: string;
  name: string;
  type: string;
  required: boolean;
  evaluatorRole: string;
  description: string;
};

type ApprovalDraft = {
  key: string;
  name: string;
  approverRole: string;
  required: boolean;
  note: string;
};

type FailurePolicyDraft = {
  action: string;
  fallbackStageKey: string;
  allowManualOverride: boolean;
  note: string;
};

type StageTemplateStrategyDraft = {
  onBlockedTemplateId: string;
  onWaitingApprovalTemplateId: string;
  note: string;
};

type InitialTaskExecutionMode = "" | "single" | "parallel" | "sequential-chain";

type InitialTaskCandidateDraft = {
  key: string;
  model: string;
  label: string;
};

type InitialTaskStepDraft = {
  id: string;
  title: string;
  instruction: string;
  model: string;
};

type InitialTaskContextBindingsDraft = {
  includeProjectBrief: boolean;
  includePreviousStageSummary: boolean;
  includeCurrentStageExitCriteria: boolean;
};

type InitialTaskOutputContractDraft = {
  summaryLabel: string;
  artifactKeys: string[];
  requireStageCompleteMarker: boolean;
};

type InitialTaskDefinitionDraft = {
  titleTemplate: string;
  goalTemplate: string;
  instructionTemplate: string;
  doneWhen: string[];
  defaultExecutionMode: InitialTaskExecutionMode;
  defaultCandidates: InitialTaskCandidateDraft[];
  defaultSteps: InitialTaskStepDraft[];
  contextBindings: InitialTaskContextBindingsDraft;
  outputContract: InitialTaskOutputContractDraft;
};

type StagePreset = {
  key: string;
  label: string;
  stageKey: string;
  entryCriteria: string[];
  exitCriteria: string[];
  gates: GateDraft[];
  approvals: ApprovalDraft[];
  failurePolicy: FailurePolicyDraft;
};

const route = useRoute();
const loading = ref(true);
const loadError = ref<string | null>(null);
const savingTemplate = ref(false);
const creatingStage = ref(false);
const reordering = ref(false);
const activeDiagramTab = ref("stage-flow");
const editorView = ref<WorkflowTemplateEditorView | null>(null);
const stageDrafts = ref<StageDraft[]>([]);

const templateForm = reactive({
  name: "",
  description: "",
  category: "",
  enabled: true,
  selectableByProjects: true,
  defaultRoles: [] as string[],
  defaultCollaborationMode: "",
  defaultAutopilotLevel: "",
  defaultBossParticipationMode: "",
  forceBossParticipation: false,
});

const newStage = reactive({
  stageKey: "",
  name: "",
  enabled: true,
  mode: "single" as "single" | "parallel" | "sequential-chain",
  primaryRoleAgentId: "",
  participantRoleAgentIds: [] as string[],
  initialTaskDefinition: createDefaultInitialTaskDefinition("", ""),
  stageTemplateStrategy: {
    onBlockedTemplateId: "",
    onWaitingApprovalTemplateId: "",
    note: "",
  },
});

const diagnosticsSummary = computed(() => {
  const diagnostics = editorView.value?.diagnostics;
  if (!diagnostics) {
    return "未生成";
  }

  const notes: string[] = [];
  if (diagnostics.hasCustomStages) {
    notes.push("含自定义阶段");
  }
  if (diagnostics.duplicateStageKeys.length > 0) {
    notes.push(`重复阶段 ${diagnostics.duplicateStageKeys.join("/")}`);
  }
  if (diagnostics.missingConfiguredStages.length > 0) {
    notes.push(`缺失配置 ${diagnostics.missingConfiguredStages.join("/")}`);
  }
  return notes.join("；") || "无异常";
});

const roleOptions = computed(() =>
  (editorView.value?.availableRoles || []).map((item) => ({ label: item.name, value: item.id })),
);

const roleLabelMap = computed(
  () =>
    new Map((editorView.value?.availableRoles || []).map((item) => [item.id, item.name] as const)),
);

const stageCatalogOptions = computed(() =>
  (editorView.value?.stageCatalog || []).map((item) => ({
    label: `${item.label} (${item.key})`,
    value: item.key,
  })),
);

const modeOptions = [
  { label: "single", value: "single" },
  { label: "parallel", value: "parallel" },
  { label: "sequential-chain", value: "sequential-chain" },
];

const initialTaskExecutionModeOptions = [
  { label: "沿用阶段模式", value: "" },
  { label: "single", value: "single" },
  { label: "parallel", value: "parallel" },
  { label: "sequential-chain（顺序编排）", value: "sequential-chain" },
];

const collaborationOptions = [
  { label: "单兵模式", value: "solo" },
  { label: "团队模式", value: "team" },
  { label: "混合模式", value: "hybrid" },
];

const autopilotOptions = [
  { label: "L0 手动监督", value: "L0" },
  { label: "L1 半自动经营", value: "L1" },
  { label: "L2 全自动托管", value: "L2" },
];

const bossModeOptions = [
  { label: "不参与", value: "disabled" },
  { label: "建议模式", value: "advisory" },
  { label: "异常介入", value: "exception-only" },
  { label: "全面管理", value: "full-manager" },
];

const gateTypeOptions = [
  { label: "quality", value: "quality" },
  { label: "security", value: "security" },
  { label: "compliance", value: "compliance" },
  { label: "approval", value: "approval" },
];

const failureActionOptions = [
  { label: "未配置", value: "" },
  { label: "retry", value: "retry" },
  { label: "fallback-stage", value: "fallback-stage" },
  { label: "manual-intervention", value: "manual-intervention" },
  { label: "abort", value: "abort" },
];

const stageFlowMermaid = computed(() => {
  if (stageDrafts.value.length === 0) {
    return "";
  }

  const lines = [
    "flowchart TD",
    "classDef active fill:#d9f7be,stroke:#389e0d,color:#135200;",
    "classDef muted fill:#f5f5f5,stroke:#bfbfbf,color:#595959;",
  ];

  for (const [index, stage] of stageDrafts.value.entries()) {
    const nodeId = `stage_${index + 1}`;
    const gateCount = stage.gates.filter((gate) => gate.required).length;
    const approvalCount = stage.approvals.filter((approval) => approval.required).length;
    const label = sanitizeMermaidLabel(
      [
        `${index + 1}. ${stage.name || stageCatalogLabel(stage.stageKey)}`,
        `${stage.stageKey} | ${resolveRoleLabel(stage.primaryRoleAgentId)}`,
        `Gate ${gateCount} | Approval ${approvalCount}`,
      ].join("\\n"),
    );
    lines.push(`${nodeId}[\"${label}\"]`);
    lines.push(`class ${nodeId} ${stage.enabled ? "active" : "muted"};`);

    if (index > 0) {
      lines.push(`stage_${index} --> ${nodeId}`);
    }

    if (stage.failurePolicy.fallbackStageKey.trim()) {
      const fallbackIndex = stageDrafts.value.findIndex(
        (item) => item.stageKey === stage.failurePolicy.fallbackStageKey,
      );
      if (fallbackIndex >= 0) {
        lines.push(
          `${nodeId} -. ${sanitizeMermaidLabel(stage.failurePolicy.action || "fallback")} .-> stage_${fallbackIndex + 1}`,
        );
      }
    }
  }

  return lines.join("\n");
});

function appendRoleMapPrimary(
  lines: string[],
  stageNodeId: string,
  stage: StageDraft,
  index: number,
) {
  if (!stage.primaryRoleAgentId.trim()) {
    return;
  }

  const primaryId = `role_primary_${index + 1}`;
  lines.push(
    `${primaryId}["主责: ${sanitizeMermaidLabel(resolveRoleLabel(stage.primaryRoleAgentId))}"]`,
  );
  lines.push(`${stageNodeId} --> ${primaryId}`);
  lines.push(`class ${primaryId} primary;`);
}

function appendRoleMapParticipants(
  lines: string[],
  stageNodeId: string,
  stage: StageDraft,
  index: number,
) {
  for (const [participantIndex, participantRoleId] of stage.participantRoleAgentIds.entries()) {
    const participantId = `role_participant_${index + 1}_${participantIndex + 1}`;
    lines.push(
      `${participantId}["参与: ${sanitizeMermaidLabel(resolveRoleLabel(participantRoleId))}"]`,
    );
    lines.push(`${stageNodeId} --> ${participantId}`);
    lines.push(`class ${participantId} participant;`);
  }
}

function appendRoleMapControls(
  lines: string[],
  stageNodeId: string,
  stage: StageDraft,
  index: number,
) {
  for (const [gateIndex, gate] of stage.gates.entries()) {
    const gateId = `gate_${index + 1}_${gateIndex + 1}`;
    const gateRole = gate.evaluatorRole.trim() ? ` / ${resolveRoleLabel(gate.evaluatorRole)}` : "";
    lines.push(
      `${gateId}["Gate: ${sanitizeMermaidLabel(gate.name || gate.type)}${sanitizeMermaidLabel(gateRole)}"]`,
    );
    lines.push(`${stageNodeId} -.-> ${gateId}`);
    lines.push(`class ${gateId} control;`);
  }

  for (const [approvalIndex, approval] of stage.approvals.entries()) {
    const approvalId = `approval_${index + 1}_${approvalIndex + 1}`;
    const approvalRole = approval.approverRole.trim()
      ? ` / ${resolveRoleLabel(approval.approverRole)}`
      : "";
    lines.push(
      `${approvalId}["Approval: ${sanitizeMermaidLabel(approval.name || "审批")}${sanitizeMermaidLabel(approvalRole)}"]`,
    );
    lines.push(`${stageNodeId} -.-> ${approvalId}`);
    lines.push(`class ${approvalId} control;`);
  }
}

const roleMapMermaid = computed(() => {
  if (stageDrafts.value.length === 0) {
    return "";
  }

  const lines = [
    "flowchart LR",
    "classDef stage fill:#e6f4ff,stroke:#1677ff,color:#003a8c;",
    "classDef primary fill:#fff7e6,stroke:#fa8c16,color:#873800;",
    "classDef participant fill:#f9f0ff,stroke:#722ed1,color:#391085;",
    "classDef control fill:#fff1f0,stroke:#cf1322,color:#820014;",
  ];

  for (const [index, stage] of stageDrafts.value.entries()) {
    const stageNodeId = `or_stage_${index + 1}`;
    lines.push(
      `${stageNodeId}[\"${sanitizeMermaidLabel(`${stage.name || stageCatalogLabel(stage.stageKey)}\\n${stage.stageKey}`)}\"]`,
    );
    lines.push(`class ${stageNodeId} stage;`);
    appendRoleMapPrimary(lines, stageNodeId, stage, index);
    appendRoleMapParticipants(lines, stageNodeId, stage, index);
    appendRoleMapControls(lines, stageNodeId, stage, index);
  }

  return lines.join("\n");
});

const stagePresets: StagePreset[] = [
  {
    key: "verify-standard",
    label: "验证标准放行",
    stageKey: "verify",
    entryCriteria: ["实现代码已合并", "测试环境和测试数据已准备"],
    exitCriteria: ["关键测试用例通过", "验证报告已归档"],
    gates: [
      {
        key: "gate-verify-quality",
        name: "质量门禁",
        type: "quality",
        required: true,
        evaluatorRole: "role.qa",
        description: "验证测试结果、回归情况和缺陷风险。",
      },
      {
        key: "gate-verify-security",
        name: "安全门禁",
        type: "security",
        required: true,
        evaluatorRole: "role.security",
        description: "确认关键漏洞和安全例外已处理。",
      },
    ],
    approvals: [
      {
        key: "approval-verify-qa",
        name: "QA 放行",
        approverRole: "role.qa",
        required: true,
        note: "QA 对验证结果进行最终确认。",
      },
    ],
    failurePolicy: {
      action: "fallback-stage",
      fallbackStageKey: "implement",
      allowManualOverride: true,
      note: "验证失败时退回 implement，并允许人工介入处理。",
    },
  },
  {
    key: "release-standard",
    label: "发布受控上线",
    stageKey: "release",
    entryCriteria: ["verify 阶段已放行", "发布窗口和回滚方案已确认"],
    exitCriteria: ["生产发布完成", "发布记录与变更单已归档"],
    gates: [
      {
        key: "gate-release-compliance",
        name: "发布合规检查",
        type: "compliance",
        required: true,
        evaluatorRole: "role.release",
        description: "确认变更单、回滚方案和发布窗口符合要求。",
      },
      {
        key: "gate-release-approval",
        name: "上线审批门禁",
        type: "approval",
        required: true,
        evaluatorRole: "role.security",
        description: "确认高风险变更已完成必要审批。",
      },
    ],
    approvals: [
      {
        key: "approval-release-ops",
        name: "发布负责人审批",
        approverRole: "role.release",
        required: true,
        note: "发布负责人确认上线方案。",
      },
      {
        key: "approval-release-security",
        name: "安全审批",
        approverRole: "role.security",
        required: true,
        note: "涉及高风险变更时需要安全团队签字。",
      },
    ],
    failurePolicy: {
      action: "fallback-stage",
      fallbackStageKey: "verify",
      allowManualOverride: true,
      note: "发布失败时回退到 verify，并由发布负责人人工介入。",
    },
  },
];

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function toMultiline(values: string[]) {
  return values.join("\n");
}

function toOptionalOperatingValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function normalizeInitialTaskExecutionMode(value: unknown): InitialTaskExecutionMode {
  if (value === "pipeline") {
    return "sequential-chain";
  }
  return value === "single" || value === "parallel" || value === "sequential-chain" ? value : "";
}

function asTemplateCollaborationMode(value: string) {
  return value === "solo" || value === "team" || value === "hybrid" ? value : undefined;
}

function asTemplateAutopilotLevel(value: string) {
  return value === "L0" || value === "L1" || value === "L2" ? value : undefined;
}

function asTemplateBossParticipationMode(value: string) {
  return value === "disabled" ||
    value === "advisory" ||
    value === "exception-only" ||
    value === "full-manager"
    ? value
    : undefined;
}

function sanitizeMermaidLabel(value: string) {
  return value
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\|/g, "/")
    .trim();
}

function resolveRoleLabel(roleAgentId: string) {
  return roleLabelMap.value.get(roleAgentId) || roleAgentId || "未指定角色";
}

function fromMultiline(value: unknown) {
  return String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeGate(value: unknown, index: number): GateDraft {
  const record = toRecord(value);
  return {
    key: String(record.key ?? record.id ?? `gate-${index + 1}`),
    name: String(record.name ?? record.label ?? `Gate ${index + 1}`),
    type: String(record.type ?? "quality"),
    required: Boolean(record.required ?? false),
    evaluatorRole: String(record.evaluatorRole ?? record.evaluatorRoleAgentId ?? ""),
    description: String(record.description ?? record.rule ?? ""),
  };
}

function normalizeApproval(value: unknown, index: number): ApprovalDraft {
  const record = toRecord(value);
  return {
    key: String(record.key ?? record.id ?? `approval-${index + 1}`),
    name: String(record.name ?? record.label ?? `Approval ${index + 1}`),
    approverRole: String(record.approverRole ?? record.role ?? record.approverRoleAgentId ?? ""),
    required: Boolean(record.required ?? true),
    note: String(record.note ?? record.description ?? ""),
  };
}

function normalizeFailurePolicy(value: unknown): FailurePolicyDraft {
  const record = toRecord(value);
  return {
    action: String(record.action ?? record.strategy ?? ""),
    fallbackStageKey: String(
      record.fallbackStageKey ?? record.rollbackStageKey ?? record.targetStageKey ?? "",
    ),
    allowManualOverride: Boolean(record.allowManualOverride ?? record.manualOverride ?? false),
    note: String(record.note ?? record.reason ?? record.description ?? ""),
  };
}

function createDefaultInitialTaskDefinition(
  stageKey: string,
  stageName: string,
): InitialTaskDefinitionDraft {
  const resolvedName = stageName.trim() || stageCatalogLabel(stageKey) || stageKey || "未命名阶段";
  return {
    titleTemplate: `${resolvedName}：初始任务`,
    goalTemplate: `完成 ${resolvedName} 阶段的首个任务目标，并输出可用于后续推进的阶段摘要。`,
    instructionTemplate: `请聚焦 ${resolvedName} 阶段目标，结合当前任务和已有上下文，输出结构化结果，并在完成时给出阶段摘要。`,
    doneWhen: [],
    defaultExecutionMode: "",
    defaultCandidates: [],
    defaultSteps: [],
    contextBindings: {
      includeProjectBrief: true,
      includePreviousStageSummary: true,
      includeCurrentStageExitCriteria: true,
    },
    outputContract: {
      summaryLabel: "",
      artifactKeys: [],
      requireStageCompleteMarker: true,
    },
  };
}

function normalizeInitialTaskCandidate(value: unknown, index: number): InitialTaskCandidateDraft {
  const record = toRecord(value);
  return {
    key: String(record.key ?? `candidate-${index + 1}-${crypto.randomUUID()}`),
    model: String(record.model ?? ""),
    label: String(record.label ?? ""),
  };
}

function normalizeInitialTaskStep(value: unknown, index: number): InitialTaskStepDraft {
  const record = toRecord(value);
  return {
    id: String(record.id ?? `step-${index + 1}-${crypto.randomUUID()}`),
    title: String(record.title ?? ""),
    instruction: String(record.instruction ?? ""),
    model: String(record.model ?? ""),
  };
}

function normalizeInitialTaskDefinition(
  value: WorkflowTemplateStageInitialTaskDefinition | null | undefined,
  stageKey: string,
  stageName: string,
): InitialTaskDefinitionDraft {
  const fallback = createDefaultInitialTaskDefinition(stageKey, stageName);
  const record = toRecord(value);
  const contextBindings = toRecord(record.contextBindings);
  const outputContract = toRecord(record.outputContract);
  return {
    titleTemplate:
      typeof record.titleTemplate === "string" && record.titleTemplate.trim()
        ? record.titleTemplate
        : fallback.titleTemplate,
    goalTemplate:
      typeof record.goalTemplate === "string" && record.goalTemplate.trim()
        ? record.goalTemplate
        : fallback.goalTemplate,
    instructionTemplate:
      typeof record.instructionTemplate === "string" && record.instructionTemplate.trim()
        ? record.instructionTemplate
        : fallback.instructionTemplate,
    doneWhen: toStringArray(record.doneWhen),
    defaultExecutionMode: normalizeInitialTaskExecutionMode(record.defaultExecutionMode),
    defaultCandidates: Array.isArray(record.defaultCandidates)
      ? record.defaultCandidates.map((item, index) => normalizeInitialTaskCandidate(item, index))
      : [],
    defaultSteps: Array.isArray(record.defaultSteps)
      ? record.defaultSteps.map((item, index) => normalizeInitialTaskStep(item, index))
      : [],
    contextBindings: {
      includeProjectBrief: Boolean(contextBindings.includeProjectBrief ?? true),
      includePreviousStageSummary: Boolean(contextBindings.includePreviousStageSummary ?? true),
      includeCurrentStageExitCriteria: Boolean(
        contextBindings.includeCurrentStageExitCriteria ?? true,
      ),
    },
    outputContract: {
      summaryLabel: String(outputContract.summaryLabel ?? ""),
      artifactKeys: toStringArray(outputContract.artifactKeys),
      requireStageCompleteMarker: Boolean(outputContract.requireStageCompleteMarker ?? true),
    },
  };
}

function serializeInitialTaskDefinition(
  initialTaskDefinition: InitialTaskDefinitionDraft,
): WorkflowTemplateStageInitialTaskDefinition {
  return {
    version: 1,
    titleTemplate: initialTaskDefinition.titleTemplate.trim(),
    goalTemplate: initialTaskDefinition.goalTemplate.trim(),
    instructionTemplate: initialTaskDefinition.instructionTemplate.trim(),
    doneWhen: initialTaskDefinition.doneWhen.map((item) => item.trim()).filter(Boolean),
    defaultExecutionMode: initialTaskDefinition.defaultExecutionMode || undefined,
    defaultCandidates:
      initialTaskDefinition.defaultExecutionMode === "parallel"
        ? initialTaskDefinition.defaultCandidates
            .filter((item) => item.model.trim())
            .map((item) => ({ model: item.model.trim(), label: item.label.trim() || undefined }))
        : undefined,
    defaultSteps:
      initialTaskDefinition.defaultExecutionMode === "sequential-chain"
        ? initialTaskDefinition.defaultSteps
            .filter((item) => item.title.trim() || item.instruction.trim() || item.model.trim())
            .map((item) => ({
              id: item.id,
              title: item.title.trim(),
              instruction: item.instruction.trim(),
              model: item.model.trim() || undefined,
            }))
        : undefined,
    contextBindings: {
      includeProjectBrief: initialTaskDefinition.contextBindings.includeProjectBrief,
      includePreviousStageSummary:
        initialTaskDefinition.contextBindings.includePreviousStageSummary,
      includeCurrentStageExitCriteria:
        initialTaskDefinition.contextBindings.includeCurrentStageExitCriteria,
    },
    outputContract: {
      summaryLabel: initialTaskDefinition.outputContract.summaryLabel.trim() || undefined,
      artifactKeys: initialTaskDefinition.outputContract.artifactKeys
        .map((item) => item.trim())
        .filter(Boolean),
      requireStageCompleteMarker: initialTaskDefinition.outputContract.requireStageCompleteMarker,
    },
  };
}

function addInitialTaskCandidate(initialTaskDefinition: InitialTaskDefinitionDraft) {
  initialTaskDefinition.defaultCandidates.push({
    key: `candidate-${crypto.randomUUID()}`,
    model: "",
    label: "",
  });
}

function removeInitialTaskCandidate(
  initialTaskDefinition: InitialTaskDefinitionDraft,
  index: number,
) {
  initialTaskDefinition.defaultCandidates.splice(index, 1);
}

function addInitialTaskStep(initialTaskDefinition: InitialTaskDefinitionDraft) {
  initialTaskDefinition.defaultSteps.push({
    id: `step-${crypto.randomUUID()}`,
    title: "",
    instruction: "",
    model: "",
  });
}

function removeInitialTaskStep(initialTaskDefinition: InitialTaskDefinitionDraft, index: number) {
  initialTaskDefinition.defaultSteps.splice(index, 1);
}

function setInitialTaskDoneWhen(initialTaskDefinition: InitialTaskDefinitionDraft, value: unknown) {
  initialTaskDefinition.doneWhen = fromMultiline(value);
}

function validateInitialTaskDefinition(initialTaskDefinition: InitialTaskDefinitionDraft) {
  if (!initialTaskDefinition.titleTemplate.trim()) {
    return "初始任务标题模板不能为空";
  }
  if (!initialTaskDefinition.goalTemplate.trim()) {
    return "初始任务目标模板不能为空";
  }
  if (!initialTaskDefinition.instructionTemplate.trim()) {
    return "初始任务指令模板不能为空";
  }

  if (initialTaskDefinition.defaultExecutionMode === "parallel") {
    const validCandidates = initialTaskDefinition.defaultCandidates.filter((item) =>
      item.model.trim(),
    );
    if (validCandidates.length < 2) {
      return "并行模式至少需要配置 2 个默认候选模型";
    }
  }

  if (initialTaskDefinition.defaultExecutionMode === "sequential-chain") {
    const steps = initialTaskDefinition.defaultSteps.filter(
      (item) => item.title.trim() || item.instruction.trim() || item.model.trim(),
    );
    if (steps.length === 0) {
      return "sequential-chain 模式至少需要配置 1 个默认步骤";
    }
    if (steps.some((item) => !item.title.trim() || !item.instruction.trim())) {
      return "sequential-chain 步骤必须填写标题和指令";
    }
  }

  return null;
}

function serializeGates(gates: GateDraft[]) {
  return gates
    .filter((gate) => gate.name.trim() || gate.description.trim() || gate.evaluatorRole.trim())
    .map((gate) => ({
      key: gate.key,
      name: gate.name.trim() || gate.key,
      type: gate.type.trim() || "quality",
      required: gate.required,
      evaluatorRole: gate.evaluatorRole.trim() || undefined,
      description: gate.description.trim() || undefined,
    }));
}

function serializeApprovals(approvals: ApprovalDraft[]) {
  return approvals
    .filter(
      (approval) => approval.name.trim() || approval.approverRole.trim() || approval.note.trim(),
    )
    .map((approval) => ({
      key: approval.key,
      name: approval.name.trim() || approval.key,
      approverRole: approval.approverRole.trim() || undefined,
      required: approval.required,
      note: approval.note.trim() || undefined,
    }));
}

function serializeFailurePolicy(failurePolicy: FailurePolicyDraft) {
  if (
    !failurePolicy.action.trim() &&
    !failurePolicy.fallbackStageKey.trim() &&
    !failurePolicy.allowManualOverride &&
    !failurePolicy.note.trim()
  ) {
    return undefined;
  }

  return {
    action: failurePolicy.action.trim() || undefined,
    fallbackStageKey: failurePolicy.fallbackStageKey.trim() || undefined,
    allowManualOverride: failurePolicy.allowManualOverride,
    note: failurePolicy.note.trim() || undefined,
  };
}

function normalizeStageTemplateStrategy(value: unknown): StageTemplateStrategyDraft {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    onBlockedTemplateId:
      typeof record.onBlockedTemplateId === "string" ? record.onBlockedTemplateId : "",
    onWaitingApprovalTemplateId:
      typeof record.onWaitingApprovalTemplateId === "string"
        ? record.onWaitingApprovalTemplateId
        : "",
    note: typeof record.note === "string" ? record.note : "",
  };
}

function serializeStageTemplateStrategy(stageTemplateStrategy: StageTemplateStrategyDraft) {
  if (
    !stageTemplateStrategy.onBlockedTemplateId.trim() &&
    !stageTemplateStrategy.onWaitingApprovalTemplateId.trim() &&
    !stageTemplateStrategy.note.trim()
  ) {
    return undefined;
  }

  return {
    onBlockedTemplateId: stageTemplateStrategy.onBlockedTemplateId.trim() || undefined,
    onWaitingApprovalTemplateId:
      stageTemplateStrategy.onWaitingApprovalTemplateId.trim() || undefined,
    note: stageTemplateStrategy.note.trim() || undefined,
  };
}

function toStageMode(value: unknown): StageDraft["mode"] {
  if (value === "pipeline") {
    return "sequential-chain";
  }
  return value === "parallel" || value === "sequential-chain" ? value : "single";
}

function setStageMode(stage: StageDraft, value: unknown) {
  stage.mode = toStageMode(value);
}

function setNewStageMode(value: unknown) {
  newStage.mode = toStageMode(value);
}

function setEntryCriteria(stage: StageDraft, value: unknown) {
  stage.entryCriteria = fromMultiline(value);
}

function setExitCriteria(stage: StageDraft, value: unknown) {
  stage.exitCriteria = fromMultiline(value);
}

function addGate(stage: StageDraft) {
  stage.gates.push({
    key: `gate-${crypto.randomUUID()}`,
    name: "",
    type: "quality",
    required: true,
    evaluatorRole: "",
    description: "",
  });
}

function removeGate(stage: StageDraft, index: number) {
  stage.gates.splice(index, 1);
}

function addApproval(stage: StageDraft) {
  stage.approvals.push({
    key: `approval-${crypto.randomUUID()}`,
    name: "",
    approverRole: "",
    required: true,
    note: "",
  });
}

function removeApproval(stage: StageDraft, index: number) {
  stage.approvals.splice(index, 1);
}

function clonePresetGate(gate: GateDraft, index: number): GateDraft {
  return {
    ...gate,
    key: `${gate.key}-${index}-${crypto.randomUUID()}`,
  };
}

function clonePresetApproval(approval: ApprovalDraft, index: number): ApprovalDraft {
  return {
    ...approval,
    key: `${approval.key}-${index}-${crypto.randomUUID()}`,
  };
}

function stagePresetOptions(stage: StageDraft) {
  return stagePresets.filter((preset) => preset.stageKey === stage.stageKey);
}

function applyStagePreset(stage: StageDraft, presetKey: string) {
  const preset = stagePresets.find(
    (item) => item.key === presetKey && item.stageKey === stage.stageKey,
  );
  if (!preset) {
    return;
  }

  stage.entryCriteria = [...preset.entryCriteria];
  stage.exitCriteria = [...preset.exitCriteria];
  stage.gates = preset.gates.map((gate, index) => clonePresetGate(gate, index));
  stage.approvals = preset.approvals.map((approval, index) => clonePresetApproval(approval, index));
  stage.failurePolicy = { ...preset.failurePolicy };
  message.success(`已应用 ${preset.label} 预设`);
}

function normalizeStageDrafts() {
  stageDrafts.value = [...stageDrafts.value].map((stage, index) => ({
    ...stage,
    orderIndex: index,
  }));
}

function stageCatalogLabel(stageKey: string) {
  return editorView.value?.stageCatalog.find((item) => item.key === stageKey)?.label || stageKey;
}

function populateEditor(view: WorkflowTemplateEditorView) {
  editorView.value = view;
  templateForm.name = view.template?.name || "";
  templateForm.description = view.template?.description || "";
  templateForm.category = view.template?.category || "";
  templateForm.enabled = view.template?.enabled ?? true;
  templateForm.selectableByProjects = view.template?.selectableByProjects ?? true;
  templateForm.defaultRoles = [...(view.template?.defaultRolesJson || [])];
  templateForm.defaultCollaborationMode = view.template?.defaultCollaborationMode || "";
  templateForm.defaultAutopilotLevel = view.template?.defaultAutopilotLevel || "";
  templateForm.defaultBossParticipationMode = view.template?.defaultBossParticipationMode || "";
  templateForm.forceBossParticipation = view.template?.forceBossParticipation ?? false;
  stageDrafts.value = [...view.stages]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((stage) => ({
      id: stage.id,
      stageKey: stage.stageKey,
      name: stage.name,
      enabled: stage.enabled,
      mode: stage.mode,
      primaryRoleAgentId: stage.primaryRoleAgentId,
      participantRoleAgentIds: [...stage.participantRoleAgentIdsJson],
      entryCriteria: toStringArray(stage.entryCriteriaJson),
      exitCriteria: toStringArray(stage.exitCriteriaJson),
      initialTaskDefinition: normalizeInitialTaskDefinition(
        stage.initialTaskDefinitionJson,
        stage.stageKey,
        stage.name,
      ),
      gates: Array.isArray(stage.gatesJson)
        ? stage.gatesJson.map((item, index) => normalizeGate(item, index))
        : [],
      approvals: Array.isArray(stage.approvalsJson)
        ? stage.approvalsJson.map((item, index) => normalizeApproval(item, index))
        : [],
      stageTemplateStrategy: normalizeStageTemplateStrategy(stage.stageTemplateStrategyJson),
      failurePolicy: normalizeFailurePolicy(stage.failurePolicyJson),
      orderIndex: stage.orderIndex,
    }));
  newStage.stageKey = "";
  newStage.name = "";
  newStage.enabled = true;
  newStage.mode = "single";
  newStage.primaryRoleAgentId = view.availableRoles[0]?.id || "";
  newStage.participantRoleAgentIds = [];
  newStage.initialTaskDefinition = createDefaultInitialTaskDefinition("", "");
  newStage.stageTemplateStrategy = {
    onBlockedTemplateId: "",
    onWaitingApprovalTemplateId: "",
    note: "",
  };
}

async function loadEditor() {
  const view = await getWorkflowTemplateEditorView(String(route.params.templateId));
  populateEditor(view);
}

async function syncTemplateStageOrder() {
  const templateId = editorView.value?.template?.id;
  if (!templateId) {
    return;
  }

  await updateWorkflowTemplate(templateId, {
    stageOrder: stageDrafts.value.map((stage) => stage.stageKey),
  });
}

async function saveTemplate() {
  const templateId = editorView.value?.template?.id;
  if (!templateId || !templateForm.name.trim()) {
    message.error("模板名称不能为空");
    return;
  }

  savingTemplate.value = true;
  try {
    await updateWorkflowTemplate(templateId, {
      name: templateForm.name.trim(),
      description: templateForm.description.trim(),
      category: templateForm.category.trim(),
      enabled: templateForm.enabled,
      selectableByProjects: templateForm.selectableByProjects,
      defaultCollaborationMode: asTemplateCollaborationMode(templateForm.defaultCollaborationMode),
      defaultAutopilotLevel: asTemplateAutopilotLevel(templateForm.defaultAutopilotLevel),
      defaultBossParticipationMode: templateForm.forceBossParticipation
        ? "full-manager"
        : asTemplateBossParticipationMode(templateForm.defaultBossParticipationMode),
      forceBossParticipation: templateForm.forceBossParticipation,
      defaultRoles: templateForm.defaultRoles,
      stageOrder: stageDrafts.value.map((stage) => stage.stageKey),
    });
    await loadEditor();
    message.success("模板已保存");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "模板保存失败");
  } finally {
    savingTemplate.value = false;
  }
}

function handleStageKeyChange(stage: StageDraft) {
  if (!stage.name.trim()) {
    stage.name = stageCatalogLabel(stage.stageKey);
  }
  if (!stage.initialTaskDefinition.titleTemplate.trim()) {
    stage.initialTaskDefinition = normalizeInitialTaskDefinition(
      undefined,
      stage.stageKey,
      stage.name,
    );
  }
}

function handleNewStageKeyChange() {
  if (!newStage.name.trim()) {
    newStage.name = stageCatalogLabel(newStage.stageKey);
  }
  newStage.initialTaskDefinition = normalizeInitialTaskDefinition(
    undefined,
    newStage.stageKey,
    newStage.name,
  );
}

async function saveStage(stage: StageDraft, index: number) {
  const templateId = editorView.value?.template?.id;
  if (!templateId) {
    return;
  }
  if (!stage.stageKey.trim() || !stage.name.trim() || !stage.primaryRoleAgentId.trim()) {
    message.error("阶段 Key、名称和主责角色不能为空");
    return;
  }

  const duplicateCount = stageDrafts.value.filter(
    (item) => item.stageKey === stage.stageKey,
  ).length;
  if (duplicateCount > 1) {
    message.error(`阶段 Key ${stage.stageKey} 重复`);
    return;
  }

  const initialTaskValidation = validateInitialTaskDefinition(stage.initialTaskDefinition);
  if (initialTaskValidation) {
    message.error(initialTaskValidation);
    return;
  }

  stage.saving = true;
  try {
    await updateWorkflowTemplateStage(templateId, stage.id, {
      stageKey: stage.stageKey,
      name: stage.name.trim(),
      enabled: stage.enabled,
      mode: stage.mode,
      primaryRoleAgentId: stage.primaryRoleAgentId,
      participantRoleAgentIds: stage.participantRoleAgentIds,
      entryCriteria: stage.entryCriteria,
      exitCriteria: stage.exitCriteria,
      initialTaskDefinition: serializeInitialTaskDefinition(stage.initialTaskDefinition),
      gates: serializeGates(stage.gates),
      approvals: serializeApprovals(stage.approvals),
      stageTemplateStrategy: serializeStageTemplateStrategy(stage.stageTemplateStrategy),
      failurePolicy: serializeFailurePolicy(stage.failurePolicy),
      orderIndex: index,
    });
    normalizeStageDrafts();
    await syncTemplateStageOrder();
    await loadEditor();
    message.success("阶段已保存");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "阶段保存失败");
  } finally {
    stage.saving = false;
  }
}

async function persistStageOrder() {
  const templateId = editorView.value?.template?.id;
  if (!templateId) {
    return;
  }

  normalizeStageDrafts();
  await Promise.all(
    stageDrafts.value.map((stage, index) =>
      updateWorkflowTemplateStage(templateId, stage.id, {
        orderIndex: index,
      }),
    ),
  );
  await syncTemplateStageOrder();
}

async function moveStage(index: number, delta: number) {
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= stageDrafts.value.length) {
    return;
  }

  const next = [...stageDrafts.value];
  const current = next[index];
  next[index] = next[targetIndex];
  next[targetIndex] = current;
  stageDrafts.value = next;

  reordering.value = true;
  try {
    await persistStageOrder();
    await loadEditor();
    message.success("阶段顺序已更新");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "阶段排序失败");
    await loadEditor();
  } finally {
    reordering.value = false;
  }
}

async function removeStage(stageId: string) {
  const templateId = editorView.value?.template?.id;
  if (!templateId) {
    return;
  }
  if (!window.confirm("确认删除该阶段？")) {
    return;
  }

  const stage = stageDrafts.value.find((item) => item.id === stageId);
  if (!stage) {
    return;
  }

  stage.deleting = true;
  try {
    await deleteWorkflowTemplateStage(templateId, stageId);
    stageDrafts.value = stageDrafts.value.filter((item) => item.id !== stageId);
    await persistStageOrder();
    await loadEditor();
    message.success("阶段已删除");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "阶段删除失败");
  } finally {
    stage.deleting = false;
  }
}

async function addStage() {
  const templateId = editorView.value?.template?.id;
  if (!templateId) {
    return;
  }
  if (!newStage.stageKey.trim() || !newStage.name.trim() || !newStage.primaryRoleAgentId.trim()) {
    message.error("新增阶段需要填写阶段 Key、名称和主责角色");
    return;
  }
  if (stageDrafts.value.some((item) => item.stageKey === newStage.stageKey)) {
    message.error(`阶段 Key ${newStage.stageKey} 已存在`);
    return;
  }

  const initialTaskValidation = validateInitialTaskDefinition(newStage.initialTaskDefinition);
  if (initialTaskValidation) {
    message.error(initialTaskValidation);
    return;
  }

  creatingStage.value = true;
  try {
    await createWorkflowTemplateStage(templateId, {
      id: `${templateId}.${newStage.stageKey}.${crypto.randomUUID()}`,
      stageKey: newStage.stageKey,
      name: newStage.name.trim(),
      enabled: newStage.enabled,
      mode: newStage.mode,
      primaryRoleAgentId: newStage.primaryRoleAgentId,
      participantRoleAgentIds: newStage.participantRoleAgentIds,
      initialTaskDefinition: serializeInitialTaskDefinition(newStage.initialTaskDefinition),
      stageTemplateStrategy: serializeStageTemplateStrategy(newStage.stageTemplateStrategy),
      orderIndex: stageDrafts.value.length,
    });
    await loadEditor();
    await syncTemplateStageOrder();
    message.success("阶段已新增");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "新增阶段失败");
  } finally {
    creatingStage.value = false;
  }
}

onMounted(async () => {
  try {
    await loadEditor();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "模板编辑视图加载失败";
  } finally {
    loading.value = false;
  }
});
</script>