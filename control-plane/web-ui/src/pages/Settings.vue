<template>
  <div style="padding: 24px">
    <a-typography-title :level="3">设置</a-typography-title>

    <a-card size="small" title="组织运行策略" style="margin-bottom: 16px">
      <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap">
        <a-typography-text type="secondary">组织架构化 Agent 的平台默认协作模式、托管等级和管理介入方式在独立页面维护。</a-typography-text>
        <a-button type="primary" data-testid="open-organization-operating-settings" @click="router.push('/settings/organization-operating')">打开组织运行策略</a-button>
      </div>
    </a-card>

    <a-tabs :activeKey="activeTab" @update:activeKey="setActiveTab">
      <a-tab-pane key="account" tab="账户信息">
        <a-row :gutter="16">
          <a-col :xs="24" :lg="12">
            <a-card title="基本信息">
              <a-alert
                v-if="authStore.user?.mustChangePassword"
                type="warning"
                show-icon
                message="当前账户被标记为首次登录必须改密。请先在下方完成密码更新。"
                style="margin-bottom: 16px"
              />
              <a-form layout="vertical">
                <a-form-item label="用户名">
                  <a-input :value="authStore.user?.username || ''" disabled />
                </a-form-item>
                <a-form-item label="显示名称" required>
                  <a-input :value="accountProfile.displayName" :maxlength="100" @update:value="accountProfile.displayName = String($event ?? '')" />
                </a-form-item>
                <a-form-item label="邮箱">
                  <a-input :value="accountProfile.email" :maxlength="200" placeholder="可选" @update:value="accountProfile.email = String($event ?? '')" />
                </a-form-item>
                <a-form-item label="全局角色">
                  <a-input :value="authStore.user?.role || ''" disabled />
                </a-form-item>
                <a-form-item label="创建时间">
                  <a-input :value="formatAccountTime(authStore.user?.createdAt)" disabled />
                </a-form-item>
                <a-form-item label="最近登录时间">
                  <a-input :value="formatAccountTime(authStore.user?.lastLoginAt)" disabled />
                </a-form-item>
                <a-button type="primary" :loading="accountSaving" @click="saveAccountProfile">保存资料</a-button>
              </a-form>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card title="修改密码">
              <a-form layout="vertical">
                <a-form-item label="当前密码" required>
                  <a-input-password :value="passwordProfile.currentPassword" autocomplete="current-password" @update:value="passwordProfile.currentPassword = String($event ?? '')" />
                </a-form-item>
                <a-form-item label="新密码" required>
                  <a-input-password :value="passwordProfile.newPassword" autocomplete="new-password" @update:value="passwordProfile.newPassword = String($event ?? '')" />
                  <div style="color: #888; font-size: 12px; margin-top: 4px">{{ PASSWORD_POLICY_HINT }}</div>
                </a-form-item>
                <a-form-item label="确认新密码" required>
                  <a-input-password :value="passwordProfile.confirmPassword" autocomplete="new-password" @update:value="passwordProfile.confirmPassword = String($event ?? '')" />
                </a-form-item>
                <a-button type="primary" :loading="passwordSaving" @click="saveMyPassword">更新密码</a-button>
              </a-form>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- ═══════════ 模型 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="models" tab="模型">
        <a-spin :spinning="modelsLoading">
          <a-card id="settings-models-copilot-accounts" title="GitHub Copilot 账号" style="margin-bottom: 16px">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap">
              <span style="color: #888; font-size: 12px">
                需要第二个或更多 Copilot 账号时，点击右侧按钮即可自动添加新的 Provider，随后在对应卡片上登录不同 GitHub 账号。
              </span>
              <a-button type="primary" @click="addCopilotProvider">添加 Copilot 账号</a-button>
            </div>
          </a-card>

          <a-card v-if="modelsLoading" style="margin-top: 16px">
            <a-skeleton active :paragraph="{ rows: 10 }" />
          </a-card>

          <template v-else>

          <!-- Copilot OAuth (multi-account) -->
          <a-card v-for="cpProvider in copilotProviders" :id="`settings-models-copilot-${cpProvider}`" :key="cpProvider" :title="`GitHub Copilot 认证 — ${cpProvider}`" style="margin-top: 16px">
            <template v-if="copilotAuthMap[cpProvider]?.authenticated">
              <a-result status="success" :title="`已登录 ${cpProvider}`"
                :sub-title="copilotAuthMap[cpProvider]?.loginAt ? `登录时间: ${copilotAuthMap[cpProvider].loginAt}` : ''">
                <template #extra>
                  <a-space>
                    <a-button danger @click="doCopilotLogoutFor(cpProvider)" :loading="copilotAuthMap[cpProvider]?.loading">退出登录</a-button>
                  </a-space>
                </template>
              </a-result>

              <a-collapse
                size="small"
                style="margin-top: 16px"
                :activeKey="getCopilotModelCollapseActiveKey(cpProvider)"
                @update:activeKey="setCopilotModelCollapseActiveKey(cpProvider, $event)"
              >
                <a-collapse-panel key="models" header="Copilot 可用模型">
                  <template #extra>
                    <a-space size="small" @click.stop>
                      <a-tag :color="getCopilotModelsStatusColor(cpProvider)">{{ getCopilotModelsStatusText(cpProvider) }}</a-tag>
                      <span v-if="getCopilotModelsMetaText(cpProvider)" style="color: #888; font-size: 12px">
                        {{ getCopilotModelsMetaText(cpProvider) }}
                      </span>
                    </a-space>
                  </template>
                  <a-spin :spinning="copilotModelsMap[cpProvider]?.loading">
                    <template v-if="copilotModelsMap[cpProvider]?.error">
                      <a-alert type="error" :message="copilotModelsMap[cpProvider].error" show-icon style="margin-bottom: 12px" />
                    </template>
                    <template v-if="(copilotModelsMap[cpProvider]?.items || []).length">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; flex-wrap: wrap">
                        <a-space wrap>
                          <a-tag color="blue">总数 {{ copilotModelsMap[cpProvider]?.items.length || 0 }}</a-tag>
                          <a-tag color="gold">未配置 {{ getCopilotUnconfiguredCount(cpProvider) }}</a-tag>
                        </a-space>
                        <a-space>
                          <a-radio-group :value="copilotModelFilter" @update:value="copilotModelFilter = String($event)">
                            <a-radio-button value="all">全部</a-radio-button>
                            <a-radio-button value="unconfigured">只显示未配置模型</a-radio-button>
                          </a-radio-group>
                          <a-button type="primary" @click="addAllCopilotModelsFor(cpProvider)">添加全部未配置模型</a-button>
                        </a-space>
                      </div>
                      <a-table :dataSource="getFilteredCopilotModels(cpProvider)" :columns="copilotModelColumns" :pagination="false" rowKey="id" size="small">
                        <template #bodyCell="{ column, record }">
                          <template v-if="column.dataIndex === 'contextWindow'">
                            {{ record.contextWindow || '-' }}
                          </template>
                          <template v-else-if="column.dataIndex === 'maxTokens'">
                            {{ record.maxTokens || '-' }}
                          </template>
                          <template v-else-if="column.dataIndex === 'action'">
                            <a-button size="small" :disabled="isModelConfigured(cpProvider, String(record.id || ''))" @click="addCopilotModelFromRecordFor(record, cpProvider)">
                              {{ isModelConfigured(cpProvider, String(record.id || '')) ? '已添加' : '添加' }}
                            </a-button>
                          </template>
                        </template>
                      </a-table>
                    </template>
                    <template v-else-if="copilotModelsMap[cpProvider]?.loaded">
                      <a-empty description="当前账号暂无可读取的 Copilot 模型" />
                    </template>
                    <template v-else>
                      <a-empty description="展开此面板会自动读取 Copilot 可用模型；再次展开会刷新列表" />
                    </template>
                  </a-spin>
                </a-collapse-panel>
              </a-collapse>
            </template>

            <template v-else-if="copilotAuthMap[cpProvider]?.deviceCode">
              <a-steps :current="1" size="small" style="margin-bottom: 20px">
                <a-step title="获取验证码" />
                <a-step title="在 GitHub 授权" />
                <a-step title="完成" />
              </a-steps>
              <div style="text-align: center; padding: 16px 0">
                <div style="margin-bottom: 12px; color: #888">请在浏览器中打开以下链接，并输入验证码：</div>
                <div style="margin-bottom: 12px">
                  <a :href="copilotAuthMap[cpProvider]?.verificationUri" target="_blank" rel="noopener noreferrer"
                    style="font-size: 16px">
                    {{ copilotAuthMap[cpProvider]?.verificationUri }}
                  </a>
                </div>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; font-family: monospace; padding: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; display: inline-block; user-select: all">
                  {{ copilotAuthMap[cpProvider]?.userCode }}
                </div>
                <div style="margin-top: 12px; color: #888">
                  <a-spin size="small" /> 等待授权中... ({{ copilotAuthMap[cpProvider]?.countdown }}s 后超时)
                </div>
              </div>
            </template>

            <template v-else>
              <div style="display: flex; align-items: center; gap: 16px">
                <a-button type="primary" @click="startCopilotAuthFor(cpProvider)" :loading="copilotAuthMap[cpProvider]?.loading">
                  使用 GitHub 帐号登录
                </a-button>
                <span style="color: #888; font-size: 12px">通过 OAuth Device Flow 认证，无需输入 Token。每个 Provider 可绑定不同的 GitHub 账号。</span>
              </div>
            </template>
          </a-card>

          <a-card id="settings-models-providers" title="Provider 列表" style="margin-top: 16px">
            <div style="margin-bottom: 8px; color: #888; font-size: 12px">先配置连接入口，再挂接模型。</div>
            <template v-if="providerTableData.length">
              <a-table
                :dataSource="providerTableData"
                :columns="providerColumns"
                :pagination="false"
                rowKey="key"
                size="small"
                :customRow="getProviderTableRowProps"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.dataIndex === 'key'">
                    <a-input :value="record.key" disabled size="small" />
                  </template>
                  <template v-else-if="column.dataIndex === 'name'">
                    <a-input
                      :value="record.name"
                      size="small"
                      placeholder="显示名称"
                      @update:value="updateProvider(record.key, 'name', $event)"
                    />
                  </template>
                  <template v-else-if="column.dataIndex === 'api'">
                    <a-select
                      :value="record.api"
                      size="small"
                      style="width:100%"
                      placeholder="API 类型"
                      @update:value="updateProvider(record.key, 'api', $event)"
                    >
                      <a-select-option value="anthropic">anthropic</a-select-option>
                      <a-select-option value="openai-completions">openai-completions</a-select-option>
                      <a-select-option value="openai-responses">openai-responses</a-select-option>
                      <a-select-option value="azure-openai">azure-openai</a-select-option>
                      <a-select-option value="github-copilot">github-copilot</a-select-option>
                      <a-select-option value="github-models">github-models</a-select-option>
                    </a-select>
                  </template>
                  <template v-else-if="column.dataIndex === 'baseURL'">
                    <a-input
                      :value="record.baseURL"
                      size="small"
                      placeholder="https://api.example.com/v1"
                      @update:value="updateProvider(record.key, 'baseURL', $event)"
                    />
                  </template>
                  <template v-else-if="column.dataIndex === 'apiKey'">
                    <a-input-password
                      :value="record.apiKey"
                      size="small"
                      placeholder="用于 Provider 鉴权的 API Key"
                      @update:value="updateProvider(record.key, 'apiKey', $event)"
                    />
                  </template>
                  <template v-else-if="column.dataIndex === 'action'">
                    <a-space>
                      <a-button size="small" :loading="providerTestLoading[record.key]" @click="testProvider(record.key)">测试</a-button>
                      <a-button size="small" :loading="providerModelLoading[record.key]" @click="chooseProviderModels(record.key)">选择模型</a-button>
                      <a-button danger size="small" @click="deleteProvider(record.key)">删除</a-button>
                    </a-space>
                  </template>
                </template>
              </a-table>
            </template>
            <a-empty v-else description="还没有 Provider。下一步：点击下方“+ 添加 Provider”，或先在上方添加 GitHub Copilot 账号。" />
            <a-button id="settings-models-provider-add" type="dashed" block style="margin-top: 8px" @click="showAddProvider = true">+ 添加 Provider</a-button>
          </a-card>

          <a-modal :open="showAddProvider" title="添加 Provider" @ok="addProvider" okText="添加" cancelText="取消" @update:open="showAddProvider = $event">
            <a-form layout="vertical">
              <a-form-item label="Key (唯一标识)">
                <a-input :value="newProvider.key" placeholder="my-provider" @update:value="newProvider.key = String($event ?? '')" />
              </a-form-item>
              <a-form-item label="显示名称">
                <a-input :value="newProvider.name" placeholder="My Custom Provider" @update:value="newProvider.name = String($event ?? '')" />
              </a-form-item>
              <a-form-item label="API 类型">
                <a-select :value="newProvider.api" style="width:100%" @update:value="newProvider.api = String($event ?? '')">
                  <a-select-option value="anthropic">anthropic</a-select-option>
                  <a-select-option value="openai-completions">openai-completions</a-select-option>
                  <a-select-option value="openai-responses">openai-responses</a-select-option>
                  <a-select-option value="azure-openai">azure-openai</a-select-option>
                  <a-select-option value="github-copilot">github-copilot</a-select-option>
                  <a-select-option value="github-models">github-models</a-select-option>
                </a-select>
              </a-form-item>
              <a-form-item label="Base URL">
                <a-input :value="newProvider.baseURL" placeholder="https://api.example.com/v1" @update:value="newProvider.baseURL = String($event ?? '')" />
              </a-form-item>
              <a-form-item label="API Key">
                <a-input-password :value="newProvider.apiKey" placeholder="用于 Provider 鉴权的 API Key" @update:value="newProvider.apiKey = String($event ?? '')" />
              </a-form-item>
            </a-form>
          </a-modal>

          <a-modal
            :open="providerModelPicker.open"
            title="选择可用模型"
            width="820px"
            :footer="null"
            @update:open="(open) => { if (!open) closeProviderModelPicker(); }"
          >
            <a-space direction="vertical" style="width: 100%" :size="12">
              <a-alert
                v-if="providerModelPicker.message"
                :type="providerModelPicker.error ? 'error' : 'info'"
                :message="providerModelPicker.message"
                show-icon
              />
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap">
                <a-typography-text type="secondary">
                  当前 Provider: {{ providerModelPicker.providerKey || '-' }}
                </a-typography-text>
                <a-button
                  type="primary"
                  :disabled="!providerModelPicker.models.some((model) => !isModelConfigured(providerModelPicker.providerKey, model.id))"
                  @click="addAllDiscoveredModels"
                >
                  添加全部未配置模型
                </a-button>
              </div>
              <a-table
                :dataSource="providerModelPicker.models"
                :columns="discoveredProviderModelColumns"
                :pagination="false"
                rowKey="id"
                size="small"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.dataIndex === 'contextWindow'">
                    {{ record.contextWindow || '-' }}
                  </template>
                  <template v-else-if="column.dataIndex === 'maxTokens'">
                    {{ record.maxTokens || '-' }}
                  </template>
                  <template v-else-if="column.dataIndex === 'action'">
                    <a-button
                      size="small"
                      :disabled="isModelConfigured(providerModelPicker.providerKey, String(record.id || ''))"
                      @click="addDiscoveredModelFromRecord(record)"
                    >
                      {{ isModelConfigured(providerModelPicker.providerKey, String(record.id || '')) ? '已添加' : '添加' }}
                    </a-button>
                  </template>
                </template>
              </a-table>
            </a-space>
          </a-modal>

          <a-card id="settings-models-list" title="模型列表" style="margin-top: 16px">
            <div style="margin-bottom: 8px; color: #888; font-size: 12px">为任务准备可选的执行模型，并维护每个模型是否付费、按什么方式收费以及价格配置。</div>
            <template v-if="modelsData.list.length">
              <a-table :dataSource="modelsData.list" :columns="modelColumns" :pagination="false" :rowKey="getConfiguredModelKey" :rowClassName="getModelRowClassName" :scroll="{ x: 1450 }" size="small">
                <template #bodyCell="{ column, record, index }">
                  <template v-if="column.dataIndex === 'id'">
                    <div style="display: flex; flex-direction: column; gap: 6px">
                      <a-input :value="record.id" size="small" @update:value="updateModelField(record, 'id', $event)" />
                      <a-tag v-if="getModelRecordIssue(record)" color="red">{{ getModelRecordIssue(record) }}</a-tag>
                    </div>
                  </template>
                  <template v-else-if="column.dataIndex === 'name'">
                    <div style="display: flex; flex-direction: column; gap: 6px">
                      <a-input :value="record.name" size="small" @update:value="record.name = String($event ?? '')" />
                      <a-tag v-if="isDefaultConfiguredModelRecord(record)" color="gold">默认执行模型</a-tag>
                    </div>
                  </template>
                  <template v-else-if="column.dataIndex === 'provider'">
                    <div style="display: flex; flex-direction: column; gap: 6px">
                      <a-select :value="record.provider" size="small" style="width:100%" @update:value="updateModelField(record, 'provider', $event)">
                        <a-select-option v-for="pk in Object.keys(modelsData.providers)" :key="pk" :value="pk">{{ pk }}</a-select-option>
                      </a-select>
                      <span v-if="getModelRoutePreview(record)" style="color: #888; font-size: 12px">{{ getModelRoutePreview(record) }}</span>
                    </div>
                  </template>
                  <template v-else-if="column.dataIndex === 'contextWindow'">
                    <a-input-number :value="record.contextWindow" size="small" :min="1" style="width:100%" @update:value="record.contextWindow = Number($event ?? 1)" />
                  </template>
                  <template v-else-if="column.dataIndex === 'maxTokens'">
                    <a-input-number :value="record.maxTokens" size="small" :min="1" style="width:100%" @update:value="record.maxTokens = Number($event ?? 1)" />
                  </template>
                  <template v-else-if="column.dataIndex === 'billingStatus'">
                    <a-switch
                      :checked="getModelBillingStatus(record) === 'paid'"
                      checked-children="付费"
                      un-checked-children="免费"
                      size="small"
                      @update:checked="setModelBillingStatus(record, $event)"
                    />
                  </template>
                  <template v-else-if="column.dataIndex === 'billingMethod'">
                    <a-select
                      :value="getModelBillingMethod(record)"
                      size="small"
                      style="width:100%"
                      :disabled="getModelBillingStatus(record) !== 'paid'"
                      placeholder="选择计费方式"
                      @update:value="setModelBillingMethod(record, $event)"
                    >
                      <a-select-option value="token_metered">按 Token</a-select-option>
                      <a-select-option value="request_metered">按请求次数</a-select-option>
                      <a-select-option value="run_metered">按运行次数</a-select-option>
                    </a-select>
                  </template>
                  <template v-else-if="column.dataIndex === 'price'">
                    <a-space direction="vertical" style="width: 100%" :size="4">
                      <a-typography-text v-if="getModelBillingStatus(record) !== 'paid'" type="secondary" style="font-size: 12px">
                        免费模型无需价格配置
                      </a-typography-text>
                      <a-typography-text v-else-if="!getModelBillingMethod(record)" type="secondary" style="font-size: 12px">
                        先选择付费方式，再填写价格
                      </a-typography-text>
                      <template v-else-if="getModelBillingMethod(record) === 'token_metered'">
                        <div style="display: flex; flex-direction: column; gap: 4px">
                          <a-input-number
                            :value="getModelBillingPriceValue(record, 'inputPerMillionTokens')"
                            size="small"
                            :min="0"
                            :precision="6"
                            style="width: 100%"
                            @update:value="updateModelBillingPrice(record, 'inputPerMillionTokens', $event)"
                          />
                          <span style="color: #888; font-size: 12px">输入单价 / 百万 Tokens (USD)</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 4px">
                          <a-input-number
                            :value="getModelBillingPriceValue(record, 'outputPerMillionTokens')"
                            size="small"
                            :min="0"
                            :precision="6"
                            style="width: 100%"
                            @update:value="updateModelBillingPrice(record, 'outputPerMillionTokens', $event)"
                          />
                          <span style="color: #888; font-size: 12px">输出单价 / 百万 Tokens (USD)</span>
                        </div>
                      </template>
                      <template v-else-if="getModelBillingMethod(record) === 'request_metered'">
                        <div style="display: flex; flex-direction: column; gap: 4px">
                          <a-input-number
                            :value="getModelBillingPriceValue(record, 'perRequestUsd')"
                            size="small"
                            :min="0"
                            :precision="6"
                            style="width: 100%"
                            @update:value="updateModelBillingPrice(record, 'perRequestUsd', $event)"
                          />
                          <span style="color: #888; font-size: 12px">每次请求价格 (USD)</span>
                        </div>
                      </template>
                      <template v-else-if="getModelBillingMethod(record) === 'run_metered'">
                        <div style="display: flex; flex-direction: column; gap: 4px">
                          <a-input-number
                            :value="getModelBillingPriceValue(record, 'perRunUsd')"
                            size="small"
                            :min="0"
                            :precision="6"
                            style="width: 100%"
                            @update:value="updateModelBillingPrice(record, 'perRunUsd', $event)"
                          />
                          <span style="color: #888; font-size: 12px">每次运行价格 (USD)</span>
                        </div>
                      </template>
                    </a-space>
                  </template>
                  <template v-else-if="column.dataIndex === 'action'">
                    <a-button danger size="small" @click="removeModelAt(index)">删除</a-button>
                  </template>
                </template>
              </a-table>
            </template>
            <a-empty v-else description="还没有模型。下一步：先配置 Provider，或登录并展开上方 Copilot 模型区后导入；也可以直接点击下方“+ 添加模型”。" />
            <a-button type="dashed" block style="margin-top: 8px" @click="addModel">+ 添加模型</a-button>
          </a-card>

          <a-card id="settings-models-default" title="默认执行模型" style="margin-top: 16px">
            <a-form layout="vertical">
              <a-form-item label="默认执行路由">
                <a-select
                  :value="getDefaultAgentModelValue() || undefined"
                  show-search
                  style="width: 100%"
                  placeholder="先在上方配置模型，再选择默认模型"
                  :options="defaultModelSelectOptions"
                  option-filter-prop="label"
                  @update:value="setDefaultAgentModelValue($event)"
                />
              </a-form-item>
              <a-form-item label="测试专用模型">
                <a-select
                  :value="getTestExecutionModelValue()"
                  style="width: 100%"
                  :options="testExecutionModelSelectOptions"
                  @update:value="setTestExecutionModelValue($event)"
                />
                <div style="margin-top: 6px; color: #888; font-size: 12px">
                  强制规则：所有真实测试默认只会使用 GPT-5 mini 或 GPT-4o，避免误用其他付费模型造成测试费用激增。
                </div>
              </a-form-item>
            </a-form>
          </a-card>

          <a-button type="primary" style="margin-top: 16px" :loading="saving" @click="saveModels">保存模型配置</a-button>
          </template>
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ Agent ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="agents" tab="Agent">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-menu
              :selectedKeys="agentSelected"
              :openKeys="agentOpenKeys"
              mode="inline"
              @click="onAgentSelect"
              @openChange="onAgentOpenChange"
            >
              <a-sub-menu
                v-for="group in groupedAgentsList"
                :key="group.key"
              >
                <template #title>{{ `${group.label} (${group.items.length})` }}</template>
                <a-menu-item v-for="a in group.items" :key="a.name">
                  {{ a.name }}
                </a-menu-item>
              </a-sub-menu>
            </a-menu>
          </a-col>
          <a-col :span="18">
            <a-spin :spinning="agentLoading">
              <template v-if="agentDetail">
                <a-card :title="getRecordString(agentDetail.frontmatter, 'name')">
                  <a-form layout="vertical">
                    <a-row :gutter="12">
                      <a-col :span="8">
                        <a-form-item label="Name">
                          <a-input
                            :value="getRecordString(agentDetail.frontmatter, 'name')"
                            @update:value="setRecordString(agentDetail.frontmatter, 'name', $event)"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :span="8">
                        <a-form-item label="Model">
                          <a-select
                            :value="getRecordString(agentDetail.frontmatter, 'model')"
                            show-search
                            style="width: 100%"
                            placeholder="选择已配置模型"
                            :options="agentModelSelectOptions"
                            option-filter-prop="label"
                            @update:value="setRecordString(agentDetail.frontmatter, 'model', $event)"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :span="8">
                        <a-form-item label="Description">
                          <a-input
                            :value="getRecordString(agentDetail.frontmatter, 'description')"
                            @update:value="setRecordString(agentDetail.frontmatter, 'description', $event)"
                          />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-form-item label="指令 (Markdown)">
                      <a-textarea :value="agentDetail.body" :rows="16" style="font-family: monospace; font-size: 13px" @update:value="agentDetail.body = String($event ?? '')" />
                    </a-form-item>
                  </a-form>
                  <a-button type="primary" :loading="saving" @click="saveAgent">保存</a-button>
                </a-card>
              </template>
              <a-empty v-else description="选择左侧 Agent 查看详情" />
            </a-spin>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- ═══════════ Skill ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="skills" tab="Skill">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-menu
              :selectedKeys="skillSelected"
              :openKeys="skillOpenKeys"
              mode="inline"
              @click="onSkillSelect"
              @openChange="onSkillOpenChange"
            >
              <a-sub-menu
                v-for="group in groupedSkillsList"
                :key="group.key"
              >
                <template #title>{{ `${group.label} (${group.items.length})` }}</template>
                <a-menu-item v-for="s in group.items" :key="s.dirName || s.name">
                  {{ s.name }}
                </a-menu-item>
              </a-sub-menu>
            </a-menu>
          </a-col>
          <a-col :span="18">
            <a-spin :spinning="skillLoading">
              <template v-if="skillDetail">
                <a-card :title="getRecordString(skillDetail.frontmatter, 'name')">
                  <a-form layout="vertical">
                    <a-row :gutter="12">
                      <a-col :span="8">
                        <a-form-item label="Name">
                          <a-input
                            :value="getRecordString(skillDetail.frontmatter, 'name')"
                            @update:value="setRecordString(skillDetail.frontmatter, 'name', $event)"
                          />
                        </a-form-item>
                      </a-col>
                      <a-col :span="16">
                        <a-form-item label="Description">
                          <a-input
                            :value="getRecordString(skillDetail.frontmatter, 'description')"
                            @update:value="setRecordString(skillDetail.frontmatter, 'description', $event)"
                          />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-form-item label="指令 (Markdown)">
                      <a-textarea :value="skillDetail.body" :rows="16" style="font-family: monospace; font-size: 13px" @update:value="skillDetail.body = String($event ?? '')" />
                    </a-form-item>
                  </a-form>
                  <a-button type="primary" :loading="saving" @click="saveSkill">保存</a-button>
                </a-card>
              </template>
              <a-empty v-else description="选择左侧 Skill 查看详情" />
            </a-spin>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- ═══════════ MCP ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="mcp" tab="MCP 服务">
        <a-spin :spinning="mcpLoading">
          <a-row :gutter="[16, 16]">
            <a-col :xs="24" :md="8" v-for="(server, name) in mcpData" :key="name">
              <a-card :title="String(name)" size="small">
                <template #extra>
                  <a-button danger size="small" @click="deleteMcp(String(name))">删除</a-button>
                </template>
                <a-form layout="vertical" size="small">
                  <a-form-item label="Command">
                    <a-input :value="server.command" @update:value="server.command = String($event ?? '')" />
                  </a-form-item>
                  <a-form-item label="Args (逗号分隔)">
                    <a-input
                      :value="server.args?.join(', ')"
                      @update:value="updateMcpArgs(server, $event)"
                    />
                  </a-form-item>
                  <a-form-item label="Description">
                    <a-input :value="server.description" @update:value="server.description = String($event ?? '')" />
                  </a-form-item>
                </a-form>
              </a-card>
            </a-col>
            <a-col :xs="24" :md="8">
              <a-card size="small" style="border-style: dashed; text-align: center; cursor: pointer" @click="showAddMcp = true">
                <div style="padding: 32px 0; color: #888">+ 添加 MCP 服务</div>
              </a-card>
            </a-col>
          </a-row>
          <a-button type="primary" style="margin-top: 16px" :loading="saving" @click="saveMcp">保存 MCP 配置</a-button>
        </a-spin>

        <a-modal :open="showAddMcp" title="添加 MCP 服务" @ok="addMcp" okText="添加" cancelText="取消" @update:open="showAddMcp = $event">
          <a-form layout="vertical">
            <a-form-item label="名称">
              <a-input :value="newMcp.name" placeholder="my-server" @update:value="newMcp.name = String($event ?? '')" />
            </a-form-item>
            <a-form-item label="Command">
              <a-select :value="newMcp.command" style="width: 100%" @update:value="newMcp.command = String($event ?? '')">
                <a-select-option value="npx">npx</a-select-option>
                <a-select-option value="node">node</a-select-option>
                <a-select-option value="bun">bun</a-select-option>
                <a-select-option value="python3">python3</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="Args">
              <a-input :value="newMcp.args" placeholder="-y, @some/package" @update:value="newMcp.args = String($event ?? '')" />
            </a-form-item>
            <a-form-item label="Description">
              <a-input :value="newMcp.description" @update:value="newMcp.description = String($event ?? '')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- ═══════════ 命令 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="commands" tab="命令">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-menu :selectedKeys="commandSelected" mode="inline" @click="onCommandSelect">
              <a-menu-item v-for="cmd in commandsList" :key="cmd.name">
                /{{ cmd.name }}
              </a-menu-item>
            </a-menu>
          </a-col>
          <a-col :span="18">
            <a-spin :spinning="commandLoading">
              <template v-if="commandDetail">
                <a-card :title="'/' + (commandSelected[0] || '')">
                  <a-form layout="vertical">
                    <a-form-item label="Description">
                      <a-input
                        :value="getRecordString(commandDetail.frontmatter, 'description')"
                        @update:value="setRecordString(commandDetail.frontmatter, 'description', $event)"
                      />
                    </a-form-item>
                    <a-form-item label="内容 (Markdown)">
                      <a-textarea :value="commandDetail.body" :rows="18" style="font-family: monospace; font-size: 13px" @update:value="commandDetail.body = String($event ?? '')" />
                    </a-form-item>
                  </a-form>
                  <a-button type="primary" :loading="saving" @click="saveCommand">保存</a-button>
                </a-card>
              </template>
              <a-empty v-else description="选择左侧命令查看详情" />
            </a-spin>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- ═══════════ 安全 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="security" tab="安全基线">
        <a-spin :spinning="securityLoading">
          <a-card title="SECURITY-BASELINE.md">
            <a-textarea :value="securityRaw" :rows="22" style="font-family: monospace; font-size: 13px" @update:value="securityRaw = String($event ?? '')" />
            <a-button type="primary" style="margin-top: 12px" :loading="saving" @click="saveSecurity">保存</a-button>
          </a-card>
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ 插件 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="plugins" tab="插件">
        <a-card title="已注册插件" size="small">
          <template #extra>
            <a-space>
              <a-button size="small" @click="checkCompat" :loading="compatLoading">兼容性检查</a-button>
              <a-button size="small" type="primary" @click="showInstallPlugin = true">安装插件</a-button>
            </a-space>
          </template>
          <a-table :dataSource="pluginsList" :columns="pluginColumns" :pagination="false" rowKey="name" size="small">
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'enabled'">
                <a-tag :color="record.enabled !== false ? 'green' : 'default'">{{ record.enabled !== false ? '启用' : '禁用' }}</a-tag>
              </template>
              <template v-else-if="column.dataIndex === 'action'">
                <a-space>
                  <a-button v-if="record.enabled !== false" size="small" @click="togglePlugin(record.name, false)">禁用</a-button>
                  <a-button v-else size="small" type="primary" @click="togglePlugin(record.name, true)">启用</a-button>
                  <a-popconfirm title="确定卸载？" @confirm="doUninstall(record.name)" okText="确定" cancelText="取消">
                    <a-button size="small" danger>卸载</a-button>
                  </a-popconfirm>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>

        <a-card v-if="compatResults.length" title="兼容性检查结果" size="small" style="margin-top: 16px">
          <a-table :dataSource="compatResults" :columns="compatColumns" :pagination="false" rowKey="name" size="small">
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'compatible'">
                <a-tag :color="record.compatible ? 'green' : 'red'">{{ record.compatible ? '兼容' : '不兼容' }}</a-tag>
              </template>
              <template v-else-if="column.dataIndex === 'errors'">
                {{ record.errors.join('; ') || '-' }}
              </template>
            </template>
          </a-table>
        </a-card>

        <a-modal
          :open="showInstallPlugin"
          title="安装插件"
          @ok="doInstallPlugin"
          @cancel="showInstallPlugin = false"
          okText="安装"
          cancelText="取消"
          :confirmLoading="installLoading"
        >
          <a-form layout="vertical">
            <a-form-item label="源文件路径 (相对于运行时工作区)">
              <a-input :value="installSource" placeholder=".opencode/plugins/my-plugin.ts" @update:value="installSource = String($event ?? '')" />
            </a-form-item>
            <a-form-item label="插件名称 (可选)">
              <a-input :value="installName" placeholder="my-plugin" @update:value="installName = String($event ?? '')" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- ═══════════ 编排策略 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="strategy" tab="编排策略">
        <a-spin :spinning="strategyLoading">
          <a-card v-if="strategyLoading">
            <a-skeleton active :paragraph="{ rows: 12 }" />
          </a-card>

          <template v-else>
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 16px"
            message="编排策略如何生效"
            description="当任务创建时，系统会根据用户 Prompt 自动判定意图分类（如安全审计、深度开发等）。判定结果依次驱动三项联动：① 按下方映射表选择该分类对应的 Agent 和模型；② 匹配适用该分类的工作流模板（决定单一执行还是并行竞争）；③ 如果配了生命周期 Hooks，则在执行前后触发对应治理逻辑。如果某个分类没有做自定义配置，系统会使用内置默认推荐（如安全审计默认使用 oracle-enterprise + hephaestus-enterprise）。"
          />
          <a-card title="意图分类 → Agent 映射" size="small">
            <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
              每行对应一种自动判定的意图分类。可为每种分类指定专属 Agent 和模型：留空则使用系统默认推荐（快速查询 → explore-enterprise；深度开发 → sisyphus / prometheus / hephaestus；运维操作 → oracle；安全审计 → oracle + hephaestus；架构设计 → prometheus + oracle）。
            </a-typography-text>
            <a-table :dataSource="strategyTableData" :columns="strategyAgentColumns" :pagination="false" rowKey="category" size="small">
              <template #bodyCell="{ column, record }">
                <template v-if="column.dataIndex === 'category'">
                  <a-tag color="blue">{{ record.label }}</a-tag>
                </template>
                <template v-else-if="column.dataIndex === 'agents'">
                  <a-select
                    mode="tags"
                    :value="record.agents"
                    style="width: 100%"
                    show-search
                    :options="getStrategyAgentSelectOptions(record.agents)"
                    option-filter-prop="label"
                    :placeholder="`留空则使用默认: ${DEFAULT_CATEGORY_AGENTS[record.category]?.join(', ') || '—'}`"
                    @change="(value) => handleStrategyAgentsChange(record.category, value)"
                  />
                </template>
                <template v-else-if="column.dataIndex === 'model'">
                  <a-select
                    :value="record.model"
                    show-search
                    size="small"
                    style="width: 100%"
                    placeholder="留空则使用全局默认模型"
                    :options="getStrategyModelSelectOptions(record.model)"
                    option-filter-prop="label"
                    allow-clear
                    @update:value="(value) => updateStrategyModel(record.category, String(value ?? ''))"
                  />
                </template>
              </template>
            </a-table>
          </a-card>

          <a-card title="规划流水线" size="small" style="margin-top: 16px">
            <a-form-item label="启用 Prometheus/Metis/Momus 规划流水线">
              <a-switch :checked="strategyData.enablePipeline" @update:checked="strategyData.enablePipeline = Boolean($event)" />
            </a-form-item>
          </a-card>

          <a-card title="生命周期 Hooks" size="small" style="margin-top: 16px">
            <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
              使用统一 hooks 配置执行前、执行后、失败后、续跑前的治理逻辑。失败后 Hook 当前仅覆盖 runtime/session 级硬失败；续跑前 Hook 仅在恢复已暂停的 agent run 时触发，不覆盖普通继续对话。
            </a-typography-text>
            <a-row :gutter="16">
              <a-col v-for="section in HOOK_SECTIONS" :key="section.trigger" :xs="24" :xl="12" style="margin-bottom: 16px">
                <a-card :title="section.title" size="small">
                  <template #extra>
                    <a-button size="small" type="dashed" @click="addHook(section.trigger)">+ 新增</a-button>
                  </template>
                  <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
                    {{ section.description }}
                  </a-typography-text>
                  <a-empty v-if="hooksByTrigger(section.trigger).length === 0" :description="section.emptyText" />
                  <a-collapse v-else size="small">
                    <a-collapse-panel
                      v-for="(hook, idx) in hooksByTrigger(section.trigger)"
                      :key="hook.id"
                      :header="hook.id || `${section.title} Hook ${idx + 1}`"
                    >
                      <template #extra>
                        <a-space @click.stop>
                          <a-switch
                            :checked="hook.enabled"
                            checked-children="启用"
                            un-checked-children="停用"
                            size="small"
                            @update:checked="hook.enabled = Boolean($event)"
                          />
                          <a-button size="small" danger @click.stop="removeHook(hook.id)">删除</a-button>
                        </a-space>
                      </template>
                      <a-form layout="vertical" size="small">
                        <a-row :gutter="12">
                          <a-col :span="10">
                            <a-form-item label="Hook 标识">
                              <a-input :value="hook.id" @update:value="hook.id = String($event ?? '')" />
                            </a-form-item>
                          </a-col>
                          <a-col :span="10">
                            <a-form-item label="执行 Agent">
                              <a-select
                                :value="hook.agent || undefined"
                                show-search
                                style="width: 100%"
                                placeholder="选择 Agent"
                                :options="getStrategySingleAgentSelectOptions(hook.agent)"
                                option-filter-prop="label"
                                allow-clear
                                @update:value="hook.agent = String($event ?? '')"
                              />
                            </a-form-item>
                          </a-col>
                          <a-col :span="4">
                            <a-form-item label="顺序">
                              <a-input-number :value="hook.order" :min="0" style="width: 100%" @update:value="hook.order = Number($event ?? 0)" />
                            </a-form-item>
                          </a-col>
                        </a-row>
                        <a-row :gutter="12">
                          <a-col :span="12">
                            <a-form-item label="指定模型">
                              <a-select
                                :value="hook.model || undefined"
                                show-search
                                style="width: 100%"
                                placeholder="留空使用系统默认"
                                :options="getStrategyModelSelectOptions(hook.model)"
                                option-filter-prop="label"
                                allow-clear
                                @update:value="hook.model = String($event ?? '')"
                              />
                            </a-form-item>
                          </a-col>
                          <a-col :span="12">
                            <a-form-item label="超时 (ms)">
                              <a-input-number :value="hook.timeoutMs" :min="1000" :step="1000" style="width: 100%" @update:value="hook.timeoutMs = Number($event ?? 15000)" />
                            </a-form-item>
                          </a-col>
                        </a-row>
                        <a-form-item label="提示词模板">
                          <a-textarea :value="hook.promptTemplate" :rows="6" @update:value="hook.promptTemplate = String($event ?? '')" />
                        </a-form-item>
                      </a-form>
                    </a-collapse-panel>
                  </a-collapse>
                </a-card>
              </a-col>
            </a-row>
          </a-card>

          <!-- ── Workflow Templates ── -->
          <a-card title="工作流模板" size="small" style="margin-top: 16px">
            <template #extra>
              <a-button size="small" type="dashed" @click="addTemplate">+ 新增模板</a-button>
            </template>
            <a-alert
              type="info"
              show-icon
              style="margin-bottom: 16px"
              message="这里维护的是编排策略里的执行模板。阶段状态机模板已拆到独立管理台。"
            >
              <template #description>
                <router-link :to="{ name: 'WorkflowTemplatesAdmin' }">
                  <a-button size="small">进入阶段模板管理台</a-button>
                </router-link>
              </template>
            </a-alert>
            <a-empty v-if="strategyData.templates.length === 0" description="暂无模板，请添加" />
            <a-collapse v-else accordion size="small">
              <a-collapse-panel
                v-for="(tpl, idx) in strategyData.templates"
                :key="tpl.id"
                :header="`${tpl.name} (${tpl.mode === 'parallel' ? '并行竞争' : '单一执行'})`"
              >
                <template #extra>
                  <a-space @click.stop>
                    <a-switch
                      :checked="tpl.enabled"
                      checked-children="启用"
                      un-checked-children="停用"
                      size="small"
                      @update:checked="tpl.enabled = Boolean($event)"
                    />
                    <a-button size="small" danger @click.stop="removeTemplate(idx)">删除</a-button>
                  </a-space>
                </template>
                <a-form layout="vertical" size="small">
                  <a-row :gutter="12">
                    <a-col :span="8">
                      <a-form-item label="模板名称">
                        <a-input
                          :value="tpl.name"
                          @update:value="tpl.name = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="执行模式">
                        <a-select :value="tpl.mode" @update:value="tpl.mode = normalizeTemplateMode($event)">
                          <a-select-option value="single">单一执行</a-select-option>
                          <a-select-option value="parallel">并行竞争</a-select-option>
                        </a-select>
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="最大并行数（上限）" v-if="tpl.mode === 'parallel'">
                        <a-space direction="vertical" style="width: 100%" :size="4">
                          <a-input-number
                            :value="tpl.maxParallelCandidates ?? 3"
                            :min="2"
                            :max="5"
                            style="width: 100%"
                            @update:value="tpl.maxParallelCandidates = Number($event ?? 3)"
                          />
                          <a-typography-text type="secondary" style="font-size: 12px">
                            这是并行 candidate 的上限，不是必须执行数。少于该数量时，只按已选择的 Agent 数量并行运行；不会重复执行某个 Agent 来补满。
                          </a-typography-text>
                        </a-space>
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-form-item label="执行 Agent 列表">
                    <a-select
                      mode="tags"
                      :value="tpl.agents"
                      placeholder="输入 Agent 名称"
                      style="width: 100%"
                      show-search
                      :options="getStrategyAgentSelectOptions(tpl.agents)"
                      option-filter-prop="label"
                      @change="(v) => (tpl.agents = Array.isArray(v) ? v.map(String) : [])"
                      :status="tpl.mode === 'parallel' && tpl.agents.length > 0 && tpl.agents.length < 2 ? 'warning' : undefined"
                    />
                    <a-typography-text v-if="tpl.mode === 'parallel' && tpl.agents.length > 0 && tpl.agents.length < 2" type="warning" style="font-size: 12px">
                      并行竞争模式建议至少选择 2 个 Agent，当前仅 {{ tpl.agents.length }} 个，将退化为单一执行。
                    </a-typography-text>
                  </a-form-item>
                  <a-form-item label="适用意图分类">
                    <a-space direction="vertical" style="width: 100%" :size="4">
                      <a-select
                        mode="multiple"
                        :value="tpl.categoryDefaults ?? []"
                        placeholder="不选则为通用模板"
                        style="width: 100%"
                        @change="(v) => handleTemplateCategoryChange(tpl, Array.isArray(v) ? v.map(String) : [])"
                      >
                        <a-select-option v-for="(label, cat) in CATEGORY_LABELS_MAP" :key="cat" :value="cat">
                          {{ label }}
                        </a-select-option>
                      </a-select>
                      <a-typography-text type="secondary" style="font-size: 12px">
                        这里不是手工创建分类，而是限制模板在什么任务意图下优先生效。意图分类来自系统在创建任务时对用户 Prompt 的自动判定，分类规则对应上面的“快速查询 / 深度开发 / 运维操作 / 安全审计 / 架构设计”；如果留空，表示该模板可作为通用模板参与选择。
                      </a-typography-text>
                    </a-space>
                  </a-form-item>
                </a-form>
              </a-collapse-panel>
            </a-collapse>
          </a-card>

          <a-card title="Continue 模板" size="small" style="margin-top: 16px">
            <template #extra>
              <a-button size="small" type="dashed" @click="addFollowup">+ 新增 Continue</a-button>
            </template>
            <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
              执行后如果 Hook 触发 continue，会从这里解析模板并启动独立 continue 执行。模板缺失时，任务详情页会明确提示用户修复配置。
            </a-typography-text>
            <a-empty v-if="strategyData.followups.length === 0" description="暂无 continue 模板，请添加" />
            <a-collapse v-else accordion size="small">
              <a-collapse-panel
                v-for="(followup, idx) in strategyData.followups"
                :key="followup.id"
                :header="followup.id || `Continue ${idx + 1}`"
              >
                <template #extra>
                  <a-space @click.stop>
                    <a-switch
                      :checked="followup.enabled"
                      checked-children="启用"
                      un-checked-children="停用"
                      size="small"
                      @update:checked="followup.enabled = Boolean($event)"
                    />
                    <a-button size="small" danger @click.stop="removeFollowup(idx)">删除</a-button>
                  </a-space>
                </template>
                <a-form layout="vertical" size="small">
                  <a-row :gutter="12">
                    <a-col :span="8">
                      <a-form-item label="模板 ID">
                        <a-input :value="followup.id" @update:value="followup.id = String($event ?? '')" />
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="执行 Agent">
                        <a-select
                          :value="followup.agent || undefined"
                          show-search
                          style="width: 100%"
                          placeholder="选择 Agent"
                          :options="getStrategySingleAgentSelectOptions(followup.agent)"
                          option-filter-prop="label"
                          allow-clear
                          @update:value="followup.agent = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="结果写回模式">
                        <a-select :value="followup.resultMode || 'advisory'" @update:value="followup.resultMode = normalizeFollowupResultMode($event)">
                          <a-select-option value="advisory">仅建议</a-select-option>
                          <a-select-option value="append">追加结果</a-select-option>
                          <a-select-option value="replace">替换结果</a-select-option>
                        </a-select>
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-row :gutter="12">
                    <a-col :span="12">
                      <a-form-item label="指定模型">
                        <a-select
                          :value="followup.model || undefined"
                          show-search
                          style="width: 100%"
                          placeholder="留空使用系统默认"
                          :options="getStrategyModelSelectOptions(followup.model)"
                          option-filter-prop="label"
                          allow-clear
                          @update:value="followup.model = String($event ?? '')"
                        />
                      </a-form-item>
                    </a-col>
                    <a-col :span="12">
                      <a-form-item label="超时 (ms)">
                        <a-input-number :value="followup.timeoutMs" :min="1000" :step="1000" style="width: 100%" @update:value="followup.timeoutMs = Number($event ?? 15000)" />
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-form-item label="提示词模板">
                    <a-textarea
                      :value="followup.promptTemplate"
                      :rows="6"
                      placeholder="可使用 {{taskPrompt}} {{taskResult}} {{hookResult}} {{continueGoal}} 等变量"
                      @update:value="followup.promptTemplate = String($event ?? '')"
                    />
                  </a-form-item>
                </a-form>
              </a-collapse-panel>
            </a-collapse>
          </a-card>

          <!-- ── Judge Configuration ── -->
          <a-card title="裁判配置" size="small" style="margin-top: 16px">
            <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
              并行竞争模式下，裁判 Agent 对多个候选结果进行评分，选出最优方案。仅在并行模板启用时生效。
            </a-typography-text>
            <a-alert
              v-if="!hasEnabledParallelTemplate"
              type="warning"
              show-icon
              style="margin-bottom: 12px"
              message="当前没有启用的并行竞争模板，裁判配置暂时不会生效。请先在上方工作流模板中添加一个「并行竞争」模式的模板并启用。"
            />
            <a-form layout="vertical">
              <a-form-item label="启用裁判">
                <a-switch :checked="strategyData.judge.enabled" :disabled="!hasEnabledParallelTemplate" @update:checked="strategyData.judge.enabled = Boolean($event)" />
              </a-form-item>
              <a-row :gutter="12">
                <a-col :span="8">
                  <a-form-item label="裁判 Agent">
                    <a-select
                      :value="strategyData.judge.agent || undefined"
                      placeholder="prometheus-enterprise"
                      style="width: 100%"
                      show-search
                      :options="getStrategySingleAgentSelectOptions(strategyData.judge.agent)"
                      option-filter-prop="label"
                      allow-clear
                      @update:value="strategyData.judge.agent = String($event ?? '')"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="8">
                  <a-form-item label="指定模型">
                    <a-select
                      :value="strategyData.judge.model || undefined"
                      placeholder="留空使用系统默认"
                      style="width: 100%"
                      show-search
                      :options="getStrategyModelSelectOptions(strategyData.judge.model)"
                      option-filter-prop="label"
                      allow-clear
                      @update:value="strategyData.judge.model = String($event ?? '')"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="8">
                  <a-form-item label="选择策略">
                    <a-select :value="strategyData.judge.selectionStrategy" @update:value="strategyData.judge.selectionStrategy = normalizeJudgeSelectionStrategy($event)">
                      <a-select-option value="judge-pick">裁判选择</a-select-option>
                      <a-select-option value="highest-score">最高评分</a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
              </a-row>
              <a-form-item label="超时 (ms)">
                <a-input-number
                  :value="strategyData.judge.timeoutMs"
                  :min="5000"
                  :step="5000"
                  style="width: 200px"
                  @update:value="strategyData.judge.timeoutMs = Number($event ?? 30000)"
                />
              </a-form-item>
              <a-form-item label="裁判提示词模板">
                <a-textarea
                  :value="strategyData.judge.promptTemplate"
                  :rows="6"
                  placeholder="使用 {{candidateResults}} {{taskTitle}} {{taskPrompt}} 等变量"
                  @update:value="strategyData.judge.promptTemplate = String($event ?? '')"
                />
              </a-form-item>
            </a-form>
          </a-card>

          <a-button type="primary" style="margin-top: 16px" :loading="strategySaving" @click="saveStrategy">保存编排策略</a-button>
          </template>
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ 恢复策略 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="policy" tab="恢复策略">
        <a-spin :spinning="policyLoading">
          <a-card v-if="policyLoading">
            <a-skeleton active :paragraph="{ rows: 8 }" />
          </a-card>

          <template v-else>
          <a-card title="失败恢复与续跑策略" size="small">
            <a-form layout="vertical">
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-form-item label="失败自动重试">
                    <a-switch :checked="policyData.autoRetryOnFailure" @update:checked="policyData.autoRetryOnFailure = Boolean($event)" />
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="最大重试次数">
                    <a-input-number :value="policyData.maxRetries" :min="0" :max="10" @update:value="policyData.maxRetries = Number($event ?? 0)" />
                  </a-form-item>
                </a-col>
              </a-row>
              <a-form-item label="可重试错误类型">
                <a-select mode="tags" :value="policyData.retryableErrors" style="width: 100%" @update:value="policyData.retryableErrors = Array.isArray($event) ? $event.map(String) : []" />
              </a-form-item>
              <a-form-item label="重试前需人工审批">
                <a-switch :checked="policyData.requireApprovalOnRetry" @update:checked="policyData.requireApprovalOnRetry = Boolean($event)" />
              </a-form-item>
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-form-item label="启用模型 Fallback">
                    <a-switch :checked="policyData.enableFallback" @update:checked="policyData.enableFallback = Boolean($event)" />
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="Fallback 模型">
                    <a-input :value="policyData.fallbackModel" placeholder="provider/model-id" :disabled="!policyData.enableFallback" @update:value="policyData.fallbackModel = String($event ?? '')" />
                  </a-form-item>
                </a-col>
              </a-row>
            </a-form>
          </a-card>

          <a-button type="primary" style="margin-top: 16px" :loading="policySaving" @click="savePolicy">保存恢复策略</a-button>
          </template>
        </a-spin>
      </a-tab-pane>

      <a-tab-pane v-if="isSystemAdmin" key="maintenance" tab="运维">
        <a-card title="运行中任务 Reconcile" size="small">
          <a-alert
            type="info"
            show-icon
            message="用于人工修复假 running 任务"
            description="会扫描当前持久化的 running 任务，尝试补全已完成结果、恢复仍在进行的会话，或将明显陈旧的假 running 任务标记为失败。"
            style="margin-bottom: 16px"
          />
          <a-space direction="vertical" style="width: 100%" :size="16">
            <a-space>
              <a-button type="primary" :loading="reconcileLoading" @click="runRunningTaskReconcile">手动触发 Reconcile</a-button>
              <a-button :loading="reconcileAuditLoading" @click="loadReconcileAuditEvents">刷新记录</a-button>
              <span style="color: #888; font-size: 12px">仅管理员可用，不需要重启 BFF。</span>
            </a-space>

            <a-descriptions bordered size="small" :column="2">
              <a-descriptions-item label="最近一次触发时间">{{ formatAccountTime(latestReconcileAudit?.ts) }}</a-descriptions-item>
              <a-descriptions-item label="最近一次触发人">{{ formatReconcileActor(latestReconcileAudit?.userId) }}</a-descriptions-item>
              <a-descriptions-item label="最近一次运行时状态">{{ latestReconcileRuntimeLabel }}</a-descriptions-item>
              <a-descriptions-item label="最近一次扫描数">{{ latestReconcileScanned }}</a-descriptions-item>
            </a-descriptions>

            <a-descriptions v-if="reconcileSummary" bordered size="small" :column="2">
              <a-descriptions-item label="扫描任务数">{{ reconcileSummary.scanned }}</a-descriptions-item>
              <a-descriptions-item label="运行时可用">{{ reconcileSummary.runtimeAvailable ? '是' : '否' }}</a-descriptions-item>
              <a-descriptions-item label="补全完成">{{ reconcileSummary.completed }}</a-descriptions-item>
              <a-descriptions-item label="修正失败">{{ reconcileSummary.failed }}</a-descriptions-item>
              <a-descriptions-item label="恢复内存态">{{ reconcileSummary.recovered }}</a-descriptions-item>
              <a-descriptions-item label="跳过">{{ reconcileSummary.skipped }}</a-descriptions-item>
            </a-descriptions>

            <a-card title="最近手动修复记录" size="small">
              <a-table
                :dataSource="reconcileAuditEvents"
                :columns="reconcileAuditColumns"
                :pagination="false"
                :loading="reconcileAuditLoading"
                rowKey="id"
                size="small"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.dataIndex === 'ts'">
                    {{ formatAccountTime(record.ts) }}
                  </template>
                  <template v-else-if="column.dataIndex === 'userId'">
                    {{ formatReconcileActor(record.userId) }}
                  </template>
                  <template v-else-if="column.dataIndex === 'runtimeAvailable'">
                    {{ getAuditRuntimeLabel(record) }}
                  </template>
                  <template v-else-if="column.dataIndex === 'summary'">
                    {{ getAuditSummaryText(record) }}
                  </template>
                </template>
              </a-table>
            </a-card>
          </a-space>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import type { Key } from "ant-design-vue/es/_util/type";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type AdminUser,
  type AgentDetail,
  type AgentSummary,
  type AuditEvent,
  type CommandDetail,
  type CommandSummary,
  type ContinuationPolicy,
  type CopilotModelInfo,
  type DiscoveredProviderModel,
  type FollowupTemplate,
  type JudgeConfig,
  type LifecycleHook,
  type McpServer,
  type ModelBillingMethod,
  type ModelBillingPrice,
  type ModelBillingStatus,
  type ModelListItem,
  type OrchestrationStrategy,
  type PluginCompatResult,
  type PluginInfo,
  type RunningTaskReconcileSummary,
  type SkillDetail,
  type SkillSummary,
  type WorkflowTemplate,
  checkPluginCompatibility,
  copilotLogout,
  disablePlugin,
  enablePlugin,
  getAgent,
  getCommand,
  getConfigOverview,
  getContinuationPolicy,
  getCopilotModels,
  getCopilotStatus,
  getMcpConfig,
  getModelsConfig,
  getModelsTestPolicy,
  getMyProfile,
  getOrchestrationStrategy,
  getSecurityBaseline,
  getSkill,
  installPlugin,
  listAuditEvents,
  listPlugins,
  listUsers,
  pollCopilotToken,
  reconcileRunningTasks,
  requestCopilotDeviceCode,
  testModelProvider,
  uninstallPlugin,
  updateAgent,
  updateCommand,
  updateContinuationPolicy,
  updateMcpConfig,
  updateModelsConfig,
  updateMyProfile,
  updateOrchestrationStrategy,
  updateSecurityBaseline,
  updateSkill,
} from "../lib/api";
import { PASSWORD_POLICY_HINT, validatePasswordPolicy } from "../lib/password-policy";
import { resolveSettingsDeepLink } from "../lib/settings-deep-link";
import { useAuthStore } from "../stores/auth";

