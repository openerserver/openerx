<template>
  <div :style="pageStyle">
    <a-flex v-if="!isReplyFocusMode" justify="space-between" align="flex-start" :style="taskDetailThemeStyles.header">
      <div>
        <a-typography-title :level="3" :style="taskDetailThemeStyles.title">
          {{ task?.title || "任务工作台" }}
        </a-typography-title>
        <a-space size="small" :style="taskDetailThemeStyles.statusTags">
          <a-tag :color="taskStatusColor(task?.status)">{{ taskStatusLabel(task?.status) }}</a-tag>
          <a-tag v-if="taskId" color="default">任务 {{ taskId.slice(0, 8) }}</a-tag>
          <a-tag v-if="selectedSession" color="blue">当前分支 {{ selectedSessionLabel(selectedSession) }}</a-tag>
          <a-tag v-if="task?.selectedModel" color="cyan">{{ task.selectedModel }}</a-tag>
        </a-space>
      </div>
      <a-space direction="vertical" align="end" size="small">
        <router-link
          v-if="taskId"
          :to="{
            path: '/agents',
            query: {
              entryContext: 'task',
              focus: 'attention',
              taskId,
              ...(task?.projectId ? { projectId: task.projectId } : {}),
              ...(task?.agentRunId ? { agentRunId: task.agentRunId } : {}),
              ...(governance?.approvalRequired ? { approvalBlocked: 'true' } : {}),
              ...(governance && governance.overallRisk !== 'low' ? { riskLevel: governance.overallRisk } : {}),
            },
          }"
        >
          <a-button>查看 Agent 运行</a-button>
        </router-link>
        <router-link v-if="taskId && !isWorkbenchEmbedded" :to="`/workbench?task=${taskId}`">
          <a-button type="primary">在工作台打开</a-button>
        </router-link>
        <a-button
          v-if="taskId && selectedSessionId && isWorkbenchEmbedded"
          :loading="forking"
          :disabled="task?.status === 'running'"
          @click="handleForkToSecondary"
        >从当前分支分叉到副窗</a-button>
      </a-space>
    </a-flex>

    <a-card
      v-if="showEmbeddedGraphSummary && !isReplyFocusMode"
      size="small"
      :body-style="taskDetailThemeStyles.graphSummaryBody"
      :style="taskDetailThemeStyles.graphSummaryCard"
    >
      <a-flex justify="space-between" align="flex-start" :style="taskDetailThemeStyles.graphSummaryHeader">
        <div>
          <div :style="taskDetailThemeStyles.graphSummaryTitle">任务图摘要</div>
          <a-typography-text type="secondary" :style="taskDetailThemeStyles.graphSummaryText">
            {{ latestTaskEvent ? `最近事件：${latestTaskEventTypeLabel}` : '任务运行后会在这里显示流程摘要' }}
          </a-typography-text>
        </div>
        <a-space size="small" wrap>
          <a-tag :color="taskStatusColor(task?.status)">{{ taskStatusLabel(task?.status) }}</a-tag>
          <a-tag v-if="taskEvents.length" color="blue">事件 {{ taskEvents.length }}</a-tag>
          <a-tag v-if="agentRuns.length" color="geekblue">活跃 Agent {{ activeAgentCount }}/{{ agentRuns.length }}</a-tag>
          <a-tag v-if="latestTaskEvent?.ts" color="default">{{ formatTime(latestTaskEvent.ts) }}</a-tag>
        </a-space>
      </a-flex>
    </a-card>

    <a-row :gutter="[16, 16]" align="top">
      <a-col v-if="!isReplyFocusMode" :xs="24" :xxl="5">
        <a-collapse
          size="small"
          :default-active-key="[
            'sessions',
            ...(showOrchestrationPanel ? ['orchestration'] : []),
            ...(showPipelinePanel && pipelineStages.length > 0 ? ['pipeline'] : []),
          ]"
          :style="taskDetailThemeStyles.collapse"
        >
          <a-collapse-panel key="sessions" header="分支 / 会话">
            <template v-if="sessionTree.length > 0">
              <SessionTree
                :tree="sessionTree"
                :selected-session-id="selectedSessionId"
                :task-status="task?.status"
                @select="selectSession"
                @activate="handleActivateSession"
                @fork="handleForkFromSession"
                @archive="handleArchiveSession"
              />
            </template>
            <template v-else-if="sessions.length > 0">
              <div :style="taskDetailThemeStyles.sessionsList">
                <div
                  v-for="session in sessions"
                  :key="session.id"
                  @click="selectSession(session.id)"
                  :style="sessionCardStyle(session.id === selectedSessionId)"
                >
                  <a-flex justify="space-between" align="flex-start" :style="taskDetailThemeStyles.sessionHeader">
                    <div :style="taskDetailThemeStyles.sessionMetaBlock">
                      <div :style="taskDetailThemeStyles.sessionTitle">
                        {{ selectedSessionLabel(session) }}
                      </div>
                      <a-typography-text type="secondary" :style="taskDetailThemeStyles.sessionMeta">
                        {{ formatTime(session.updatedAt || session.createdAt || "") }}
                      </a-typography-text>
                    </div>
                    <a-tag :color="session.isActive ? 'blue' : 'default'">
                      {{ session.isActive ? "当前" : "历史" }}
                    </a-tag>
                  </a-flex>
                  <div :style="taskDetailThemeStyles.sessionExcerptWrap">
                    <a-typography-paragraph
                      :content="session.title || session.id"
                      :ellipsis="{ rows: 2 }"
                      :style="taskDetailThemeStyles.sessionExcerpt"
                    />
                  </div>
                  <a-typography-text type="secondary" :style="taskDetailThemeStyles.sessionSummary">
                    {{ sessionSummaryLabel(session.summary) }}
                  </a-typography-text>
                </div>
              </div>
            </template>
            <div v-else-if="isWorkbenchEmbedded" :style="taskDetailThemeStyles.compactEmptyState">
              <a-typography-text type="secondary" :style="taskDetailThemeStyles.compactEmptyText">暂无会话</a-typography-text>
            </div>
            <a-empty v-else description="暂无会话" />
          </a-collapse-panel>

          <a-collapse-panel v-if="showOrchestrationPanel && !useCompactInspector" key="orchestration" header="编排决策">
            <div v-if="orchestrationSummaryItems.length > 0" class="reply-composer-shell__summary-inline">
              <div class="reply-composer-shell__summary-inline-list">
                <span
                  v-for="item in orchestrationSummaryItems"
                  :key="item.label"
                  class="reply-composer-shell__summary-chip"
                >
                  <span class="reply-composer-shell__summary-chip-label">{{ item.label }}</span>
                  <a-tag v-if="item.tone" :color="item.tone">{{ item.value }}</a-tag>
                  <span v-else class="reply-composer-shell__summary-chip-value">{{ item.value }}</span>
                </span>
              </div>
            </div>
            <a-empty v-else description="暂无编排数据" />
          </a-collapse-panel>

          <a-collapse-panel v-if="showPipelinePanel && !useCompactInspector" key="pipeline" header="运行流水线">
            <a-empty v-if="pipelineStages.length === 0" description="暂无运行数据" />
            <template v-else>
              <div v-if="runtimePipelineSummaryItems.length > 0" class="reply-composer-shell__summary-inline">
                <div class="reply-composer-shell__summary-inline-list">
                  <span
                    v-for="item in runtimePipelineSummaryItems"
                    :key="item.label"
                    class="reply-composer-shell__summary-chip"
                  >
                    <span class="reply-composer-shell__summary-chip-label">{{ item.label }}</span>
                    <a-tag v-if="item.tone" :color="item.tone">{{ item.value }}</a-tag>
                    <span v-else class="reply-composer-shell__summary-chip-value">{{ item.value }}</span>
                  </span>
                </div>
              </div>
              <a-steps :current="pipelineCurrentStep" size="small" direction="vertical">
                <a-step
                  v-for="stage in pipelineStages"
                  :key="stage.id"
                  :title="stage.label"
                  :description="pipelineStageDescription(stage)"
                  :status="pipelineStepStatus(stage.status)"
                />
              </a-steps>
              <a-collapse v-if="pipelineOutputStages.length > 0" size="small" :style="taskDetailThemeStyles.pipelineOutputs">
                <a-collapse-panel
                  v-for="stage in pipelineOutputStages"
                  :key="stage.id"
                  :header="pipelineOutputPanelHeader(stage)"
                >
                  <pre :style="taskDetailThemeStyles.pipelineOutputPre">{{ stage.error || stage.output }}</pre>
                </a-collapse-panel>
              </a-collapse>
            </template>
          </a-collapse-panel>
        </a-collapse>
      </a-col>

      <a-col :xs="24" :xxl="mainContentColSpan">
        <a-card size="small" :body-style="taskDetailThemeStyles.mainBody" :style="taskDetailThemeStyles.mainCard">
          <template v-if="!isReplyFocusMode" #title>
            <a-flex justify="space-between" align="center" :style="taskDetailThemeStyles.mainHeader">
              <div>
                <div :style="taskDetailThemeStyles.mainHeaderTitle">回复主视图</div>
                <a-typography-text v-if="selectedSession" type="secondary" :style="taskDetailThemeStyles.selectedSessionHint">
                  {{ selectedSessionLabel(selectedSession) }}
                </a-typography-text>
              </div>
              <a-space size="small">
                <a-button
                  v-if="taskId && !isReplyFocusMode"
                  type="text"
                  size="small"
                  @click="openReplyFocusWindow"
                >独立窗口</a-button>
                <a-tag v-if="selectedSession?.isActive" color="blue">活跃分支</a-tag>
                <a-tag v-if="isAwaitingAssistantResponse" color="processing">执行中</a-tag>
              </a-space>
            </a-flex>
          </template>

          <div ref="messagesPaneRef" :style="messagesPaneStyle">
            <div v-if="!selectedSessionId && isWorkbenchEmbedded" :style="taskDetailThemeStyles.compactMainEmptyState">
              <a-typography-text type="secondary" :style="taskDetailThemeStyles.compactMainEmptyText">
                请选择分支
              </a-typography-text>
            </div>
            <a-empty v-else-if="!selectedSessionId" description="请选择分支" />
            <a-spin v-else-if="messagesLoading" />
            <a-empty v-else-if="sessionMessageItems.length === 0" description="当前分支还没有可展示的消息" />
            <div v-else :style="taskDetailThemeStyles.messageList">
              <div
                v-for="item in sessionMessageItems"
                :key="item.key"
                :style="messageCardStyle(item.role)"
              >
                <a-flex justify="space-between" align="center" :style="taskDetailThemeStyles.messageHeader">
                  <a-space size="small" wrap>
                    <a-tag :color="messageRoleColor(item.role)">{{ messageRoleLabel(item.role) }}</a-tag>
                    <a-tag v-if="item.agent" color="geekblue">{{ formatAgentLabel(item.agent) }}</a-tag>
                    <a-tag v-if="item.isPending" color="gold" class="message-state-tag message-state-tag--pending">等待中</a-tag>
                    <a-tag v-if="item.isStreaming" color="processing" class="message-state-tag message-state-tag--streaming">生成中</a-tag>
                  </a-space>
                  <a-space size="small">
                    <a-button
                      v-if="item.text && !item.isPending"
                      type="text"
                      size="small"
                      :style="{ opacity: 0.6 }"
                      @click="handleCopyMessage(item.text)"
                    >
                      <template #icon><CopyOutlined /></template>
                    </a-button>
                    <a-button
                      v-if="item.text && !item.isPending"
                      type="text"
                      size="small"
                      :style="{ opacity: 0.6 }"
                      @click="handleQuoteToInput(item.text)"
                    >
                      <template #icon><EnterOutlined /></template>
                    </a-button>
                    <a-button
                      v-if="selectedSessionId && task?.status !== 'running' && !item.isPending"
                      type="text"
                      size="small"
                      :loading="forkingMessageId === item.key"
                      :disabled="!!forkingMessageId"
                      :style="{ opacity: 0.6 }"
                      @click="handleForkFromMessage(item.key)"
                    >
                      <template #icon><BranchesOutlined /></template>
                      从这里分叉
                    </a-button>
                    <a-typography-text type="secondary" :style="taskDetailThemeStyles.itemTime">
                      {{ formatTime(item.createdAt || "") }}
                    </a-typography-text>
                  </a-space>
                </a-flex>

                <div
                  v-if="messageDisplayText(item)"
                  class="message-markdown"
                  :style="taskDetailThemeStyles.messagePre"
                  v-html="renderMarkdown(messageDisplayText(item) || '')"
                />

                <ConfirmationForm
                  v-if="getConfirmationBlock(item)"
                  :block="getConfirmationBlockNonNull(item)"
                  @submit="handleConfirmationSubmit"
                />

                <div
                  v-if="!messageDisplayText(item) && shouldShowStreamingSkeleton(item)"
                  class="streaming-skeleton"
                  :style="taskDetailThemeStyles.messagePre"
                  aria-label="等待首字节"
                >
                  <div class="streaming-skeleton__inline" aria-hidden="true">
                    <span class="streaming-skeleton__inline-dot">.</span>
                    <span class="streaming-skeleton__inline-dot">.</span>
                    <span class="streaming-skeleton__inline-dot">.</span>
                    <span class="streaming-skeleton__inline-dot">.</span>
                  </div>
                </div>

                <div v-if="item.toolCalls.length" :style="taskDetailThemeStyles.toolSummaryList">
                  <div
                    class="tool-fold-header"
                    @click="toggleToolFold(item.key)"
                  >
                    <span>{{ toolFoldExpanded[item.key] ? '▾' : '▸' }} {{ toolGroupTitle(item.toolCalls) }}</span>
                  </div>
                  <template v-if="toolFoldExpanded[item.key]">
                    <div
                      v-for="tool in item.toolCalls.slice(0, toolShowAll[item.key] ? undefined : 2)"
                      :key="tool.key"
                      :style="taskDetailThemeStyles.toolCallCard"
                    >
                      <a-flex justify="space-between" align="start" :style="taskDetailThemeStyles.toolCallHeader">
                        <div :style="taskDetailThemeStyles.toolCallTitleGroup">
                          <a-space size="small" wrap>
                            <strong>{{ tool.label }}</strong>
                            <a-tag :color="tool.stateColor">{{ tool.stateLabel }}</a-tag>
                            <a-tag v-if="tool.exitCode !== undefined" :color="tool.exitCode === 0 ? 'green' : 'red'">
                              exit {{ tool.exitCode }}
                            </a-tag>
                          </a-space>
                          <div v-if="tool.headline" :style="taskDetailThemeStyles.toolCallHeadline">{{ tool.headline }}</div>
                        </div>
                        <a-space size="small" :style="taskDetailThemeStyles.toolCallActions">
                          <a-button
                            v-if="tool.outputTruncated"
                            type="text"
                            size="small"
                            @click="toggleToolOutput(tool.key)"
                          >
                            {{ toolOutputExpanded[tool.key] ? '收起输出' : '展开完整输出' }}
                          </a-button>
                          <a-button
                            type="text"
                            size="small"
                            @click="handleCopyToolRaw(tool)"
                          >
                            <template #icon><CopyOutlined /></template>
                            复制原始内容
                          </a-button>
                        </a-space>
                      </a-flex>
                      <div v-if="tool.kind === 'bash' && tool.command" :style="taskDetailThemeStyles.toolCallSection">
                        <div :style="taskDetailThemeStyles.toolCallSectionLabel">命令</div>
                        <pre :style="taskDetailThemeStyles.toolCallCommand">{{ tool.command }}</pre>
                      </div>
                      <div v-if="tool.kind === 'read' && tool.filePath" :style="taskDetailThemeStyles.toolCallSection">
                        <div :style="taskDetailThemeStyles.toolCallSectionLabel">文件路径</div>
                        <pre :style="taskDetailThemeStyles.toolCallPath">{{ tool.filePath }}</pre>
                      </div>
                      <div v-if="tool.kind === 'read' && tool.readPreview" :style="taskDetailThemeStyles.toolCallSection">
                        <div :style="taskDetailThemeStyles.toolCallSectionLabel">内容摘要</div>
                        <pre :style="taskDetailThemeStyles.toolCallCode">{{ tool.readPreview }}</pre>
                      </div>
                      <div v-if="tool.description" :style="taskDetailThemeStyles.toolCallMeta">{{ tool.description }}</div>
                      <div v-if="tool.goal" :style="taskDetailThemeStyles.toolCallMeta">目标：{{ tool.goal }}</div>
                      <div v-if="tool.inputPreview && tool.kind !== 'bash' && tool.kind !== 'read'" :style="taskDetailThemeStyles.toolCallSection">
                        <div :style="taskDetailThemeStyles.toolCallSectionLabel">输入</div>
                        <pre :style="taskDetailThemeStyles.toolCallCode">{{ tool.inputPreview }}</pre>
                      </div>
                      <div v-if="tool.outputPreview" :style="taskDetailThemeStyles.toolCallSection">
                        <div :style="taskDetailThemeStyles.toolCallSectionLabel">输出</div>
                        <pre :style="taskDetailThemeStyles.toolCallCode">{{ toolDisplayOutput(tool) }}</pre>
                        <div v-if="tool.outputTruncated" :style="taskDetailThemeStyles.toolCallMoreHint">
                          {{ toolOutputExpanded[tool.key] ? '当前显示完整输出' : '输出已截断，可展开查看完整内容' }}
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="item.toolCalls.length > 2 && !toolShowAll[item.key]"
                      class="tool-fold-header"
                      :style="{ fontSize: '12px', paddingTop: '2px' }"
                      @click.stop="toolShowAll[item.key] = true"
                    >
                      … 还有 {{ item.toolCalls.length - 2 }} 个工具
                    </div>
                  </template>
                </div>
              </div>
              <div ref="messageListEndRef"></div>
            </div>
          </div>

          <div :style="composerStyle">
            <div class="reply-composer-shell">
              <a-textarea
                class="reply-composer-shell__textarea"
                :value="continuePrompt"
                :auto-size="{ minRows: composerRows, maxRows: composerMaxRows }"
                :maxlength="50000"
                placeholder="描述下一步要构建的内容"
                :disabled="!selectedSessionId"
                :bordered="false"
                @keydown="handleComposerKeydown"
                @update:value="continuePrompt = String($event ?? '')"
              />

              <div class="reply-composer-shell__footer">
                <div class="reply-composer-shell__toolbar">
                  <a-select
                    class="reply-composer-model-select"
                    :value="task?.selectedModel || undefined"
                    :options="modelOptions"
                    placeholder="默认模型"
                    size="small"
                    show-search
                    allow-clear
                    :filter-option="filterModelOption"
                    :disabled="!taskId || task?.status === 'running' || updatingSelectedModel"
                    :loading="modelsLoading || updatingSelectedModel"
                    @focus="handleModelPickerFocus"
                    @update:value="handleSelectedModelChange"
                  />
                  <button
                    type="button"
                    class="reply-composer-pill reply-composer-pill--icon"
                    :disabled="!taskId || task?.status === 'running' || modelsLoading || updatingSelectedModel"
                    title="刷新模型列表"
                    @click="handleRefreshModels"
                  >
                    <span aria-hidden="true">⟲</span>
                  </button>
                </div>

                <div class="reply-composer-shell__actions">
                  <span v-if="isAwaitingAssistantResponse" class="reply-composer-shell__hint composer-waiting-hint">
                    当前任务执行中，先等待本轮输出完成。
                  </span>
                  <span v-else class="reply-composer-shell__counter">{{ continuePrompt.length }} / 50000</span>

                  <button
                    v-if="taskId && selectedSessionId && !isWorkbenchEmbedded"
                    type="button"
                    class="reply-composer-action reply-composer-action--icon"
                    :disabled="isAwaitingAssistantResponse"
                    title="副窗分叉"
                    @click="handleForkToSecondary"
                  >
                    <span aria-hidden="true">⑂</span>
                  </button>

                  <button
                    v-if="taskId && selectedSessionId"
                    type="button"
                    class="reply-composer-action"
                    :disabled="!canContinueCurrentSession"
                    @click="handleForkAndRun"
                  >
                    {{ forkAndRunning ? '处理中' : '分叉' }}
                  </button>

                  <button type="button" class="reply-composer-round reply-composer-round--ghost" :disabled="true" aria-label="语音输入">
                    <span aria-hidden="true">◉</span>
                  </button>

                  <button
                    type="button"
                    class="reply-composer-round reply-composer-round--send"
                    :disabled="!canContinueCurrentSession"
                    @click="handleContinue"
                    aria-label="继续当前分支"
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </a-card>
      </a-col>

      <a-col v-if="showSidebar" :xs="24" :xxl="sidebarColSpan">
        <a-space direction="vertical" :style="taskDetailThemeStyles.sidebar" :size="16">
          <a-collapse size="small" :default-active-key="taskDetailDefaultActivePanels" :style="taskDetailThemeStyles.collapse">
            <a-collapse-panel v-if="showGraphPanel && !useCompactInspector" key="graph" header="任务图">
              <a-card size="small" :bordered="false" :style="taskDetailThemeStyles.graphCard">
                <div :style="taskDetailThemeStyles.graphWrap">
                  <TaskGraph :task-id="taskId || ''" :events="taskEvents" :fallback-status="task?.status" />
                </div>
              </a-card>
            </a-collapse-panel>

            <a-collapse-panel v-if="showContextPanel" key="context" header="代码上下文">
              <a-descriptions v-if="task?.repoId" :column="1" bordered size="small">
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
              <a-empty v-else description="暂无代码上下文" />
            </a-collapse-panel>

            <a-collapse-panel v-if="showChangesPanel" key="changes" header="代码变更">
              <TaskCodeChanges v-if="taskId" :task-id="taskId" />
            </a-collapse-panel>

            <a-collapse-panel v-if="showGovernancePanel" key="governance" header="治理评估">
              <a-spin v-if="governanceLoading" />
              <a-empty v-else-if="!governance" description="暂无治理数据" />
              <div v-else>
                <a-descriptions :column="1" bordered size="small">
                  <a-descriptions-item label="风险等级">
                    <a-tag :color="riskColor(governance.overallRisk)">{{ riskLabel(governance.overallRisk) }}</a-tag>
                  </a-descriptions-item>
                  <a-descriptions-item label="需要审批">
                    <a-tag :color="governance.approvalRequired ? 'red' : 'green'">
                      {{ governance.approvalRequired ? '是' : '否' }}
                    </a-tag>
                  </a-descriptions-item>
                </a-descriptions>
                <div v-if="governance.violations.length > 0" :style="taskDetailThemeStyles.governanceViolations">
                  <a-typography-text strong>命中规则</a-typography-text>
                  <div style="margin: 8px 0 12px 0">
                    <router-link
                      v-if="taskId"
                      :to="{
                        path: '/agents',
                        query: {
                          entryContext: 'task',
                          focus: 'attention',
                          taskId,
                          ...(task?.projectId ? { projectId: task.projectId } : {}),
                          ...(task?.agentRunId ? { agentRunId: task.agentRunId } : {}),
                          ...(governance.approvalRequired ? { approvalBlocked: 'true' } : {}),
                          ...(governance.overallRisk !== 'low' ? { riskLevel: governance.overallRisk } : {}),
                        },
                      }"
                    >
                      <a-button size="small">带筛选查看 Agent</a-button>
                    </router-link>
                  </div>
                  <a-list size="small" :data-source="governance.violations" :style="taskDetailThemeStyles.governanceList">
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-tag :color="riskColor(item.level)">{{ item.level }}</a-tag>
                        <a-typography-text strong>{{ item.ruleName }}</a-typography-text>
                      </a-list-item>
                    </template>
                  </a-list>
                </div>
              </div>
            </a-collapse-panel>

            <a-collapse-panel v-if="showProjectRoleConfigPanel" key="project-role-config" header="项目角色配置">
              <TaskProjectRoleConfigPanel
                v-if="task?.projectId"
                :loading="projectRoleConfigLoading"
                :error="projectRoleConfigError"
                :project-id="task.projectId"
                :rows="projectRoleConfigRows"
                :current-stage="workflowSummary?.currentStage"
                :active-role-agent-ids="activeRoleAgentIds"
              />
            </a-collapse-panel>

            <a-collapse-panel v-if="showRoleWorkflowPanel" key="role-workflow" header="角色实际介入记录">
              <TaskRoleWorkflowPanel
                :loading="workflowViewLoading"
                :error="workflowViewError"
                :workflow-summary="workflowSummary"
                :workflow-stages="workflowStages"
                :role-conclusions="roleConclusions"
                :developer-change-requests="developerChangeRequests"
                :updating-request-ids="updatingChangeRequestIds"
                @request-status-change="handleRoleWorkflowRequestStatusChange"
              />
            </a-collapse-panel>

            <a-collapse-panel v-if="showHooksPanel" key="hooks" header="Hook 执行记录">
              <a-table
                :data-source="strategy?.hookExecutions || []"
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
                    <a-tag color="blue">{{ formatAgentLabel(record.agent) }}</a-tag>
                  </template>
                  <template v-else-if="column.dataIndex === 'result'">
                    <a-typography-text v-if="record.error" type="danger">{{ record.error }}</a-typography-text>
                    <a-typography-paragraph
                      v-else-if="record.result"
                      :ellipsis="{ rows: 2, expandable: true }"
                      :content="record.result"
                      :style="taskDetailThemeStyles.hookResult"
                    />
                    <span v-else>-</span>
                  </template>
                  <template v-else-if="column.dataIndex === 'decision'">
                    <template v-if="record.decision">
                      <a-tag :color="record.decision.action === 'allow' ? 'green' : record.decision.action === 'rewrite-prompt' ? 'orange' : 'red'">{{ record.decision.action }}</a-tag>
                    </template>
                    <span v-else>-</span>
                  </template>
                </template>
              </a-table>
            </a-collapse-panel>

            <a-collapse-panel v-if="showEventsPanel && !useCompactInspector" key="events" header="任务事件">
              <a-empty v-if="taskEvents.length === 0" description="暂无任务事件" />
              <a-table
                v-else
                :data-source="displayedTaskEvents"
                :columns="eventColumns"
                :pagination="false"
                size="small"
                row-key="tableKey"
                :scroll="taskDetailEventTableScroll"
              />
            </a-collapse-panel>
          </a-collapse>
        </a-space>
      </a-col>
    </a-row>

    <div v-if="useCompactInspector && !isReplyFocusMode && compactInspectorTabs.length > 0" class="compact-inspector-launcher">
      <button
        type="button"
        class="compact-inspector-launcher__button"
        @click="openCompactInspector()"
        aria-label="打开工作台面板"
        title="工作台面板"
      >
        <span class="compact-inspector-launcher__icon" aria-hidden="true">◫</span>
        <span v-if="showEventsPanel" class="compact-inspector-launcher__count">{{ taskEvents.length }}</span>
      </button>
    </div>

    <a-drawer
      :open="compactInspectorVisible"
      @update:open="compactInspectorVisible = $event"
      title="速览"
      placement="right"
      :width="352"
      :mask="false"
      :destroy-on-close="false"
      class="compact-inspector-drawer"
    >
      <div v-if="compactInspectorTabs.length > 0" class="compact-inspector-tabs">
        <button
          v-for="tab in compactInspectorTabs"
          :key="tab.key"
          type="button"
          class="compact-inspector-tabs__button"
          :class="{ 'compact-inspector-tabs__button--active': compactInspectorTab === tab.key }"
          @click="compactInspectorTab = tab.key"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.count !== undefined" class="compact-inspector-tabs__count">{{ tab.count }}</span>
        </button>
      </div>

      <div v-if="compactInspectorTab === 'orchestration'">
        <div v-if="orchestrationSummaryItems.length > 0" class="reply-composer-shell__summary-inline">
          <div class="reply-composer-shell__summary-inline-list">
            <span
              v-for="item in orchestrationSummaryItems"
              :key="item.label"
              class="reply-composer-shell__summary-chip"
            >
              <span class="reply-composer-shell__summary-chip-label">{{ item.label }}</span>
              <a-tag v-if="item.tone" :color="item.tone">{{ item.value }}</a-tag>
              <span v-else class="reply-composer-shell__summary-chip-value">{{ item.value }}</span>
            </span>
          </div>
        </div>
        <a-empty v-else description="暂无编排数据" />
      </div>

      <div v-else-if="compactInspectorTab === 'pipeline'">
        <a-empty v-if="pipelineStages.length === 0" description="暂无运行数据" />
        <template v-else>
          <div v-if="runtimePipelineSummaryItems.length > 0" class="reply-composer-shell__summary-inline">
            <div class="reply-composer-shell__summary-inline-list">
              <span
                v-for="item in runtimePipelineSummaryItems"
                :key="item.label"
                class="reply-composer-shell__summary-chip"
              >
                <span class="reply-composer-shell__summary-chip-label">{{ item.label }}</span>
                <a-tag v-if="item.tone" :color="item.tone">{{ item.value }}</a-tag>
                <span v-else class="reply-composer-shell__summary-chip-value">{{ item.value }}</span>
              </span>
            </div>
          </div>
          <a-steps :current="pipelineCurrentStep" size="small" direction="vertical">
            <a-step
              v-for="stage in pipelineStages"
              :key="stage.id"
              :title="stage.label"
              :description="pipelineStageDescription(stage)"
              :status="pipelineStepStatus(stage.status)"
            />
          </a-steps>
          <a-collapse v-if="pipelineOutputStages.length > 0" size="small" :style="taskDetailThemeStyles.pipelineOutputs">
            <a-collapse-panel
              v-for="stage in pipelineOutputStages"
              :key="stage.id"
              :header="pipelineOutputPanelHeader(stage)"
            >
              <pre :style="taskDetailThemeStyles.pipelineOutputPre">{{ stage.error || stage.output }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </template>
      </div>

      <div v-else-if="compactInspectorTab === 'graph'">
        <a-card size="small" :bordered="false" :style="taskDetailThemeStyles.graphCard">
          <div :style="taskDetailThemeStyles.graphWrap">
            <TaskGraph :task-id="taskId || ''" :events="taskEvents" :fallback-status="task?.status" />
          </div>
        </a-card>
      </div>

      <div v-else-if="compactInspectorTab === 'events'">
        <a-empty v-if="taskEvents.length === 0" description="暂无任务事件" />
        <a-table
          v-else
          :data-source="displayedTaskEvents"
          :columns="eventColumns"
          :pagination="false"
          size="small"
          row-key="tableKey"
          :scroll="taskDetailEventTableScroll"
        />
      </div>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { BranchesOutlined, CopyOutlined, EnterOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, defineAsyncComponent, nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type GovernanceSummary,
  type PipelineSummary,
  type ProjectRoleExecutionView,
  type RuntimePipeline,
  type RuntimePipelineStage,
  type SessionInfo,
  type SessionTreeNode,
  type Task,
  type TaskWorkflowViewModel,
  activateSession,
  archiveTaskSession,
  continueTask,
  forkTaskSession,
  getModelsList,
  getProjectRoleExecutionView,
  getSessionMessages,
  getSessionTree,
  getTask,
  getTaskGovernance,
  getTaskPipeline,
  getTaskSessions,
  getTaskWorkflowView,
  updateDeveloperChangeRequest,
  updateTask,
} from "../lib/api";
import { showRuntimeRecoveryNotice } from "../lib/runtime-recovery";
import { renderMarkdown } from "../lib/markdown";
import { parseConfirmationBlock, type ConfirmationBlock } from "../lib/confirmation-parser";
import { RUNTIME_RECOVERY_CONTEXTS } from "../lib/runtime-recovery-notice";
import { type RealtimeEvent, useRealtimeStore } from "../stores/realtime";
import {
  buildTaskDetailMessageCardStyle,
  buildTaskDetailSessionCardStyle,
  taskDetailThemeStyles,
} from "../theme/ui-theme";

const ConfirmationForm = defineAsyncComponent(() => import("../components/ConfirmationForm.vue"));
const TaskProjectRoleConfigPanel = defineAsyncComponent(() => import("../components/TaskProjectRoleConfigPanel.vue"));
const TaskRoleWorkflowPanel = defineAsyncComponent(() => import("../components/TaskRoleWorkflowPanel.vue"));

const route = useRoute();
const router = useRouter();
const realtimeStore = useRealtimeStore();
const isWorkbenchEmbedded = computed(() => route.query.workbench === "1");
const isReplyFocusMode = computed(() => route.query.reply === "1");
const taskDetailEventTableScroll = { y: 220 };
const REPLY_FOCUS_WINDOW_STORAGE_KEY = "openerx.replyFocusWindowBounds";

const taskId = computed(() => route.params.taskId as string | undefined);
const task = ref<Task | null>(null);

const hasCodeContext = computed(() => Boolean(task.value?.repoId));

const hasCodeChanges = computed(() => {
  const summary = task.value?.changesSummary;
  const total = (summary?.filesAdded ?? 0)
    + (summary?.filesModified ?? 0)
    + (summary?.filesDeleted ?? 0)
    + (summary?.totalInsertions ?? 0)
    + (summary?.totalDeletions ?? 0);

  return Boolean(task.value?.finalCommitSha || total > 0);
});

const hasTaskGraphData = computed(
  () => task.value?.status === "running" || taskEvents.value.length > 0,
);

const hasGovernanceData = computed(() => {
  if (!governance.value) {
    return false;
  }

  return Boolean(
    governance.value.approvalRequired
      || governance.value.violations.length > 0
      || governance.value.overallRisk !== "low",
  );
});

const hasOrchestrationData = computed(() =>
  Boolean(
    task.value?.category
      || strategy.value
      || task.value?.selectedModel
      || executionPlan.value
      || (task.value?.executionMode && task.value.executionMode !== "single"),
  ),
);

const hasPipelineData = computed(() => pipelineStages.value.length > 0);
const hasTaskEventsData = computed(() => taskEvents.value.length > 0);
const hasHookData = computed(() => Boolean(strategy.value?.hookExecutions?.length));
const hasRoleWorkflowData = computed(() =>
  Boolean(
    workflowSummary.value?.currentStage
      || workflowStages.value.length > 0
      || roleConclusions.value.length > 0
      || developerChangeRequests.value.length > 0,
  ),
);
const hasProjectRoleConfigData = computed(() => projectRoleConfigRows.value.length > 0);

const showGraphPanel = computed(() => !isWorkbenchEmbedded.value || hasTaskGraphData.value);
const showContextPanel = computed(() => !isWorkbenchEmbedded.value || hasCodeContext.value);
const showChangesPanel = computed(() => !isWorkbenchEmbedded.value || hasCodeChanges.value);
const showGovernancePanel = computed(() => !isWorkbenchEmbedded.value || hasGovernanceData.value);
const showOrchestrationPanel = computed(() => !isWorkbenchEmbedded.value || hasOrchestrationData.value);
const showPipelinePanel = computed(() => !isWorkbenchEmbedded.value || hasPipelineData.value);
const showHooksPanel = computed(() => !isWorkbenchEmbedded.value ? Boolean(strategy.value?.hookExecutions?.length) : hasHookData.value);
const showProjectRoleConfigPanel = computed(() => !isWorkbenchEmbedded.value || hasProjectRoleConfigData.value || projectRoleConfigLoading.value);
const showRoleWorkflowPanel = computed(() => !isWorkbenchEmbedded.value || hasRoleWorkflowData.value || workflowViewLoading.value);
const showEventsPanel = computed(() => !isWorkbenchEmbedded.value || hasTaskEventsData.value);
const useCompactInspector = computed(() => isWorkbenchEmbedded.value);
const orchestrationSummaryItems = computed(() => {
  const items: Array<{ label: string; value: string; tone?: string }> = [];

  const model = task.value?.selectedModel;
  if (model) {
    items.push({ label: "模型", value: model, tone: "cyan" });
  }

  const category = categoryLabels[task.value?.category || ""] || task.value?.category;
  if (category) {
    items.push({ label: "分类", value: category, tone: "blue" });
  }

  const complexity = strategy.value?.complexity;
  if (complexity) {
    items.push({
      label: "复杂度",
      value: complexity,
      tone: complexityColors[complexity] || "default",
    });
  }

  const mode = task.value?.executionMode || strategy.value?.executionMode;
  if (mode) {
    items.push({
      label: "模式",
      value: mode === "parallel" ? "并行竞争" : "单一执行",
      tone: mode === "parallel" ? "volcano" : "blue",
    });
  }

  return items.slice(0, 4);
});

const embeddedSidebarPanelCount = computed(
  () => [
    showContextPanel.value,
    showChangesPanel.value,
    showGovernancePanel.value,
    showRoleWorkflowPanel.value,
    showHooksPanel.value,
    ...(!useCompactInspector.value ? [showOrchestrationPanel.value, showPipelinePanel.value, showGraphPanel.value, showEventsPanel.value] : []),
  ].filter(Boolean).length,
);

const showSidebar = computed(() => !isWorkbenchEmbedded.value || embeddedSidebarPanelCount.value > 0);
const sidebarColSpan = computed(() => (isWorkbenchEmbedded.value ? 6 : 8));
const showEmbeddedGraphSummary = computed(() => isWorkbenchEmbedded.value && hasTaskGraphData.value && !useCompactInspector.value);
const pageStyle = computed(() => ({
  ...taskDetailThemeStyles.page,
  ...(isReplyFocusMode.value
    ? {
        padding: "8px 10px 10px",
      }
    : {}),
}));
const mainContentColSpan = computed(() => {
  if (isReplyFocusMode.value) {
    return 24;
  }

  if (!isWorkbenchEmbedded.value) {
    return 11;
  }

  return showSidebar.value ? 13 : 19;
});

const latestTaskEvent = computed(() => taskEvents.value[0]);
const latestTaskEventTypeLabel = computed(() => formatEventTypeLabel(latestTaskEvent.value?.type));
const activeAgentCount = computed(
  () => agentRuns.value.filter((run) => run.status === "running" || run.status === "paused").length,
);
const isCompactMainEmpty = computed(() => isWorkbenchEmbedded.value && !selectedSessionId.value);
const messagesPaneStyle = computed(() => {
  if (isCompactMainEmpty.value) {
    return taskDetailThemeStyles.compactMessagesPane;
  }

  return taskDetailThemeStyles.messagesPane;
});
const composerStyle = computed(() =>
  isCompactMainEmpty.value ? taskDetailThemeStyles.compactComposer : taskDetailThemeStyles.composer,
);
const composerFormItemStyle = computed(() =>
  isCompactMainEmpty.value ? taskDetailThemeStyles.compactComposerFormItem : taskDetailThemeStyles.composerFormItem,
);
const composerRows = computed(() => (isCompactMainEmpty.value ? 2 : 3));
const composerMaxRows = computed(() => (isReplyFocusMode.value ? 7 : 8));

const taskDetailDefaultActivePanels = computed(() => {
  const base: string[] = [];

  if (showContextPanel.value) {
    base.push("context");
  }

  if (showChangesPanel.value) {
    base.push("changes");
  }

  if (showRoleWorkflowPanel.value) {
    base.push("role-workflow");
  }

  if (showEventsPanel.value && isWorkbenchEmbedded.value) {
    base.push("events");
  }

  return base;
});

// Pipeline
const runtimePipeline = ref<RuntimePipeline | null>(null);
const pipelineStages = computed(() => runtimePipeline.value?.stages ?? []);
const pipelineOutputStages = computed(() =>
  pipelineStages.value.filter((stage) => Boolean(stage.output || stage.error)),
);
const pipelineCurrentStep = computed(() => {
  const currentStageId = runtimePipeline.value?.summary.currentStageId;
  if (currentStageId) {
    const currentIndex = pipelineStages.value.findIndex((stage) => stage.id === currentStageId);
    if (currentIndex >= 0) {
      return currentIndex;
    }
  }

  const idx = pipelineStages.value.findIndex((stage) =>
    stage.status !== "completed" && stage.status !== "skipped",
  );
  return idx === -1 ? pipelineStages.value.length : idx;
});
const runtimePipelineSummaryItems = computed(() => {
  if (!runtimePipeline.value) {
    return [] as Array<{ label: string; value: string; tone?: string }>;
  }

  const summary = runtimePipeline.value.summary;
  const currentStage = pipelineStages.value.find((stage) => stage.id === summary.currentStageId);
  const items: Array<{ label: string; value: string; tone?: string }> = [];

  if (runtimePipeline.value.branchName) {
    items.push({ label: "分支", value: runtimePipeline.value.branchName, tone: "blue" });
  }

  items.push({ label: "阶段", value: `${summary.completedStages}/${summary.totalStages}`, tone: "geekblue" });

  if (currentStage) {
    items.push({ label: "当前", value: currentStage.label, tone: "processing" });
  }

  return items;
});

// Sessions
const sessions = ref<SessionInfo[]>([]);
const sessionTree = ref<SessionTreeNode[]>([]);
const selectedSessionId = ref<string | undefined>(undefined);
const sessionMessages = ref<unknown[]>([]);
const messagesLoading = ref(false);
const activating = ref(false);

// Governance
const governance = ref<GovernanceSummary | null>(null);
const governanceLoading = ref(false);

// Role workflow placeholders
const workflowViewLoading = ref(false);
const workflowViewError = ref<string | null>(null);
const workflowView = ref<TaskWorkflowViewModel | null>(null);
const projectRoleConfigLoading = ref(false);
const projectRoleConfigError = ref<string | null>(null);
const projectRoleExecutionView = ref<ProjectRoleExecutionView | null>(null);
const updatingChangeRequestIds = ref<string[]>([]);

const continuePrompt = ref("");
const continuing = ref(false);
const forking = ref(false);
const modelsLoading = ref(false);
const modelsData = ref<Array<Record<string, unknown>> | null>(null);
const updatingSelectedModel = ref(false);
const compactInspectorVisible = ref(false);
const compactInspectorTab = ref<"orchestration" | "pipeline" | "graph" | "events">("orchestration");
const pendingAssistantState = ref<PendingAssistantState | null>(null);
const messagesPaneRef = ref<HTMLDivElement | null>(null);
const messageListEndRef = ref<HTMLDivElement | null>(null);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let messageRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let liveMessageRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let liveMessageRefreshInFlight = false;
let bootstrapRefreshToken = 0;
let messageAutoScrollFrame: number | null = null;
let messageAutoScrollTimer: ReturnType<typeof setTimeout> | null = null;
const BOOTSTRAP_REFRESH_ATTEMPTS = 8;
const BOOTSTRAP_REFRESH_INTERVAL_MS = 500;
const LIVE_MESSAGE_REFRESH_INTERVAL_MS = 320;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadModels() {
  modelsLoading.value = true;
  try {
    const result = await getModelsList();
    modelsData.value = result?.data ?? [];
  } catch {
    modelsData.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

const modelOptions = computed(() => {
  const options = (modelsData.value || [])
    .map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) return null;
      const name = typeof model.name === "string" ? model.name : "";
      const provider = typeof model.provider === "string" ? model.provider : "";
      const meta = [name, provider].filter(Boolean).join(" / ");
      return {
        value: id,
        label: meta ? `${id} (${meta})` : id,
      };
    })
    .filter((option): option is { value: string; label: string } => Boolean(option));

  const currentModel = task.value?.selectedModel?.trim();
  if (currentModel && !options.some((option) => option.value === currentModel)) {
    options.unshift({ value: currentModel, label: `${currentModel} (当前值)` });
  }

  return options;
});

