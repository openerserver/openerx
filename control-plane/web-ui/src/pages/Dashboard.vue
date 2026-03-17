<template>
  <div style="padding: 24px">
    <a-typography-title :level="3">
      Dashboard
      <a-typography-text
        v-if="projectStore.currentProject"
        type="secondary"
        style="font-size: 14px; margin-left: 12px"
      >
        {{ projectStore.currentProject.name }}
      </a-typography-text>
    </a-typography-title>

    <a-card size="small" style="margin-bottom: 16px">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" :gap="12">
          <span>Provider Token 总览</span>
          <a-space wrap>
            <a-radio-group :value="providerRange" size="small" @update:value="handleRangeChange">
              <a-radio-button value="24h">24h</a-radio-button>
              <a-radio-button value="7d">7d</a-radio-button>
              <a-radio-button value="30d">30d</a-radio-button>
              <a-radio-button value="monthly">按月</a-radio-button>
            </a-radio-group>
          </a-space>
        </a-flex>
      </template>

      <a-alert
        style="margin-bottom: 16px"
        type="info"
        show-icon
        :message="providerInsightTitle"
        :description="providerInsightDescription"
      />

      <a-empty
        v-if="showProviderEmpty"
        description="当前项目暂无可用的 provider token 统计"
      />

      <template v-else>
        <a-row :gutter="[12, 12]" style="margin-bottom: 16px">
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">{{ providerTotalLabel }}</div>
              <div class="provider-card-value">{{ formatTokenCount(providerSummary?.totalTokens) }}</div>
              <div class="provider-card-hint">{{ providerSummary?.requestCount ?? providerSummary?.totalRuns ?? 0 }} 次模型请求</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">模型请求次数</div>
              <div class="provider-card-value">{{ formatCount(providerSummary?.requestCount ?? providerSummary?.totalRuns) }}</div>
              <div class="provider-card-hint">完成 {{ providerSummary?.completedRuns ?? 0 }} 次</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">Top Provider</div>
              <div class="provider-card-value">{{ topProviderLabel }}</div>
              <div class="provider-card-hint">占比 {{ formatPercent(providerSummary?.topProviderShare) }}</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">平均完成成本</div>
              <div class="provider-card-value">{{ formatTokenCount(providerSummary?.avgTokensPerCompletedRun) }}</div>
              <div class="provider-card-hint">每个完成任务平均 Tokens</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">风险 Provider / 异常模型</div>
              <div class="provider-card-value">{{ formatProviderRiskSummary(providerSummary?.riskProviderCount, abnormalModelTotal) }}</div>
              <div class="provider-card-hint">优先检查 {{ formatCount(abnormalModelTotal) }} 个异常模型的配置与路由策略</div>
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :xl="16">
            <a-card size="small" title="Provider 排行" :loading="providerTokenLoading">
              <a-table
                :data-source="providerRows"
                :columns="providerColumns"
                :pagination="false"
                size="small"
                row-key="providerId"
                :custom-row="providerRowProps"
              >
                <template #expandedRowRender="{ record }">
                  <div v-if="record.models?.length" class="provider-model-panel">
                    <div class="provider-model-panel__header">
                      <div class="provider-model-panel__title">模型明细</div>
                      <a-space wrap :size="8" class="provider-model-panel__summary">
                        <a-tag color="red">失败请求 {{ formatCount(record.failedModelCount) }}</a-tag>
                        <a-tag color="orange">空耗请求 {{ formatCount(record.emptyModelCount) }}</a-tag>
                        <a-tag color="green">正常消耗 {{ formatCount(record.normalModelCount) }}</a-tag>
                      </a-space>
                    </div>
                    <a-table
                      :data-source="record.models"
                      :columns="providerModelColumns"
                      :pagination="false"
                      size="small"
                      row-key="route"
                    >
                      <template #bodyCell="{ column, record: model }">
                        <template v-if="column.key === 'model'">
                          <a-space direction="vertical" :size="0">
                            <a-space :size="6" wrap>
                              <span>{{ modelDisplayLabel(model) }}</span>
                              <a-tag :color="modelDisplayGroupColor(model.displayGroup)">{{ modelDisplayGroupLabel(model.displayGroup) }}</a-tag>
                            </a-space>
                            <a-typography-text type="secondary">{{ model.route }}</a-typography-text>
                            <a-typography-text v-if="model.displayGroup === 'empty'" type="warning">有请求但未完成，且未产生 token 消耗</a-typography-text>
                            <a-typography-text v-else-if="model.displayGroup === 'failed'" type="danger">存在失败请求，建议优先检查失败原因与模型适配</a-typography-text>
                            <a-button
                              v-if="model.displayGroup !== 'normal'"
                              size="small"
                              type="link"
                              class="provider-action-link"
                              @click.stop="openProviderSettings(modelProviderId(model))"
                            >
                              去调整模型
                            </a-button>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'tokens'">
                          <a-space direction="vertical" :size="0">
                            <span>{{ formatTokenCount(model.tokenUsed) }}</span>
                            <a-typography-text type="secondary">占 provider {{ formatPercent(model.tokenShareWithinProvider) }}</a-typography-text>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'requests'">
                          <a-space direction="vertical" :size="0">
                            <span>{{ formatCount(model.requestCount ?? model.totalRuns) }}</span>
                            <a-typography-text type="secondary">完成 {{ formatCount(model.completedRuns) }}</a-typography-text>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'quality'">
                          <a-space direction="vertical" :size="0">
                            <span>失败率 {{ formatPercent(model.failureRate) }}</span>
                            <a-typography-text type="secondary">介入率 {{ formatPercent(model.interventionRate) }}</a-typography-text>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'efficiency'">
                          <a-space direction="vertical" :size="0">
                            <span>{{ formatTokenCount(model.avgTokensPerCompletedRun) }}</span>
                            <a-typography-text type="secondary">平均每次 {{ formatTokenCount(model.avgTokensPerRun) }}</a-typography-text>
                          </a-space>
                        </template>
                      </template>
                    </a-table>
                  </div>
                </template>
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'provider'">
                    <a-space direction="vertical" :size="2">
                      <a-space>
                        <a-tag :color="providerHealthColor(record.health)">{{ record.label }}</a-tag>
                        <a-typography-text type="secondary">{{ record.providerId }}</a-typography-text>
                      </a-space>
                      <a-space wrap :size="8">
                        <a-typography-text type="secondary">{{ formatCount(record.models?.length ?? 0) }} 个模型</a-typography-text>
                        <a-tag v-if="record.abnormalModelCount > 0" color="orange">{{ formatCount(record.abnormalModelCount) }} 个异常</a-tag>
                      </a-space>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'tokens'">
                    <a-space direction="vertical" :size="0">
                      <span>{{ formatTokenCount(record.tokenUsed) }}</span>
                      <a-typography-text type="secondary">{{ formatPercent(record.tokenShare) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'requests'">
                    <a-space direction="vertical" :size="0">
                      <span>{{ formatCount(record.requestCount ?? record.totalRuns) }}</span>
                      <a-typography-text type="secondary">完成 {{ formatCount(record.completedRuns) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'quality'">
                    <a-space direction="vertical" :size="0">
                      <span>完成 {{ record.completedRuns }}</span>
                      <a-typography-text type="secondary">失败率 {{ formatPercent(record.failureRate) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'efficiency'">
                    <a-space direction="vertical" :size="0">
                      <span>{{ formatTokenCount(record.avgTokensPerCompletedRun) }}</span>
                      <a-typography-text type="secondary">介入率 {{ formatPercent(record.interventionRate) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'status'">
                    <a-space direction="vertical" :size="0">
                      <a-tag :color="providerRecommendationColor(record.recommendationAction)">{{ record.recommendationLabel }}</a-tag>
                      <a-typography-text type="secondary">{{ record.recommendationMessage }}</a-typography-text>
                      <a-button
                        size="small"
                        type="link"
                        class="provider-action-link"
                        @click.stop="openProviderSettings(record.providerId)"
                      >
                        {{ record.recommendationAction === 'downgrade' ? '去调整模型' : '查看模型配置' }}
                      </a-button>
                    </a-space>
                  </template>
                </template>
              </a-table>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="8">
            <a-card size="small" :loading="providerTokenLoading">
              <template #title>
                <a-flex justify="space-between" align="center" wrap="wrap" :gap="8">
                  <span>月度视图</span>
                  <a-radio-group :value="monthlyViewMode" size="small" @update:value="handleMonthlyViewChange">
                    <a-radio-button value="trend">总量趋势</a-radio-button>
                    <a-radio-button value="share">Provider 占比</a-radio-button>
                    <a-radio-button value="efficiency">平均完成成本</a-radio-button>
                  </a-radio-group>
                </a-flex>
              </template>
              <a-empty v-if="monthlyTotals.length === 0" description="暂无月度数据" />
              <a-space v-else direction="vertical" style="width: 100%" :size="12">
                <template v-if="monthlyViewMode === 'trend'">
                  <div v-for="item in monthlyTrendRows" :key="`trend-${item.month}`" class="monthly-chart-row">
                    <a-flex justify="space-between" align="center" :gap="12" style="margin-bottom: 6px">
                      <span>{{ item.month }}</span>
                      <a-space :size="10">
                        <a-typography-text>{{ formatTokenCount(item.tokenUsed) }}</a-typography-text>
                        <a-typography-text type="secondary">完成 {{ item.completedRuns }}</a-typography-text>
                      </a-space>
                    </a-flex>
                    <div class="monthly-bar-track">
                      <div class="monthly-bar-single monthly-bar-single--trend" :style="{ width: `${item.widthPercent}%` }" />
                    </div>
                  </div>
                </template>

                <template v-else-if="monthlyViewMode === 'share'">
                  <div v-for="item in monthlyShareRows" :key="`share-${item.month}`" class="monthly-chart-row">
                    <a-flex justify="space-between" align="center" :gap="12" style="margin-bottom: 6px">
                      <span>{{ item.month }}</span>
                      <a-space :size="10">
                        <a-typography-text>{{ formatTokenCount(item.tokenUsed) }}</a-typography-text>
                        <a-typography-text type="secondary">完成 {{ item.completedRuns }}</a-typography-text>
                      </a-space>
                    </a-flex>
                    <div class="monthly-bar-track">
                      <div class="monthly-bar-total" :style="{ width: `${item.widthPercent}%` }">
                        <div
                          v-for="segment in item.segments"
                          :key="`${item.month}-${segment.providerId}`"
                          class="monthly-bar-segment"
                          :style="{ width: `${segment.sharePercent}%`, background: segment.color }"
                        />
                      </div>
                    </div>
                    <div class="monthly-chart-legend">
                      <span v-for="segment in item.segments" :key="`${segment.providerId}-legend-${item.month}`">
                        {{ segment.label }} {{ formatPercent(segment.shareRatio) }}
                      </span>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div v-for="item in monthlyEfficiencyRows" :key="`eff-${item.month}`" class="monthly-chart-row">
                    <a-flex justify="space-between" align="center" :gap="12" style="margin-bottom: 6px">
                      <span>{{ item.month }}</span>
                      <a-space :size="10">
                        <a-typography-text>{{ formatTokenCount(item.avgTokensPerCompletedRun) }}</a-typography-text>
                        <a-typography-text type="secondary">每个完成任务平均 Tokens</a-typography-text>
                      </a-space>
                    </a-flex>
                    <div class="monthly-bar-track">
                      <div class="monthly-bar-single monthly-bar-single--efficiency" :style="{ width: `${item.widthPercent}%` }" />
                    </div>
                  </div>
                </template>
              </a-space>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-card>

    <div data-testid="dashboard-governance-overview-section" style="margin-bottom: 16px">
      <a-card size="small">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" :gap="12">
          <span>付费执行治理总览</span>
          <a-button size="small" :loading="governanceLoading" @click="loadGovernanceOverview">
            刷新
          </a-button>
        </a-flex>
      </template>

      <a-alert
        style="margin-bottom: 16px"
        :type="governanceInsightTone"
        show-icon
        :message="governanceInsightTitle"
        :description="governanceInsightDescription"
      />

      <a-empty
        v-if="showGovernanceEmpty"
        description="当前窗口没有 paid execution 治理事件与风险任务"
      />

      <template v-else>
        <a-row :gutter="[12, 12]" style="margin-bottom: 16px">
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="governanceLoading">
              <div class="provider-card-label">Block 命中</div>
              <div class="provider-card-value">{{ formatCount(governanceSummary?.blockedCount) }}</div>
              <div class="provider-card-hint">当前窗口被 guard 拦截的 paid execution 次数</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="governanceLoading">
              <div class="provider-card-label">Breaker 触发</div>
              <div class="provider-card-value">{{ formatCount(governanceSummary?.breakerCount) }}</div>
              <div class="provider-card-hint">运行中熔断并终止后续请求的次数</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="governanceLoading">
              <div class="provider-card-label">Active Lease</div>
              <div class="provider-card-value">{{ formatCount(governanceSummary?.activeLeaseCount) }}</div>
              <div class="provider-card-hint">当前仍有效的付费执行租约数</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="governanceLoading">
              <div class="provider-card-label">Top 风险任务</div>
              <div class="provider-card-value">{{ formatCount(governanceSummary?.topRiskTaskCount) }}</div>
              <div class="provider-card-hint">按风险评分排序的高风险任务 Top 5</div>
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :xl="16">
            <div data-testid="dashboard-governance-top-risk-card">
              <a-card size="small" title="Top 风险任务" :loading="governanceLoading">
                <a-table
                  :data-source="governanceTopRiskRows"
                  :pagination="false"
                  size="small"
                  row-key="taskId"
                >
            <a-table-column title="任务 / 项目" key="task">
              <template #default="{ record }">
                <div>
                  <div>{{ record.title || '未记录' }}</div>
                  <div style="color: rgba(0, 0, 0, 0.45)">{{ record.projectName }} / {{ record.orgName }}</div>
                  <div style="color: rgba(0, 0, 0, 0.45)">{{ record.projectGroupLabel }}</div>
                </div>
              </template>
            </a-table-column>
            <a-table-column title="治理信号" key="signals" :width="220">
              <template #default="{ record }">
                <a-space wrap :size="4">
                  <a-tag v-if="record.blockedCount > 0" color="red">block {{ record.blockedCount }}</a-tag>
                  <a-tag v-if="record.breakerCount > 0" color="volcano">breaker {{ record.breakerCount }}</a-tag>
                  <a-tag v-if="record.parallelCandidateCount > 0">parallel {{ record.parallelCandidateCount }}</a-tag>
                  <a-tag v-if="record.judgeRequestCount > 0">judge {{ record.judgeRequestCount }}</a-tag>
                  <a-tag v-if="record.hookRequestCount > 0">hook {{ record.hookRequestCount }}</a-tag>
                </a-space>
              </template>
            </a-table-column>
            <a-table-column title="风险分" key="riskScore" :width="110">
              <template #default="{ record }">
                <div>
                  <div>{{ formatCount(record.riskScore) }}</div>
                  <div style="color: rgba(0, 0, 0, 0.45)">{{ formatGovernanceDriverLabel(record.dominantDriver) }}</div>
                </div>
              </template>
            </a-table-column>
            <a-table-column title="调用 / 成本" key="usage" :width="160">
              <template #default="{ record }">
                <div>
                  <div>{{ formatCount(record.requestCount) }} 次</div>
                  <div style="color: rgba(0, 0, 0, 0.45)">{{ formatUsd(record.costUsd) }} / {{ formatTokenCount(record.totalTokens) }}</div>
                </div>
              </template>
            </a-table-column>
            <a-table-column title="最近 Guard" key="decision" :width="200">
              <template #default="{ record }">
                <div>
                  <div>{{ formatGuardDecisionLabel(record.lastGuardDecision) }}</div>
                  <div style="color: rgba(0, 0, 0, 0.45)">{{ record.lastGuardReason || '无最近 guard 原因' }}</div>
                </div>
              </template>
            </a-table-column>
            <a-table-column title="最近 Breaker" key="breaker" :width="220">
              <template #default="{ record }">
                <div>
                  <div>{{ record.breakerCount > 0 ? '最近熔断原因' : '未触发' }}</div>
                  <div style="color: rgba(0, 0, 0, 0.45)">{{ record.lastBreakerReason || '无最近 breaker 原因' }}</div>
                </div>
              </template>
            </a-table-column>
            <a-table-column title="跳转" key="actions" :width="160">
              <template #default="{ record }">
                <a-space wrap :size="4">
                  <a-button
                    type="link"
                    size="small"
                    :data-testid="`open-governance-task-${record.taskId}`"
                    @click="openGovernanceTask(record)"
                  >
                    任务详情
                  </a-button>
                  <a-button
                    type="link"
                    size="small"
                    :data-testid="`open-governance-project-${record.projectId}`"
                    @click="openGovernanceProject(record)"
                  >
                    项目页
                  </a-button>
                </a-space>
              </template>
            </a-table-column>
                </a-table>
              </a-card>
            </div>
          </a-col>

          <a-col :xs="24" :xl="8">
            <div data-testid="dashboard-governance-event-stream-card">
              <a-card size="small" title="最近 breaker / guard 事件流" :loading="governanceLoading">
                <a-empty
                  v-if="governanceEventRows.length === 0"
                  description="当前窗口没有可展示的治理事件"
                />
                <div v-else class="governance-event-stream">
                  <div
                    v-for="event in governanceEventRows"
                    :key="event.id"
                    class="governance-event-item"
                    :data-testid="`governance-event-${event.id}`"
                  >
                    <a-space wrap :size="6" style="margin-bottom: 4px">
                      <a-tag :color="event.eventKind === 'breaker' ? 'volcano' : 'blue'">
                        {{ event.eventKindLabel }}
                      </a-tag>
                      <a-typography-text type="secondary">{{ formatTime(event.occurredAt) }}</a-typography-text>
                    </a-space>
                    <div class="governance-event-item__title">{{ event.projectName }} / {{ event.title }}</div>
                    <div class="governance-event-item__meta">{{ event.orgName }} / {{ event.projectGroupLabel }}</div>
                    <div v-if="event.guardDecisionLabel && event.eventKind === 'guard'" class="governance-event-item__decision">
                      {{ event.guardDecisionLabel }}
                    </div>
                    <div class="governance-event-item__summary">
                      <a-tag :color="event.reasonSummaryColor">{{ event.reasonSummaryLabel }}</a-tag>
                    </div>
                    <div class="governance-event-item__reason">{{ event.reason || '未记录原因' }}</div>
                  </div>
                </div>
              </a-card>
            </div>
          </a-col>
        </a-row>
      </template>
      </a-card>
    </div>

    <div data-testid="dashboard-runtime-ledger-section" style="margin-bottom: 16px">
      <a-card size="small">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" :gap="12">
          <span>跨项目运行治理总览</span>
          <a-space wrap>
            <a-select
              :value="runtimeOrgFilter"
              style="min-width: 160px"
              :options="runtimeOrgOptions"
              size="small"
              @update:value="runtimeOrgFilter = String($event || 'all')"
            />
            <a-select
              :value="runtimeProjectGroupFilter"
              style="min-width: 180px"
              :options="runtimeProjectGroupOptions"
              size="small"
              @update:value="runtimeProjectGroupFilter = String($event || 'all')"
            />
            <a-button
              size="small"
              :loading="runtimeLedgerLoading"
              @click="loadRuntimeLedgerOverview"
            >
              刷新
            </a-button>
          </a-space>
        </a-flex>
      </template>

      <a-alert
        style="margin-bottom: 16px"
        :type="runtimeGovernanceInsightTone"
        show-icon
        :message="runtimeGovernanceInsightTitle"
        :description="runtimeGovernanceInsightDescription"
      />

      <a-empty
        v-if="showRuntimeLedgerEmpty"
        description="当前没有可用的 runtime usage ledger，可在项目页或执行链路落下首批账本后再查看。"
      />

      <template v-else>
        <a-row :gutter="[12, 12]" style="margin-bottom: 16px">
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="runtimeLedgerLoading">
              <div class="provider-card-label">覆盖项目</div>
              <div class="provider-card-value">{{ formatCount(runtimeGovernanceProjectCount) }}</div>
              <div class="provider-card-hint">失败加载 {{ formatCount(runtimeGovernanceFailedProjects) }}</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="runtimeLedgerLoading">
              <div class="provider-card-label">账本批次</div>
              <div class="provider-card-value">{{ formatCount(runtimeLedgerSummary?.ledgerCount) }}</div>
              <div class="provider-card-hint">总请求 {{ formatCount(runtimeLedgerSummary?.requestCount) }}</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="runtimeLedgerLoading">
              <div class="provider-card-label">累计 Token</div>
              <div class="provider-card-value">{{ formatTokenCount(runtimeLedgerSummary?.totalTokens) }}</div>
              <div class="provider-card-hint">累计成本 {{ formatUsd(runtimeLedgerSummary?.costUsd) }}</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="runtimeLedgerLoading">
              <div class="provider-card-label">高消耗执行</div>
              <div class="provider-card-value">{{ formatCount(highCostLedgerRows.length) }}</div>
              <div class="provider-card-hint">跨项目按成本排序的最近窗口 Top 5</div>
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :xl="15">
            <div data-testid="dashboard-runtime-high-cost-card">
              <a-card size="small" title="最近高消耗执行" :loading="runtimeLedgerLoading">
              <a-table
                :data-source="highCostLedgerRows"
                :pagination="false"
                size="small"
                row-key="id"
              >
                <a-table-column title="项目 / 会话" key="session">
                  <template #default="{ record }">
                    <div>
                      <div>{{ record.projectName }}</div>
                      <div style="color: rgba(0, 0, 0, 0.45)">{{ record.orgName }} / {{ record.projectGroupLabel }}</div>
                      <div style="color: rgba(0, 0, 0, 0.45)">{{ record.runtimeSessionId }}</div>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column title="任务" key="task" :width="150">
                  <template #default="{ record }">
                    <div>
                      <div>{{ record.taskId || '未绑定任务' }}</div>
                      <div>{{ record.runtimeSessionId }}</div>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column title="入口" key="entrypoint" :width="150">
                  <template #default="{ record }">
                    <div>
                      <div>{{ record.executionSource }}</div>
                      <div style="color: rgba(0, 0, 0, 0.45)">{{ record.entrypointType }}</div>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column title="放大来源" key="amplification" :width="180">
                  <template #default="{ record }">
                    <a-space wrap :size="4">
                      <a-tag v-for="label in runtimeLedgerAmplificationTags(record)" :key="label">
                        {{ label }}
                      </a-tag>
                    </a-space>
                  </template>
                </a-table-column>
                <a-table-column title="Token" data-index="totalTokens" key="totalTokens" :width="110" />
                <a-table-column title="成本" key="cost" :width="110">
                  <template #default="{ record }">
                    {{ formatUsd(record.costUsd) }}
                  </template>
                </a-table-column>
                <a-table-column title="完成时间" key="finishedAt" :width="140">
                  <template #default="{ record }">
                    {{ formatTime(record.finishedAt || record.updatedAt) }}
                  </template>
                </a-table-column>
                <a-table-column title="跳转" key="actions" :width="190">
                  <template #default="{ record }">
                    <a-space wrap :size="4">
                      <a-button
                        type="link"
                        size="small"
                        :data-testid="`open-runtime-ledger-${record.id}`"
                        @click="openProjectRuntimeLedger(record)"
                      >
                        打开账本
                      </a-button>
                      <a-button
                        v-if="record.taskId"
                        type="link"
                        size="small"
                        :data-testid="`open-runtime-ledger-task-${record.taskId}`"
                        @click="openRuntimeLedgerTask(record)"
                      >
                        任务详情
                      </a-button>
                    </a-space>
                  </template>
                </a-table-column>
              </a-table>
              </a-card>
            </div>
          </a-col>

          <a-col :xs="24" :xl="9">
            <div data-testid="dashboard-runtime-amplification-card">
              <a-card size="small" title="风险放大来源概览" :loading="runtimeLedgerLoading">
              <a-space direction="vertical" style="width: 100%" :size="12">
                <div class="monthly-summary-item">
                  <div class="provider-card-label">Parallel 候选放大</div>
                  <div class="provider-card-value">{{ formatCount(runtimeAmplificationSummary.parallelCandidates) }}</div>
                  <div class="provider-card-hint">candidateCount 大于 1 的执行批次累计候选数</div>
                </div>
                <div class="monthly-summary-item">
                  <div class="provider-card-label">Judge 请求放大</div>
                  <div class="provider-card-value">{{ formatCount(runtimeAmplificationSummary.judgeRequests) }}</div>
                  <div class="provider-card-hint">judgeRequestCount 累计命中</div>
                </div>
                <div class="monthly-summary-item">
                  <div class="provider-card-label">Hook 请求放大</div>
                  <div class="provider-card-value">{{ formatCount(runtimeAmplificationSummary.hookRequests) }}</div>
                  <div class="provider-card-hint">hookRequestCount 累计命中</div>
                </div>
                <div class="monthly-summary-item">
                  <div class="provider-card-label">最近风险会话</div>
                  <div class="provider-card-value">{{ topAmplifiedLedgerLabel }}</div>
                  <div class="provider-card-hint">当前窗口内放大来源最多的执行批次</div>
                </div>
              </a-space>
              </a-card>
            </div>
          </a-col>
        </a-row>
      </template>
      </a-card>
    </div>

    <a-row :gutter="[16, 16]">
      <!-- Active Tasks -->
      <a-col :xs="24" :lg="8">
        <a-card title="活跃任务" size="small">
          <a-empty v-if="activeTasks.length === 0" description="暂无活跃任务" />
          <a-list v-else :data-source="activeTasks" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <router-link :to="`/workbench?task=${item.taskId}`">
                  <a-space>
                    <a-typography-text code>{{
                      item.taskId.slice(0, 8)
                    }}</a-typography-text>
                    <a-tag>{{ item.lastEvent }}</a-tag>
                  </a-space>
                </router-link>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- Agent Activity -->
      <a-col :xs="24" :lg="8">
        <a-card title="Agent 活动" size="small">
          <a-empty v-if="agentEvents.length === 0" description="暂无 Agent 活动" />
          <a-list v-else :data-source="agentEvents" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-space>
                  <a-tag :color="statusColor(item.type.split('.')[1])">
                    {{ item.type.split(".")[1] }}
                  </a-tag>
                  <a-typography-text type="secondary" style="font-size: 12px">
                    {{ item.agentRunId?.slice(0, 8) }}
                  </a-typography-text>
                  <a-typography-text
                    type="secondary"
                    style="font-size: 11px; margin-left: auto"
                  >
                    {{ formatTime(item.ts) }}
                  </a-typography-text>
                </a-space>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- Pending Approvals -->
      <a-col :xs="24" :lg="8">
        <a-card size="small">
          <template #title>
            待审批
            <a-badge
              :count="approvals.length"
              :number-style="{ backgroundColor: '#3b82f6' }"
              style="margin-left: 8px"
            />
          </template>
          <ApprovalPanel :approvals="approvals" @resolved="loadApprovals" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Event Stream -->
    <a-card title="事件流" size="small" style="margin-top: 16px">
      <a-empty v-if="events.length === 0" description="等待事件..." />
      <div v-else style="max-height: 260px; overflow-y: auto">
        <a-table
          :data-source="events.slice(0, 50)"
          :columns="eventColumns"
          :pagination="false"
          size="small"
          row-key="id"
        />
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  DashboardGovernanceOverviewResponse,
  DashboardProviderModelItem,
  DashboardProviderTokenItem,
  DashboardProviderTokenRange,
  DashboardProviderTokenResponse,
  Org,
  Project,
  RuntimeUsageLedgerRecord,
} from "../lib/api";
import {
  getDashboardGovernanceOverview,
  getDashboardProviderTokens,
  getProjectRuntimeUsageLedgers,
  listApprovals,
  listOrgs,
} from "../lib/api";
import { useProjectStore } from "../stores/project";
import { useRealtimeStore } from "../stores/realtime";

const realtimeStore = useRealtimeStore();
const projectStore = useProjectStore();
const router = useRouter();
const approvals = ref<unknown[]>([]);
const providerRange = ref<DashboardProviderTokenRange>("24h");
const monthlyViewMode = ref<"trend" | "share" | "efficiency">("share");
const runtimeOrgFilter = ref("all");
const runtimeProjectGroupFilter = ref("all");
const providerTokenLoading = ref(true);
const providerBootstrapPending = ref(true);
const providerTokenData = ref<DashboardProviderTokenResponse | null>(null);
const governanceLoading = ref(true);
const governanceBootstrapPending = ref(true);
const governanceData = ref<DashboardGovernanceOverviewResponse | null>(null);
const runtimeLedgerLoading = ref(true);
const runtimeLedgerBootstrapPending = ref(true);
const runtimeLedgerData = ref<RuntimeGovernanceOverview | null>(null);
const orgs = ref<Org[]>([]);

const providerColumns = [
  { title: "Provider", key: "provider", width: 220 },
  { title: "Tokens", key: "tokens", width: 140 },
  { title: "请求", key: "requests", width: 120 },
  { title: "质量", key: "quality", width: 160 },
  { title: "效率", key: "efficiency", width: 160 },
  { title: "状态 / 建议", key: "status" },
];

const providerModelColumns = [
  { title: "模型", key: "model", width: 280 },
  { title: "Tokens", key: "tokens", width: 140 },
  { title: "请求", key: "requests", width: 120 },
  { title: "质量", key: "quality", width: 160 },
  { title: "效率", key: "efficiency", width: 180 },
];

type ModelDisplayGroup = "failed" | "empty" | "normal";

type DisplayModelItem = DashboardProviderModelItem & {
  displayGroup: ModelDisplayGroup;
};

type DisplayProviderItem = DashboardProviderTokenItem & {
  models: DisplayModelItem[];
  abnormalModelCount: number;
  failedModelCount: number;
  emptyModelCount: number;
  normalModelCount: number;
};

type CrossProjectRuntimeUsageLedgerRecord = RuntimeUsageLedgerRecord & {
  orgId: string;
  orgName: string;
  projectName: string;
  projectSlug?: string | null;
  projectGroupKey: string;
  projectGroupLabel: string;
};

type RuntimeGovernanceOverview = {
  totals: {
    ledgerCount: number;
    requestCount: number;
    stepCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  items: CrossProjectRuntimeUsageLedgerRecord[];
  failedProjectIds: string[];
};

type GovernanceTaskRow = DashboardGovernanceOverviewResponse["topRiskTasks"][number] & {
  projectName: string;
  orgName: string;
  projectGroupKey: string;
  projectGroupLabel: string;
};

type GovernanceEventRow = DashboardGovernanceOverviewResponse["recentEvents"][number] & {
  projectName: string;
  orgName: string;
  projectGroupKey: string;
  projectGroupLabel: string;
  eventKindLabel: string;
  guardDecisionLabel: string | null;
  reasonSummaryLabel: string;
  reasonSummaryColor: string;
};

type ProjectGroupDescriptor = {
  key: string;
  label: string;
};

const events = computed(() => {
  if (!projectStore.currentProjectId) return [];
  return realtimeStore.events.filter((event) => event.projectId === projectStore.currentProjectId);
});

const providerSummary = computed(() => providerTokenData.value?.summary ?? null);
const governanceSummary = computed(() => governanceData.value?.summary ?? null);
const runtimeLedgerItems = computed(() => runtimeLedgerData.value?.items ?? []);
const runtimeProjectGroupLookup = computed<Record<string, ProjectGroupDescriptor>>(() =>
  buildRuntimeProjectGroupLookup(projectStore.projects),
);
const runtimeOrgOptions = computed(() => {
  const options = projectStore.projects
    .map((project) => ({
      value: project.orgId,
      label: orgs.value.find((item) => item.id === project.orgId)?.name || project.orgId,
    }))
    .filter(
      (option, index, list) => list.findIndex((item) => item.value === option.value) === index,
    )
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));

  return [{ value: "all", label: "全部组织" }, ...options];
});
const runtimeProjectGroupOptions = computed(() => {
  const options = projectStore.projects
    .filter(
      (project) => runtimeOrgFilter.value === "all" || project.orgId === runtimeOrgFilter.value,
    )
    .map(
      (project) =>
        runtimeProjectGroupLookup.value[project.id] ?? createStandaloneProjectGroup(project),
    )
    .map((group) => ({ value: group.key, label: group.label }))
    .filter(
      (option, index, list) => list.findIndex((item) => item.value === option.value) === index,
    )
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));

  return [{ value: "all", label: "全部项目组" }, ...options];
});
const filteredRuntimeLedgerItems = computed(() =>
  runtimeLedgerItems.value.filter((item) => {
    if (runtimeOrgFilter.value !== "all" && item.orgId !== runtimeOrgFilter.value) {
      return false;
    }
    if (
      runtimeProjectGroupFilter.value !== "all" &&
      item.projectGroupKey !== runtimeProjectGroupFilter.value
    ) {
      return false;
    }
    return true;
  }),
);
const runtimeLedgerSummary = computed(() =>
  filteredRuntimeLedgerItems.value.reduce(
    (acc, item) => {
      acc.ledgerCount += 1;
      acc.requestCount += item.requestCount;
      acc.stepCount += item.stepCount;
      acc.inputTokens += item.inputTokens;
      acc.outputTokens += item.outputTokens;
      acc.totalTokens += item.totalTokens;
      acc.costUsd = Number((acc.costUsd + item.costUsd).toFixed(4));
      return acc;
    },
    {
      ledgerCount: 0,
      requestCount: 0,
      stepCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    },
  ),
);
const runtimeGovernanceProjectCount = computed(() => {
  const scopedProjectIds = projectStore.projects
    .filter((project) => matchesRuntimeGovernanceFilters(project))
    .map((project) => project.id);

  return scopedProjectIds.filter(
    (projectId) => !runtimeLedgerData.value?.failedProjectIds.includes(projectId),
  ).length;
});
const runtimeGovernanceFailedProjects = computed(
  () =>
    projectStore.projects
      .filter((project) => matchesRuntimeGovernanceFilters(project))
      .filter((project) => runtimeLedgerData.value?.failedProjectIds.includes(project.id)).length,
);
const providerRows = computed<DisplayProviderItem[]>(() =>
  (providerTokenData.value?.providers ?? []).map((provider) => {
    const models = [...provider.models]
      .map((model) => ({
        ...model,
        displayGroup: classifyModelGroup(model),
      }))
      .sort(compareModelsForDisplay);

    const failedModelCount = models.filter((model) => model.displayGroup === "failed").length;
    const emptyModelCount = models.filter((model) => model.displayGroup === "empty").length;
    const normalModelCount = models.filter((model) => model.displayGroup === "normal").length;

    return {
      ...provider,
      models,
      abnormalModelCount: failedModelCount + emptyModelCount,
      failedModelCount,
      emptyModelCount,
      normalModelCount,
    };
  }),
);
const abnormalModelTotal = computed(() =>
  providerRows.value.reduce((sum, provider) => sum + provider.abnormalModelCount, 0),
);
const showProviderEmpty = computed(
  () =>
    !providerBootstrapPending.value &&
    !providerTokenLoading.value &&
    providerRows.value.length === 0,
);
const showGovernanceEmpty = computed(
  () =>
    !governanceBootstrapPending.value &&
    !governanceLoading.value &&
    governanceTopRiskRows.value.length === 0 &&
    governanceEventRows.value.length === 0,
);
const showRuntimeLedgerEmpty = computed(
  () =>
    !runtimeLedgerBootstrapPending.value &&
    !runtimeLedgerLoading.value &&
    filteredRuntimeLedgerItems.value.length === 0,
);

const governanceTopRiskRows = computed<GovernanceTaskRow[]>(() =>
  (governanceData.value?.topRiskTasks ?? []).map((item) => {
    const project = projectStore.projects.find((entry) => entry.id === item.projectId);
    const projectGroup = project
      ? (runtimeProjectGroupLookup.value[project.id] ?? createStandaloneProjectGroup(project))
      : { key: `project:${item.projectId}`, label: item.projectId };
    return {
      ...item,
      projectName: project?.name || item.projectId,
      orgName: project
        ? orgs.value.find((entry) => entry.id === project.orgId)?.name || project.orgId
        : "未知组织",
      projectGroupKey: projectGroup.key,
      projectGroupLabel: projectGroup.label,
    };
  }),
);
const governanceEventRows = computed<GovernanceEventRow[]>(() =>
  (governanceData.value?.recentEvents ?? []).map((item) => {
    const project = projectStore.projects.find((entry) => entry.id === item.projectId);
    const fallbackProject = project
      ? project
      : {
          id: item.projectId,
          orgId: item.projectId,
          name: item.projectId || "未知项目",
          slug: item.projectId || "unknown",
          settings: undefined,
        };
    const projectGroup =
      runtimeProjectGroupLookup.value[fallbackProject.id] ??
      createStandaloneProjectGroup(fallbackProject);
    return {
      ...item,
      projectName: project?.name || item.projectId || "未知项目",
      orgName: project
        ? orgs.value.find((entry) => entry.id === project.orgId)?.name || project.orgId
        : "未知组织",
      projectGroupKey: projectGroup.key,
      projectGroupLabel: projectGroup.label,
      eventKindLabel: formatGovernanceEventKindLabel(item.eventKind),
      guardDecisionLabel: formatGuardDecisionLabel(item.guardDecision),
      reasonSummaryLabel: summarizeGovernanceEventReason(item),
      reasonSummaryColor: governanceEventReasonColor(item),
    };
  }),
);

const governanceInsightTitle = computed(() => {
  if (governanceTopRiskRows.value.length === 0 && governanceEventRows.value.length === 0) {
    return "当前窗口没有高风险 paid execution 任务";
  }
  if (governanceTopRiskRows.value.length === 0) {
    return `最近窗口记录了 ${formatCount(governanceEventRows.value.length)} 条治理事件`;
  }
  if ((governanceSummary.value?.breakerCount ?? 0) > 0) {
    return `最近窗口触发 ${formatCount(governanceSummary.value?.breakerCount)} 次 breaker`;
  }
  if ((governanceSummary.value?.blockedCount ?? 0) > 0) {
    return `最近窗口拦截 ${formatCount(governanceSummary.value?.blockedCount)} 次 paid execution`;
  }
  return `当前共有 ${formatCount(governanceSummary.value?.topRiskTaskCount)} 个高风险任务进入治理视野`;
});

const governanceInsightDescription = computed(() => {
  if (governanceTopRiskRows.value.length === 0 && governanceEventRows.value.length === 0) {
    return "Dashboard 会在 paid execution 发生 block、breaker、租约生效或高风险放大时，把任务排进治理总览。";
  }
  if (governanceTopRiskRows.value.length === 0) {
    const recent = governanceEventRows.value[0];
    return recent
      ? `${recent.projectName} / ${recent.title} 最近触发了 ${recent.eventKindLabel} 事件。`
      : "Dashboard 会在 paid execution 发生 block、breaker、租约生效或高风险放大时，把任务排进治理总览。";
  }
  const top = governanceTopRiskRows.value[0];
  const leaseText = `${formatCount(governanceSummary.value?.activeLeaseCount)} 个 active lease 正在生效。`;
  return `${top.projectName} / ${top.title} 当前风险最高，累计 ${formatCount(top.requestCount)} 次调用、${formatUsd(top.costUsd)}。${leaseText}`;
});

const governanceInsightTone = computed(() => {
  if ((governanceSummary.value?.breakerCount ?? 0) > 0) return "warning" as const;
  if ((governanceSummary.value?.blockedCount ?? 0) > 0) return "info" as const;
  return "success" as const;
});

const highCostLedgerRows = computed(() =>
  [...filteredRuntimeLedgerItems.value]
    .sort((left, right) => {
      if (right.costUsd !== left.costUsd) return right.costUsd - left.costUsd;
      return right.totalTokens - left.totalTokens;
    })
    .slice(0, 5),
);

const runtimeAmplificationSummary = computed(() =>
  filteredRuntimeLedgerItems.value.reduce(
    (acc, ledger) => {
      if ((ledger.candidateCount ?? 1) > 1) {
        acc.parallelCandidates += ledger.candidateCount;
      }
      acc.judgeRequests += ledger.judgeRequestCount ?? 0;
      acc.hookRequests += ledger.hookRequestCount ?? 0;
      return acc;
    },
    {
      parallelCandidates: 0,
      judgeRequests: 0,
      hookRequests: 0,
    },
  ),
);

const riskAmplificationTotal = computed(
  () =>
    runtimeAmplificationSummary.value.parallelCandidates +
    runtimeAmplificationSummary.value.judgeRequests +
    runtimeAmplificationSummary.value.hookRequests,
);

const topAmplifiedLedger = computed(
  () =>
    [...filteredRuntimeLedgerItems.value].sort(
      (left, right) => runtimeLedgerRiskScore(right) - runtimeLedgerRiskScore(left),
    )[0] ?? null,
);

const topAmplifiedLedgerLabel = computed(() => topAmplifiedLedger.value?.runtimeSessionId || "-");

const runtimeGovernanceInsightTitle = computed(() => {
  if (projectStore.projects.length === 0) return "当前没有可聚合的项目";
  if (filteredRuntimeLedgerItems.value.length === 0) return "当前筛选范围没有可用的 runtime ledger";
  if (riskAmplificationTotal.value > 0)
    return `最近窗口内出现 ${riskAmplificationTotal.value} 次风险放大来源`;
  return "最近执行以单路低放大链路为主";
});

const runtimeGovernanceInsightDescription = computed(() => {
  if (projectStore.projects.length === 0) {
    return "Dashboard 会在有项目数据后展示跨项目的高消耗执行排行，以及并行、judge、hook 的放大来源。";
  }
  if (filteredRuntimeLedgerItems.value.length === 0) {
    return "当前没有跨项目账本数据，暂时无法判断哪些执行批次消耗最高、哪些链路最容易放大请求。";
  }
  const top = highCostLedgerRows.value[0];
  const topText = top
    ? `${top.projectName} / ${top.runtimeSessionId} 当前成本最高，累计 ${formatUsd(top.costUsd)} / ${formatTokenCount(top.totalTokens)}。`
    : "";
  const amplificationText =
    riskAmplificationTotal.value > 0
      ? ` 放大来源中 parallel=${formatCount(runtimeAmplificationSummary.value.parallelCandidates)}，judge=${formatCount(runtimeAmplificationSummary.value.judgeRequests)}，hook=${formatCount(runtimeAmplificationSummary.value.hookRequests)}。`
      : " 当前窗口未观察到明显放大来源。";
  const failureText =
    runtimeGovernanceFailedProjects.value > 0
      ? ` ${formatCount(runtimeGovernanceFailedProjects.value)} 个项目加载失败，当前结果按已成功项目聚合。`
      : "";
  return `${topText}${amplificationText}${failureText}`.trim();
});

const runtimeGovernanceInsightTone = computed(() => {
  if (riskAmplificationTotal.value > 0) return "warning" as const;
  return "info" as const;
});
const monthlyTotals = computed(() => providerSummary.value?.monthlyTotals ?? []);
const maxMonthlyToken = computed(() =>
  monthlyTotals.value.reduce((max, item) => Math.max(max, item.tokenUsed), 0),
);
const monthlyTrendRows = computed(() =>
  monthlyTotals.value.map((item) => ({
    ...item,
    widthPercent: maxMonthlyToken.value > 0 ? (item.tokenUsed / maxMonthlyToken.value) * 100 : 0,
  })),
);

const monthlyShareRows = computed(() => {
  const palette = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#dc2626"];
  const topProviders = providerRows.value.slice(0, 5);
  return monthlyTotals.value.map((item) => {
    const segments = topProviders
      .map((provider, index) => {
        const monthBucket = provider.monthly.find((bucket) => bucket.month === item.month);
        const tokenUsed = monthBucket?.tokenUsed ?? 0;
        const shareRatio = item.tokenUsed > 0 ? tokenUsed / item.tokenUsed : 0;
        return {
          providerId: provider.providerId,
          label: provider.label,
          shareRatio,
          sharePercent: shareRatio * 100,
          color: palette[index % palette.length],
        };
      })
      .filter((segment) => segment.shareRatio > 0);

    return {
      ...item,
      widthPercent: maxMonthlyToken.value > 0 ? (item.tokenUsed / maxMonthlyToken.value) * 100 : 0,
      segments,
    };
  });
});

const maxMonthlyAvgCost = computed(() =>
  monthlyTotals.value.reduce((max, item) => {
    const avg = item.completedRuns > 0 ? item.tokenUsed / item.completedRuns : 0;
    return Math.max(max, avg);
  }, 0),
);

const monthlyEfficiencyRows = computed(() =>
  monthlyTotals.value.map((item) => {
    const avgTokensPerCompletedRun =
      item.completedRuns > 0 ? item.tokenUsed / item.completedRuns : 0;
    return {
      month: item.month,
      avgTokensPerCompletedRun,
      widthPercent:
        maxMonthlyAvgCost.value > 0
          ? (avgTokensPerCompletedRun / maxMonthlyAvgCost.value) * 100
          : 0,
    };
  }),
);

const providerTotalLabel = computed(() =>
  providerRange.value === "monthly" ? "本月 Token 总量" : `${providerRange.value} Token 总量`,
);

const topProviderLabel = computed(() => {
  const top = providerRows.value[0];
  return top ? top.label : "-";
});

const providerInsightTitle = computed(() => {
  if (!projectStore.currentProjectId) return "请先选择项目";
  if (providerRows.value.length === 0) return "当前没有足够数据做模型调整建议";
  const riskCount = providerSummary.value?.riskProviderCount ?? 0;
  const downgradeCount = providerRows.value.filter(
    (item) => item.recommendationAction === "downgrade",
  ).length;
  if (downgradeCount > 0) return `存在 ${downgradeCount} 个建议降配的 Provider`;
  return riskCount > 0 ? "存在可优化的模型分配" : "当前模型分配整体稳定";
});

const providerInsightDescription = computed(() => {
  if (!projectStore.currentProjectId) {
    return "Dashboard 会在选中项目后展示 provider token 结构，帮助管理员做模型重分配。";
  }
  if (providerRows.value.length === 0) {
    return "当前项目还没有足够的 Agent token 数据，暂时无法判断哪些模型更省、哪些模型更准。";
  }
  const top = providerRows.value[0];
  const riskCount = providerSummary.value?.riskProviderCount ?? 0;
  const downgradeCount = providerRows.value.filter(
    (item) => item.recommendationAction === "downgrade",
  ).length;
  const monthlyTail =
    monthlyTotals.value.length > 0 ? monthlyTotals.value[monthlyTotals.value.length - 1] : null;
  const monthText = monthlyTail ? `最近月度总量 ${formatTokenCount(monthlyTail.tokenUsed)}。` : "";
  const actionText =
    downgradeCount > 0
      ? ` 其中 ${downgradeCount} 个 provider 已满足建议降配条件，可直接进入模型设置调整。`
      : riskCount > 0
        ? ` 其中 ${riskCount} 个 provider 已进入重点观察区。`
        : " 暂无明显高风险 provider。";
  return `${top.label} 当前承担了 ${formatPercent(top.tokenShare)} 的 token 消耗，平均完成成本 ${formatTokenCount(top.avgTokensPerCompletedRun)}。${actionText} ${monthText}`.trim();
});

async function loadApprovals() {
  try {
    approvals.value = (await listApprovals("pending")) as unknown[];
  } catch {
    approvals.value = [];
  }
}

async function loadOrgs() {
  try {
    orgs.value = await listOrgs();
  } catch {
    orgs.value = [];
  }
}

async function loadProviderTokens() {
  if (!projectStore.currentProjectId) {
    providerTokenData.value = null;
    providerTokenLoading.value = false;
    return;
  }
  providerTokenLoading.value = true;
  try {
    providerTokenData.value = await getDashboardProviderTokens(
      projectStore.currentProjectId,
      providerRange.value,
    );
  } catch {
    providerTokenData.value = null;
  } finally {
    providerTokenLoading.value = false;
  }
}

async function loadGovernanceOverview() {
  governanceLoading.value = true;
  try {
    governanceData.value = await getDashboardGovernanceOverview(providerRange.value);
  } catch {
    governanceData.value = null;
  } finally {
    governanceLoading.value = false;
  }
}

async function loadRuntimeLedgerOverview() {
  if (projectStore.projects.length === 0) {
    runtimeLedgerData.value = null;
    runtimeLedgerLoading.value = false;
    return;
  }

  runtimeLedgerLoading.value = true;
  try {
    const settled = await Promise.all(
      projectStore.projects.map(async (project) => {
        try {
          const response = await getProjectRuntimeUsageLedgers(project.id, {
            limit: 20,
          });
          return {
            status: "fulfilled" as const,
            project,
            response,
          };
        } catch (error) {
          return {
            status: "rejected" as const,
            project,
            error,
          };
        }
      }),
    );

    const totals = {
      ledgerCount: 0,
      requestCount: 0,
      stepCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    const items: CrossProjectRuntimeUsageLedgerRecord[] = [];
    const failedProjectIds: string[] = [];

    for (const result of settled) {
      if (result.status !== "fulfilled") {
        failedProjectIds.push(result.project.id);
        continue;
      }

      const { project, response } = result;
      totals.ledgerCount += response.totals.ledgerCount;
      totals.requestCount += response.totals.requestCount;
      totals.stepCount += response.totals.stepCount;
      totals.inputTokens += response.totals.inputTokens;
      totals.outputTokens += response.totals.outputTokens;
      totals.totalTokens += response.totals.totalTokens;
      totals.costUsd = Number((totals.costUsd + response.totals.costUsd).toFixed(4));

      for (const item of response.items) {
        const projectGroup =
          runtimeProjectGroupLookup.value[project.id] ?? createStandaloneProjectGroup(project);
        items.push({
          ...item,
          orgId: project.orgId,
          orgName: orgs.value.find((entry) => entry.id === project.orgId)?.name || project.orgId,
          projectName: project.name,
          projectSlug: project.slug,
          projectGroupKey: projectGroup.key,
          projectGroupLabel: projectGroup.label,
        });
      }
    }

    runtimeLedgerData.value = {
      totals,
      items,
      failedProjectIds,
    };
  } catch {
    runtimeLedgerData.value = null;
  } finally {
    runtimeLedgerLoading.value = false;
  }
}

onMounted(async () => {
  providerBootstrapPending.value = true;
  runtimeLedgerBootstrapPending.value = true;
  try {
    if (projectStore.projects.length === 0) {
      await projectStore.loadProjects();
    }
    await Promise.all([loadApprovals(), loadOrgs()]);
    await Promise.all([
      loadProviderTokens(),
      loadGovernanceOverview(),
      loadRuntimeLedgerOverview(),
    ]);
  } finally {
    providerBootstrapPending.value = false;
    governanceBootstrapPending.value = false;
    runtimeLedgerBootstrapPending.value = false;
    if (!projectStore.currentProjectId) {
      providerTokenLoading.value = false;
      governanceLoading.value = false;
      runtimeLedgerLoading.value = false;
    }
  }
});

watch([() => projectStore.currentProjectId, providerRange], async () => {
  await Promise.all([loadProviderTokens(), loadGovernanceOverview()]);
});

watch(
  () => projectStore.currentProjectId,
  async () => {
    if (runtimeLedgerData.value == null && projectStore.projects.length > 0) {
      await loadRuntimeLedgerOverview();
    }
  },
);

watch(
  () => projectStore.projects.map((project) => project.id).join(","),
  async (next, prev) => {
    if (next !== prev) {
      await loadRuntimeLedgerOverview();
    }
  },
);

watch(runtimeOrgFilter, () => {
  if (
    !runtimeProjectGroupOptions.value.some(
      (option) => option.value === runtimeProjectGroupFilter.value,
    )
  ) {
    runtimeProjectGroupFilter.value = "all";
  }
});

const activeTasks = computed(() => {
  const map = new Map<string, { taskId: string; lastEvent: string; lastUpdate: string }>();
  for (const e of events.value) {
    if (
      (e.type === "task.created" || e.type === "task.node.updated") &&
      e.taskId &&
      !map.has(e.taskId)
    ) {
      map.set(e.taskId, {
        taskId: e.taskId,
        lastEvent: e.type,
        lastUpdate: e.ts,
      });
    }
  }
  return Array.from(map.values());
});

const agentEvents = computed(() =>
  events.value.filter((e) => e.type.startsWith("agent.")).slice(0, 10),
);

const eventColumns = [
  {
    title: "时间",
    dataIndex: "ts",
    width: 100,
    customRender: ({ text }: { text: string }) => formatTime(text),
  },
  { title: "类型", dataIndex: "type", width: 180 },
  {
    title: "数据",
    dataIndex: "data",
    ellipsis: true,
    customRender: ({ text }: { text: Record<string, unknown> }) =>
      JSON.stringify(text).slice(0, 100),
  },
];

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString();
}

function formatCount(value?: number | null) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value ?? 0));
}

function formatUsd(value?: number | null) {
  return `$${Number(value ?? 0).toFixed(4)}`;
}

function formatProviderRiskSummary(
  riskProviderCount?: number | null,
  abnormalModelCount?: number | null,
) {
  return `${formatCount(riskProviderCount)} / ${formatCount(abnormalModelCount)}`;
}

function formatGovernanceDriverLabel(driver?: string | null) {
  if (driver === "breaker") return "熔断触发";
  if (driver === "blocked") return "预检拦截";
  if (driver === "parallel") return "并行放大";
  if (driver === "hook") return "Hook 放大";
  if (driver === "judge") return "Judge 放大";
  if (driver === "cost") return "成本抬升";
  return "治理信号";
}

function formatGuardDecisionLabel(decision?: string | null) {
  if (decision === "allow") return "允许执行";
  if (decision === "allow-with-downgrade") return "允许降配执行";
  if (decision === "require-approval") return "需要审批";
  if (decision === "deny") return "已拒绝";
  return null;
}

function formatGovernanceEventKindLabel(kind: "guard" | "breaker") {
  return kind === "breaker" ? "Breaker" : "Guard";
}

type GovernanceReasonRule = {
  keywords: string[];
  label: string;
};

const BREAKER_REASON_RULES: GovernanceReasonRule[] = [
  { keywords: ["parallel", "candidate"], label: "并行候选超阈值" },
  { keywords: ["retry", "retries", "repeated"], label: "重复重试触发熔断" },
  { keywords: ["hook"], label: "Hook 链路触发熔断" },
  { keywords: ["judge"], label: "Judge 链路触发熔断" },
  { keywords: ["cost", "budget"], label: "成本阈值触发熔断" },
];

const GUARD_REASON_RULES: GovernanceReasonRule[] = [
  { keywords: ["lease"], label: "缺少付费租约" },
  { keywords: ["amplification", "parallel", "candidate"], label: "请求放大量超阈值" },
  { keywords: ["budget", "cost"], label: "预算或成本超限" },
];

const GUARD_DECISION_REASON_LABELS: Partial<Record<string, string>> = {
  "require-approval": "转人工审批",
  "allow-with-downgrade": "自动降配放行",
  deny: "执行已拦截",
  allow: "允许执行",
};

function matchesGovernanceReasonRule(normalizedReason: string, keywords: string[]) {
  return keywords.some((keyword) => normalizedReason.includes(keyword));
}

function summarizeGovernanceReasonByRules(normalizedReason: string, rules: GovernanceReasonRule[]) {
  return rules.find((rule) => matchesGovernanceReasonRule(normalizedReason, rule.keywords))?.label;
}

function summarizeBreakerEventReason(normalizedReason: string) {
  return (
    summarizeGovernanceReasonByRules(normalizedReason, BREAKER_REASON_RULES) ?? "执行链路触发熔断"
  );
}

function summarizeGuardEventReason(normalizedReason: string, guardDecision?: string | null) {
  if (guardDecision === "require-approval" || guardDecision === "allow-with-downgrade") {
    return GUARD_DECISION_REASON_LABELS[guardDecision] ?? "治理规则命中";
  }

  const matchedLabel = summarizeGovernanceReasonByRules(normalizedReason, GUARD_REASON_RULES);
  if (matchedLabel) {
    return matchedLabel;
  }

  return GUARD_DECISION_REASON_LABELS[guardDecision ?? ""] ?? "治理规则命中";
}

function summarizeGovernanceEventReason(
  event: DashboardGovernanceOverviewResponse["recentEvents"][number],
) {
  const normalizedReason = (event.reason || "").trim().toLowerCase();

  if (event.eventKind === "breaker") {
    return summarizeBreakerEventReason(normalizedReason);
  }

  return summarizeGuardEventReason(normalizedReason, event.guardDecision);
}

function governanceEventReasonColor(
  event: DashboardGovernanceOverviewResponse["recentEvents"][number],
) {
  if (event.eventKind === "breaker") return "volcano";
  if (event.guardDecision === "deny") return "red";
  if (event.guardDecision === "require-approval") return "orange";
  if (event.guardDecision === "allow-with-downgrade") return "gold";
  if (event.guardDecision === "allow") return "green";
  return "blue";
}

function matchesRuntimeGovernanceFilters(
  project: Pick<Project, "id" | "orgId" | "name" | "slug" | "settings">,
) {
  if (runtimeOrgFilter.value !== "all" && project.orgId !== runtimeOrgFilter.value) {
    return false;
  }

  if (runtimeProjectGroupFilter.value !== "all") {
    const group =
      runtimeProjectGroupLookup.value[project.id] ?? createStandaloneProjectGroup(project);
    return group.key === runtimeProjectGroupFilter.value;
  }

  return true;
}

type RuntimeProjectGroupLookupMaps = {
  explicitDescriptorByProjectId: Map<string, ProjectGroupDescriptor>;
  explicitLabelByScopedKey: Map<string, string>;
  familyCountByScopedKey: Map<string, number>;
  candidateByProjectId: Map<string, string | null>;
};

function createRuntimeProjectGroupLookupMaps(): RuntimeProjectGroupLookupMaps {
  return {
    explicitDescriptorByProjectId: new Map<string, ProjectGroupDescriptor>(),
    explicitLabelByScopedKey: new Map<string, string>(),
    familyCountByScopedKey: new Map<string, number>(),
    candidateByProjectId: new Map<string, string | null>(),
  };
}

function createRuntimeProjectFamilyKey(orgId: string, candidate: string) {
  return `${orgId}::${candidate}`;
}

function collectRuntimeProjectGroupCandidates(
  projects: Array<Pick<Project, "id" | "orgId" | "name" | "slug" | "settings">>,
) {
  const maps = createRuntimeProjectGroupLookupMaps();

  for (const project of projects) {
    const explicitGroup = resolveExplicitProjectGroup(project);
    if (explicitGroup) {
      maps.explicitDescriptorByProjectId.set(project.id, explicitGroup);
      if (!maps.explicitLabelByScopedKey.has(explicitGroup.key)) {
        maps.explicitLabelByScopedKey.set(explicitGroup.key, explicitGroup.label);
      }
      continue;
    }

    const candidate = deriveProjectGroupFamilyCandidate(project.slug, project.name);
    maps.candidateByProjectId.set(project.id, candidate);
    if (!candidate) {
      continue;
    }

    const familyKey = createRuntimeProjectFamilyKey(project.orgId, candidate);
    maps.familyCountByScopedKey.set(
      familyKey,
      (maps.familyCountByScopedKey.get(familyKey) ?? 0) + 1,
    );
  }

  return maps;
}

function buildRuntimeProjectGroupDescriptor(
  project: Pick<Project, "id" | "orgId" | "name" | "slug" | "settings">,
  maps: RuntimeProjectGroupLookupMaps,
) {
  const explicitGroup = maps.explicitDescriptorByProjectId.get(project.id);
  if (explicitGroup) {
    return {
      key: explicitGroup.key,
      label: maps.explicitLabelByScopedKey.get(explicitGroup.key) ?? explicitGroup.label,
    };
  }

  const candidate = maps.candidateByProjectId.get(project.id) ?? null;
  const familyCount = candidate
    ? (maps.familyCountByScopedKey.get(createRuntimeProjectFamilyKey(project.orgId, candidate)) ??
      0)
    : 0;

  if (candidate && familyCount >= 2) {
    return {
      key: `family:${project.orgId}:${candidate}`,
      label: candidate,
    };
  }

  return createStandaloneProjectGroup(project);
}

function buildRuntimeProjectGroupLookup(
  projects: Array<Pick<Project, "id" | "orgId" | "name" | "slug" | "settings">>,
) {
  const maps = collectRuntimeProjectGroupCandidates(projects);

  const lookup: Record<string, ProjectGroupDescriptor> = {};
  for (const project of projects) {
    lookup[project.id] = buildRuntimeProjectGroupDescriptor(project, maps);
  }

  return lookup;
}

function resolveExplicitProjectGroup(
  project: Pick<Project, "id" | "orgId" | "settings">,
): ProjectGroupDescriptor | null {
  const rawKey = normalizeProjectGroupMetadataValue(project.settings?.projectGroupKey);
  const rawLabel = normalizeProjectGroupMetadataValue(project.settings?.projectGroupLabel);

  if (!rawKey && !rawLabel) {
    return null;
  }

  const normalizedKey = rawKey
    ? normalizeProjectGroupKeySegment(rawKey)
    : normalizeProjectGroupKeySegment(rawLabel || "");
  const label = rawLabel || rawKey || "未分组";

  return {
    key: `explicit:${project.orgId}:${normalizedKey || project.id}`,
    label,
  };
}

function deriveProjectGroupFamilyCandidate(slug?: string | null, name?: string | null) {
  const slugTokens = tokenizeProjectGroupSource(slug);
  if (slugTokens.length > 0) {
    return slugTokens[0] ?? null;
  }

  const nameTokens = tokenizeProjectGroupSource(name);
  return nameTokens[0] ?? null;
}

function tokenizeProjectGroupSource(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .split(/[\s._:/-]+/)
    .filter(Boolean);
}

function normalizeProjectGroupMetadataValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProjectGroupKeySegment(value: string) {
  return tokenizeProjectGroupSource(value).join("-");
}

function createStandaloneProjectGroup(
  project: Pick<Project, "id" | "name" | "slug">,
): ProjectGroupDescriptor {
  const label = project.name?.trim() || project.slug?.trim() || "未分组";
  return {
    key: `project:${project.id}`,
    label,
  };
}

function handleRangeChange(value: string | number | boolean) {
  providerRange.value = String(value ?? "24h") as DashboardProviderTokenRange;
}

function handleMonthlyViewChange(value: string | number | boolean) {
  const next = String(value ?? "share");
  if (next === "trend" || next === "share" || next === "efficiency") {
    monthlyViewMode.value = next;
  }
}

function providerRowProps(record: DisplayProviderItem) {
  return {
    style: { cursor: "pointer" },
    onClick: () => {
      void router.push({
        path: "/agents",
        query: {
          entryContext: "alert",
          provider: record.providerId,
          focus: record.recommendationAction === "downgrade" ? "attention" : "recent",
          ...(record.recommendationAction === "downgrade" ? { status: "failed" } : {}),
        },
      });
    },
  };
}

function openProviderSettings(providerId: string) {
  void router.push({
    path: "/settings",
    query: {
      tab: "models",
      section: "provider-row",
      provider: providerId,
    },
  });
}

function openProjectRuntimeLedger(record: CrossProjectRuntimeUsageLedgerRecord) {
  void router.push({
    name: "ProjectDetail",
    params: {
      projectId: record.projectId,
    },
    query: {
      tab: "overview",
      runtimeLedger: record.id,
    },
  });
}

function openGovernanceTask(record: GovernanceTaskRow) {
  void router.push({
    name: "TaskDetail",
    params: {
      taskId: record.taskId,
    },
    query: record.runtimeSessionId ? { session: record.runtimeSessionId } : {},
  });
}

function openGovernanceProject(record: GovernanceTaskRow) {
  void router.push({
    name: "ProjectDetail",
    params: {
      projectId: record.projectId,
    },
    query: {
      tab: "overview",
    },
  });
}

function openRuntimeLedgerTask(record: CrossProjectRuntimeUsageLedgerRecord) {
  if (!record.taskId) {
    openProjectRuntimeLedger(record);
    return;
  }

  void router.push({
    name: "TaskDetail",
    params: {
      taskId: record.taskId,
    },
    query: {
      session: record.runtimeSessionId,
      runtimeLedger: record.id,
    },
  });
}

function formatTokenCount(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

function providerHealthColor(health: DashboardProviderTokenItem["health"]) {
  if (health === "risk") return "red";
  if (health === "warn") return "orange";
  return "green";
}

function providerHealthLabel(health: DashboardProviderTokenItem["health"]) {
  if (health === "risk") return "建议调整";
  if (health === "warn") return "重点观察";
  return "稳定";
}

function providerRecommendationColor(action: DashboardProviderTokenItem["recommendationAction"]) {
  if (action === "downgrade") return "red";
  if (action === "observe") return "orange";
  return "green";
}

function providerReasonsText(reasons: string[]) {
  return reasons.length > 0 ? reasons.join(" / ") : "完成质量与 token 使用基本匹配";
}

function modelDisplayLabel(model?: { label?: string; modelId?: string; route?: string } | null) {
  return model?.label || model?.modelId || model?.route || "unknown";
}

function modelProviderId(model?: { route?: string | null } | null) {
  const route = model?.route?.trim();
  if (!route) return "unknown";
  const colonIndex = route.indexOf(":");
  if (colonIndex > 0) return route.slice(0, colonIndex);
  const slashIndex = route.indexOf("/");
  if (slashIndex > 0) return route.slice(0, slashIndex);
  return route;
}

function isEmptyRequestModel(
  model?: {
    tokenUsed?: number | null;
    requestCount?: number | null;
    totalRuns?: number | null;
    completedRuns?: number | null;
  } | null,
) {
  const requestCount = model?.requestCount ?? model?.totalRuns ?? 0;
  return requestCount > 0 && (model?.completedRuns ?? 0) === 0 && (model?.tokenUsed ?? 0) <= 0;
}

function isFailedRequestModel(
  model?: {
    failedRuns?: number | null;
    failureRate?: number | null;
  } | null,
) {
  return (model?.failedRuns ?? 0) > 0 || (model?.failureRate ?? 0) > 0;
}

function classifyModelGroup(model: DashboardProviderModelItem): ModelDisplayGroup {
  if (isFailedRequestModel(model)) return "failed";
  if (isEmptyRequestModel(model)) return "empty";
  return "normal";
}

function modelDisplayGroupLabel(group: ModelDisplayGroup) {
  if (group === "failed") return "失败请求";
  if (group === "empty") return "空耗请求";
  return "正常消耗";
}

function modelDisplayGroupColor(group: ModelDisplayGroup) {
  if (group === "failed") return "red";
  if (group === "empty") return "orange";
  return "green";
}

function modelDisplayGroupOrder(group: ModelDisplayGroup) {
  if (group === "failed") return 0;
  if (group === "empty") return 1;
  return 2;
}

function compareModelsForDisplay(left: DisplayModelItem, right: DisplayModelItem) {
  const groupDelta =
    modelDisplayGroupOrder(left.displayGroup) - modelDisplayGroupOrder(right.displayGroup);
  if (groupDelta !== 0) return groupDelta;
  if (right.tokenUsed !== left.tokenUsed) return right.tokenUsed - left.tokenUsed;
  return (right.requestCount ?? right.totalRuns) - (left.requestCount ?? left.totalRuns);
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    started: "blue",
    running: "blue",
    paused: "orange",
    completed: "green",
    failed: "red",
    stopped: "default",
  };
  return map[status] || "default";
}

function runtimeLedgerAmplificationTags(record: RuntimeUsageLedgerRecord) {
  const tags: string[] = [];
  if ((record.candidateCount ?? 1) > 1) {
    tags.push(`parallel x${record.candidateCount}`);
  }
  if ((record.judgeRequestCount ?? 0) > 0) {
    tags.push(`judge ${record.judgeRequestCount}`);
  }
  if ((record.hookRequestCount ?? 0) > 0) {
    tags.push(`hook ${record.hookRequestCount}`);
  }
  return tags.length > 0 ? tags : ["single-path"];
}

function runtimeLedgerRiskScore(record: RuntimeUsageLedgerRecord) {
  const parallelScore = Math.max(0, (record.candidateCount ?? 1) - 1);
  return parallelScore + (record.judgeRequestCount ?? 0) + (record.hookRequestCount ?? 0);
}
</script>

<style scoped>
.provider-card-label {
  color: #64748b;
  font-size: 12px;
  margin-bottom: 6px;
}

.provider-card-value {
  color: #0f172a;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
}

.provider-card-hint {
  color: #64748b;
  font-size: 12px;
  margin-top: 6px;
}

.monthly-summary-item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
}