// ── Tab ────────────────────────────────────────────────────────────
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const isSystemAdmin = computed(
  () => authStore.user?.role === "platform_admin" || authStore.user?.role === "org_admin",
);
const activeTab = ref(isSystemAdmin.value ? "models" : "account");

const reconcileLoading = ref(false);
const reconcileSummary = ref<RunningTaskReconcileSummary | null>(null);
const reconcileAuditLoading = ref(false);
const reconcileAuditEvents = ref<AuditEvent[]>([]);
const adminUsers = ref<AdminUser[]>([]);
function setActiveTab(value: unknown) {
  activeTab.value = String(value);
}

function normalizeTemplateMode(value: unknown): WorkflowTemplate["mode"] {
  return value === "parallel" ? "parallel" : "single";
}

function normalizeJudgeSelectionStrategy(value: unknown): JudgeConfig["selectionStrategy"] {
  return value === "highest-score" ? "highest-score" : "judge-pick";
}

function normalizeFollowupResultMode(value: unknown): FollowupTemplate["resultMode"] {
  if (value === "append" || value === "replace") {
    return value;
  }
  return "advisory";
}

function prefillProviderDraft(draft: { key: string; api?: string } | undefined) {
  if (!draft) {
    return;
  }
  if (!newProvider.key.trim()) {
    newProvider.key = draft.key;
  }
  if (draft.api) {
    newProvider.api = draft.api;
  }
}