const workflowSummary = computed(() => workflowView.value?.workflow ?? null);
const workflowStages = computed(() => workflowView.value?.workflow.stages ?? []);
const roleConclusions = computed(() => workflowView.value?.roleConclusions ?? []);
const developerChangeRequests = computed(() => workflowView.value?.developerChangeRequests ?? []);
const projectRoleConfigRows = computed(() => projectRoleExecutionView.value?.rows ?? []);
const activeRoleAgentIds = computed(() => {
  const ids = new Set<string>();
  for (const item of roleConclusions.value) {
    if (item.roleAgentId) ids.add(item.roleAgentId);
  }
  for (const item of developerChangeRequests.value) {
    if (item.sourceRoleAgentId) ids.add(item.sourceRoleAgentId);
  }
  return Array.from(ids);
});

async function refreshWorkflowView(id: string) {
  workflowViewLoading.value = true;
  try {
    workflowView.value = await getTaskWorkflowView(id);
    workflowViewError.value = null;
  } catch (error) {
    workflowViewError.value = error instanceof Error ? error.message : "加载角色工作流失败";
    workflowView.value = null;
  } finally {
    workflowViewLoading.value = false;
  }
}

async function refreshProjectRoleConfig(projectId: string) {
  projectRoleConfigLoading.value = true;
  try {
    projectRoleExecutionView.value = await getProjectRoleExecutionView(projectId);
    projectRoleConfigError.value = null;
  } catch (error) {
    projectRoleConfigError.value = error instanceof Error ? error.message : "加载项目角色配置失败";
    projectRoleExecutionView.value = null;
  } finally {
    projectRoleConfigLoading.value = false;
  }
}