.governance-event-stream {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.governance-event-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  background: #f8fafc;
}

.governance-event-item__title {
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}

.governance-event-item__meta {
  color: #64748b;
  font-size: 12px;
  margin-bottom: 6px;
}

.governance-event-item__decision {
  color: #0f172a;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.governance-event-item__summary {
  margin-bottom: 6px;
}

.governance-event-item__reason {
  color: #475569;
  font-size: 12px;
  line-height: 1.5;
}

.monthly-chart-row {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
}

.monthly-bar-track {
  background: #e2e8f0;
  border-radius: 999px;
  height: 12px;
  overflow: hidden;
}

.monthly-bar-total {
  display: flex;
  height: 100%;
  border-radius: 999px;
  overflow: hidden;
}

.monthly-bar-single {
  height: 100%;
  border-radius: 999px;
}

.monthly-bar-single--trend {
  background: linear-gradient(90deg, #2563eb 0%, #60a5fa 100%);
}

.monthly-bar-single--efficiency {
  background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%);
}

.monthly-bar-segment {
  height: 100%;
}

.monthly-chart-legend {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: #64748b;
  font-size: 12px;
  margin-top: 6px;
}

.provider-action-link {
  padding-left: 0;
}

.provider-model-panel {
  padding-top: 8px;
}

.provider-model-panel__header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}

.provider-model-panel__title {
  color: #64748b;
  font-size: 12px;
  margin-bottom: 8px;
}

.provider-model-panel__summary {
  margin-bottom: 8px;
}

.provider-model-panel :deep(.ant-table) {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}
</style>