async function applySettingsDeepLink() {
  const resolution = resolveSettingsDeepLink({
    tab: route.query.tab,
    section: route.query.section,
    provider: route.query.provider,
    providerKeys: providerTableData.value.map((entry) => entry.key),
    authenticatedCopilotProviders: Object.entries(copilotAuthMap)
      .filter(([, state]) => state?.authenticated)
      .map(([provider]) => provider),
  });

  if (resolution.activeTab) {
    activeTab.value = resolution.activeTab;
  }

  if (activeTab.value !== "models" || modelsLoading.value) {
    return;
  }

  if (resolution.ensureCopilotProvider) {
    ensureCopilotAuthState(resolution.ensureCopilotProvider);
  }

  if (resolution.expandCopilotProvider) {
    setCopilotModelCollapseActiveKey(resolution.expandCopilotProvider, ["models"]);
  }

  showAddProvider.value = resolution.openProviderModal;
  if (resolution.providerDraft) {
    prefillProviderDraft(resolution.providerDraft);
  }

  await nextTick();
  const targetId = resolution.targetId;
  if (!targetId) {
    return;
  }

  const element = document.getElementById(targetId);
  element?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const latestReconcileAudit = computed(() => reconcileAuditEvents.value[0] ?? null);

const reconcileAuditColumns = [
  { title: "时间", dataIndex: "ts", width: "24%" },
  { title: "触发人", dataIndex: "userId", width: "22%" },
  { title: "运行时", dataIndex: "runtimeAvailable", width: "14%" },
  { title: "摘要", dataIndex: "summary", width: "40%" },
];

const latestReconcileRuntimeLabel = computed(() =>
  latestReconcileAudit.value ? getAuditRuntimeLabel(latestReconcileAudit.value) : "-",
);

const latestReconcileScanned = computed(() => {
  if (!latestReconcileAudit.value) return "-";
  return String(getAuditDetailNumber(latestReconcileAudit.value, "scanned"));
});

const accountSaving = ref(false);
const passwordSaving = ref(false);
const accountProfile = reactive({ displayName: "", email: "" });
const passwordProfile = reactive({ currentPassword: "", newPassword: "", confirmPassword: "" });

function syncAccountProfile() {
  accountProfile.displayName = authStore.user?.displayName || "";
  accountProfile.email = authStore.user?.email || "";
}

function formatAccountTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function findAdminUser(userId?: string | null) {
  if (!userId) return null;
  return adminUsers.value.find((user) => user.id === userId) ?? null;
}

function formatReconcileActor(userId?: string | null) {
  if (!userId) return "-";
  const user = findAdminUser(userId);
  if (!user) return userId;
  return `${user.displayName} (${user.username})`;
}

function getAuditDetailRecord(event: unknown) {
  const detail =
    event && typeof event === "object" && "detail" in event
      ? (event as { detail?: unknown }).detail
      : undefined;
  return detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
}

function getAuditDetailNumber(event: unknown, key: string) {
  const value = getAuditDetailRecord(event)[key];
  return typeof value === "number" ? value : 0;
}

function getAuditRuntimeLabel(event: unknown) {
  const value = getAuditDetailRecord(event).runtimeAvailable;
  return value === true ? "可用" : value === false ? "不可用" : "-";
}

function getAuditSummaryText(event: unknown) {
  return `扫描 ${getAuditDetailNumber(event, "scanned")}，补全 ${getAuditDetailNumber(event, "completed")}，失败 ${getAuditDetailNumber(event, "failed")}，恢复 ${getAuditDetailNumber(event, "recovered")}，跳过 ${getAuditDetailNumber(event, "skipped")}`;
}

async function loadAdminUsers() {
  try {
    adminUsers.value = await listUsers();
  } catch {
    adminUsers.value = [];
  }
}

async function loadReconcileAuditEvents() {
  reconcileAuditLoading.value = true;
  try {
    const result = await listAuditEvents({
      type: "task.running.reconciled",
      limit: 10,
    });
    reconcileAuditEvents.value = result.data;
  } catch {
    reconcileAuditEvents.value = [];
  } finally {
    reconcileAuditLoading.value = false;
  }
}

async function saveAccountProfile() {
  if (!accountProfile.displayName.trim()) {
    message.warning("显示名称不能为空");
    return;
  }

  accountSaving.value = true;
  try {
    const profile = await updateMyProfile({
      displayName: accountProfile.displayName.trim(),
      email: accountProfile.email.trim() || null,
    });
    authStore.setUser(profile);
    syncAccountProfile();
    message.success("账户资料已更新");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "更新失败");
  } finally {
    accountSaving.value = false;
  }
}