async function handleDeveloperChangeRequestStatus(requestId: string, status: "acknowledged" | "resolved") {
  if (!taskId.value || updatingChangeRequestIds.value.includes(requestId)) {
    return;
  }

  updatingChangeRequestIds.value = [...updatingChangeRequestIds.value, requestId];
  try {
    await updateDeveloperChangeRequest(taskId.value, { requestId, status });
    message.success(status === "resolved" ? "修正请求已标记为已解决" : "修正请求已确认");
    await refreshTaskData(taskId.value, {
      task: false,
      pipeline: false,
      sessions: false,
      governance: false,
      workflow: true,
    });
  } catch (error) {
    message.error(`更新修正请求失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    updatingChangeRequestIds.value = updatingChangeRequestIds.value.filter((item) => item !== requestId);
  }
}

function handleRoleWorkflowRequestStatusChange(payload: { requestId: string; status: "acknowledged" | "resolved" }) {
  void handleDeveloperChangeRequestStatus(payload.requestId, payload.status);
}

function filterModelOption(input: string, option: { value?: string; label?: string }) {
  const keyword = input.toLowerCase();
  return (
    (option.value?.toLowerCase().includes(keyword) ?? false)
    || (option.label?.toLowerCase().includes(keyword) ?? false)
  );
}

function handleModelPickerFocus() {
  if ((modelsData.value?.length || 0) === 0 && !modelsLoading.value) {
    void loadModels();
  }
}

function handleRefreshModels() {
  if (!modelsLoading.value) {
    void loadModels();
  }
}

async function handleSelectedModelChange(value: unknown) {
  if (!taskId.value || !task.value || updatingSelectedModel.value) {
    return;
  }

  const nextModel = value == null ? null : String(value);
  const currentModel = task.value.selectedModel ?? null;
  if (nextModel === currentModel) {
    return;
  }

  updatingSelectedModel.value = true;
  try {
    await updateTask(taskId.value, { selectedModel: nextModel });
    task.value = {
      ...task.value,
      selectedModel: nextModel,
    };
    message.success(nextModel ? "执行模型已更新" : "已恢复为默认模型");
  } catch (error) {
    message.error(`更新执行模型失败: ${error}`);
  } finally {
    updatingSelectedModel.value = false;
  }
}

async function refreshTaskData(
  id: string,
  options: {
    task?: boolean;
    pipeline?: boolean;
    sessions?: boolean;
    governance?: boolean;
    workflow?: boolean;
    roleConfig?: boolean;
  } = {
    task: true,
    pipeline: true,
    sessions: true,
    governance: true,
    workflow: true,
    roleConfig: true,
  },
) {
  const jobs: Promise<unknown>[] = [];
  let refreshedTaskProjectId: string | null = null;

  if (options.task !== false) {
    jobs.push(
      getTask(id)
        .then((t) => {
          task.value = t;
          refreshedTaskProjectId = t.projectId || null;
        })
        .catch(() => {}),
    );
  }

  if (options.pipeline) {
    jobs.push(
      refreshPipelineData(id)
        .catch(() => {}),
    );
  }

  if (options.sessions) {
    jobs.push(
      getTaskSessions(id)
        .then((r) => {
          sessions.value = r.data;
          ensureSelectedSession();
        })
        .catch(() => {}),
    );
    jobs.push(
      getSessionTree(id)
        .then((r) => {
          sessionTree.value = r.data;
          ensureSelectedSessionFromTree();
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

  if (options.workflow) {
    jobs.push(refreshWorkflowView(id));
  }

  await Promise.all(jobs);

  if (options.roleConfig) {
    const nextProjectId = refreshedTaskProjectId || task.value?.projectId || null;
    if (nextProjectId) {
      await refreshProjectRoleConfig(nextProjectId);
    } else {
      projectRoleExecutionView.value = null;
      projectRoleConfigError.value = null;
    }
  }
}

function getPreferredPipelineSessionId() {
  const requestedSessionId = typeof route.query.session === "string" ? route.query.session : undefined;
  return requestedSessionId || selectedSessionId.value || task.value?.sessionId;
}

async function refreshPipelineData(id: string, sessionId?: string) {
  try {
    runtimePipeline.value = await getTaskPipeline(id, sessionId || getPreferredPipelineSessionId());
  } catch {
    runtimePipeline.value = null;
  }
}

interface PipelineStageUpdatedEventData {
  patch?: {
    type?: "upsert" | "remove";
    stage?: RuntimePipelineStage;
    stageId?: string;
  };
  summary?: PipelineSummary;
  reason?: string;
  status?: RuntimePipeline["status"];
  branchName?: string | null;
}

function isPipelineSummary(value: unknown): value is PipelineSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.totalStages === "number"
    && typeof candidate.completedStages === "number"
    && typeof candidate.failedStages === "number"
    && (typeof candidate.currentStageId === "string" || candidate.currentStageId === null)
    && typeof candidate.totalDurationMs === "number"
    && typeof candidate.replanCount === "number"
    && typeof candidate.totalTokens === "object"
    && candidate.totalTokens !== null
  );
}

function isRuntimePipelineStage(value: unknown): value is RuntimePipelineStage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.label === "string"
    && typeof candidate.order === "number"
    && typeof candidate.status === "string"
    && Array.isArray(candidate.dependsOn)
  );
}

function parsePipelineStageUpdatedEventData(event: RealtimeEvent): PipelineStageUpdatedEventData | null {
  if (event.type !== "pipeline.stage.updated") {
    return null;
  }

  const data = event.data as PipelineStageUpdatedEventData;
  if (!data || typeof data !== "object" || !isPipelineSummary(data.summary)) {
    return null;
  }

  if (data.patch?.type === "upsert" && !isRuntimePipelineStage(data.patch.stage)) {
    return null;
  }

  if (data.patch?.type === "remove" && typeof data.patch.stageId !== "string") {
    return null;
  }

  return data;
}

function applyPipelineStagePatch(event: RealtimeEvent) {
  const data = parsePipelineStageUpdatedEventData(event);
  if (!data || !taskId.value || event.taskId !== taskId.value) {
    return false;
  }

  const targetSessionId = event.sessionId || getPreferredPipelineSessionId();
  if (!targetSessionId) {
    return false;
  }

  const preferredSessionId = getPreferredPipelineSessionId();
  if (preferredSessionId && targetSessionId !== preferredSessionId) {
    return false;
  }

  if (!runtimePipeline.value || runtimePipeline.value.sessionId !== targetSessionId) {
    void refreshPipelineData(taskId.value, targetSessionId);
    return true;
  }

  const stages = [...runtimePipeline.value.stages];
  if (data.patch?.type === "remove" && data.patch.stageId) {
    const nextStages = stages.filter((stage) => stage.id !== data.patch?.stageId);
    runtimePipeline.value = {
      ...runtimePipeline.value,
      updatedAt: event.ts,
      summary: data.summary ?? runtimePipeline.value.summary,
      status: data.status ?? runtimePipeline.value.status,
      branchName: data.branchName ?? runtimePipeline.value.branchName,
      stages: nextStages,
    };
    return true;
  }

  if (data.patch?.type === "upsert" && data.patch.stage) {
    const existingIndex = stages.findIndex((stage) => stage.id === data.patch?.stage?.id);
    if (existingIndex >= 0) {
      stages.splice(existingIndex, 1, data.patch.stage);
    } else {
      stages.push(data.patch.stage);
    }

    stages.sort((left, right) => left.order - right.order);
    runtimePipeline.value = {
      ...runtimePipeline.value,
      updatedAt: event.ts,
      summary: data.summary ?? runtimePipeline.value.summary,
      status: data.status ?? runtimePipeline.value.status,
      branchName: data.branchName ?? runtimePipeline.value.branchName,
      stages,
    };
    return true;
  }

  return false;
}

function ensureSelectedSession() {
  const requestedSessionId = typeof route.query.session === "string" ? route.query.session : undefined;

  if (sessions.value.length === 0) {
    selectedSessionId.value = undefined;
    sessionMessages.value = [];
    return;
  }

  if (requestedSessionId && sessions.value.some((session) => session.id === requestedSessionId)) {
    selectedSessionId.value = requestedSessionId;
    return;
  }

  if (selectedSessionId.value && sessions.value.some((session) => session.id === selectedSessionId.value)) {
    return;
  }

  selectedSessionId.value = sessions.value.find((session) => session.isActive)?.id || sessions.value[0]?.id;
}

function flattenTree(nodes: SessionTreeNode[]): SessionTreeNode[] {
  const result: SessionTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

function ensureSelectedSessionFromTree() {
  if (sessionTree.value.length === 0) return;
  if (selectedSessionId.value) return; // already selected via flat sessions

  const flat = flattenTree(sessionTree.value);
  const requestedSessionId = typeof route.query.session === "string" ? route.query.session : undefined;

  if (requestedSessionId && flat.some((n) => n.runtimeSessionId === requestedSessionId)) {
    selectedSessionId.value = requestedSessionId;
    return;
  }

  const active = flat.find((n) => n.isActive);
  if (active) {
    selectedSessionId.value = active.runtimeSessionId;
    return;
  }

  selectedSessionId.value = flat[0]?.runtimeSessionId;
}

async function handleActivateSession(sessionId: string) {
  if (!taskId.value || activating.value) return;
  activating.value = true;
  try {
    await activateSession(taskId.value, sessionId);
    message.success("已切换到目标分支");
    selectedSessionId.value = sessionId;
    await refreshTaskData(taskId.value, { task: true, pipeline: false, sessions: true, governance: false });
  } catch {
    message.error("切换分支失败");
  } finally {
    activating.value = false;
  }
}

async function refreshSessionMessages(
  currentTaskId: string,
  sessionId: string,
  silent = false,
) {
  if (!silent) {
    messagesLoading.value = true;
  }

  try {
    const response = await getSessionMessages(currentTaskId, sessionId);
    sessionMessages.value = Array.isArray(response.data) ? response.data : [];
  } catch {
    if (!silent) {
      sessionMessages.value = [];
    }
  } finally {
    if (!silent) {
      messagesLoading.value = false;
    }
  }
}

function scheduleSessionRefresh() {
  if (!taskId.value || !selectedSessionId.value) {
    return;
  }

  if (messageRefreshTimer) {
    clearTimeout(messageRefreshTimer);
  }

  messageRefreshTimer = setTimeout(() => {
    messageRefreshTimer = null;
    void refreshSessionMessages(taskId.value as string, selectedSessionId.value as string, true);
  }, 250);
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
    void (async () => {
      await refreshTaskData(taskId.value as string, {
        task: true,
        pipeline: [
          "agent.started",
          "message.updated",
          "session.updated",
          "task.node.updated",
          "task.completed",
          "task.continued",
          "task.hooks.updated",
        ].includes(reason),
        sessions: reason !== "agent.started",
        governance:
          reason === "task.completed" ||
          reason === "task.continued" ||
          reason === "task.hooks.updated",
        workflow: [
          "agent.started",
          "task.completed",
          "task.continued",
          "task.hooks.updated",
          "task.role-review.started",
          "task.role-review.completed",
          "task.role-review.conflicted",
          "task.developer-change-request.created",
        ].includes(reason),
      });

      if (
        selectedSessionId.value &&
        ["message.updated", "session.updated", "task.continued", "task.completed"].includes(reason)
      ) {
        await refreshSessionMessages(taskId.value as string, selectedSessionId.value, true);
      }
    })();
  }, delay);
}

const taskEvents = computed(() => realtimeStore.events.filter((e) => e.taskId === taskId.value));

const persistedSessionMessageIds = computed(() => {
  const ids = new Set<string>();

  if (!Array.isArray(sessionMessages.value)) {
    return ids;
  }

  for (const message of sessionMessages.value) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const info = (message as Record<string, unknown>).info;
    if (!info || typeof info !== "object") {
      continue;
    }

    const messageId = (info as Record<string, unknown>).id;
    if (typeof messageId === "string" && messageId.length > 0) {
      ids.add(messageId);
    }
  }

  return ids;
});

const liveAssistantState = computed(() => {
  const orderedAssistantMessageIds: string[] = [];
  const knownAssistantIds = new Set<string>();
  const metaById = new Map<string, StreamingAssistantMeta>();
  const textById = new Map<string, string>();
  const incompleteIds = new Set<string>();

  if (!selectedSessionId.value) {
    return {
      orderedAssistantMessageIds,
      metaById,
      textById,
      incompleteIds,
    };
  }

  const relevantEvents = taskEvents.value
    .filter((event) => event.sessionId === selectedSessionId.value)
    .slice()
    .reverse();

  const rememberAssistantMessage = (messageId: string) => {
    if (!knownAssistantIds.has(messageId)) {
      orderedAssistantMessageIds.push(messageId);
      knownAssistantIds.add(messageId);
    }
  };

  for (const event of relevantEvents) {
    const rawType = getRealtimeRawType(event);

    if (rawType === "message.updated") {
      const info = getRealtimeInfo(event);
      if (info) {
        const messageId = typeof info.id === "string" ? info.id : null;
        const role = typeof info.role === "string" ? info.role : null;

        if (messageId && role === "assistant") {
          const time = info.time && typeof info.time === "object"
            ? (info.time as Record<string, unknown>)
            : undefined;

          metaById.set(messageId, {
            agent: typeof info.agent === "string" ? info.agent : undefined,
            createdAt: parseMessageTimestamp(time?.created ?? time?.completed),
          });
          rememberAssistantMessage(messageId);

          if (typeof time?.completed === "number") {
            incompleteIds.delete(messageId);
          } else {
            incompleteIds.add(messageId);
          }
        }
      }
    }

    if (rawType !== "message.updated" && rawType !== "message.part.updated") {
      continue;
    }

    const part = getRealtimePart(event);
    if (!part) {
      continue;
    }

    const messageId = typeof part.messageID === "string" ? part.messageID : null;
    const partType = typeof part.type === "string" ? part.type : null;
    const text = typeof part.text === "string" ? part.text : null;
    if (!messageId || partType !== "text" || text === null) {
      continue;
    }

    rememberAssistantMessage(messageId);
    textById.set(messageId, text);
  }

  return {
    orderedAssistantMessageIds,
    metaById,
    textById,
    incompleteIds,
  };
});

const streamingAssistantDraft = computed<SessionMessageView | null>(() => {
  for (let index = liveAssistantState.value.orderedAssistantMessageIds.length - 1; index >= 0; index -= 1) {
    const messageId = liveAssistantState.value.orderedAssistantMessageIds[index];
    if (persistedSessionMessageIds.value.has(messageId)) {
      continue;
    }

    const meta = liveAssistantState.value.metaById.get(messageId);
    const draftText = liveAssistantState.value.textById.get(messageId)?.trim();
    if (!meta && !draftText) {
      continue;
    }

    return {
      key: messageId,
      role: "assistant",
      agent: meta?.agent,
      text: draftText || "正在生成...",
      toolCalls: [],
      createdAt: meta?.createdAt,
      isStreaming: true,
    } satisfies SessionMessageView;
  }

  return null;
});

const pendingAssistantMessage = computed<SessionMessageView | null>(() => {
  const pending = pendingAssistantState.value;
  if (!pending || selectedSessionId.value !== pending.sessionId) {
    return null;
  }

  if (streamingAssistantDraft.value) {
    return null;
  }

  const pendingTime = Date.parse(pending.sentAt);
  if (Number.isFinite(pendingTime) && Array.isArray(sessionMessages.value)) {
    const hasAssistantReply = sessionMessages.value.some((message) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      const info = (message as Record<string, unknown>).info;
      if (!info || typeof info !== "object") {
        return false;
      }

      const role = (info as Record<string, unknown>).role;
      if (role !== "assistant") {
        return false;
      }

      const time = (info as Record<string, unknown>).time;
      const created = time && typeof time === "object"
        ? (time as Record<string, unknown>).created
        : undefined;

      return typeof created === "number" && created >= pendingTime;
    });

    if (hasAssistantReply) {
      return null;
    }
  }

  return {
    key: `pending-${pending.sessionId}-${pending.sentAt}`,
    role: "assistant",
    agent: "system",
    text: "消息已发送，等待系统回复...",
    toolCalls: [],
    createdAt: pending.sentAt,
    isPending: true,
  } satisfies SessionMessageView;
});

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
      selectedSessionId.value = undefined;
      sessionMessages.value = [];
      void loadModels();
      void refreshTaskData(id).then(() => bootstrapTaskRefresh(id));
    }
  },
  { immediate: true },
);

watch(selectedSessionId, (sessionId) => {
  stopLiveMessageRefresh();

  if (!taskId.value || !sessionId) {
    sessionMessages.value = [];
    runtimePipeline.value = null;
    return;
  }

  const currentQuerySession = typeof route.query.session === "string" ? route.query.session : undefined;
  if (currentQuerySession !== sessionId) {
    void router.replace({
      query: {
        ...route.query,
        session: sessionId,
      },
    });
  }

  void refreshSessionMessages(taskId.value, sessionId);
  void refreshPipelineData(taskId.value, sessionId);
});

watch(
  [streamingAssistantDraft, pendingAssistantMessage],
  ([streamingDraft, pendingMessage]) => {
    if (streamingDraft || !pendingMessage) {
      pendingAssistantState.value = null;
    }
  },
);

watch(
  () => route.query.session,
  (sessionQuery) => {
    const sessionId = typeof sessionQuery === "string" ? sessionQuery : undefined;
    if (sessionId && sessionId !== selectedSessionId.value && sessions.value.some((session) => session.id === sessionId)) {
      selectedSessionId.value = sessionId;
    }
  },
);

watch(
  () => taskEvents.value[0]?.id,
  () => {
    const latestEvent = taskEvents.value[0];
    if (!latestEvent) {
      return;
    }

    if (latestEvent.type === "pipeline.stage.updated") {
      applyPipelineStagePatch(latestEvent);
      return;
    }

    if (getRealtimeRawType(latestEvent) === "message.part.updated") {
      return;
    }

    if (
      latestEvent.type === "agent.started" ||
      latestEvent.type === "message.updated" ||
      latestEvent.type === "session.updated" ||
      latestEvent.type === "task.node.updated" ||
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
  stopMessageAutoScroll();
  persistReplyFocusWindowBounds();
  stopReplyFocusWindowPersistence();
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (messageRefreshTimer) {
    clearTimeout(messageRefreshTimer);
    messageRefreshTimer = null;
  }
  stopLiveMessageRefresh();
  stopStreamingReveal();
});

async function handleContinue() {
  if (!taskId.value || !selectedSessionId.value || !continuePrompt.value.trim()) return;
  continuing.value = true;
  const sessionId = selectedSessionId.value;
  const prompt = continuePrompt.value.trim();
  const sentAt = new Date().toISOString();
  pendingAssistantState.value = {
    sessionId,
    prompt,
    sentAt,
  };
  try {
    await continueTask(taskId.value, prompt, sessionId);
    message.success("续跑指令已发送");
    continuePrompt.value = "";
    const t = await getTask(taskId.value);
    task.value = t;
    scheduleSessionRefresh();
  } catch (e) {
    if (
      showRuntimeRecoveryNotice(e, {
        context: RUNTIME_RECOVERY_CONTEXTS.taskContinue,
        router,
      })
    ) {
      return;
    }

    message.error(`续跑失败: ${e}`);
    pendingAssistantState.value = null;
  } finally {
    continuing.value = false;
  }
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter") {
    return;
  }

  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  void handleContinue();
}

async function handleForkToSecondary() {
  if (!taskId.value || !selectedSessionId.value) {
    return;
  }

  forking.value = true;
  try {
    const nextTitle = `${selectedSessionLabel(selectedSession.value || { id: selectedSessionId.value, title: "", isActive: false, summary: null, createdAt: null, updatedAt: null } as SessionInfo)} 分叉`;
    const result = await forkTaskSession(taskId.value, selectedSessionId.value, nextTitle);
    message.success("已创建分叉分支");
    await refreshTaskData(taskId.value, { task: false, pipeline: false, sessions: true, governance: false });
    if (result.sessionId) {
      selectedSessionId.value = result.sessionId;
    }

    if (isWorkbenchEmbedded.value) {
      window.parent.postMessage(
        {
          type: "workbench:open-fork",
          taskId: taskId.value,
          sessionId: result.sessionId,
          title: result.title || nextTitle,
        },
        window.location.origin,
      );
    }
  } catch (error) {
    message.error(`分叉失败: ${error}`);
  } finally {
    forking.value = false;
  }
}

const forkAndRunning = ref(false);

async function handleForkAndRun() {
  if (!taskId.value || !selectedSessionId.value || !continuePrompt.value.trim()) return;
  forkAndRunning.value = true;
  const prompt = continuePrompt.value.trim();
  try {
    const nextTitle = `${selectedSessionLabel(selectedSession.value || { id: selectedSessionId.value, title: "", isActive: false, summary: null, createdAt: null, updatedAt: null } as SessionInfo)} 分叉`;
    const result = await forkTaskSession(taskId.value, selectedSessionId.value, nextTitle);
    if (result.sessionId) {
      selectedSessionId.value = result.sessionId;
      const sentAt = new Date().toISOString();
      pendingAssistantState.value = {
        sessionId: result.sessionId,
        prompt,
        sentAt,
      };
      await continueTask(taskId.value, prompt, result.sessionId);
      message.success("已分叉并发送续跑指令");
      continuePrompt.value = "";
      const t = await getTask(taskId.value);
      task.value = t;
      await refreshTaskData(taskId.value, { task: false, pipeline: false, sessions: true, governance: false });
      scheduleSessionRefresh();
    }
  } catch (error) {
    message.error(`分叉执行失败: ${error}`);
    pendingAssistantState.value = null;
  } finally {
    forkAndRunning.value = false;
  }
}

const forkingMessageId = ref<string | null>(null);

const toolFoldExpanded = ref<Record<string, boolean>>({});
const toolShowAll = ref<Record<string, boolean>>({});
const toolOutputExpanded = ref<Record<string, boolean>>({});
function toggleToolFold(key: string) {
  toolFoldExpanded.value[key] = !toolFoldExpanded.value[key];
  if (!toolFoldExpanded.value[key]) {
    toolShowAll.value[key] = false;
  }
}

function toggleToolOutput(key: string) {
  toolOutputExpanded.value[key] = !toolOutputExpanded.value[key];
}

function handleCopyMessage(text?: string) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => message.success("已复制到剪贴板"),
    () => message.error("复制失败"),
  );
}

function handleQuoteToInput(text?: string) {
  if (!text) return;
  const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
  continuePrompt.value = continuePrompt.value
    ? `${continuePrompt.value}\n\n${quoted}\n\n`
    : `${quoted}\n\n`;
  message.info("已引用到输入框");
}

function handleCopyToolRaw(tool: ToolCallView) {
  navigator.clipboard.writeText(tool.rawContent).then(
    () => message.success("已复制工具原始内容"),
    () => message.error("复制失败"),
  );
}

function toolDisplayOutput(tool: ToolCallView) {
  if (tool.outputTruncated && toolOutputExpanded.value[tool.key] && tool.fullOutput) {
    return tool.fullOutput;
  }

  return tool.outputPreview;
}

function toolGroupTitle(toolCalls: ToolCallView[]) {
  const firstTool = toolCalls[0];
  if (!firstTool) {
    return "工具调用";
  }

  const title = firstTool.headline || firstTool.description || firstTool.label;
  const compactTitle = title.length > 80 ? `${title.slice(0, 79)}…` : title;

  if (toolCalls.length === 1) {
    return `工具调用 · ${firstTool.label} · ${compactTitle}`;
  }

  return `工具调用 (${toolCalls.length}) · ${firstTool.label} · ${compactTitle}`;
}

async function handleForkFromMessage(messageId: string) {
  if (!taskId.value || !selectedSessionId.value) return;
  forkingMessageId.value = messageId;
  try {
    const nextTitle = `${selectedSessionLabel(selectedSession.value || { id: selectedSessionId.value, title: "", isActive: false, summary: null, createdAt: null, updatedAt: null } as SessionInfo)} 分叉`;
    const result = await forkTaskSession(taskId.value, selectedSessionId.value, nextTitle, messageId);
    message.success("已从此消息创建分叉分支");
    await refreshTaskData(taskId.value, { task: false, pipeline: false, sessions: true, governance: false });
    if (result.sessionId) {
      selectedSessionId.value = result.sessionId;
      // 预填输入框，引用 fork 源消息
      const sourceMsg = sessionMessageItems.value.find((m) => m.key === messageId);
      if (sourceMsg?.text) {
        const snippet = sourceMsg.text.length > 120 ? `${sourceMsg.text.slice(0, 120)}…` : sourceMsg.text;
        continuePrompt.value = `基于前面的分析：\n> ${snippet}\n\n`;
      }
    }
  } catch (error) {
    message.error(`分叉失败: ${error}`);
  } finally {
    forkingMessageId.value = null;
  }
}

async function handleForkFromSession(runtimeSessionId: string) {
  if (!taskId.value) return;
  forking.value = true;
  try {
    const nextTitle = `Session ${runtimeSessionId.slice(0, 8)} 分叉`;
    const result = await forkTaskSession(taskId.value, runtimeSessionId, nextTitle);
    message.success("已创建分叉分支");
    await refreshTaskData(taskId.value, { task: false, pipeline: false, sessions: true, governance: false });
    if (result.sessionId) {
      selectedSessionId.value = result.sessionId;
    }
  } catch (error) {
    message.error(`分叉失败: ${error}`);
  } finally {
    forking.value = false;
  }
}

async function handleArchiveSession(runtimeSessionId: string) {
  if (!taskId.value) return;
  try {
    await archiveTaskSession(taskId.value, runtimeSessionId);
    message.success("分支已归档");
    await refreshTaskData(taskId.value, { task: false, pipeline: false, sessions: true, governance: false });
  } catch (error) {
    message.error(`归档失败: ${error}`);
  }
}

const selectedSession = computed(() =>
  sessions.value.find((session) => session.id === selectedSessionId.value),
);

const latestAssistantMessageIncomplete = computed(() => {
  if (!Array.isArray(sessionMessages.value) || sessionMessages.value.length === 0) {
    return false;
  }

  for (let index = sessionMessages.value.length - 1; index >= 0; index -= 1) {
    const message = sessionMessages.value[index];
    if (!message || typeof message !== "object") {
      continue;
    }

    const info = (message as Record<string, unknown>).info;
    if (!info || typeof info !== "object") {
      continue;
    }

    const role = (info as Record<string, unknown>).role;
    if (role !== "assistant") {
      if (role === "user") {
        return false;
      }

      continue;
    }

    const time = (info as Record<string, unknown>).time;
    const completed = time && typeof time === "object"
      ? (time as Record<string, unknown>).completed
      : undefined;

    return typeof completed !== "number";
  }

  return false;
});

const latestInteractiveMessageRole = computed(() => {
  if (!Array.isArray(sessionMessages.value) || sessionMessages.value.length === 0) {
    return null as string | null;
  }

  for (let index = sessionMessages.value.length - 1; index >= 0; index -= 1) {
    const message = sessionMessages.value[index];
    if (!message || typeof message !== "object") {
      continue;
    }

    const info = (message as Record<string, unknown>).info;
    if (!info || typeof info !== "object") {
      continue;
    }

    const role = (info as Record<string, unknown>).role;
    if (role === "user" || role === "assistant") {
      return role;
    }
  }

  return null as string | null;
});

const isAwaitingAssistantResponse = computed(() => {
  if (continuing.value || forkAndRunning.value) {
    return true;
  }

  if (
    Boolean(pendingAssistantMessage.value) ||
    Boolean(streamingAssistantDraft.value) ||
    latestAssistantMessageIncomplete.value
  ) {
    return true;
  }

  if (selectedSessionId.value && latestInteractiveMessageRole.value === "user") {
    return true;
  }

  return false;
});

const canContinueCurrentSession = computed(
  () => Boolean(selectedSessionId.value && continuePrompt.value.trim()) && !isAwaitingAssistantResponse.value,
);

function stopLiveMessageRefresh() {
  if (liveMessageRefreshTimer) {
    clearTimeout(liveMessageRefreshTimer);
    liveMessageRefreshTimer = null;
  }
}

function scheduleLiveMessageRefresh() {
  if (
    liveMessageRefreshTimer ||
    liveMessageRefreshInFlight ||
    !taskId.value ||
    !selectedSessionId.value ||
    !isAwaitingAssistantResponse.value
  ) {
    return;
  }

  liveMessageRefreshTimer = setTimeout(() => {
    liveMessageRefreshTimer = null;

    if (!taskId.value || !selectedSessionId.value || !isAwaitingAssistantResponse.value) {
      return;
    }

    liveMessageRefreshInFlight = true;
    void refreshSessionMessages(taskId.value, selectedSessionId.value, true)
      .finally(() => {
        liveMessageRefreshInFlight = false;
        if (isAwaitingAssistantResponse.value) {
          scheduleLiveMessageRefresh();
        }
      });
  }, LIVE_MESSAGE_REFRESH_INTERVAL_MS);
}

watch(
  [selectedSessionId, isAwaitingAssistantResponse],
  ([sessionId, awaiting]) => {
    if (!sessionId || !awaiting) {
      stopLiveMessageRefresh();
      return;
    }

    scheduleLiveMessageRefresh();
  },
  { immediate: true },
);

interface SessionPart {
  type?: string;
  text?: string;
  id?: string;
  callID?: string;
  toolName?: string;
  tool?: string;
  state?: string | Record<string, unknown>;
  input?: Record<string, unknown>;
}

interface ToolStateView {
  status?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  exit?: number;
  error?: unknown;
}

interface ToolCallView {
  key: string;
  kind: string;
  label: string;
  stateLabel: string;
  stateColor: string;
  headline?: string;
  description?: string;
  goal?: string;
  command?: string;
  filePath?: string;
  readPreview?: string;
  inputPreview?: string;
  fullOutput?: string;
  outputPreview?: string;
  outputTruncated: boolean;
  rawContent: string;
  exitCode?: number;
}

interface SessionMessageView {
  key: string;
  role: string;
  agent?: string;
  text?: string;
  toolCalls: ToolCallView[];
  createdAt?: string;
  isPending?: boolean;
  isStreaming?: boolean;
}

interface StreamingAssistantMeta {
  agent?: string;
  createdAt?: string;
}

interface PendingAssistantState {
  sessionId: string;
  prompt: string;
  sentAt: string;
}

function parseMessageTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return undefined;
}

function normalizeTextParts(parts: SessionPart[]): string | undefined {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter(Boolean)
    .join("\n\n");

  return text || undefined;
}

function getRealtimeRawType(event: RealtimeEvent): string {
  return typeof event.data.rawType === "string" ? event.data.rawType : event.type;
}

function getRealtimeInfo(event: RealtimeEvent): Record<string, unknown> | null {
  if (event.data.info && typeof event.data.info === "object" && !Array.isArray(event.data.info)) {
    return event.data.info as Record<string, unknown>;
  }

  return null;
}

function getRealtimePart(event: RealtimeEvent): Record<string, unknown> | null {
  if (event.data.part && typeof event.data.part === "object" && !Array.isArray(event.data.part)) {
    return event.data.part as Record<string, unknown>;
  }

  return null;
}

function summarizeUnknownValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => summarizeUnknownValue(item))
      .filter((item): item is string => Boolean(item))
      .join(", ");

    return joined || undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      "status",
      "state",
      "label",
      "message",
      "command",
      "filePath",
      "path",
      "query",
      "name",
      "toolName",
      "tool",
    ] as const;

    for (const key of preferredKeys) {
      const summarized = summarizeUnknownValue(record[key]);
      if (summarized) {
        return summarized;
      }
    }

    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function getToolState(part: SessionPart): ToolStateView {
  if (part.state && typeof part.state === "object" && !Array.isArray(part.state)) {
    return part.state as ToolStateView;
  }

  return {};
}

function getToolStatus(part: SessionPart): string | undefined {
  if (typeof part.state === "string") {
    return part.state;
  }

  return summarizeUnknownValue(getToolState(part).status);
}

function normalizeToolInput(part: SessionPart): Record<string, unknown> {
  if (part.input && typeof part.input === "object" && !Array.isArray(part.input)) {
    return part.input;
  }

  const stateInput = getToolState(part).input;
  if (stateInput && typeof stateInput === "object" && !Array.isArray(stateInput)) {
    return stateInput;
  }

  return {};
}

function normalizePreviewText(value: unknown, maxLength = 800): { text?: string; truncated: boolean } {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value === undefined || value === null
        ? ""
        : (() => {
            try {
              return JSON.stringify(value, null, 2);
            } catch {
              return String(value);
            }
          })();

  if (!raw) {
    return { text: undefined, truncated: false };
  }

  if (raw.length <= maxLength) {
    return { text: raw, truncated: false };
  }

  return {
    text: `${raw.slice(0, maxLength).trimEnd()}\n...`,
    truncated: true,
  };
}

function stringifyUnknownValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractTaggedContent(source: string | undefined, tag: string): string | undefined {
  if (!source) {
    return undefined;
  }

  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || undefined;
}

function buildReadPreview(outputText: string | undefined): { filePath?: string; readPreview?: string } {
  const filePath = extractTaggedContent(outputText, "path");
  const content = extractTaggedContent(outputText, "content");
  const entries = extractTaggedContent(outputText, "entries");
  const preview = normalizePreviewText(content ?? entries, 500).text;

  return {
    filePath,
    readPreview: preview,
  };
}

function buildToolRawContent(part: SessionPart, input: Record<string, unknown>, state: ToolStateView, status?: string) {
  const payload = {
    tool: part.toolName ?? part.tool,
    status,
    input,
    output: state.output,
    error: state.error,
    exit: state.exit,
  };

  return stringifyUnknownValue(payload) || "";
}

function buildToolInputPreview(input: Record<string, unknown>): string | undefined {
  const lines: string[] = [];
  const pushLine = (label: string, value: unknown) => {
    const summarized = summarizeUnknownValue(value);
    if (summarized) {
      lines.push(`${label}: ${summarized}`);
    }
  };

  pushLine("command", input.command);
  pushLine("filePath", input.filePath);
  pushLine("path", input.path);
  pushLine("pattern", input.pattern);
  pushLine("query", input.query);
  pushLine("url", input.url);
  pushLine("urls", input.urls);
  pushLine("description", input.description);
  pushLine("explanation", input.explanation);

  if (Array.isArray(input.args) && input.args.length) {
    const joinedArgs = input.args
      .map((item) => summarizeUnknownValue(item))
      .filter((item): item is string => Boolean(item))
      .join(" ");
    if (joinedArgs) {
      lines.push(`args: ${joinedArgs}`);
    }
  }

  if (Array.isArray(input.todos) && input.todos.length) {
    const todoLines = input.todos
      .slice(0, 4)
      .map((todo, index) => {
        const summarized = summarizeUnknownValue(todo);
        return summarized ? `- ${index + 1}. ${summarized}` : null;
      })
      .filter((line): line is string => Boolean(line));

    if (todoLines.length) {
      lines.push("todos:");
      lines.push(...todoLines);
    }
    if (input.todos.length > 4) {
      lines.push(`... +${input.todos.length - 4} more todos`);
    }
  }

  if (typeof input.prompt === "string" && input.prompt.trim()) {
    const promptPreview = normalizePreviewText(input.prompt, 320).text;
    if (promptPreview) {
      lines.push(`prompt:\n${promptPreview}`);
    }
  }

  if (lines.length > 0) {
    return lines.join("\n");
  }

  return normalizePreviewText(input, 500).text;
}

function buildToolHeadline(label: string, input: Record<string, unknown>): string | undefined {
  if (label === "bash") {
    return summarizeUnknownValue(input.command);
  }

  return (
    summarizeUnknownValue(input.command) ??
    summarizeUnknownValue(input.filePath) ??
    summarizeUnknownValue(input.path) ??
    summarizeUnknownValue(input.pattern) ??
    summarizeUnknownValue(input.query) ??
    summarizeUnknownValue(input.url)
  );
}

function stateColorFromStatus(status?: string): string {
  if (status === "completed") return "green";
  if (status === "running") return "processing";
  if (status === "error" || status === "failed") return "red";
  return "default";
}

function buildToolCallView(part: SessionPart, index: number): ToolCallView | null {
  if (part.type !== "tool") {
    return null;
  }

  const state = getToolState(part);
  const status = getToolStatus(part);
  const input = normalizeToolInput(part);
  const fullOutput = stringifyUnknownValue(state.output ?? state.error);
  const output = normalizePreviewText(state.output ?? state.error);
  const stateLabel =
    status === "completed"
      ? "完成"
      : status === "running"
        ? "执行中"
        : status === "error" || status === "failed"
          ? "失败"
          : status || "已触发";
  const label = summarizeUnknownValue(part.toolName) ?? summarizeUnknownValue(part.tool) ?? "工具调用";
  const toolKind = String(part.toolName ?? part.tool ?? "tool");
  const readDetails = toolKind === "read" ? buildReadPreview(fullOutput) : {};

  return {
    key: part.id || part.callID || `${label}-${index}`,
    kind: toolKind,
    label,
    stateLabel,
    stateColor: stateColorFromStatus(status),
    headline: buildToolHeadline(label, input),
    description: summarizeUnknownValue(input.description) ?? summarizeUnknownValue(input.explanation),
    goal: summarizeUnknownValue(input.goal),
    command: toolKind === "bash" ? summarizeUnknownValue(input.command) : undefined,
    filePath: summarizeUnknownValue(input.filePath) ?? readDetails.filePath,
    readPreview: readDetails.readPreview,
    inputPreview: buildToolInputPreview(input),
    fullOutput,
    outputPreview: output.text,
    outputTruncated: output.truncated,
    rawContent: buildToolRawContent(part, input, state, status),
    exitCode: typeof state.exit === "number" ? state.exit : undefined,
  };
}

const sessionMessageItems = computed<SessionMessageView[]>(() => {
  const persistedItems = Array.isArray(sessionMessages.value)
    ? sessionMessages.value
    .map((message, index) => {
      const raw = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
      const info = raw.info && typeof raw.info === "object" ? (raw.info as Record<string, unknown>) : {};
      const time = info.time && typeof info.time === "object" ? (info.time as Record<string, unknown>) : {};
      const parts = Array.isArray(raw.parts) ? (raw.parts as SessionPart[]) : [];
      const toolCalls = parts
        .map((part, partIndex) => buildToolCallView(part, partIndex))
        .filter((item): item is ToolCallView => Boolean(item));
      const messageId = typeof info.id === "string" ? info.id : `${index}`;
      const persistedText = normalizeTextParts(parts);
      const liveText = liveAssistantState.value.textById.get(messageId);
      const mergedText = liveText && liveText.length > (persistedText?.length ?? 0)
        ? liveText
        : persistedText;
      const role = typeof info.role === "string" ? info.role : "system";

      return {
        key: messageId,
        role,
        agent: typeof info.agent === "string" ? info.agent : undefined,
        text: mergedText,
        toolCalls,
        createdAt: parseMessageTimestamp(time.created ?? time.completed),
        isStreaming: role === "assistant" && liveAssistantState.value.incompleteIds.has(messageId),
      } satisfies SessionMessageView;
    })
    .filter((item) => item.text || item.toolCalls.length > 0 || item.isStreaming)
    : [];

  if (
    streamingAssistantDraft.value &&
    !persistedItems.some((item) => item.key === streamingAssistantDraft.value?.key)
  ) {
    return [...persistedItems, streamingAssistantDraft.value];
  }

  if (pendingAssistantMessage.value) {
    return [...persistedItems, pendingAssistantMessage.value];
  }

  return persistedItems;
});

const streamingRevealText = ref<Record<string, string>>({});
let streamingRevealTimer: ReturnType<typeof setTimeout> | null = null;
const STREAMING_PLACEHOLDER_TEXT = "正在生成...";
const STREAMING_REVEAL_INTERVAL_MS = 22;
const STREAMING_MINOR_PAUSE_MS = 90;
const STREAMING_MAJOR_PAUSE_MS = 180;

function stopMessageAutoScroll() {
  if (messageAutoScrollFrame !== null) {
    cancelAnimationFrame(messageAutoScrollFrame);
    messageAutoScrollFrame = null;
  }

  if (messageAutoScrollTimer) {
    clearTimeout(messageAutoScrollTimer);
    messageAutoScrollTimer = null;
  }
}

function scrollMessagesToBottom() {
  if (messageListEndRef.value) {
    messageListEndRef.value.scrollIntoView({ block: "end", inline: "nearest" });
  }

  if (messagesPaneRef.value) {
    messagesPaneRef.value.scrollTop = messagesPaneRef.value.scrollHeight;
  }

  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
}

async function scheduleMessageAutoScroll() {
  stopMessageAutoScroll();

  await nextTick();

  messageAutoScrollFrame = requestAnimationFrame(() => {
    messageAutoScrollFrame = null;
    scrollMessagesToBottom();

    messageAutoScrollTimer = setTimeout(() => {
      messageAutoScrollTimer = null;
      scrollMessagesToBottom();
    }, 96);
  });
}

function nextStreamingRevealProgress(fullText: string, currentLength: number): { nextLength: number; delay: number } {
  const remaining = Math.max(fullText.length - currentLength, 0);
  if (remaining <= 0) {
    return { nextLength: fullText.length, delay: STREAMING_REVEAL_INTERVAL_MS };
  }

  const baseStep = remaining > 320 ? 5 : remaining > 180 ? 4 : remaining > 96 ? 3 : 2;
  const lookahead = Math.min(6, remaining);
  const upcoming = fullText.slice(currentLength, currentLength + lookahead);
  const punctuationIndex = upcoming.search(/[，,、；：]/u);
  const sentenceBreakIndex = upcoming.search(/[。！？!?]/u);
  const lineBreakIndex = upcoming.indexOf("\n");

  if (sentenceBreakIndex >= 0) {
    return {
      nextLength: currentLength + sentenceBreakIndex + 1,
      delay: STREAMING_MAJOR_PAUSE_MS,
    };
  }

  if (lineBreakIndex >= 0) {
    return {
      nextLength: currentLength + lineBreakIndex + 1,
      delay: STREAMING_MAJOR_PAUSE_MS,
    };
  }

  if (punctuationIndex >= 0) {
    return {
      nextLength: currentLength + punctuationIndex + 1,
      delay: STREAMING_MINOR_PAUSE_MS,
    };
  }

  return {
    nextLength: Math.min(fullText.length, currentLength + baseStep),
    delay: STREAMING_REVEAL_INTERVAL_MS,
  };
}

function isStreamingPlaceholderText(text?: string): boolean {
  return !text || text === STREAMING_PLACEHOLDER_TEXT;
}

function stopStreamingReveal() {
  if (streamingRevealTimer) {
    clearTimeout(streamingRevealTimer);
    streamingRevealTimer = null;
  }
}

function syncStreamingReveal() {
  const nextReveal: Record<string, string> = {};
  let hasPendingReveal = false;
  let nextDelay = STREAMING_REVEAL_INTERVAL_MS;

  for (const item of sessionMessageItems.value) {
    if (!shouldAnimateMessage(item)) {
      continue;
    }

    const fullText = item.text;
    if (!fullText) {
      continue;
    }

    const current = streamingRevealText.value[item.key] ?? "";
    if (current.length >= fullText.length) {
      nextReveal[item.key] = fullText;
      continue;
    }

    const progress = nextStreamingRevealProgress(fullText, current.length);
    nextReveal[item.key] = fullText.slice(0, progress.nextLength);
    nextDelay = Math.max(nextDelay, progress.delay);

    if (progress.nextLength < fullText.length) {
      hasPendingReveal = true;
    }
  }

  streamingRevealText.value = nextReveal;
  stopStreamingReveal();
  void scheduleMessageAutoScroll();

  if (hasPendingReveal) {
    streamingRevealTimer = setTimeout(() => {
      streamingRevealTimer = null;
      syncStreamingReveal();
    }, nextDelay);
  }
}

function messageDisplayText(item: SessionMessageView): string | undefined {
  if (!item.text) {
    return item.text;
  }

  if (isStreamingPlaceholderText(item.text)) {
    return undefined;
  }

  const revealed = streamingRevealText.value[item.key];
  if (revealed && revealed.length < item.text.length) {
    return revealed;
  }

  if (shouldAnimateMessage(item)) {
    return revealed || undefined;
  }

  return item.text;
}

function shouldShowStreamingSkeleton(item: SessionMessageView): boolean {
  return Boolean(item.isStreaming && isStreamingPlaceholderText(item.text));
}

const confirmationBlockCache = new Map<string, ReturnType<typeof parseConfirmationBlock>>();

function getConfirmationBlock(item: SessionMessageView): ConfirmationBlock | null {
  if (item.role !== "assistant" || !item.text || item.isStreaming || item.isPending) return null;
  const text = messageDisplayText(item);
  if (!text) return null;
  if (confirmationBlockCache.has(item.key)) return confirmationBlockCache.get(item.key)!;
  const result = parseConfirmationBlock(text);
  confirmationBlockCache.set(item.key, result);
  return result;
}

/** Non-null version for template binding (guarded by v-if) */
function getConfirmationBlockNonNull(item: SessionMessageView): ConfirmationBlock {
  return getConfirmationBlock(item)!;
}

function handleConfirmationSubmit(reply: string) {
  if (!reply.trim()) return;
  continuePrompt.value = continuePrompt.value
    ? `${continuePrompt.value}\n\n${reply}`
    : reply;
  // Scroll to the composer for visibility
  nextTick(() => {
    const composer = document.querySelector(".reply-composer-shell__textarea");
    if (composer) (composer as HTMLElement).focus();
  });
}

function shouldAnimateMessage(item: SessionMessageView): boolean {
  if (item.role !== "assistant" || !item.text || isStreamingPlaceholderText(item.text)) {
    return false;
  }

  const revealed = streamingRevealText.value[item.key] ?? "";
  if (revealed.length > 0 && revealed.length < item.text.length) {
    return true;
  }

  const latestItem = sessionMessageItems.value[sessionMessageItems.value.length - 1];
  return latestItem?.key === item.key && liveAssistantState.value.textById.has(item.key);
}

watch(
  sessionMessageItems,
  () => {
    syncStreamingReveal();
    void scheduleMessageAutoScroll();
  },
  { immediate: true },
);

watch(selectedSessionId, () => {
  void scheduleMessageAutoScroll();
});

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

function formatAgentLabel(agent: string | undefined | null) {
  if (!agent) {
    return "-";
  }

  return agent === "build" || agent === "default-executor" ? "default-executor" : agent;
}

function formatDurationMs(durationMs: number | null | undefined) {
  if (!durationMs || durationMs <= 0) {
    return null;
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function pipelineStepStatus(status: RuntimePipelineStage["status"]) {
  switch (status) {
    case "completed":
      return "finish" as const;
    case "running":
      return "process" as const;
    case "failed":
      return "error" as const;
    case "pending":
    case "skipped":
    default:
      return "wait" as const;
  }
}

function pipelineStageDescription(stage: RuntimePipelineStage) {
  const parts = [
    stage.type === "graph-node" ? "图节点" : stage.type,
    stage.agent ? formatAgentLabel(stage.agent) : null,
    stage.model || null,
    formatDurationMs(stage.durationMs),
  ].filter(Boolean);

  if (stage.tokens && (stage.tokens.input > 0 || stage.tokens.output > 0)) {
    parts.push(`in ${stage.tokens.input} / out ${stage.tokens.output}`);
  }

  return parts.join(" · ");
}

function pipelineOutputPanelHeader(stage: RuntimePipelineStage) {
  if (typeof stage.messageCount === "number" && stage.messageCount > 0) {
    return `${stage.label} 输出 (${stage.messageCount} 条消息)`;
  }

  return stage.error ? `${stage.label} 异常详情` : `${stage.label} 输出`;
}

const compactInspectorTabs = computed(() => {
  const tabs: Array<{ key: "orchestration" | "pipeline" | "graph" | "events"; label: string; count?: number }> = [];

  if (useCompactInspector.value || showOrchestrationPanel.value) {
    tabs.push({ key: "orchestration", label: "编排决策" });
  }

  if (useCompactInspector.value || showPipelinePanel.value) {
    tabs.push({ key: "pipeline", label: "运行流水线", count: pipelineStages.value.length || undefined });
  }

  if (useCompactInspector.value || showGraphPanel.value) {
    tabs.push({ key: "graph", label: "任务图" });
  }

  if (useCompactInspector.value || showEventsPanel.value) {
    tabs.push({ key: "events", label: "任务事件", count: taskEvents.value.length || undefined });
  }

  return tabs;
});

function openCompactInspector(preferred?: "orchestration" | "pipeline" | "graph" | "events") {
  const availableKeys = compactInspectorTabs.value.map((item) => item.key);
  if (preferred && availableKeys.includes(preferred)) {
    compactInspectorTab.value = preferred;
  } else if (!availableKeys.includes(compactInspectorTab.value)) {
    compactInspectorTab.value = availableKeys[0] || "orchestration";
  }

  compactInspectorVisible.value = true;
}

function openReplyFocusWindow() {
  if (!taskId.value || typeof window === "undefined") {
    return;
  }

  const query = new URLSearchParams();
  query.set("embedded", "1");
  query.set("workbench", "1");
  query.set("reply", "1");

  const sessionId = selectedSessionId.value || (typeof route.query.session === "string" ? route.query.session : undefined);
  if (sessionId) {
    query.set("session", sessionId);
  }

  const targetUrl = `/tasks/${taskId.value}?${query.toString()}`;
  const bounds = readReplyFocusWindowBounds();
  const features = [
    "popup=yes",
    `width=${bounds?.width ?? 1480}`,
    `height=${bounds?.height ?? 960}`,
    `left=${bounds?.left ?? 120}`,
    `top=${bounds?.top ?? 72}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");
  window.open(targetUrl, "_blank", features);
}

type ReplyFocusWindowBounds = {
  width: number;
  height: number;
  left: number;
  top: number;
};

let replyFocusWindowPersistTimer: number | null = null;

function normalizeReplyFocusWindowBounds(raw: unknown): ReplyFocusWindowBounds | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const left = Number(candidate.left);
  const top = Number(candidate.top);

  if (![width, height, left, top].every((value) => Number.isFinite(value))) {
    return null;
  }

  return {
    width: Math.max(960, Math.round(width)),
    height: Math.max(720, Math.round(height)),
    left: Math.max(0, Math.round(left)),
    top: Math.max(0, Math.round(top)),
  };
}

function readReplyFocusWindowBounds(): ReplyFocusWindowBounds | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(REPLY_FOCUS_WINDOW_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return normalizeReplyFocusWindowBounds(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistReplyFocusWindowBounds() {
  if (typeof window === "undefined" || !isReplyFocusMode.value) {
    return;
  }

  const bounds = normalizeReplyFocusWindowBounds({
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenX,
    top: window.screenY,
  });

  if (!bounds) {
    return;
  }

  try {
    window.localStorage.setItem(REPLY_FOCUS_WINDOW_STORAGE_KEY, JSON.stringify(bounds));
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

function restoreReplyFocusWindowBounds() {
  if (typeof window === "undefined" || !isReplyFocusMode.value) {
    return;
  }

  const bounds = readReplyFocusWindowBounds();
  if (!bounds) {
    return;
  }

  try {
    window.resizeTo(bounds.width, bounds.height);
    window.moveTo(bounds.left, bounds.top);
  } catch {
    // Browser may block move or resize for non-popup contexts.
  }
}

function stopReplyFocusWindowPersistence() {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", persistReplyFocusWindowBounds);
    window.removeEventListener("pagehide", persistReplyFocusWindowBounds);
    window.removeEventListener("beforeunload", persistReplyFocusWindowBounds);
  }

  if (replyFocusWindowPersistTimer !== null) {
    window.clearInterval(replyFocusWindowPersistTimer);
    replyFocusWindowPersistTimer = null;
  }
}

function startReplyFocusWindowPersistence() {
  if (typeof window === "undefined" || !isReplyFocusMode.value) {
    return;
  }

  restoreReplyFocusWindowBounds();
  persistReplyFocusWindowBounds();
  window.addEventListener("resize", persistReplyFocusWindowBounds);
  window.addEventListener("pagehide", persistReplyFocusWindowBounds);
  window.addEventListener("beforeunload", persistReplyFocusWindowBounds);
  replyFocusWindowPersistTimer = window.setInterval(persistReplyFocusWindowBounds, 1000);
}

watch(
  isReplyFocusMode,
  (enabled) => {
    stopReplyFocusWindowPersistence();
    if (enabled) {
      startReplyFocusWindowPersistence();
    }
  },
  { immediate: true },
);

watch(compactInspectorTabs, (tabs) => {
  const availableKeys = tabs.map((item) => item.key);
  if (!availableKeys.includes(compactInspectorTab.value)) {
    compactInspectorTab.value = availableKeys[0] || "orchestration";
  }
}, { immediate: true });

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

function taskStatusColor(status?: string) {
  const map: Record<string, string> = {
    pending: "default",
    running: "processing",
    paused: "orange",
    completed: "green",
    failed: "red",
    cancelled: "default",
  };
  return map[status || ""] || "default";
}

function taskStatusLabel(status?: string) {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return map[status || ""] || status || "未知";
}

function selectedSessionLabel(session: SessionInfo) {
  const raw = session.title?.trim();
  return raw || `Session ${session.id.slice(0, 8)}`;
}

function sessionSummaryLabel(summary: SessionInfo["summary"]) {
  if (!summary) {
    return "暂无代码变更摘要";
  }

  return `+${summary.additions} -${summary.deletions} · ${summary.files} 文件`;
}

function selectSession(sessionId: string) {
  selectedSessionId.value = sessionId;
}

function sessionCardStyle(selected: boolean) {
  return buildTaskDetailSessionCardStyle(selected);
}

function messageRoleColor(role: string) {
  if (role === "assistant") return "cyan";
  if (role === "user") return "gold";
  return "default";
}

function messageRoleLabel(role: string) {
  if (role === "assistant") return "模型回复";
  if (role === "user") return "用户输入";
  return role || "系统";
}

function messageCardStyle(role: string) {
  return buildTaskDetailMessageCardStyle(role);
}

function formatEventTypeLabel(type?: string) {
  if (!type) {
    return "暂无事件";
  }

  const map: Record<string, string> = {
    "agent.started": "Agent 已启动",
    "agent.running": "Agent 运行中",
    "agent.resumed": "Agent 已恢复",
    "agent.paused": "Agent 已暂停",
    "agent.completed": "Agent 已完成",
    "agent.failed": "Agent 失败",
    "agent.stopped": "Agent 已停止",
    "task.completed": "任务已完成",
    "task.continued": "任务已续跑",
    "task.hooks.updated": "Hook 已更新",
    "session.updated": "分支已更新",
    "message.updated": "消息已更新",
  };

  return map[type] || type;
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

<style scoped>
.message-markdown {
  line-height: 1.42;
  word-break: break-word;
}

.message-markdown :deep(p) {
  margin: 0 0 4px;
}

.message-markdown :deep(h1),
.message-markdown :deep(h2),
.message-markdown :deep(h3),
.message-markdown :deep(h4),
.message-markdown :deep(h5),
.message-markdown :deep(h6) {
  margin: 10px 0 6px;
  line-height: 1.3;
}

.message-markdown :deep(h1) {
  font-size: 1.38em;
  margin-top: 14px;
  margin-bottom: 8px;
}

.message-markdown :deep(h2) {
  font-size: 1.26em;
  margin-top: 13px;
  margin-bottom: 8px;
}

.message-markdown :deep(h3) {
  font-size: 1.14em;
  margin-top: 12px;
  margin-bottom: 7px;
}

.message-markdown :deep(pre) {
  margin: 4px 0 6px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  font-size: 13px;
}
.message-markdown :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}
.message-markdown :deep(pre code) {
  background: none;
  padding: 0;
}
.message-markdown :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 4px 0 6px;
}
.message-markdown :deep(th),
.message-markdown :deep(td) {
  border: 1px solid #d9d9d9;
  padding: 6px 12px;
  text-align: left;
}
.message-markdown :deep(blockquote) {
  border-left: 3px solid #d9d9d9;
  margin: 4px 0 6px;
  padding: 4px 12px;
  color: rgba(0, 0, 0, 0.55);
}
.message-markdown :deep(ul),
.message-markdown :deep(ol) {
  margin: 2px 0 4px;
  padding-left: 20px;
}

.message-markdown :deep(li + li) {
  margin-top: 1px;
}

.message-markdown :deep(p + h1),
.message-markdown :deep(p + h2),
.message-markdown :deep(p + h3),
.message-markdown :deep(p + h4),
.message-markdown :deep(p + h5),
.message-markdown :deep(p + h6),
.message-markdown :deep(ul + h1),
.message-markdown :deep(ul + h2),
.message-markdown :deep(ul + h3),
.message-markdown :deep(ul + h4),
.message-markdown :deep(ul + h5),
.message-markdown :deep(ul + h6),
.message-markdown :deep(ol + h1),
.message-markdown :deep(ol + h2),
.message-markdown :deep(ol + h3),
.message-markdown :deep(ol + h4),
.message-markdown :deep(ol + h5),
.message-markdown :deep(ol + h6) {
  margin-top: 10px;
}

.message-markdown :deep(p + ul),
.message-markdown :deep(p + ol),
.message-markdown :deep(h1 + p),
.message-markdown :deep(h2 + p),
.message-markdown :deep(h3 + p),
.message-markdown :deep(h4 + p),
.message-markdown :deep(h5 + p),
.message-markdown :deep(h6 + p) {
  margin-top: 4px;
}

.message-markdown :deep(> :first-child) {
  margin-top: 0 !important;
}

.message-markdown :deep(> :last-child) {
  margin-bottom: 0 !important;
}

.message-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.streaming-skeleton {
  display: flex;
  justify-content: flex-start;
  padding: 6px 0 4px;
}

.streaming-skeleton__inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 2px;
}

.streaming-skeleton__inline-dot {
  display: inline-block;
  min-width: 0.24em;
  font-size: 22px;
  line-height: 1;
  font-weight: 700;
  color: rgba(76, 98, 142, 0.72);
  animation: thinking-dot-bounce 1s ease-in-out infinite;
}

.streaming-skeleton__inline-dot:nth-child(2) {
  animation-delay: 0.12s;
}

.streaming-skeleton__inline-dot:nth-child(3) {
  animation-delay: 0.24s;
}

.streaming-skeleton__inline-dot:nth-child(4) {
  animation-delay: 0.36s;
}

.reply-composer-shell {
  display: grid;
  gap: 10px;
  padding: 11px 14px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(31, 35, 41, 0.98) 0%, rgba(20, 23, 29, 0.98) 100%);
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.26);
}

