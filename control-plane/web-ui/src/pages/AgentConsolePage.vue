<template>
  <div style="padding: 24px">
    <!-- ── Header ── -->
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
        <a-tooltip :title="connectionTooltip">
          <a-badge
            :status="realtimeStore.connected ? 'success' : 'error'"
            :text="connectionLabel"
          />
        </a-tooltip>
        <a-button
          v-if="!realtimeStore.connected"
          size="small"
          type="link"
          @click="handleReconnect"
        >
          重连
        </a-button>
        <a-button @click="refreshAgents" :loading="loading">刷新</a-button>
      </a-space>
    </a-flex>

    <!-- ── Stats Row (6 metrics) ── -->
    <a-card size="small" style="margin-bottom: 16px">
      <a-row :gutter="8">
        <a-col :span="4" style="text-align: center">
          <a-statistic title="运行中" :value="runningCount" :value-style="{ color: '#3b82f6' }" />
        </a-col>
        <a-col :span="4" style="text-align: center">
          <a-statistic title="已暂停" :value="pausedCount" :value-style="{ color: '#f59e0b' }" />
        </a-col>
        <a-col :span="4" style="text-align: center">
          <a-statistic title="失败" :value="failedCount" :value-style="{ color: '#ef4444' }" />
        </a-col>
        <a-col :span="4" style="text-align: center">
          <a-statistic title="已停止" :value="stoppedCount" :value-style="{ color: '#94a3b8' }" />
        </a-col>
        <a-col :span="4" style="text-align: center">
          <a-statistic title="已完成" :value="completedCount" :value-style="{ color: '#22c55e' }" />
        </a-col>
        <a-col :span="4" style="text-align: center">
          <a-statistic title="总计" :value="allAgentRuns.length" />
        </a-col>
      </a-row>
    </a-card>

    <!-- ── Main Content ── -->
    <a-row :gutter="[16, 16]">
      <!-- ═══ Left: Instance List ═══ -->
      <a-col :xs="24" :xl="8">
        <a-card size="small">
          <template #title>
            <a-flex align="center" :gap="8">
              <span>Agent 实例</span>
              <a-badge
                :count="allAgentRuns.length"
                :show-zero="true"
                :number-style="{ backgroundColor: '#64748b', fontSize: '11px' }"
                :overflow-count="999"
              />
            </a-flex>
          </template>

          <!-- Search -->
          <a-input
            :value="searchText"
            placeholder="搜索 ID / 类型 / 任务..."
            size="small"
            allow-clear
            style="margin-bottom: 8px"
            @update:value="searchText = String($event ?? '')"
          >
            <template #prefix>
              <SearchOutlined style="color: #94a3b8" />
            </template>
          </a-input>

          <!-- Status filter -->
          <a-radio-group
            :value="statusFilter"
            size="small"
            button-style="solid"
            style="margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 4px"
            @update:value="statusFilter = String($event ?? '')"
          >
            <a-radio-button value="">全部</a-radio-button>
            <a-radio-button value="running">运行中</a-radio-button>
            <a-radio-button value="paused">暂停</a-radio-button>
            <a-radio-button value="failed">失败</a-radio-button>
          </a-radio-group>

          <!-- Instance list -->
          <div v-if="filteredRuns.length === 0 && allAgentRuns.length > 0" style="padding: 16px 0">
            <a-empty description="没有匹配的实例" />
          </div>
          <div v-else-if="allAgentRuns.length === 0" style="padding: 16px 0">
            <a-empty description="暂无 Agent 实例">
              <template #image>
                <RobotOutlined style="font-size: 36px; color: #94a3b8" />
              </template>
            </a-empty>
          </div>
          <div v-else style="max-height: 580px; overflow-y: auto">
            <div
              v-for="run in filteredRuns"
              :key="run.agentRunId"
              :class="[
                'instance-item',
                { 'instance-item-selected': selectedAgentId === run.agentRunId },
              ]"
              @click="handleSelectInstance(run.agentRunId)"
            >
              <a-flex align="center" :gap="6">
                <RobotOutlined style="color: #64748b; font-size: 14px" />
                <span style="font-size: 13px; font-weight: 500">{{
                  run.agentType || 'Agent'
                }}</span>
                <a-tag
                  :color="statusColor(run.status)"
                  style="margin: 0; font-size: 10px"
                >
                  {{ statusLabel(run.status) }}
                </a-tag>
              </a-flex>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px">
                {{ run.agentRunId.slice(0, 12) }}
                <span v-if="run.taskId"> · 任务 {{ run.taskId.slice(0, 8) }}</span>
                <span v-if="run.updatedAt">
                  · {{ formatRelativeTime(run.updatedAt) }}
                </span>
              </div>
            </div>
          </div>
        </a-card>
      </a-col>

      <!-- ═══ Right: Detail / Overview Panel ═══ -->
      <a-col :xs="24" :xl="16">
        <!-- ── Empty state guidance (no instances at all) ── -->
        <a-card v-if="allAgentRuns.length === 0" size="small">
          <a-result
            status="info"
            title="Agent 控制台"
            sub-title="当 AI Agent 被分配任务后，运行实例将显示在此处。您可以暂停、恢复、终止 Agent，或在暂停时注入指令。"
          >
            <template #extra>
              <a-space>
                <router-link to="/tasks">
                  <a-button type="primary">去任务页创建任务</a-button>
                </router-link>
                <router-link to="/projects">
                  <a-button>查看项目配置</a-button>
                </router-link>
                <router-link to="/approvals">
                  <a-button>查看待审批</a-button>
                </router-link>
              </a-space>
            </template>
          </a-result>
          <a-typography-paragraph
            type="secondary"
            style="text-align: center; margin-top: 8px"
          >
            <strong>Agent 实例生命周期：</strong>
            创建任务 → Agent 启动(运行中) → 可暂停/注入指令 → 审批阻塞(如有)
            → 完成/失败/停止
          </a-typography-paragraph>
        </a-card>

        <!-- ── No instance selected: Quick guidance + General event stream ── -->
        <template v-else-if="!selectedRun">
          <!-- Quick Guidance -->
          <a-card size="small" style="margin-bottom: 16px">
            <template #title>
              <a-flex align="center" :gap="8">
                <SendOutlined />
                <span>快速注入指令</span>
              </a-flex>
            </template>
            <a-flex :gap="12" wrap="wrap">
              <a-select
                :value="selectedAgentId"
                style="min-width: 240px; flex: 1"
                placeholder="选择 Agent"
                :options="agentSelectOptions"
                allow-clear
                @update:value="setSelectedAgentId"
              />
              <a-input
                :value="quickGuidance"
                placeholder="输入指令内容..."
                style="flex: 2"
                @press-enter="handleQuickGuidance"
                @update:value="quickGuidance = String($event ?? '')"
              />
              <a-radio-group
                :value="guidanceMode"
                size="small"
                @update:value="guidanceMode = $event"
              >
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

          <!-- General Event Stream -->
          <a-card size="small">
            <template #title>
              <a-flex align="center" :gap="8">
                <span>Agent 事件流</span>
                <a-badge
                  :count="agentEvents.length"
                  :overflow-count="999"
                  :number-style="{
                    backgroundColor: '#64748b',
                    fontSize: '11px',
                  }"
                />
              </a-flex>
            </template>
            <template #extra>
              <a-select
                :value="eventTypeFilter"
                size="small"
                style="width: 120px"
                @update:value="eventTypeFilter = String($event ?? 'all')"
              >
                <a-select-option value="all">全部类型</a-select-option>
                <a-select-option value="status">状态变化</a-select-option>
                <a-select-option value="guidance">指令交互</a-select-option>
                <a-select-option value="error">异常</a-select-option>
              </a-select>
            </template>

            <a-empty
              v-if="filteredGlobalEvents.length === 0"
              description="等待 Agent 事件..."
            />
            <div v-else style="max-height: 500px; overflow-y: auto">
              <a-timeline mode="left">
                <a-timeline-item
                  v-for="evt in filteredGlobalEvents.slice(0, 50)"
                  :key="evt.id"
                  :color="eventColor(evt.type)"
                >
                  <div style="cursor: pointer" @click="openEventDetail(evt)">
                    <div style="font-size: 12px">
                      <a-tag
                        :color="eventColor(evt.type)"
                        style="font-size: 10px"
                      >
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
                      style="
                        font-size: 11px;
                        color: #64748b;
                        margin-top: 2px;
                      "
                    >
                      {{ JSON.stringify(evt.data).slice(0, 80) }}
                    </div>
                  </div>
                </a-timeline-item>
              </a-timeline>
            </div>
          </a-card>
        </template>

        <!-- ── Instance selected: Detail Tabs ── -->
        <template v-else>
          <!-- Instance header with actions -->
          <a-card size="small" style="margin-bottom: 16px">
            <a-flex justify="space-between" align="center" wrap="wrap" :gap="8">
              <a-flex align="center" :gap="8">
                <RobotOutlined style="font-size: 18px" />
                <span style="font-size: 16px; font-weight: 600">{{
                  selectedRun.agentType || 'Agent'
                }}</span>
                <a-typography-text code style="font-size: 12px">{{
                  selectedRun.agentRunId.slice(0, 16)
                }}</a-typography-text>
                <a-tag
                  :color="statusColor(selectedRun.status)"
                  style="font-size: 12px"
                >
                  {{ statusLabel(selectedRun.status) }}
                </a-tag>
              </a-flex>
              <a-space>
                <a-button
                  v-if="selectedRun.status === 'running'"
                  size="small"
                  :loading="actionLoading === selectedRun.agentRunId"
                  @click="handlePause(selectedRun.agentRunId)"
                >
                  <template #icon><PauseCircleOutlined /></template>
                  暂停
                </a-button>
                <a-button
                  v-if="selectedRun.status === 'paused'"
                  size="small"
                  type="primary"
                  :loading="actionLoading === selectedRun.agentRunId"
                  @click="handleResume(selectedRun.agentRunId)"
                >
                  <template #icon><PlayCircleOutlined /></template>
                  恢复
                </a-button>
                <a-popconfirm
                  v-if="
                    selectedRun.status === 'running' ||
                    selectedRun.status === 'paused'
                  "
                  title="确定终止此 Agent？此操作不可恢复。"
                  @confirm="handleTerminate(selectedRun.agentRunId)"
                >
                  <a-button
                    size="small"
                    danger
                    :loading="actionLoading === selectedRun.agentRunId"
                  >
                    <template #icon><StopOutlined /></template>
                    终止
                  </a-button>
                </a-popconfirm>
                <a-button
                  size="small"
                  @click="handleSelectInstance(undefined)"
                >
                  取消选择
                </a-button>
              </a-space>
            </a-flex>
          </a-card>

          <!-- Tabs -->
          <a-tabs
            :activeKey="detailTab"
            @update:activeKey="detailTab = String($event)"
          >
            <!-- ── Tab: Detail ── -->
            <a-tab-pane key="detail" tab="详情">
              <a-row :gutter="[16, 16]">
                <a-col :xs="24" :md="12">
                  <a-card title="基本信息" size="small">
                    <a-descriptions :column="1" size="small">
                      <a-descriptions-item label="实例 ID">
                        <a-typography-text code copyable>{{
                          selectedRun.agentRunId
                        }}</a-typography-text>
                      </a-descriptions-item>
                      <a-descriptions-item label="Agent 类型">
                        {{ selectedRun.agentType || 'Agent' }}
                      </a-descriptions-item>
                      <a-descriptions-item label="状态">
                        <a-tag :color="statusColor(selectedRun.status)">{{
                          statusLabel(selectedRun.status)
                        }}</a-tag>
                      </a-descriptions-item>
                      <a-descriptions-item label="关联任务">
                        <router-link
                          v-if="selectedRun.taskId"
                          :to="`/workbench?task=${selectedRun.taskId}`"
                        >
                          <a-typography-text code>{{
                            selectedRun.taskId.slice(0, 12)
                          }}</a-typography-text>
                          → 查看任务详情
                        </router-link>
                        <span v-else>-</span>
                      </a-descriptions-item>
                      <a-descriptions-item label="会话 ID">
                        <a-typography-text
                          v-if="selectedRun.subSessionId"
                          code
                          style="font-size: 11px"
                        >
                          {{ selectedRun.subSessionId.slice(0, 16) }}
                        </a-typography-text>
                        <span v-else>-</span>
                      </a-descriptions-item>
                      <a-descriptions-item label="最近活动">
                        {{
                          selectedRun.updatedAt
                            ? formatRelativeTime(selectedRun.updatedAt)
                            : '-'
                        }}
                      </a-descriptions-item>
                    </a-descriptions>
                  </a-card>
                </a-col>

                <a-col :xs="24" :md="12">
                  <!-- Failure block -->
                  <a-card
                    v-if="
                      selectedRun.status === 'failed' ||
                      selectedRun.status === 'stopped'
                    "
                    size="small"
                  >
                    <template #title>
                      <a-flex align="center" :gap="8">
                        <ExclamationCircleOutlined style="color: #ef4444" />
                        <span>{{
                          selectedRun.status === 'failed'
                            ? '失败信息'
                            : '停止信息'
                        }}</span>
                      </a-flex>
                    </template>
                    <div v-if="failureInfo">
                      <a-alert
                        :type="
                          selectedRun.status === 'failed' ? 'error' : 'warning'
                        "
                        show-icon
                        style="margin-bottom: 12px"
                      >
                        <template #message>
                          {{
                            failureInfo.reason || '未提供结构化失败原因'
                          }}
                        </template>
                        <template v-if="failureInfo.detail" #description>
                          <div style="font-size: 12px; margin-top: 4px">
                            {{ failureInfo.detail }}
                          </div>
                        </template>
                      </a-alert>
                      <div
                        style="
                          font-size: 11px;
                          color: #94a3b8;
                          margin-bottom: 8px;
                        "
                      >
                        发生时间:
                        {{ failureInfo.ts ? formatTime(failureInfo.ts) : '-' }}
                      </div>
                    </div>
                    <div v-else>
                      <a-alert
                        type="warning"
                        message="未发现结构化失败事件"
                        show-icon
                        style="margin-bottom: 12px"
                      />
                    </div>
                    <a-space>
                      <router-link
                        v-if="selectedRun.taskId"
                        :to="`/workbench?task=${selectedRun.taskId}`"
                      >
                        <a-button size="small">查看任务上下文</a-button>
                      </router-link>
                      <a-button size="small" @click="copyDiagnostics">
                        复制诊断信息
                      </a-button>
                    </a-space>
                  </a-card>

                  <!-- Inline guidance for selected instance -->
                  <a-card
                    v-if="
                      selectedRun.status === 'paused' ||
                      selectedRun.status === 'running'
                    "
                    title="注入指令"
                    size="small"
                  >
                    <a-input-search
                      :value="inlineGuidance[selectedRun.agentRunId]"
                      placeholder="输入指令内容..."
                      enter-button="发送"
                      size="small"
                      :loading="actionLoading === selectedRun.agentRunId"
                      @search="
                        handleInlineGuidance(selectedRun.agentRunId)
                      "
                      @update:value="
                        inlineGuidance[selectedRun.agentRunId] = String(
                          $event ?? '',
                        )
                      "
                    />
                    <div
                      v-if="selectedRun.status === 'running'"
                      style="
                        font-size: 11px;
                        color: #f59e0b;
                        margin-top: 4px;
                      "
                    >
                      提示: Agent 运行中时注入的指令将在下次暂停时生效
                    </div>
                  </a-card>

                  <!-- Recent events summary -->
                  <a-card
                    title="最近事件"
                    size="small"
                    :style="
                      selectedRun.status === 'failed' ||
                      selectedRun.status === 'stopped'
                        ? 'margin-top: 16px'
                        : selectedRun.status === 'paused' ||
                            selectedRun.status === 'running'
                          ? 'margin-top: 16px'
                          : ''
                    "
                  >
                    <div
                      v-if="selectedAgentEvents.length === 0"
                      style="color: #94a3b8; font-size: 12px"
                    >
                      暂无事件
                    </div>
                    <div v-else>
                      <div
                        v-for="evt in selectedAgentEvents.slice(0, 5)"
                        :key="evt.id"
                        style="
                          font-size: 11px;
                          color: #94a3b8;
                          padding: 3px 0;
                          cursor: pointer;
                        "
                        @click="openEventDetail(evt)"
                      >
                        <a-tag
                          :color="eventColor(evt.type)"
                          style="font-size: 10px"
                        >
                          {{ evt.type.split('.').pop() }}
                        </a-tag>
                        {{ formatTime(evt.ts) }}
                        <span
                          v-if="evt.data?.content"
                          style="color: #64748b; margin-left: 4px"
                        >
                          {{ String(evt.data.content).slice(0, 40) }}
                        </span>
                      </div>
                      <a-button
                        v-if="selectedAgentEvents.length > 5"
                        type="link"
                        size="small"
                        @click="detailTab = 'events'"
                      >
                        查看全部事件 ({{ selectedAgentEvents.length }})
                      </a-button>
                    </div>
                  </a-card>
                </a-col>
              </a-row>
            </a-tab-pane>

            <!-- ── Tab: Events ── -->
            <a-tab-pane key="events">
              <template #tab>
                事件
                <a-badge
                  :count="selectedAgentEvents.length"
                  :overflow-count="999"
                  :number-style="{
                    backgroundColor: '#64748b',
                    fontSize: '10px',
                    marginLeft: '4px',
                  }"
                />
              </template>

              <!-- Event filters -->
              <a-flex :gap="8" style="margin-bottom: 12px" wrap="wrap">
                <a-select
                  :value="eventTypeFilter"
                  size="small"
                  style="width: 140px"
                  @update:value="
                    eventTypeFilter = String($event ?? 'all')
                  "
                >
                  <a-select-option value="all">全部类型</a-select-option>
                  <a-select-option value="status">状态变化</a-select-option>
                  <a-select-option value="guidance"
                    >指令交互</a-select-option
                  >
                  <a-select-option value="error">异常</a-select-option>
                </a-select>
                <a-input
                  :value="eventSearchText"
                  size="small"
                  placeholder="搜索事件内容..."
                  allow-clear
                  style="width: 200px"
                  @update:value="
                    eventSearchText = String($event ?? '')
                  "
                />
              </a-flex>

              <a-empty
                v-if="filteredSelectedEvents.length === 0"
                description="暂无匹配事件"
              />
              <div v-else style="max-height: 500px; overflow-y: auto">
                <a-timeline mode="left">
                  <a-timeline-item
                    v-for="evt in filteredSelectedEvents.slice(0, 100)"
                    :key="evt.id"
                    :color="eventColor(evt.type)"
                  >
                    <div
                      style="cursor: pointer"
                      @click="openEventDetail(evt)"
                    >
                      <div style="font-size: 12px">
                        <a-tag
                          :color="eventColor(evt.type)"
                          style="font-size: 10px"
                        >
                          {{ evt.type }}
                        </a-tag>
                      </div>
                      <div style="font-size: 11px; color: #94a3b8">
                        {{ formatTime(evt.ts) }} ·
                        {{ formatRelativeTime(Date.parse(evt.ts)) }}
                      </div>
                      <div
                        v-if="
                          evt.data && Object.keys(evt.data).length > 0
                        "
                        style="
                          font-size: 11px;
                          color: #64748b;
                          margin-top: 2px;
                        "
                      >
                        {{ JSON.stringify(evt.data).slice(0, 120) }}
                      </div>
                    </div>
                  </a-timeline-item>
                </a-timeline>
              </div>
            </a-tab-pane>

            <!-- ── Tab: Commands ── -->
            <a-tab-pane key="commands">
              <template #tab>
                指令历史
                <a-badge
                  :count="guidanceHistory.length"
                  :overflow-count="999"
                  :number-style="{
                    backgroundColor: '#7c3aed',
                    fontSize: '10px',
                    marginLeft: '4px',
                  }"
                />
              </template>

              <a-empty
                v-if="guidanceHistory.length === 0"
                description="暂无指令记录"
              >
                <a-typography-paragraph
                  type="secondary"
                  style="font-size: 12px"
                >
                  在 Agent 暂停时注入指令，指令记录将显示在此处。
                </a-typography-paragraph>
              </a-empty>

              <div v-else style="max-height: 500px; overflow-y: auto">
                <div
                  v-for="cmd in guidanceHistory"
                  :key="cmd.id"
                  style="
                    padding: 8px 12px;
                    border-left: 3px solid #7c3aed;
                    margin-bottom: 8px;
                    background: #f8fafc;
                    border-radius: 4px;
                  "
                >
                  <a-flex justify="space-between" align="center">
                    <a-tag color="purple" style="font-size: 10px">
                      {{
                        cmd.type === 'guidance.injected'
                          ? '指令注入'
                          : cmd.type.split('.').pop()
                      }}
                    </a-tag>
                    <span style="font-size: 11px; color: #94a3b8">
                      {{ formatTime(cmd.ts) }} ·
                      {{ formatRelativeTime(Date.parse(cmd.ts)) }}
                    </span>
                  </a-flex>
                  <div
                    v-if="cmd.data?.content"
                    style="
                      font-size: 13px;
                      margin-top: 4px;
                      color: #1e293b;
                    "
                  >
                    {{ String(cmd.data.content) }}
                  </div>
                  <div
                    v-if="cmd.data?.mode"
                    style="
                      font-size: 11px;
                      color: #94a3b8;
                      margin-top: 2px;
                    "
                  >
                    模式:
                    {{
                      cmd.data.mode === 'reply' ? '等待回复' : '仅注入'
                    }}
                  </div>
                  <div
                    v-if="cmd.data?.response"
                    style="
                      font-size: 12px;
                      margin-top: 6px;
                      padding: 6px 8px;
                      background: #e0f2fe;
                      border-radius: 4px;
                      color: #0f172a;
                    "
                  >
                    <strong style="font-size: 11px; color: #3b82f6"
                      >Agent 回复:</strong
                    >
                    <div>{{ String(cmd.data.response) }}</div>
                  </div>
                </div>
              </div>
            </a-tab-pane>
          </a-tabs>
        </template>
      </a-col>
    </a-row>

    <!-- ── Event Detail Drawer ── -->
    <a-drawer
      :open="eventDetailVisible"
      title="事件详情"
      placement="right"
      :width="480"
      @close="eventDetailVisible = false"
    >
      <template v-if="eventDetailData">
        <a-descriptions
          :column="1"
          bordered
          size="small"
          style="margin-bottom: 16px"
        >
          <a-descriptions-item label="事件类型">
            <a-tag :color="eventColor(eventDetailData.type)">{{
              eventDetailData.type
            }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="时间">
            {{ formatTime(eventDetailData.ts) }}
          </a-descriptions-item>
          <a-descriptions-item label="相对时间">
            {{ formatRelativeTime(Date.parse(eventDetailData.ts)) }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="eventDetailData.agentRunId"
            label="实例 ID"
          >
            <a-typography-text code>{{
              eventDetailData.agentRunId
            }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item
            v-if="eventDetailData.taskId"
            label="任务 ID"
          >
            <router-link :to="`/tasks/${eventDetailData.taskId}`">
              <a-typography-text code>{{
                eventDetailData.taskId
              }}</a-typography-text>
            </router-link>
          </a-descriptions-item>
          <a-descriptions-item
            v-if="eventDetailData.sessionId"
            label="会话 ID"
          >
            <a-typography-text code style="font-size: 11px">{{
              eventDetailData.sessionId
            }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item
            v-if="eventDetailData.projectId"
            label="项目 ID"
          >
            <a-typography-text code style="font-size: 11px">{{
              eventDetailData.projectId
            }}</a-typography-text>
          </a-descriptions-item>
        </a-descriptions>

        <a-card title="事件数据" size="small">
          <template #extra>
            <a-button size="small" type="link" @click="copyEventPayload">
              复制
            </a-button>
          </template>
          <pre
            style="
              white-space: pre-wrap;
              word-break: break-all;
              font-size: 12px;
              max-height: 400px;
              overflow-y: auto;
              margin: 0;
            "
          >{{ JSON.stringify(eventDetailData.data, null, 2) }}</pre>
        </a-card>
      </template>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import {
  ExclamationCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { injectGuidance, listAgentRuns, pauseAgent, resumeAgent, terminateAgent } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { type RealtimeEvent, useRealtimeStore } from "../stores/realtime";

// ── Types ──────────────────────────────────────────────────────────

interface AgentRun {
  agentRunId: string;
  subSessionId?: string;
  status: string;
  taskId: string;
  agentType?: string;
  updatedAt?: number;
}

type AgentRunStatus = "running" | "paused" | "completed" | "failed" | "stopped";

// ── State ──────────────────────────────────────────────────────────

const realtimeStore = useRealtimeStore();
const loading = ref(false);
const actionLoading = ref<string | null>(null);
const guidanceLoading = ref(false);

const registeredRuns = ref<AgentRun[]>([]);
const selectedAgentId = ref<string | undefined>(undefined);
const quickGuidance = ref("");
const guidanceMode = ref<"reply" | "noReply">("reply");
const inlineGuidance = reactive<Record<string, string>>({});

// New state
const searchText = ref("");
const statusFilter = ref("");
const detailTab = ref("detail");
const eventTypeFilter = ref("all");
const eventSearchText = ref("");
const eventDetailVisible = ref(false);
const eventDetailData = ref<RealtimeEvent | null>(null);

// ── Helpers ────────────────────────────────────────────────────────

function setSelectedAgentId(value: unknown) {
  selectedAgentId.value = value == null ? undefined : String(value);
}

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

function normalizeAgentStatus(status?: string): AgentRunStatus | undefined {
  const statusMap: Record<string, AgentRunStatus> = {
    running: "running",
    paused: "paused",
    completed: "completed",
    failed: "failed",
    stopped: "stopped",
  };
  return status ? statusMap[status] : undefined;
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
  if (type.includes("started") || type.includes("running") || type.includes("resumed"))
    return "blue";
  if (type.includes("paused")) return "orange";
  if (type.includes("completed")) return "green";
  if (type.includes("failed") || type.includes("stopped")) return "red";
  if (type.includes("guidance")) return "purple";
  return "default";
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString();
}

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  if (Number.isNaN(diff) || diff < 0) return "";
  if (diff < 60000) return `${Math.round(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}小时前`;
  return `${Math.round(diff / 86400000)}天前`;
}

function filterEventsByType(events: RealtimeEvent[]): RealtimeEvent[] {
  if (eventTypeFilter.value === "status") {
    return events.filter((e) =>
      [
        "agent.started",
        "agent.running",
        "agent.resumed",
        "agent.paused",
        "agent.completed",
        "agent.failed",
        "agent.stopped",
      ].includes(e.type),
    );
  }
  if (eventTypeFilter.value === "guidance") {
    return events.filter((e) => e.type === "guidance.injected" || e.type.includes("guidance"));
  }
  if (eventTypeFilter.value === "error") {
    return events.filter(
      (e) => e.type.includes("failed") || e.type.includes("error") || e.type.includes("stopped"),
    );
  }
  return events;
}

// ── Computed ───────────────────────────────────────────────────────

const connectionLabel = computed(() => (realtimeStore.connected ? "实时连接" : "未连接"));

const connectionTooltip = computed(() => {
  if (realtimeStore.connected) {
    const lastEvent = realtimeStore.events[0];
    return lastEvent ? `已连接 · 最近事件: ${formatTime(lastEvent.ts)}` : "已连接 · 等待事件";
  }
  return '未连接 · 点击"重连"按钮恢复实时连接';
});

const latestRealtimeRuns = computed(() => {
  const runs = new Map<string, AgentRun>();
  for (const evt of [...realtimeStore.events].reverse()) {
    if (!evt.type.startsWith("agent.") || !evt.agentRunId) continue;
    const existing = runs.get(evt.agentRunId);
    runs.set(evt.agentRunId, {
      agentRunId: evt.agentRunId,
      subSessionId: evt.sessionId || existing?.subSessionId,
      status: normalizeAgentEventStatus(evt.type) ?? existing?.status ?? "running",
      taskId: evt.taskId || existing?.taskId || "",
      agentType:
        typeof evt.data?.agentType === "string"
          ? evt.data.agentType
          : existing?.agentType || "Agent",
      updatedAt: Date.parse(evt.ts),
    });
  }
  return runs;
});

const allAgentRuns = computed(() => {
  const map = new Map<string, AgentRun>();
  for (const run of registeredRuns.value) {
    map.set(run.agentRunId, {
      ...run,
      status: normalizeAgentStatus(run.status) ?? run.status,
      agentType: run.agentType || "Agent",
      updatedAt: run.updatedAt ?? 0,
    });
  }
  for (const [agentRunId, realtimeRun] of latestRealtimeRuns.value.entries()) {
    const existing = map.get(agentRunId);
    map.set(agentRunId, {
      ...existing,
      ...realtimeRun,
      subSessionId: realtimeRun.subSessionId || existing?.subSessionId,
      taskId: realtimeRun.taskId || existing?.taskId || "",
      agentType: realtimeRun.agentType || existing?.agentType || "Agent",
      status: realtimeRun.status || existing?.status || "running",
      updatedAt: realtimeRun.updatedAt ?? existing?.updatedAt ?? 0,
    });
  }
  const order: Record<string, number> = {
    running: 0,
    paused: 1,
    stopped: 2,
    completed: 3,
    failed: 4,
  };
  return Array.from(map.values()).sort((a, b) => {
    const d = (order[a.status] ?? 5) - (order[b.status] ?? 5);
    return d !== 0 ? d : (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
});

const filteredRuns = computed(() => {
  let runs = allAgentRuns.value;
  if (statusFilter.value) {
    runs = runs.filter((r) => r.status === statusFilter.value);
  }
  if (searchText.value.trim()) {
    const q = searchText.value.trim().toLowerCase();
    runs = runs.filter(
      (r) =>
        r.agentRunId.toLowerCase().includes(q) ||
        (r.agentType || "").toLowerCase().includes(q) ||
        (r.taskId || "").toLowerCase().includes(q),
    );
  }
  return runs;
});

const selectedRun = computed(() => {
  if (!selectedAgentId.value) return undefined;
  return allAgentRuns.value.find((r) => r.agentRunId === selectedAgentId.value);
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
  realtimeStore.events.filter((e) => e.type.startsWith("agent.") || e.type === "guidance.injected"),
);

const runningCount = computed(
  () => allAgentRuns.value.filter((r) => r.status === "running").length,
);
const pausedCount = computed(() => allAgentRuns.value.filter((r) => r.status === "paused").length);
const failedCount = computed(() => allAgentRuns.value.filter((r) => r.status === "failed").length);
const stoppedCount = computed(
  () => allAgentRuns.value.filter((r) => r.status === "stopped").length,
);
const completedCount = computed(
  () => allAgentRuns.value.filter((r) => r.status === "completed").length,
);

const selectedAgentEvents = computed(() => {
  if (!selectedAgentId.value) return [];
  return realtimeStore.events.filter((e) => e.agentRunId === selectedAgentId.value);
});

const filteredGlobalEvents = computed(() => filterEventsByType(agentEvents.value));

const filteredSelectedEvents = computed(() => {
  let events = filterEventsByType(selectedAgentEvents.value);
  if (eventSearchText.value.trim()) {
    const q = eventSearchText.value.trim().toLowerCase();
    events = events.filter(
      (e) => e.type.toLowerCase().includes(q) || JSON.stringify(e.data).toLowerCase().includes(q),
    );
  }
  return events;
});

const guidanceHistory = computed(() => {
  if (!selectedAgentId.value) return [];
  return realtimeStore.events.filter(
    (e) =>
      e.agentRunId === selectedAgentId.value &&
      (e.type === "guidance.injected" || e.type.includes("guidance")),
  );
});

const failureInfo = computed(() => {
  if (!selectedRun.value) return null;
  const { status } = selectedRun.value;
  if (status !== "failed" && status !== "stopped") return null;
  const failEvent = selectedAgentEvents.value.find(
    (e) => e.type.includes("failed") || e.type.includes("stopped") || e.type.includes("error"),
  );
  if (!failEvent) return null;
  const data = failEvent.data || {};
  return {
    reason: String(data.reason || data.error || data.message || data.content || ""),
    detail: data.detail ? String(data.detail) : data.stack ? String(data.stack) : "",
    ts: failEvent.ts,
  };
});

// ── Actions ────────────────────────────────────────────────────────

function handleSelectInstance(id: string | undefined) {
  selectedAgentId.value = id;
  if (id) detailTab.value = "detail";
}

function handleReconnect() {
  const authStore = useAuthStore();
  if (authStore.token) {
    realtimeStore.disconnect();
    realtimeStore.connect(authStore.token);
    message.info("正在重新连接...");
  }
}

function openEventDetail(evt: RealtimeEvent) {
  eventDetailData.value = evt;
  eventDetailVisible.value = true;
}

function copyEventPayload() {
  if (!eventDetailData.value) return;
  navigator.clipboard.writeText(JSON.stringify(eventDetailData.value, null, 2));
  message.success("已复制到剪贴板");
}

function copyDiagnostics() {
  if (!selectedRun.value) return;
  const diag = {
    agentRunId: selectedRun.value.agentRunId,
    status: selectedRun.value.status,
    taskId: selectedRun.value.taskId,
    agentType: selectedRun.value.agentType,
    failureInfo: failureInfo.value,
    recentEvents: selectedAgentEvents.value.slice(0, 10).map((e) => ({
      type: e.type,
      ts: e.ts,
      data: e.data,
    })),
  };
  navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
  message.success("诊断信息已复制到剪贴板");
}

async function refreshAgents() {
  loading.value = true;
  try {
    registeredRuns.value = (await listAgentRuns()).map((run) => ({
      ...run,
      status: normalizeAgentStatus(run.status) ?? run.status,
    }));
  } catch {
    registeredRuns.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleAction(agentRunId: string, action: () => Promise<unknown>) {
  actionLoading.value = agentRunId;
  try {
    await action();
    await refreshAgents();
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

// ── Lifecycle ──────────────────────────────────────────────────────

onMounted(() => refreshAgents());
</script>

<style scoped>
.instance-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
  margin-bottom: 4px;
}

.instance-item:hover {
  background: #f1f5f9;
  border-color: #e2e8f0;
}

.instance-item-selected {
  background: #eff6ff;
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 1px #3b82f6;
}
</style>