async function saveMyPassword() {
  if (!passwordProfile.currentPassword || !passwordProfile.newPassword) {
    message.warning("请填写当前密码和新密码");
    return;
  }
  const policyResult = validatePasswordPolicy(passwordProfile.newPassword);
  if (!policyResult.valid) {
    message.warning(policyResult.errors[0]);
    return;
  }
  if (passwordProfile.newPassword !== passwordProfile.confirmPassword) {
    message.warning("两次输入的新密码不一致");
    return;
  }

  passwordSaving.value = true;
  try {
    const profile = await updateMyProfile({
      currentPassword: passwordProfile.currentPassword,
      newPassword: passwordProfile.newPassword,
    });
    authStore.setUser(profile);
    passwordProfile.currentPassword = "";
    passwordProfile.newPassword = "";
    passwordProfile.confirmPassword = "";
    message.success("密码已更新");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "更新密码失败");
  } finally {
    passwordSaving.value = false;
  }
}

// ── Models ─────────────────────────────────────────────────────────
const modelsLoading = ref(false);
const modelsData = reactive<{
  defaults: Record<string, unknown>;
  providers: Record<string, unknown>;
  list: ModelListItem[];
}>({
  defaults: {},
  providers: {},
  list: [],
});

type ModelBillingPriceField = keyof Pick<
  ModelBillingPrice,
  "inputPerMillionTokens" | "outputPerMillionTokens" | "perRequestUsd" | "perRunUsd"