.reply-composer-pill,
.reply-composer-action,
.reply-composer-round {
  border: 0;
  outline: none;
  appearance: none;
  font: inherit;
}

.reply-composer-shell__textarea {
  color: #f4f7fb;
}

.reply-composer-shell__textarea :deep(textarea) {
  min-height: 84px !important;
  padding: 0 !important;
  color: #f4f7fb !important;
  font-size: 14px;
  line-height: 1.55;
  background: transparent !important;
  box-shadow: none !important;
}

.reply-composer-shell__textarea :deep(textarea::placeholder) {
  color: rgba(226, 232, 240, 0.5);
}

.reply-composer-shell__textarea :deep(.ant-input-data-count) {
  display: none;
}

.reply-composer-shell__summary-inline {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.reply-composer-shell__summary-inline-list {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  gap: 10px;
  flex-wrap: wrap;
}

.reply-composer-shell__summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
}

.reply-composer-shell__summary-chip-label {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(226, 232, 240, 0.48);
  white-space: nowrap;
}

.reply-composer-shell__summary-chip-value {
  min-width: 0;
  color: rgba(241, 245, 249, 0.88);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.reply-composer-shell__summary-chip :deep(.ant-tag) {
  margin-inline-end: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reply-composer-shell__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: nowrap;
  min-width: 0;
}

.reply-composer-shell__toolbar,
.reply-composer-shell__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.reply-composer-shell__toolbar {
  flex: 1 1 auto;
  min-width: 0;
}

.reply-composer-shell__actions {
  flex: 0 0 auto;
  min-width: max-content;
}

.reply-composer-model-select {
  flex: 1 1 188px;
  min-width: 152px;
  max-width: min(46vw, 280px);
}

.reply-composer-model-select :deep(.ant-select-selector) {
  display: flex !important;
  align-items: center !important;
  min-height: 34px !important;
  padding: 0 11px !important;
  border: none !important;
  border-radius: 999px !important;
  background: rgba(255, 255, 255, 0.05) !important;
  box-shadow: none !important;
}

.reply-composer-model-select :deep(.ant-select-selection-wrap) {
  align-items: center;
}

.reply-composer-model-select :deep(.ant-select-selection-item),
.reply-composer-model-select :deep(.ant-select-arrow),
.reply-composer-model-select :deep(.ant-select-clear) {
  color: rgba(241, 245, 249, 0.88) !important;
}

.reply-composer-model-select :deep(.ant-select-selection-item),
.reply-composer-model-select :deep(.ant-select-selection-placeholder) {
  display: flex;
  align-items: center;
  min-height: 34px;
  line-height: 1.2;
}

.reply-composer-model-select :deep(.ant-select-selection-placeholder) {
  color: rgba(226, 232, 240, 0.56) !important;
}

.reply-composer-model-select :deep(.ant-select-selection-search-input) {
  color: rgba(241, 245, 249, 0.92) !important;
}

.reply-composer-model-select :deep(.ant-select-selector:hover),
.reply-composer-model-select.ant-select-focused :deep(.ant-select-selector) {
  background: rgba(255, 255, 255, 0.1) !important;
}

.reply-composer-pill,
.reply-composer-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 11px;
  border-radius: 999px;
  color: rgba(241, 245, 249, 0.88);
  background: rgba(255, 255, 255, 0.05);
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
  line-height: 1;
}