>;

function normalizeModelBillingStatus(value: unknown): ModelBillingStatus {
  return value === "paid" ? "paid" : "free";
}

function normalizeModelBillingMethod(value: unknown): ModelBillingMethod | undefined {
  return value === "token_metered" || value === "request_metered" || value === "run_metered"
    ? value
    : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeModelBillingPriceRecord(value: unknown): ModelBillingPrice | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const normalized: ModelBillingPrice = { currency: "USD" };
  const inputPerMillionTokens = toFiniteNumber(record.inputPerMillionTokens);
  const outputPerMillionTokens = toFiniteNumber(record.outputPerMillionTokens);
  const perRequestUsd = toFiniteNumber(record.perRequestUsd);
  const perRunUsd = toFiniteNumber(record.perRunUsd);

  if (inputPerMillionTokens !== undefined) {
    normalized.inputPerMillionTokens = inputPerMillionTokens;
  }
  if (outputPerMillionTokens !== undefined) {
    normalized.outputPerMillionTokens = outputPerMillionTokens;
  }
  if (perRequestUsd !== undefined) {
    normalized.perRequestUsd = perRequestUsd;
  }
  if (perRunUsd !== undefined) {
    normalized.perRunUsd = perRunUsd;
  }

  return Object.keys(normalized).length > 1 ? normalized : undefined;
}

function normalizeModelRecord(record: ModelListItem | Record<string, unknown>): ModelListItem {
  const source = record as Record<string, unknown>;
  const normalized: ModelListItem = { ...source };
  const contextWindow = toFiniteNumber(source.contextWindow);
  const maxTokens = toFiniteNumber(source.maxTokens);
  const route = getRecordString(source, "route").trim();
  const billingStatus = normalizeModelBillingStatus(source.billingStatus);
  const billingMethod = normalizeModelBillingMethod(source.billingMethod);
  const price = normalizeModelBillingPriceRecord(source.price);

  normalized.id = getRecordString(source, "id");
  normalized.name = getRecordString(source, "name");
  normalized.provider = getRecordString(source, "provider");
  if (route) {
    normalized.route = route;
  } else {
    delete normalized.route;
  }
  if (contextWindow !== undefined) {
    normalized.contextWindow = contextWindow;
  } else {
    delete normalized.contextWindow;
  }
  if (maxTokens !== undefined) {
    normalized.maxTokens = maxTokens;
  } else {
    delete normalized.maxTokens;
  }

  normalized.billingStatus = billingStatus;
  if (billingStatus === "paid" && billingMethod) {
    normalized.billingMethod = billingMethod;
    if (price) {
      normalized.price = price;
    } else {
      delete normalized.price;
    }
  } else {
    delete normalized.billingMethod;
    delete normalized.price;
  }

  return normalized;
}

function normalizeModelList(list: Array<ModelListItem | Record<string, unknown>>) {
  return list.map((record) => normalizeModelRecord(record));
}

function createModelRecord(overrides: Partial<ModelListItem> = {}): ModelListItem {
  return normalizeModelRecord({
    id: "",
    name: "",
    provider: "",
    contextWindow: 200000,
    maxTokens: 16384,
    billingStatus: "free",
    ...overrides,
  });
}

const allowedTestExecutionModels = ["github-copilot:gpt-5-mini", "github-copilot:gpt-4o"];

function normalizeTestExecutionModelValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return allowedTestExecutionModels[0];
  }

  return allowedTestExecutionModels.includes(normalized)
    ? normalized
    : allowedTestExecutionModels[0];
}

function buildModelRoute(provider: string, modelId: string) {
  if (!provider || !modelId) return "";
  return `${provider}:${modelId}`;
}

function parseModelRouteValue(value: string) {
  const normalized = value.trim();
  const colonIndex = normalized.indexOf(":");
  if (colonIndex > 0) {
    return {
      provider: normalized.slice(0, colonIndex),
      modelId: normalized.slice(colonIndex + 1),
    };
  }

  return {
    provider: "",
    modelId: normalized,
  };
}

function getConfiguredModelKey(model: ModelListItem) {
  return buildModelRoute(getRecordString(model, "provider"), getRecordString(model, "id"));
}

function getDefaultAgentModelValue() {
  const model = getRecordString(modelsData.defaults, "model");
  if (!model) return "";
  if (model.includes(":")) return model;

  const provider = getRecordString(modelsData.defaults, "provider");
  return buildModelRoute(provider, model) || model;
}

function setDefaultAgentModelValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    modelsData.defaults.model = "";
    modelsData.defaults.provider = undefined;
    return;
  }

  const parsed = parseModelRouteValue(normalized);
  modelsData.defaults.model = parsed.provider
    ? buildModelRoute(parsed.provider, parsed.modelId)
    : parsed.modelId;
  if (parsed.provider) {
    modelsData.defaults.provider = parsed.provider;
  } else {
    modelsData.defaults.provider = undefined;
  }
}

function getTestExecutionModelValue() {
  return normalizeTestExecutionModelValue(getRecordString(modelsData.defaults, "testModel"));
}

function setTestExecutionModelValue(value: unknown) {
  modelsData.defaults.testModel = normalizeTestExecutionModelValue(value);
}

function isDefaultAgentModelConfigured() {
  const route = getDefaultAgentModelValue();
  if (!route) return true;
  return modelsData.list.some((model) => getConfiguredModelKey(model) === route);
}

function clearInvalidDefaultAgentModel() {
  if (!isDefaultAgentModelConfigured()) {
    setDefaultAgentModelValue("");
    return true;
  }
  return false;
}

function isDefaultConfiguredModelRecord(record: ModelListItem) {
  const route = getDefaultAgentModelValue();
  if (!route) return false;
  return getConfiguredModelKey(record) === route;
}

function getModelDuplicateRouteCount(record: ModelListItem) {
  const route = getConfiguredModelKey(record);
  if (!route) return 0;
  return modelsData.list.filter((model) => getConfiguredModelKey(model) === route).length;
}

function getModelBillingStatus(record: ModelListItem): ModelBillingStatus {
  return normalizeModelBillingStatus(record.billingStatus);
}

function getModelBillingMethod(record: ModelListItem): ModelBillingMethod | undefined {
  if (getModelBillingStatus(record) !== "paid") {
    return undefined;
  }
  return normalizeModelBillingMethod(record.billingMethod);
}

function getModelBillingPrice(record: ModelListItem): ModelBillingPrice | undefined {
  if (!getModelBillingMethod(record)) {
    return undefined;
  }
  return normalizeModelBillingPriceRecord(record.price);
}

function ensureModelBillingPrice(record: ModelListItem): ModelBillingPrice {
  const normalized = getModelBillingPrice(record) ?? { currency: "USD" };
  record.price = normalized;
  return normalized;
}

function setModelBillingStatus(record: ModelListItem, checked: unknown) {
  if (checked === true) {
    record.billingStatus = "paid";
    if (!getModelBillingMethod(record)) {
      delete record.billingMethod;
      delete record.price;
    }
    return;
  }

  record.billingStatus = "free";
  delete record.billingMethod;
  delete record.price;
}

function setModelBillingMethod(record: ModelListItem, value: unknown) {
  const billingMethod = normalizeModelBillingMethod(value);
  if (getModelBillingStatus(record) !== "paid" || !billingMethod) {
    delete record.billingMethod;
    delete record.price;
    return;
  }

  const currentPrice = getModelBillingPrice(record);
  record.billingMethod = billingMethod;

  if (billingMethod === "token_metered") {
    record.price = {
      currency: "USD",
      ...(currentPrice?.inputPerMillionTokens !== undefined
        ? { inputPerMillionTokens: currentPrice.inputPerMillionTokens }
        : {}),
      ...(currentPrice?.outputPerMillionTokens !== undefined
        ? { outputPerMillionTokens: currentPrice.outputPerMillionTokens }
        : {}),
    };
    return;
  }

  if (billingMethod === "request_metered") {
    record.price = {
      currency: "USD",
      ...(currentPrice?.perRequestUsd !== undefined
        ? { perRequestUsd: currentPrice.perRequestUsd }
        : {}),
    };
    return;
  }

  record.price = {
    currency: "USD",
    ...(currentPrice?.perRunUsd !== undefined ? { perRunUsd: currentPrice.perRunUsd } : {}),
  };
}

function getModelBillingPriceValue(record: ModelListItem, field: ModelBillingPriceField) {
  return getModelBillingPrice(record)?.[field];
}

function updateModelBillingPrice(
  record: ModelListItem,
  field: ModelBillingPriceField,
  value: unknown,
) {
  if (!getModelBillingMethod(record)) {
    return;
  }

  const numericValue = toFiniteNumber(value);
  const price = ensureModelBillingPrice(record);
  if (numericValue === undefined) {
    delete price[field];
  } else {
    price[field] = numericValue;
  }
  record.price = normalizeModelBillingPriceRecord(price) ?? { currency: "USD" };
}

function getModelBillingIssue(record: ModelListItem) {
  if (getModelBillingStatus(record) !== "paid") {
    return "";
  }

  const billingMethod = getModelBillingMethod(record);
  if (!billingMethod) {
    return "付费模型必须选择付费方式";
  }

  const price = getModelBillingPrice(record);
  if (
    billingMethod === "token_metered" &&
    (!price ||
      !((price.inputPerMillionTokens ?? 0) > 0) ||
      !((price.outputPerMillionTokens ?? 0) > 0))
  ) {
    return "按 Token 计费必须填写输入/输出单价";
  }
  if (billingMethod === "request_metered" && !((price?.perRequestUsd ?? 0) > 0)) {
    return "按请求计费必须填写每次请求价格";
  }
  if (billingMethod === "run_metered" && !((price?.perRunUsd ?? 0) > 0)) {
    return "按运行计费必须填写每次运行价格";
  }

  return "";
}

function getModelRecordIssue(record: ModelListItem) {
  const provider = getRecordString(record, "provider").trim();
  const id = getRecordString(record, "id").trim();
  if (!provider || !id) return "需要同时填写 Provider 和模型 ID";
  if (getModelDuplicateRouteCount(record) > 1)
    return `重复模型路由：${buildModelRoute(provider, id)}`;
  const billingIssue = getModelBillingIssue(record);
  if (billingIssue) return billingIssue;
  return "";
}

function getModelRoutePreview(record: ModelListItem) {
  const provider = getRecordString(record, "provider").trim();
  const id = getRecordString(record, "id").trim();
  if (!provider && !id) return "";
  if (!provider || !id) return "需补全后才会形成模型路由";
  return `模型路由：${buildModelRoute(provider, id)}`;
}

function getModelRowClassName(record: ModelListItem) {
  const rowClasses: string[] = [];
  if (isDefaultConfiguredModelRecord(record)) rowClasses.push("default-agent-model-row");
  if (getModelRecordIssue(record)) rowClasses.push("invalid-model-row");
  return rowClasses.join(" ");
}

function getModelValidationErrors() {
  const errors: string[] = [];
  const seen = new Map<string, number>();

  for (const [index, model] of modelsData.list.entries()) {
    const provider = getRecordString(model, "provider").trim();
    const id = getRecordString(model, "id").trim();
    const rowNumber = index + 1;

    if (!provider || !id) {
      errors.push(`第 ${rowNumber} 行缺少 Provider 或模型 ID`);
      return errors;
    }

    const route = buildModelRoute(provider, id);
    const firstRow = seen.get(route);
    if (firstRow) {
      errors.push(`第 ${firstRow} 行与第 ${rowNumber} 行存在重复模型路由 ${route}`);
      return errors;
    }

    seen.set(route, rowNumber);
  }

  return errors;
}

function buildModelSelectOptions(currentModel = "") {
  const options = modelsData.list
    .map((model) => {
      const id = getRecordString(model, "id");
      const provider = getRecordString(model, "provider");
      if (!id) return null;
      if (!provider) return null;

      const name = getRecordString(model, "name");
      const route = buildModelRoute(provider, id);
      const meta = [name, provider].filter(Boolean).join(" / ");

      return {
        value: route,
        label: meta ? `${route} (${meta})` : route,
      };
    })
    .filter((option): option is { value: string; label: string } => Boolean(option));

  if (currentModel && !options.some((option) => option.value === currentModel)) {
    options.unshift({ value: currentModel, label: `${currentModel} (当前值)` });
  }

  return options;
}

const defaultModelSelectOptions = computed(() =>
  buildModelSelectOptions(getDefaultAgentModelValue()),
);

const testExecutionModelSelectOptions = computed(() =>
  allowedTestExecutionModels.map((route) => ({
    value: route,
    label: modelsData.list.some((model) => getConfiguredModelKey(model) === route)
      ? route
      : `${route} (推荐值)`,
  })),
);

const agentModelSelectOptions = computed(() =>
  buildModelSelectOptions(getRecordString(agentDetail.value?.frontmatter ?? {}, "model")),
);

function buildAgentSelectOptions(currentAgents: string[] = []) {
  const currentValues = currentAgents.filter(Boolean);
  const knownAgents = agentsList.value.map((agent) => agent.name).filter(Boolean);
  const allAgents = [...knownAgents, ...currentValues];
  const seen = new Set<string>();

  return allAgents
    .filter((agent) => {
      if (seen.has(agent)) return false;
      seen.add(agent);
      return true;
    })
    .map((agent) => ({ value: agent, label: agent }));
}

function getStrategyAgentSelectOptions(currentAgents: string[] = []) {
  return buildAgentSelectOptions(currentAgents);
}

function getStrategySingleAgentSelectOptions(currentAgent = "") {
  return buildAgentSelectOptions(currentAgent ? [currentAgent] : []);
}

function getStrategyModelSelectOptions(currentModel = "") {
  return buildModelSelectOptions(currentModel);
}

const providerColumns = [
  { title: "Key", dataIndex: "key", width: "15%" },
  { title: "名称", dataIndex: "name", width: "16%" },
  { title: "API 类型", dataIndex: "api", width: "16%" },
  { title: "Base URL", dataIndex: "baseURL", width: "24%" },
  { title: "API Key", dataIndex: "apiKey", width: "19%" },
  { title: "", dataIndex: "action", width: "10%" },
];

const discoveredProviderModelColumns = [
  { title: "ID", dataIndex: "id", width: "30%" },
  { title: "名称", dataIndex: "name", width: "28%" },
  { title: "Context Window", dataIndex: "contextWindow", width: "16%" },
  { title: "Max Tokens", dataIndex: "maxTokens", width: "16%" },
  { title: "", dataIndex: "action", width: "10%" },
];

const providerTableData = computed(() =>
  Object.entries(modelsData.providers).map(([key, val]) => ({
    key,
    ...(val as Record<string, unknown>),
  })),
);

const showAddProvider = ref(false);
const newProvider = reactive({
  key: "",
  name: "",
  api: "openai-completions",
  baseURL: "",
  apiKey: "",
});
const providerTestLoading = reactive<Record<string, boolean>>({});
const providerModelLoading = reactive<Record<string, boolean>>({});
const providerModelPicker = reactive<{
  open: boolean;
  providerKey: string;
  models: DiscoveredProviderModel[];
  message: string;
  error: boolean;
}>({
  open: false,
  providerKey: "",
  models: [],
  message: "",
  error: false,
});

function getProviderTableRowProps(record: { key: string }) {
  return {
    id: `settings-models-provider-row-${record.key}`,
  };
}

function getRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function setRecordString(record: Record<string, unknown>, key: string, value: unknown) {
  record[key] = String(value ?? "");
}

async function addProvider() {
  if (!newProvider.key) {
    message.warning("请输入 Key");
    return;
  }
  if (modelsData.providers[newProvider.key]) {
    message.warning("该 Key 已存在");
    return;
  }
  const providerKey = newProvider.key;
  modelsData.providers[providerKey] = {
    api: newProvider.api,
    name: newProvider.name || providerKey,
    ...(newProvider.baseURL ? { baseURL: newProvider.baseURL } : {}),
    ...(newProvider.apiKey ? { apiKey: newProvider.apiKey } : {}),
  };
  showAddProvider.value = false;
  newProvider.key = "";
  newProvider.name = "";
  newProvider.api = "openai-completions";
  newProvider.baseURL = "";
  newProvider.apiKey = "";

  const provider = modelsData.providers[providerKey] as Record<string, unknown> | undefined;
  if (provider && getRecordString(provider, "baseURL")) {
    await chooseProviderModels(providerKey);
  }
}

function updateProvider(key: string, field: string, value: unknown) {
  const p = modelsData.providers[key] as Record<string, unknown>;
  if (p) p[field] = String(value ?? "");
}

async function testProvider(key: string) {
  const provider = modelsData.providers[key] as Record<string, unknown> | undefined;
  if (!provider) {
    message.warning("Provider 不存在");
    return;
  }

  providerTestLoading[key] = true;
  try {
    const result = await testModelProvider({ key, provider });
    if (result.data.ok) {
      message.success(`${key}：${result.data.message}`);
    } else {
      message.error(`${key}：${result.data.message}`);
    }
  } catch (error) {
    message.error(
      error instanceof Error ? `${key}：${error.message}` : `${key}：测试 Provider 失败`,
    );
  } finally {
    providerTestLoading[key] = false;
  }
}

function closeProviderModelPicker() {
  providerModelPicker.open = false;
  providerModelPicker.providerKey = "";
  providerModelPicker.models = [];
  providerModelPicker.message = "";
  providerModelPicker.error = false;
}

async function chooseProviderModels(key: string) {
  const provider = modelsData.providers[key] as Record<string, unknown> | undefined;
  if (!provider) {
    message.warning("Provider 不存在");
    return;
  }

  providerModelLoading[key] = true;
  try {
    const result = await testModelProvider({ key, provider });
    providerModelPicker.open = true;
    providerModelPicker.providerKey = key;
    providerModelPicker.models = result.data.models || [];
    providerModelPicker.message = result.data.message;
    providerModelPicker.error = !result.data.ok;
    if (!result.data.ok) {
      message.error(`${key}：${result.data.message}`);
      return;
    }
    if (!providerModelPicker.models.length) {
      message.info(`${key}：未读取到可导入模型`);
    }
  } catch (error) {
    providerModelPicker.open = true;
    providerModelPicker.providerKey = key;
    providerModelPicker.models = [];
    providerModelPicker.message = error instanceof Error ? error.message : "读取可用模型失败";
    providerModelPicker.error = true;
    message.error(error instanceof Error ? `${key}：${error.message}` : `${key}：读取可用模型失败`);
  } finally {
    providerModelLoading[key] = false;
  }
}

function addDiscoveredModelFor(model: DiscoveredProviderModel, provider: string) {
  if (!provider || isModelConfigured(provider, model.id)) return;
  modelsData.list.push(createModelRecord({
    id: model.id,
    name: model.name || model.id,
    provider,
    contextWindow: model.contextWindow ?? 200000,
    maxTokens: model.maxTokens ?? 16384,
  }));
}

function addDiscoveredModelFromRecord(record: Record<string, unknown>) {
  addDiscoveredModelFor(
    {
      id: String(record.id || ""),
      name: String(record.name || record.id || ""),
      contextWindow: typeof record.contextWindow === "number" ? record.contextWindow : null,
      maxTokens: typeof record.maxTokens === "number" ? record.maxTokens : null,
    },
    providerModelPicker.providerKey,
  );
}

function addAllDiscoveredModels() {
  const provider = providerModelPicker.providerKey;
  const pending = providerModelPicker.models.filter(
    (model) => !isModelConfigured(provider, model.id),
  );
  if (!pending.length) {
    message.info("可用模型已全部加入当前配置");
    return;
  }
  for (const model of pending) {
    addDiscoveredModelFor(model, provider);
  }
  message.success(`已添加 ${pending.length} 个模型，请点击“保存模型配置”生效`);
}

function getNextCopilotProviderKey() {
  let index = 2;
  while (modelsData.providers[`github-copilot-${index}`]) {
    index += 1;
  }
  return `github-copilot-${index}`;
}

function addCopilotProvider() {
  let initializedPrimary = false;
  if (!modelsData.providers["github-copilot"]) {
    ensureCopilotProviderFor("github-copilot");
    initializedPrimary = true;
  }

  const providerKey = getNextCopilotProviderKey();
  modelsData.providers[providerKey] = {
    api: "github-copilot",
    name: `GitHub Copilot (${providerKey.replace("github-copilot-", "账号 ")})`,
  };

  message.success(
    initializedPrimary
      ? `已初始化 github-copilot 并新增 ${providerKey}，现在可以分别登录不同账号`
      : `已新增 ${providerKey}，现在可以在新卡片上登录另一个 GitHub 账号`,
  );
}

function deleteProvider(key: string) {
  const removedModels = modelsData.list.filter(
    (model) => getRecordString(model, "provider") === key,
  ).length;
  delete modelsData.providers[key];
  if (removedModels > 0) {
    modelsData.list = modelsData.list.filter((model) => getRecordString(model, "provider") !== key);
  }

  const clearedDefault = clearInvalidDefaultAgentModel();
  if (removedModels > 0 || clearedDefault) {
    const messages: string[] = [];
    if (removedModels > 0) messages.push(`已移除 ${removedModels} 个关联模型`);
    if (clearedDefault) messages.push("已清空失效的默认执行模型");
    message.info(messages.join("，"));
  }
}

const modelColumns = [
  { title: "ID", dataIndex: "id", width: 190 },
  { title: "名称", dataIndex: "name", width: 170 },
  { title: "Provider", dataIndex: "provider", width: 140 },
  { title: "Context Window", dataIndex: "contextWindow", width: 130 },
  { title: "Max Tokens", dataIndex: "maxTokens", width: 130 },
  { title: "是否付费", dataIndex: "billingStatus", width: 110 },
  { title: "付费方式", dataIndex: "billingMethod", width: 160 },
  { title: "价格配置", dataIndex: "price", width: 260 },
  { title: "", dataIndex: "action", width: 90 },
];

const copilotModelColumns = [
  { title: "ID", dataIndex: "id", width: "26%" },
  { title: "名称", dataIndex: "name", width: "24%" },
  { title: "厂商", dataIndex: "vendor", width: "14%" },
  { title: "Context Window", dataIndex: "contextWindow", width: "14%" },
  { title: "Max Tokens", dataIndex: "maxTokens", width: "12%" },
  { title: "", dataIndex: "action", width: "10%" },
];

function addModel() {
  modelsData.list.push(createModelRecord());
}

function updateModelField(
  record: ModelListItem,
  field: "id" | "provider",
  value: unknown,
) {
  record[field] = String(value ?? "");
  if (clearInvalidDefaultAgentModel()) {
    message.info("已清空失效的默认执行模型");
  }
}

function removeModelAt(index: number) {
  modelsData.list.splice(index, 1);
  if (clearInvalidDefaultAgentModel()) {
    message.info("已清空失效的默认执行模型");
  }
}

// ── Copilot OAuth (multi-account) ──────────────────────────────────
interface CopilotAuthState {
  authenticated: boolean;
  loginAt: string | null;
  loading: boolean;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  countdown: number;
  interval: number;
}
interface CopilotModelsState {
  loading: boolean;
  loaded: boolean;
  error: string;
  items: CopilotModelInfo[];
}

// List of copilot provider IDs from the current project config
const copilotProviders = computed(() => {
  const providers = Object.keys(modelsData.providers || {});
  const result = providers.filter((id) => id.startsWith("github-copilot"));
  return result.length ? result : ["github-copilot"];
});

const copilotAuthMap = reactive<Record<string, CopilotAuthState>>({});
const copilotModelsMap = reactive<Record<string, CopilotModelsState>>({});

function ensureCopilotAuthState(provider: string) {
  if (!copilotAuthMap[provider]) {
    copilotAuthMap[provider] = {
      authenticated: false,
      loginAt: null,
      loading: false,
      deviceCode: "",
      userCode: "",
      verificationUri: "",
      countdown: 0,
      interval: 5,
    };
  }
  if (!copilotModelsMap[provider]) {
    copilotModelsMap[provider] = { loading: false, loaded: false, error: "", items: [] };
  }
}

const copilotModelFilter = ref("all");
const copilotModelsExpanded = reactive<Record<string, boolean>>({});
const pollTimers: Record<string, ReturnType<typeof setInterval> | null> = {};
const countdownTimers: Record<string, ReturnType<typeof setInterval> | null> = {};

function getCopilotUnconfiguredCount(provider: string) {
  ensureCopilotAuthState(provider);
  return (copilotModelsMap[provider]?.items || []).filter(
    (model) => !isModelConfigured(provider, model.id),
  ).length;
}

function getCopilotModelsStatusColor(provider: string) {
  ensureCopilotAuthState(provider);
  const modelsState = copilotModelsMap[provider];
  if (modelsState.loading) return "processing";
  if (modelsState.error) return "red";
  if (!modelsState.loaded) return "default";
  return "green";
}

function getCopilotModelsStatusText(provider: string) {
  ensureCopilotAuthState(provider);
  const modelsState = copilotModelsMap[provider];
  if (modelsState.loading) return "读取中";
  if (modelsState.error) return "读取失败";
  if (!modelsState.loaded) return "未读取";
  return "已读取";
}

function getCopilotModelsMetaText(provider: string) {
  ensureCopilotAuthState(provider);
  const modelsState = copilotModelsMap[provider];
  if (modelsState.loading) return "正在读取模型列表";
  if (modelsState.error) return "展开可重试";
  if (!modelsState.loaded) return "展开后读取";

  const count = modelsState.items.length;
  if (!count) return "暂无数据；再次展开可刷新";
  return `${count} 个模型，未配置 ${getCopilotUnconfiguredCount(provider)} 个`;
}

function getCopilotModelCollapseActiveKey(provider: string) {
  return copilotModelsExpanded[provider] ? ["models"] : [];
}

function setCopilotModelCollapseActiveKey(provider: string, value: unknown) {
  const keys = Array.isArray(value)
    ? value.map((item) => String(item))
    : [String(value ?? "")].filter(Boolean);
  const shouldExpand = keys.includes("models");
  const wasExpanded = Boolean(copilotModelsExpanded[provider]);
  copilotModelsExpanded[provider] = shouldExpand;
  if (shouldExpand && !wasExpanded && !copilotModelsMap[provider]?.loading) {
    void loadCopilotModelsFor(provider);
  }
}

function ensureCopilotProviderFor(provider: string) {
  if (!modelsData.providers[provider]) {
    modelsData.providers[provider] = {
      api: "github-copilot",
      name:
        provider === "github-copilot"
          ? "GitHub Copilot"
          : `GitHub Copilot (${provider.replace("github-copilot-", "")})`,
    };
  }
}

function isModelConfigured(provider: string, modelId: string) {
  const route = buildModelRoute(provider, modelId);
  return modelsData.list.some((model) => getConfiguredModelKey(model) === route);
}

function getFilteredCopilotModels(provider: string): CopilotModelInfo[] {
  ensureCopilotAuthState(provider);
  const items = copilotModelsMap[provider]?.items || [];
  if (copilotModelFilter.value !== "unconfigured") return items;
  return items.filter((model) => !isModelConfigured(provider, model.id));
}

function addCopilotModelFor(model: CopilotModelInfo, provider: string) {
  if (isModelConfigured(provider, model.id)) return;
  ensureCopilotProviderFor(provider);
  modelsData.list.push(createModelRecord({
    id: model.id,
    name: model.name || model.id,
    provider,
    contextWindow: model.contextWindow ?? 200000,
    maxTokens: model.maxTokens ?? 16384,
  }));
}

function addCopilotModelFromRecordFor(record: Record<string, unknown>, provider: string) {
  addCopilotModelFor(
    {
      id: String(record.id || ""),
      name: String(record.name || record.id || ""),
      vendor: String(record.vendor || ""),
      version: String(record.version || ""),
      preview: Boolean(record.preview),
      contextWindow: typeof record.contextWindow === "number" ? record.contextWindow : null,
      maxTokens: typeof record.maxTokens === "number" ? record.maxTokens : null,
    },
    provider,
  );
}

function addAllCopilotModelsFor(provider: string) {
  ensureCopilotAuthState(provider);
  const allItems = copilotModelsMap[provider]?.items || [];
  const pending = allItems.filter((model) => !isModelConfigured(provider, model.id));
  if (!pending.length) {
    message.info("Copilot 模型已全部加入当前配置");
    return;
  }
  for (const model of pending) {
    addCopilotModelFor(model, provider);
  }
  message.success(`已添加 ${pending.length} 个 Copilot 模型，请点击"保存模型配置"生效`);
}

function clearCopilotTimersFor(provider: string) {
  const pollTimer = pollTimers[provider];
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimers[provider] = null;
  }
  const countdownTimer = countdownTimers[provider];
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimers[provider] = null;
  }
}

function clearAllCopilotTimers() {
  for (const p of Object.keys(pollTimers)) clearCopilotTimersFor(p);
}

async function loadCopilotStatusFor(provider: string) {
  ensureCopilotAuthState(provider);
  try {
    const res = await getCopilotStatus(provider);
    copilotAuthMap[provider].authenticated = res.data.authenticated;
    copilotAuthMap[provider].loginAt = res.data.login_at || null;
    if (copilotAuthMap[provider].authenticated) {
      ensureCopilotProviderFor(provider);
    }
  } catch {
    /* ignore */
  }
}

async function loadCopilotModelsFor(provider: string) {
  ensureCopilotAuthState(provider);
  if (!copilotAuthMap[provider].authenticated) return;

  copilotModelsMap[provider].loading = true;
  copilotModelsMap[provider].error = "";
  try {
    const res = await getCopilotModels(provider);
    copilotModelsMap[provider].items = res.data;
    copilotModelsMap[provider].loaded = true;
  } catch (e: unknown) {
    copilotModelsMap[provider].error = e instanceof Error ? e.message : "读取 Copilot 模型失败";
  } finally {
    copilotModelsMap[provider].loading = false;
  }
}