.reply-composer-pill:hover,
.reply-composer-action:hover {
  background: rgba(255, 255, 255, 0.1);
}

.reply-composer-pill:disabled,
.reply-composer-action:disabled,
.reply-composer-round:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.reply-composer-pill--icon {
  padding-inline: 10px;
}

.reply-composer-action--icon {
  min-width: 38px;
  justify-content: center;
  padding-inline: 10px;
}

.reply-composer-pill__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: rgba(255, 255, 255, 0.64);
}

.reply-composer-shell__hint,
.reply-composer-shell__counter {
  font-size: 11px;
  color: rgba(226, 232, 240, 0.56);
}

.reply-composer-round {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
}

.reply-composer-round--ghost {
  color: rgba(226, 232, 240, 0.68);
  background: rgba(255, 255, 255, 0.05);
}

.reply-composer-round--send {
  color: #f8fbff;
  background: linear-gradient(180deg, #4b74d1 0%, #3357a8 100%);
  box-shadow: 0 12px 22px rgba(75, 116, 209, 0.34);
}

.reply-composer-round--send:not(:disabled):hover {
  transform: translateY(-1px);
}

.compact-inspector-launcher {
  position: fixed;
  right: 18px;
  bottom: 132px;
  z-index: 40;
}

.compact-inspector-launcher__button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid rgba(92, 59, 24, 0.14);
  border-radius: 999px;
  background: rgba(255, 250, 244, 0.96);
  color: rgba(92, 59, 24, 0.82);
  box-shadow: 0 8px 18px rgba(92, 59, 24, 0.1);
  cursor: pointer;
}