async function startCopilotAuthFor(provider: string) {
  ensureCopilotAuthState(provider);
  const auth = copilotAuthMap[provider];
  auth.loading = true;
  try {
    const res = await requestCopilotDeviceCode(provider);
    const d = res.data;
    auth.deviceCode = d.device_code;
    auth.userCode = d.user_code;
    auth.verificationUri = d.verification_uri;
    auth.interval = Math.max(d.interval || 5, 5);
    auth.countdown = d.expires_in || 900;

    countdownTimers[provider] = setInterval(() => {
      auth.countdown--;
      if (auth.countdown <= 0) {
        clearCopilotTimersFor(provider);
        auth.deviceCode = "";
        message.error("验证码已过期，请重新发起认证");
      }
    }, 1000);

    startPollingFor(provider);
  } catch {
    message.error("发起认证失败");
  } finally {
    auth.loading = false;
  }
}

function startPollingFor(provider: string) {
  ensureCopilotAuthState(provider);
  const auth = copilotAuthMap[provider];
  const pollTimer = pollTimers[provider];
  if (pollTimer) clearInterval(pollTimer);
  pollTimers[provider] = setInterval(async () => {
    try {
      const pollRes = await pollCopilotToken(auth.deviceCode, provider);
      const status = pollRes.data.status;
      if (status === "success") {
        clearCopilotTimersFor(provider);
        auth.deviceCode = "";
        auth.authenticated = true;
        auth.loginAt = new Date().toISOString();
        ensureCopilotProviderFor(provider);
        message.success(`${provider} 认证成功！`);
      } else if (status === "slow_down") {
        auth.interval = (pollRes.data.interval || auth.interval) + 3;
        startPollingFor(provider);
      }
    } catch {
      // Network error — keep trying
    }
  }, auth.interval * 1000);
}

async function doCopilotLogoutFor(provider: string) {
  ensureCopilotAuthState(provider);
  const auth = copilotAuthMap[provider];
  auth.loading = true;
  try {
    await copilotLogout(provider);
    auth.authenticated = false;
    auth.loginAt = null;
    copilotModelsMap[provider].items = [];
    copilotModelsMap[provider].loaded = false;
    copilotModelsMap[provider].error = "";
    message.success(`已退出 ${provider} 登录`);
  } catch {
    message.error("退出失败");
  } finally {
    auth.loading = false;
  }
}

async function loadCopilotStatus() {
  for (const p of copilotProviders.value) {
    await loadCopilotStatusFor(p);
  }
}

onUnmounted(() => {
  clearAllCopilotTimers();
});

// ── Agents ─────────────────────────────────────────────────────────
const agentsList = ref<AgentSummary[]>([]);
const agentSelected = ref<string[]>([]);
const agentOpenKeys = ref<string[]>([]);
const agentDetail = ref<{ frontmatter: Record<string, unknown>; body: string } | null>(null);
const agentLoading = ref(false);

interface AgentGroupDefinition {
  key: string;
  label: string;
  priority: number;
  keywords: string[];
}

interface AgentGroupView {
  key: string;
  label: string;
  priority: number;
  items: AgentSummary[];
}

const agentGroupDefinitions: AgentGroupDefinition[] = [
  {
    key: "orchestration",
    label: "编排 / 路由",
    priority: 10,
    keywords: ["orchestrator", "dispatch", "decomposes", "routes", "routing", "specialist agents"],
  },
  {
    key: "planning",
    label: "规划 / 方案",
    priority: 20,
    keywords: [
      "planning",
      "plan",
      "pre-plan",
      "post-plan",
      "requirement",
      "interviews",
      "ambiguities",
    ],
  },
  {
    key: "exploration",
    label: "探索 / 检索",
    priority: 30,
    keywords: ["exploration", "lookup", "retrieval", "finds", "summarizes", "context", "queries"],
  },
  {
    key: "execution",
    label: "执行 / 开发",
    priority: 40,
    keywords: ["execution", "writes", "edits", "tests code", "implements", "end-to-end"],
  },
  {
    key: "review-validation",
    label: "审核 / 校验",
    priority: 50,
    keywords: [
      "validator",
      "reviews",
      "audit",
      "clarity",
      "completeness",
      "verifiability",
      "validates",
    ],
  },
  {
    key: "operations",
    label: "运维 / 故障处理",
    priority: 60,
    keywords: ["operations", "troubleshooting", "system inspection", "inspection", "ops"],
  },
  {
    key: "multimodal",
    label: "多模态",
    priority: 70,
    keywords: ["multimodal", "images", "pdf", "screenshots", "design mockups"],
  },
];

const agentCategoryAliases: Record<string, string> = {
  orchestration: "orchestration",
  orchestrator: "orchestration",
  planning: "planning",
  planner: "planning",
  explore: "exploration",
  exploration: "exploration",
  retrieval: "exploration",
  execution: "execution",
  coding: "execution",
  review: "review-validation",
  validation: "review-validation",
  audit: "review-validation",
  operations: "operations",
  ops: "operations",
  multimodal: "multimodal",
};

function getAgentSearchText(agent: AgentSummary): string {
  return [
    agent.name,
    agent.description,
    agent.category,
    agent.model,
    ...(agent.tags ?? []),
    ...(agent.applyTo ?? []),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .toLowerCase();
}

function matchesAgentKeyword(searchText: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.toLowerCase()).replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
  return pattern.test(searchText);
}

function resolveAgentGroup(agent: AgentSummary): { key: string; label: string; priority: number } {
  const rawCategory = String(agent.category ?? "")
    .trim()
    .toLowerCase();
  if (rawCategory) {
    const aliasKey = agentCategoryAliases[rawCategory];
    const aliasGroup = aliasKey
      ? agentGroupDefinitions.find((group) => group.key === aliasKey)
      : undefined;
    if (aliasGroup) {
      return { key: aliasGroup.key, label: aliasGroup.label, priority: aliasGroup.priority };
    }
    return {
      key: `custom:${rawCategory}`,
      label: normalizeSkillGroupLabel(rawCategory),
      priority: 999,
    };
  }

  const searchText = getAgentSearchText(agent);
  const matchedGroup = agentGroupDefinitions.find((group) =>
    group.keywords.some((keyword) => matchesAgentKeyword(searchText, keyword)),
  );
  if (matchedGroup) {
    return { key: matchedGroup.key, label: matchedGroup.label, priority: matchedGroup.priority };
  }

  return { key: "uncategorized", label: "未分类", priority: 999 };
}

const groupedAgentsList = computed<AgentGroupView[]>(() => {
  const groups = new Map<string, AgentGroupView>();

  for (const agent of [...agentsList.value].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN"),
  )) {
    const groupMeta = resolveAgentGroup(agent);
    const current = groups.get(groupMeta.key);
    if (current) {
      current.items.push(agent);
      continue;
    }
    groups.set(groupMeta.key, {
      key: groupMeta.key,
      label: groupMeta.label,
      priority: groupMeta.priority,
      items: [agent],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.label.localeCompare(right.label, "zh-CN");
  });
});

const agentGroupKeyByAgentName = computed<Record<string, string>>(() => {
  const mapping: Record<string, string> = {};
  for (const group of groupedAgentsList.value) {
    for (const agent of group.items) {
      mapping[agent.name] = group.key;
    }
  }
  return mapping;
});

function onAgentOpenChange(keys: Key[]) {
  agentOpenKeys.value = keys.map((key) => String(key));
}

async function onAgentSelect({ key }: { key: string | number }) {
  const agentKey = String(key);
  agentLoading.value = true;
  try {
    agentSelected.value = [agentKey];
    const groupKey = agentGroupKeyByAgentName.value[agentKey];
    if (groupKey && !agentOpenKeys.value.includes(groupKey)) {
      agentOpenKeys.value = [...agentOpenKeys.value, groupKey];
    }
    const res = await getAgent(agentKey);
    agentDetail.value = { frontmatter: res.data.frontmatter, body: res.data.body };
  } catch (e: unknown) {
    message.error("加载 Agent 失败");
  } finally {
    agentLoading.value = false;
  }
}

// ── Skills ─────────────────────────────────────────────────────────
const skillsList = ref<SkillSummary[]>([]);
const skillSelected = ref<string[]>([]);
const skillOpenKeys = ref<string[]>([]);
const skillDetail = ref<{ frontmatter: Record<string, unknown>; body: string } | null>(null);
const skillLoading = ref(false);

interface SkillGroupDefinition {
  key: string;
  label: string;
  priority: number;
  keywords: string[];
}

interface SkillGroupView {
  key: string;
  label: string;
  priority: number;
  items: SkillSummary[];
}

const skillGroupDefinitions: SkillGroupDefinition[] = [
  {
    key: "ai-agent",
    label: "AI / Agent",
    priority: 10,
    keywords: ["agentic", "copilot", "prompt", "context", "memory", "mcp"],
  },
  {
    key: "search-research",
    label: "搜索 / 研究",
    priority: 20,
    keywords: ["search", "research", "knowledge", "obsidian"],
  },
  {
    key: "testing-quality",
    label: "测试 / 质量",
    priority: 30,
    keywords: [
      "test",
      "testing",
      "playwright",
      "cypress",
      "vitest",
      "jest",
      "review",
      "lint",
      "quality",
    ],
  },
  {
    key: "security",
    label: "安全",
    priority: 40,
    keywords: [
      "security",
      "auth",
      "audit",
      "owasp",
      "threat",
      "stride",
      "vulnerability",
      "csp",
      "cors",
    ],
  },
  {
    key: "git-collaboration",
    label: "Git / 协作",
    priority: 50,
    keywords: ["git", "commit", "pull request", "pr", "linear", "branch", "rebase"],
  },
  {
    key: "docs-writing",
    label: "文档 / 写作",
    priority: 60,
    keywords: ["documentation", "document", "docs", "readme", "runbook", "writing"],
  },
  {
    key: "backend-api",
    label: "后端 / API",
    priority: 70,
    keywords: ["backend", "api", "graphql", "rest", "microservice", "server", "architecture"],
  },
  {
    key: "frontend-ui",
    label: "前端 / UI",
    priority: 80,
    keywords: ["react", "next.js", "nextjs", "vite", "tailwind", "browser", "frontend", "email"],
  },
  {
    key: "data-database",
    label: "数据 / 数据库",
    priority: 90,
    keywords: [
      "database",
      "sql",
      "postgres",
      "prisma",
      "drizzle",
      "query",
      "schema",
      "migration",
      "model",
    ],
  },
  {
    key: "devops-infra",
    label: "DevOps / 运维",
    priority: 100,
    keywords: ["docker", "bash", "ci/cd", "deployment", "infra", "container", "monorepo"],
  },
  {
    key: "workflow-automation",
    label: "工作流 / 自动化",
    priority: 110,
    keywords: ["workflow", "orchestration", "automation", "retry", "recovery", "fallback"],
  },
  {
    key: "development",
    label: "代码开发",
    priority: 120,
    keywords: [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
      "coding",
      "clean code",
      "refactor",
    ],
  },
];

const skillCategoryAliases: Record<string, string> = {
  testing: "testing-quality",
  quality: "testing-quality",
  security: "security",
  documentation: "docs-writing",
  docs: "docs-writing",
  writing: "docs-writing",
  workflow: "workflow-automation",
  automation: "workflow-automation",
  orchestration: "workflow-automation",
  frontend: "frontend-ui",
  ui: "frontend-ui",
  backend: "backend-api",
  api: "backend-api",
  database: "data-database",
  data: "data-database",
  git: "git-collaboration",
  devops: "devops-infra",
  infra: "devops-infra",
  search: "search-research",
  research: "search-research",
  agent: "ai-agent",
  ai: "ai-agent",
};

function normalizeSkillGroupLabel(value: string): string {
  return value
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function getSkillSearchText(skill: SkillSummary): string {
  return [
    skill.name,
    skill.description,
    skill.category,
    ...(skill.tags ?? []),
    ...(skill.applyTo ?? []),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesSkillKeyword(searchText: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.toLowerCase()).replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
  return pattern.test(searchText);
}

function resolveSkillGroup(skill: SkillSummary): { key: string; label: string; priority: number } {
  const rawCategory = String(skill.category ?? "")
    .trim()
    .toLowerCase();
  if (rawCategory) {
    const aliasKey = skillCategoryAliases[rawCategory];
    const aliasGroup = aliasKey
      ? skillGroupDefinitions.find((group) => group.key === aliasKey)
      : undefined;
    if (aliasGroup) {
      return { key: aliasGroup.key, label: aliasGroup.label, priority: aliasGroup.priority };
    }
    return {
      key: `custom:${rawCategory}`,
      label: normalizeSkillGroupLabel(rawCategory),
      priority: 130,
    };
  }

  const searchText = getSkillSearchText(skill);
  const matchedGroup = skillGroupDefinitions.find((group) =>
    group.keywords.some((keyword) => matchesSkillKeyword(searchText, keyword)),
  );
  if (matchedGroup) {
    return { key: matchedGroup.key, label: matchedGroup.label, priority: matchedGroup.priority };
  }

  return { key: "uncategorized", label: "未分类", priority: 999 };
}

const groupedSkillsList = computed<SkillGroupView[]>(() => {
  const groups = new Map<string, SkillGroupView>();

  for (const skill of [...skillsList.value].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN"),
  )) {
    const groupMeta = resolveSkillGroup(skill);
    const current = groups.get(groupMeta.key);
    if (current) {
      current.items.push(skill);
      continue;
    }
    groups.set(groupMeta.key, {
      key: groupMeta.key,
      label: groupMeta.label,
      priority: groupMeta.priority,
      items: [skill],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.label.localeCompare(right.label, "zh-CN");
  });
});

const skillGroupKeyBySkillKey = computed<Record<string, string>>(() => {
  const mapping: Record<string, string> = {};
  for (const group of groupedSkillsList.value) {
    for (const skill of group.items) {
      mapping[skill.dirName || skill.name] = group.key;
    }
  }
  return mapping;
});

function onSkillOpenChange(keys: Key[]) {
  skillOpenKeys.value = keys.map((key) => String(key));
}

async function onSkillSelect({ key }: { key: string | number }) {
  const skillKey = String(key);
  skillLoading.value = true;
  try {
    skillSelected.value = [skillKey];
    const groupKey = skillGroupKeyBySkillKey.value[skillKey];
    if (groupKey && !skillOpenKeys.value.includes(groupKey)) {
      skillOpenKeys.value = [...skillOpenKeys.value, groupKey];
    }
    const res = await getSkill(skillKey);
    skillDetail.value = { frontmatter: res.data.frontmatter, body: res.data.body };
  } catch (e: unknown) {
    message.error("加载 Skill 失败");
  } finally {
    skillLoading.value = false;
  }
}

// ── Commands ───────────────────────────────────────────────────────
const commandsList = ref<CommandSummary[]>([]);
const commandSelected = ref<string[]>([]);
const commandDetail = ref<{ frontmatter: Record<string, unknown>; body: string } | null>(null);
const commandLoading = ref(false);

async function onCommandSelect({ key }: { key: string | number }) {
  const commandKey = String(key);
  commandLoading.value = true;
  try {
    commandSelected.value = [commandKey];
    const res = await getCommand(commandKey);
    commandDetail.value = { frontmatter: res.data.frontmatter, body: res.data.body };
  } catch (e: unknown) {
    message.error("加载命令失败");
  } finally {
    commandLoading.value = false;
  }
}

// ── MCP ────────────────────────────────────────────────────────────
const mcpLoading = ref(false);
const mcpData = reactive<Record<string, McpServer>>({});
const showAddMcp = ref(false);
const newMcp = reactive({ name: "", command: "npx", args: "", description: "" });

function deleteMcp(name: string) {
  delete mcpData[name];
}

function updateMcpArgs(server: McpServer, value: unknown) {
  const raw = String(value ?? "");
  server.args = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function addMcp() {
  if (!newMcp.name) {
    message.warning("请输入名称");
    return;
  }
  mcpData[newMcp.name] = {
    command: newMcp.command,
    args: newMcp.args
      ? newMcp.args
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    description: newMcp.description || undefined,
  };
  showAddMcp.value = false;
  newMcp.name = "";
  newMcp.args = "";
  newMcp.description = "";
}

// ── Security ───────────────────────────────────────────────────────
const securityLoading = ref(false);
const securityRaw = ref("");

// ── Plugins ────────────────────────────────────────────────────────
const pluginsList = ref<PluginInfo[]>([]);
const pluginColumns = [
  { title: "名称", dataIndex: "name", width: "20%" },
  { title: "路径", dataIndex: "path", width: "40%" },
  { title: "状态", dataIndex: "enabled", width: "15%" },
  { title: "操作", dataIndex: "action", width: "25%" },
];

// Plugin lifecycle
const showInstallPlugin = ref(false);
const installSource = ref("");
const installName = ref("");
const installLoading = ref(false);
const compatLoading = ref(false);
const compatResults = ref<PluginCompatResult[]>([]);
const compatColumns = [
  { title: "名称", dataIndex: "name" },
  { title: "路径", dataIndex: "path" },
  { title: "兼容性", dataIndex: "compatible", width: 100 },
  { title: "问题", dataIndex: "errors" },
];

async function togglePlugin(name: string, enable: boolean) {
  try {
    if (enable) await enablePlugin(name);
    else await disablePlugin(name);
    message.success(`插件 ${name} 已${enable ? "启用" : "禁用"}`);
    const r = await listPlugins();
    pluginsList.value = r.data;
  } catch {
    message.error("操作失败");
  }
}

async function doUninstall(name: string) {
  try {
    await uninstallPlugin(name);
    message.success(`插件 ${name} 已卸载`);
    const r = await listPlugins();
    pluginsList.value = r.data;
  } catch {
    message.error("卸载失败");
  }
}

async function doInstallPlugin() {
  if (!installSource.value.trim()) return;
  installLoading.value = true;
  try {
    await installPlugin(installSource.value, installName.value || undefined);
    message.success("插件安装成功");
    showInstallPlugin.value = false;
    installSource.value = "";
    installName.value = "";
    const r = await listPlugins();
    pluginsList.value = r.data;
  } catch {
    message.error("安装失败");
  } finally {
    installLoading.value = false;
  }
}

async function checkCompat() {
  compatLoading.value = true;
  try {
    const r = await checkPluginCompatibility();
    compatResults.value = r.data;
  } catch {
    message.error("检查失败");
  } finally {
    compatLoading.value = false;
  }
}

// ── Orchestration Strategy ─────────────────────────────────────────
const strategyLoading = ref(true);
const strategySaving = ref(false);

const CATEGORY_LABELS: Record<string, string> = {
  quick: "快速查询",
  deep: "深度开发",
  ops: "运维操作",
  security: "安全审计",
  architecture: "架构设计",
};

const DEFAULT_CATEGORY_AGENTS: Record<string, string[]> = {
  quick: ["explore-enterprise"],
  deep: ["sisyphus-enterprise", "prometheus-enterprise", "hephaestus-enterprise"],
  ops: ["oracle-enterprise"],
  security: ["oracle-enterprise", "hephaestus-enterprise"],
  architecture: ["prometheus-enterprise", "oracle-enterprise"],
};

const strategyData = reactive<OrchestrationStrategy>({
  categoryAgentMap: {},
  categoryModelMap: {},
  enablePipeline: true,
  hooks: [],
  templates: [
    {
      id: "default-single",
      name: "标准单执行",
      mode: "single",
      agents: [],
      enabled: true,
      categoryDefaults: ["quick", "deep", "ops", "security", "architecture"],
    },
  ],
  followups: [],
  judge: {
    enabled: false,
    agent: "prometheus-enterprise",
    model: "",
    promptTemplate: "",
    timeoutMs: 30000,
    selectionStrategy: "judge-pick",
  },
});

const strategyTableData = computed(() =>
  Object.keys(CATEGORY_LABELS).map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    agents: strategyData.categoryAgentMap[cat] || [],
    model: strategyData.categoryModelMap[cat] || "",
  })),
);

const strategyAgentColumns = [
  { title: "分类", dataIndex: "category", width: "15%" },
  { title: "推荐 Agent", dataIndex: "agents", width: "50%" },
  { title: "指定模型", dataIndex: "model", width: "35%" },
];

function updateStrategyAgent(category: string, agents: string[]) {
  strategyData.categoryAgentMap[category] = agents;
}

function handleStrategyAgentsChange(category: string, value: unknown) {
  updateStrategyAgent(category, Array.isArray(value) ? value.map((item) => String(item)) : []);
}

function updateStrategyModel(category: string, model: string) {
  strategyData.categoryModelMap[category] = model;
}

const CATEGORY_LABELS_MAP = CATEGORY_LABELS;

const hasEnabledParallelTemplate = computed(() =>
  strategyData.templates.some((t) => t.enabled && t.mode === "parallel"),
);

function resolveNewTemplateCategories(
  tpl: OrchestrationStrategy["templates"][number],
  categories: string[],
) {
  const oldCategories = tpl.categoryDefaults ?? [];
  tpl.categoryDefaults = categories;
  return categories.filter((category) => !oldCategories.includes(category));
}

function collectCategoryDefaultAgents(categories: string[]) {
  const agentsToAdd: string[] = [];

  for (const category of categories) {
    const mapped = strategyData.categoryAgentMap[category];
    const source = mapped && mapped.length > 0 ? mapped : (DEFAULT_CATEGORY_AGENTS[category] ?? []);
    for (const agent of source) {
      if (!agentsToAdd.includes(agent)) {
        agentsToAdd.push(agent);
      }
    }
  }

  return agentsToAdd;
}

function handleTemplateCategoryChange(
  tpl: OrchestrationStrategy["templates"][number],
  categories: string[],
) {
  const newCategories = resolveNewTemplateCategories(tpl, categories);

  // Auto-fill agents when categories are added and agent list is empty
  if (tpl.agents.length > 0 || newCategories.length === 0) {
    return;
  }

  const agentsToAdd = collectCategoryDefaultAgents(newCategories);
  if (agentsToAdd.length > 0) {
    tpl.agents = agentsToAdd;
  }
}

const HOOK_SECTIONS = [
  {
    trigger: "pre-execution",
    title: "执行前 Hook",
    emptyText: "暂无执行前 Hook",
    description: "任务首次执行前触发，适合做准入审查、Prompt 改写和模型切换。",
  },
  {
    trigger: "post-execution",
    title: "执行后 Hook",
    emptyText: "暂无执行后 Hook",
    description: "任务执行完成后触发，适合做结果复核、审计记录和后置通知。",
  },
  {
    trigger: "on-failure",
    title: "失败后 Hook",
    emptyText: "暂无失败后 Hook",
    description: "仅在 runtime/session 级硬失败时触发，不覆盖结果质量差、未达成阶段目标等软失败。",
  },
  {
    trigger: "pre-resume",
    title: "续跑前 Hook",
    emptyText: "暂无续跑前 Hook",
    description:
      "仅在恢复已暂停的 agent run 前触发，用于恢复前检查和补充指导，不覆盖普通 continue。",
  },
] as const;

function hooksByTrigger(trigger: LifecycleHook["trigger"]) {
  return strategyData.hooks
    .filter((hook) => hook.trigger === trigger)
    .sort((a, b) => a.order - b.order);
}

function addHook(trigger: LifecycleHook["trigger"]) {
  const count = strategyData.hooks.filter((hook) => hook.trigger === trigger).length + 1;
  strategyData.hooks.push({
    id: `${trigger}-${Date.now()}`,
    trigger,
    enabled: true,
    agent: "",
    model: "",
    promptTemplate: "",
    timeoutMs: 15000,
    order: count - 1,
  });
}

function removeHook(hookId: string) {
  const index = strategyData.hooks.findIndex((hook) => hook.id === hookId);
  if (index >= 0) {
    strategyData.hooks.splice(index, 1);
  }
}

function addTemplate() {
  const id = `tpl-${Date.now()}`;
  strategyData.templates.push({
    id,
    name: `模板 ${strategyData.templates.length + 1}`,
    mode: "single",
    agents: [],
    enabled: true,
  });
}

function removeTemplate(index: number) {
  strategyData.templates.splice(index, 1);
}

function addFollowup() {
  const id = `followup-${Date.now()}`;
  strategyData.followups.push({
    id,
    enabled: true,
    agent: "",
    model: "",
    promptTemplate: "",
    timeoutMs: 15000,
    resultMode: "advisory",
  });
}

function removeFollowup(index: number) {
  strategyData.followups.splice(index, 1);
}

async function saveStrategy() {
  strategySaving.value = true;
  try {
    await updateOrchestrationStrategy({
      categoryAgentMap: strategyData.categoryAgentMap,
      categoryModelMap: strategyData.categoryModelMap,
      enablePipeline: strategyData.enablePipeline,
      hooks: strategyData.hooks,
      templates: strategyData.templates,
      followups: strategyData.followups,
      judge: strategyData.judge,
    });
    message.success("编排策略已保存");
  } catch {
    message.error("保存失败");
  } finally {
    strategySaving.value = false;
  }
}

// ── Continuation Policy ────────────────────────────────────────────
const policyLoading = ref(true);
const policySaving = ref(false);

const policyData = reactive<ContinuationPolicy>({
  autoRetryOnFailure: false,
  maxRetries: 2,
  retryableErrors: ["timeout", "rate_limit", "context_length"],
  requireApprovalOnRetry: true,
  fallbackModel: "",
  enableFallback: false,
});

async function savePolicy() {
  policySaving.value = true;
  try {
    await updateContinuationPolicy({ ...policyData });
    message.success("恢复策略已保存");
  } catch {
    message.error("保存失败");
  } finally {
    policySaving.value = false;
  }
}

async function runRunningTaskReconcile() {
  reconcileLoading.value = true;
  try {
    const result = await reconcileRunningTasks();
    reconcileSummary.value = result.data;
    await loadReconcileAuditEvents();
    message.success(
      `Reconcile 完成：扫描 ${result.data.scanned}，补全 ${result.data.completed}，失败 ${result.data.failed}，恢复 ${result.data.recovered}`,
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : "触发 reconcile 失败");
  } finally {
    reconcileLoading.value = false;
  }
}

// ── Saving ─────────────────────────────────────────────────────────
const saving = ref(false);

async function saveModels() {
  saving.value = true;
  try {
    clearInvalidDefaultAgentModel();
    setDefaultAgentModelValue(getDefaultAgentModelValue());
    setTestExecutionModelValue(getTestExecutionModelValue());
    modelsData.list = normalizeModelList(modelsData.list);
    const validationErrors = getModelValidationErrors();
    if (validationErrors.length > 0) {
      message.error(validationErrors[0]);
      return;
    }
    const res = await updateModelsConfig({
      defaults: modelsData.defaults,
      providers: modelsData.providers,
      list: normalizeModelList(modelsData.list),
    });
    message.success(
      res.restartRequired
        ? "模型配置已保存到运行时配置文件；需重启运行时后，新任务才会使用新配置"
        : "模型配置已保存到运行时配置文件；新任务将自动使用最新配置",
    );
  } catch (e: unknown) {
    message.error("保存失败");
  } finally {
    saving.value = false;
  }
}

async function saveAgent() {
  if (!agentDetail.value || !agentSelected.value[0]) return;
  saving.value = true;
  try {
    await updateAgent(agentSelected.value[0], agentDetail.value);
    message.success("Agent 已保存");
  } catch (e: unknown) {
    message.error("保存失败");
  } finally {
    saving.value = false;
  }
}

async function saveSkill() {
  if (!skillDetail.value || !skillSelected.value[0]) return;
  saving.value = true;
  try {
    await updateSkill(skillSelected.value[0], skillDetail.value);
    message.success("Skill 已保存");
  } catch (e: unknown) {
    message.error("保存失败");
  } finally {
    saving.value = false;
  }
}

async function saveCommand() {
  if (!commandDetail.value || !commandSelected.value[0]) return;
  saving.value = true;
  try {
    await updateCommand(commandSelected.value[0], commandDetail.value);
    message.success("命令已保存");
  } catch (e: unknown) {
    message.error("保存失败");
  } finally {
    saving.value = false;
  }
}

async function saveMcp() {
  saving.value = true;
  try {
    const res = await updateMcpConfig(mcpData);
    message.success(`MCP 配置已保存${res.restartRequired ? "（需重启运行时生效）" : ""}`);
  } catch (e: unknown) {
    message.error("保存失败");
  } finally {
    saving.value = false;
  }
}

async function saveSecurity() {
  saving.value = true;
  try {
    await updateSecurityBaseline(securityRaw.value);
    message.success("安全基线已保存");
  } catch (e: unknown) {
    message.error("保存失败");
  } finally {
    saving.value = false;
  }
}

// ── Init ───────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const profile = await getMyProfile();
    authStore.setUser(profile);
    syncAccountProfile();
  } catch {
    message.error("加载账户信息失败");
  }

  if (!isSystemAdmin.value) {
    activeTab.value = "account";
    return;
  }

  await applySettingsDeepLink();

  modelsLoading.value = true;
  try {
    // Load overview for quick lists
    try {
      const overview = await getConfigOverview();
      const d = overview.data;
      agentsList.value = d.agents;
      skillsList.value = d.skills as SkillSummary[];
      Object.assign(modelsData.defaults, d.models.defaults);
      setTestExecutionModelValue(getRecordString(d.models.defaults, "testModel"));
      modelsData.list = normalizeModelList(d.models.list || []);

      // MCP
      Object.assign(mcpData, d.mcp);

      // Plugins
      pluginsList.value = d.plugins;
    } catch {
      message.error("加载配置概览失败");
    }

    // Load models providers separately (overview doesn't include them)
    try {
      const modelsRes = await getModelsConfig();
      Object.assign(modelsData.defaults, modelsRes.data.defaults || {});
      setTestExecutionModelValue(getRecordString(modelsRes.data.defaults || {}, "testModel"));
      modelsData.list = normalizeModelList(modelsRes.data.list || modelsData.list);
      Object.assign(modelsData.providers, modelsRes.data.providers);
    } catch {
      /* ignore */
    }

    try {
      const modelsPolicy = await getModelsTestPolicy();
      setTestExecutionModelValue(modelsPolicy.data.effectiveModel);
    } catch {
      setTestExecutionModelValue(getTestExecutionModelValue());
    }

    // Copilot auth status depends on configured providers.
    await loadCopilotStatus();
  } finally {
    modelsLoading.value = false;
  }

  await applySettingsDeepLink();

  await Promise.allSettled([loadAdminUsers(), loadReconcileAuditEvents()]);

  // Commands (not in overview)
  try {
    const { data: cmds } = await (await import("../lib/api")).listCommands();
    commandsList.value = cmds;
  } catch {
    /* ignore */
  }

  // Security
  try {
    const secRes = await getSecurityBaseline();
    securityRaw.value = secRes.data.raw;
  } catch {
    /* ignore */
  }

  // Orchestration strategy
  try {
    strategyLoading.value = true;
    const s = await getOrchestrationStrategy();
    Object.assign(strategyData, s.data);
  } catch {
    /* ignore */
  } finally {
    strategyLoading.value = false;
  }

  // Continuation policy
  try {
    policyLoading.value = true;
    const p = await getContinuationPolicy();
    Object.assign(policyData, p.data);
  } catch {
    /* ignore */
  } finally {
    policyLoading.value = false;
  }
});

watch(
  () => [route.query.tab, route.query.section, route.query.provider, modelsLoading.value],
  () => {
    void applySettingsDeepLink();
  },
);
</script>

<style scoped>
:deep(.default-agent-model-row > td) {
  background: #fff7e6;
}

:deep(.default-agent-model-row:hover > td) {
  background: #ffe7ba;
}

:deep(.invalid-model-row > td) {
  background: #fff1f0;
}

:deep(.invalid-model-row:hover > td) {
  background: #ffccc7;
}
</style>