.compact-inspector-launcher__button:hover {
  background: rgba(255, 247, 237, 0.98);
}

.compact-inspector-launcher__icon {
  font-size: 18px;
  line-height: 1;
}

.compact-inspector-launcher__count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(191, 219, 254, 0.9);
  color: rgba(30, 64, 175, 0.92);
  font-size: 11px;
  text-align: center;
}

.compact-inspector-drawer :deep(.ant-drawer-content) {
  background: rgba(255, 250, 244, 0.98);
}

.compact-inspector-drawer :deep(.ant-drawer-header) {
  background: rgba(255, 247, 237, 0.98);
  padding: 12px 14px;
}

.compact-inspector-drawer :deep(.ant-drawer-body) {
  padding: 10px 12px 12px;
}

.compact-inspector-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.compact-inspector-tabs__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid rgba(92, 59, 24, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  color: rgba(92, 59, 24, 0.72);
  cursor: pointer;
}

.compact-inspector-tabs__button--active {
  border-color: rgba(59, 130, 246, 0.24);
  background: rgba(219, 234, 254, 0.88);
  color: rgba(30, 64, 175, 0.92);
}

.compact-inspector-tabs__count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 900px) {
  .reply-composer-shell__footer {
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .reply-composer-shell__footer::-webkit-scrollbar {
    display: none;
  }

  .reply-composer-shell__toolbar,
  .reply-composer-shell__actions {
    width: auto;
  }

  .reply-composer-model-select {
    min-width: 136px;
    max-width: min(42vw, 220px);
  }

  .compact-inspector-launcher {
    right: 12px;
    bottom: 112px;
  }
}

.tool-fold-header {
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
}
.tool-fold-header:hover {
  color: rgba(0, 0, 0, 0.85);
}

.message-state-tag,
.composer-waiting-hint {
  position: relative;
}

.message-state-tag::after,
.composer-waiting-hint::after {
  content: "";
  display: inline-block;
  width: 0.8em;
  margin-left: 4px;
  overflow: hidden;
  vertical-align: baseline;
  animation: waiting-dots 1.2s steps(4, end) infinite;
}

.message-state-tag--pending::after,
.composer-waiting-hint::after {
  content: "...";
}

.message-state-tag--streaming {
  animation: waiting-pulse 1.1s ease-in-out infinite;
}

.message-state-tag--streaming::after {
  content: "...";
}

@keyframes waiting-dots {
  0% {
    width: 0;
  }

  100% {
    width: 0.8em;
  }
}

@keyframes waiting-pulse {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.72;
  }

  50% {
    transform: translateY(-1px);
    opacity: 1;
  }
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -20% 0;
  }
}

@keyframes skeleton-breathe {
  0%,
  100% {
    opacity: 0.72;
    transform: scaleX(0.995);
  }

  50% {
    opacity: 1;
    transform: scaleX(1);
  }
}

@keyframes thinking-dot-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.42;
  }

  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>
