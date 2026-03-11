<template>
  <div style="padding: 24px">
    <a-typography-title :level="3">设置</a-typography-title>

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
          <a-card title="GitHub Copilot 账号" style="margin-bottom: 16px">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap">
              <span style="color: #888; font-size: 12px">
                需要第二个或更多 Copilot 账号时，点击右侧按钮即可自动添加新的 Provider，随后在对应卡片上登录不同 GitHub 账号。
              </span>
              <a-button type="primary" @click="addCopilotProvider">添加 Copilot 账号</a-button>
            </div>
          </a-card>

          <!-- Copilot OAuth (multi-account) -->
          <a-card v-for="cpProvider in copilotProviders" :key="cpProvider" :title="`GitHub Copilot 认证 — ${cpProvider}`" style="margin-top: 16px">
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

          <a-card title="Provider 列表" style="margin-top: 16px">
            <div style="margin-bottom: 8px; color: #888; font-size: 12px">先配置连接入口，再挂接模型。</div>
            <template v-if="providerTableData.length">
              <a-table :dataSource="providerTableData" :columns="providerColumns" :pagination="false" rowKey="key" size="small">
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
                  <template v-else-if="column.dataIndex === 'action'">
                    <a-button danger size="small" @click="deleteProvider(record.key)">删除</a-button>
                  </template>
                </template>
              </a-table>
            </template>
            <a-empty v-else description="还没有 Provider。下一步：点击下方“+ 添加 Provider”，或先在上方添加 GitHub Copilot 账号。" />
            <a-button type="dashed" block style="margin-top: 8px" @click="showAddProvider = true">+ 添加 Provider</a-button>
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
            </a-form>
          </a-modal>

          <a-card title="模型列表" style="margin-top: 16px">
            <div style="margin-bottom: 8px; color: #888; font-size: 12px">为任务准备可选的执行模型。</div>
            <template v-if="modelsData.list.length">
              <a-table :dataSource="modelsData.list" :columns="modelColumns" :pagination="false" :rowKey="getConfiguredModelKey" :rowClassName="getModelRowClassName" size="small">
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
                  <template v-else-if="column.dataIndex === 'action'">
                    <a-button danger size="small" @click="removeModelAt(index)">删除</a-button>
                  </template>
                </template>
              </a-table>
            </template>
            <a-empty v-else description="还没有模型。下一步：先配置 Provider，或登录并展开上方 Copilot 模型区后导入；也可以直接点击下方“+ 添加模型”。" />
            <a-button type="dashed" block style="margin-top: 8px" @click="addModel">+ 添加模型</a-button>
          </a-card>

          <a-card title="默认执行模型" style="margin-top: 16px">
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
            </a-form>
          </a-card>

          <a-button type="primary" style="margin-top: 16px" :loading="saving" @click="saveModels">保存模型配置</a-button>
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ Agent ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="agents" tab="Agent">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-menu :selectedKeys="agentSelected" mode="inline" @click="onAgentSelect">
              <a-menu-item v-for="a in agentsList" :key="a.name">
                {{ a.name }}
              </a-menu-item>
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
            <a-menu :selectedKeys="skillSelected" mode="inline" @click="onSkillSelect">
              <a-menu-item v-for="s in skillsList" :key="s.dirName || s.name">
                {{ s.name }}
              </a-menu-item>
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
            <a-form-item label="源文件路径 (相对于 opencode-fork/)">
              <a-input v-model:value="installSource" placeholder=".opencode/plugins/my-plugin.ts" />
            </a-form-item>
            <a-form-item label="插件名称 (可选)">
              <a-input v-model:value="installName" placeholder="my-plugin" />
            </a-form-item>
          </a-form>
        </a-modal>
      </a-tab-pane>

      <!-- ═══════════ 编排策略 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="strategy" tab="编排策略">
        <a-spin :spinning="strategyLoading">
          <a-card title="意图分类 → Agent 映射" size="small">
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
                    @change="(value) => handleStrategyAgentsChange(record.category, value)"
                  />
                </template>
                <template v-else-if="column.dataIndex === 'model'">
                  <a-input
                    :value="record.model"
                    size="small"
                    placeholder="使用默认模型"
                    @update:value="(value) => updateStrategyModel(record.category, String(value ?? ''))"
                  />
                </template>
              </template>
            </a-table>
          </a-card>

          <a-card title="规划流水线" size="small" style="margin-top: 16px">
            <a-form-item label="启用 Prometheus/Metis/Momus 规划流水线">
              <a-switch v-model:checked="strategyData.enablePipeline" />
            </a-form-item>
          </a-card>

          <a-card title="生命周期 Hooks" size="small" style="margin-top: 16px">
            <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
              使用统一 hooks 配置执行前、执行后、失败后、续跑前的治理逻辑。前置/后置评估已合并到 hooks 视图管理。
            </a-typography-text>
            <a-row :gutter="16">
              <a-col v-for="section in HOOK_SECTIONS" :key="section.trigger" :xs="24" :xl="12" style="margin-bottom: 16px">
                <a-card :title="section.title" size="small">
                  <template #extra>
                    <a-button size="small" type="dashed" @click="addHook(section.trigger)">+ 新增</a-button>
                  </template>
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
                            v-model:checked="hook.enabled"
                            checked-children="启用"
                            un-checked-children="停用"
                            size="small"
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
                              <a-input :value="hook.agent" placeholder="prometheus-enterprise" @update:value="hook.agent = String($event ?? '')" />
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
                              <a-input :value="hook.model" placeholder="留空使用系统默认" @update:value="hook.model = String($event ?? '')" />
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
                      v-model:checked="tpl.enabled"
                      checked-children="启用"
                      un-checked-children="停用"
                      size="small"
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
                        <a-select v-model:value="tpl.mode">
                          <a-select-option value="single">单一执行</a-select-option>
                          <a-select-option value="parallel">并行竞争</a-select-option>
                        </a-select>
                      </a-form-item>
                    </a-col>
                    <a-col :span="8">
                      <a-form-item label="最大并行数" v-if="tpl.mode === 'parallel'">
                        <a-input-number
                          :value="tpl.maxParallelCandidates ?? 3"
                          :min="2"
                          :max="5"
                          style="width: 100%"
                          @update:value="tpl.maxParallelCandidates = Number($event ?? 3)"
                        />
                      </a-form-item>
                    </a-col>
                  </a-row>
                  <a-form-item label="执行 Agent 列表">
                    <a-select
                      mode="tags"
                      :value="tpl.agents"
                      placeholder="输入 Agent 名称"
                      style="width: 100%"
                      @change="(v) => (tpl.agents = Array.isArray(v) ? v.map(String) : [])"
                    />
                  </a-form-item>
                  <a-form-item label="适用意图分类">
                    <a-select
                      mode="multiple"
                      :value="tpl.categoryDefaults ?? []"
                      placeholder="不选则为通用模板"
                      style="width: 100%"
                      @change="(v) => (tpl.categoryDefaults = Array.isArray(v) ? v.map(String) : [])"
                    >
                      <a-select-option v-for="(label, cat) in CATEGORY_LABELS_MAP" :key="cat" :value="cat">
                        {{ label }}
                      </a-select-option>
                    </a-select>
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
            <a-form layout="vertical">
              <a-form-item label="启用裁判">
                <a-switch v-model:checked="strategyData.judge.enabled" />
              </a-form-item>
              <a-row :gutter="12">
                <a-col :span="8">
                  <a-form-item label="裁判 Agent">
                    <a-input
                      :value="strategyData.judge.agent"
                      placeholder="prometheus-enterprise"
                      @update:value="strategyData.judge.agent = String($event ?? '')"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="8">
                  <a-form-item label="指定模型">
                    <a-input
                      :value="strategyData.judge.model"
                      placeholder="留空使用系统默认"
                      @update:value="strategyData.judge.model = String($event ?? '')"
                    />
                  </a-form-item>
                </a-col>
                <a-col :span="8">
                  <a-form-item label="选择策略">
                    <a-select v-model:value="strategyData.judge.selectionStrategy">
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
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ 恢复策略 ═══════════ -->
      <a-tab-pane v-if="isSystemAdmin" key="policy" tab="恢复策略">
        <a-spin :spinning="policyLoading">
          <a-card title="失败恢复与续跑策略" size="small">
            <a-form layout="vertical">
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-form-item label="失败自动重试">
                    <a-switch v-model:checked="policyData.autoRetryOnFailure" />
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="最大重试次数">
                    <a-input-number v-model:value="policyData.maxRetries" :min="0" :max="10" />
                  </a-form-item>
                </a-col>
              </a-row>
              <a-form-item label="可重试错误类型">
                <a-select mode="tags" v-model:value="policyData.retryableErrors" style="width: 100%" />
              </a-form-item>
              <a-form-item label="重试前需人工审批">
                <a-switch v-model:checked="policyData.requireApprovalOnRetry" />
              </a-form-item>
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-form-item label="启用模型 Fallback">
                    <a-switch v-model:checked="policyData.enableFallback" />
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="Fallback 模型">
                    <a-input v-model:value="policyData.fallbackModel" placeholder="provider/model-id" :disabled="!policyData.enableFallback" />
                  </a-form-item>
                </a-col>
              </a-row>
            </a-form>
          </a-card>

          <a-button type="primary" style="margin-top: 16px" :loading="policySaving" @click="savePolicy">保存恢复策略</a-button>
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
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import {
  type AdminUser,
  type AgentDetail,
  type AgentSummary,
  type AuditEvent,
  type CommandDetail,
  type CommandSummary,
  type ContinuationPolicy,
  type CopilotModelInfo,
  type JudgeConfig,
  type LifecycleHook,
  type McpServer,
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
import { useAuthStore } from "../stores/auth";

// ── Tab ────────────────────────────────────────────────────────────
const authStore = useAuthStore();
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
  list: Array<Record<string, unknown>>;
}>({
  defaults: {},
  providers: {},
  list: [],
});

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

function getConfiguredModelKey(model: Record<string, unknown>) {
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
    delete modelsData.defaults.provider;
    return;
  }

  const parsed = parseModelRouteValue(normalized);
  modelsData.defaults.model = parsed.provider ? buildModelRoute(parsed.provider, parsed.modelId) : parsed.modelId;
  if (parsed.provider) {
    modelsData.defaults.provider = parsed.provider;
  } else {
    delete modelsData.defaults.provider;
  }
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

function isDefaultConfiguredModelRecord(record: Record<string, unknown>) {
  const route = getDefaultAgentModelValue();
  if (!route) return false;
  return getConfiguredModelKey(record) === route;
}

function getModelDuplicateRouteCount(record: Record<string, unknown>) {
  const route = getConfiguredModelKey(record);
  if (!route) return 0;
  return modelsData.list.filter((model) => getConfiguredModelKey(model) === route).length;
}

function getModelRecordIssue(record: Record<string, unknown>) {
  const provider = getRecordString(record, "provider").trim();
  const id = getRecordString(record, "id").trim();
  if (!provider || !id) return "需要同时填写 Provider 和模型 ID";
  if (getModelDuplicateRouteCount(record) > 1) return `重复模型路由：${buildModelRoute(provider, id)}`;
  return "";
}

function getModelRoutePreview(record: Record<string, unknown>) {
  const provider = getRecordString(record, "provider").trim();
  const id = getRecordString(record, "id").trim();
  if (!provider && !id) return "";
  if (!provider || !id) return "需补全后才会形成模型路由";
  return `模型路由：${buildModelRoute(provider, id)}`;
}

function getModelRowClassName(record: Record<string, unknown>) {
  const rowClasses: string[] = [];
  if (isDefaultConfiguredModelRecord(record)) rowClasses.push("default-agent-model-row");
  if (getModelRecordIssue(record)) rowClasses.push("invalid-model-row");
  return rowClasses.join(" ");
}

function getModelValidationErrors() {
  const errors: string[] = [];
  const seen = new Map<string, number>();

  modelsData.list.forEach((model, index) => {
    const provider = getRecordString(model, "provider").trim();
    const id = getRecordString(model, "id").trim();
    const rowNumber = index + 1;

    if (!provider || !id) {
      errors.push(`第 ${rowNumber} 行缺少 Provider 或模型 ID`);
      return;
    }

    const route = buildModelRoute(provider, id);
    const firstRow = seen.get(route);
    if (firstRow) {
      errors.push(`第 ${firstRow} 行与第 ${rowNumber} 行存在重复模型路由 ${route}`);
      return;
    }

    seen.set(route, rowNumber);
  });

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

const agentModelSelectOptions = computed(() =>
  buildModelSelectOptions(getRecordString(agentDetail.value?.frontmatter ?? {}, "model")),
);

const providerColumns = [
  { title: "Key", dataIndex: "key", width: "15%" },
  { title: "名称", dataIndex: "name", width: "20%" },
  { title: "API 类型", dataIndex: "api", width: "20%" },
  { title: "Base URL", dataIndex: "baseURL", width: "35%" },
  { title: "", dataIndex: "action", width: "10%" },
];

const providerTableData = computed(() =>
  Object.entries(modelsData.providers).map(([key, val]) => ({
    key,
    ...(val as Record<string, unknown>),
  })),
);

const showAddProvider = ref(false);
const newProvider = reactive({ key: "", name: "", api: "openai-completions", baseURL: "" });

function getRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function setRecordString(record: Record<string, unknown>, key: string, value: unknown) {
  record[key] = String(value ?? "");
}

function addProvider() {
  if (!newProvider.key) {
    message.warning("请输入 Key");
    return;
  }
  if (modelsData.providers[newProvider.key]) {
    message.warning("该 Key 已存在");
    return;
  }
  modelsData.providers[newProvider.key] = {
    api: newProvider.api,
    name: newProvider.name || newProvider.key,
    ...(newProvider.baseURL ? { baseURL: newProvider.baseURL } : {}),
  };
  showAddProvider.value = false;
  newProvider.key = "";
  newProvider.name = "";
  newProvider.api = "openai-completions";
  newProvider.baseURL = "";
}

function updateProvider(key: string, field: string, value: unknown) {
  const p = modelsData.providers[key] as Record<string, unknown>;
  if (p) p[field] = String(value ?? "");
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
  const removedModels = modelsData.list.filter((model) => getRecordString(model, "provider") === key).length;
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
  { title: "ID", dataIndex: "id", width: "22%" },
  { title: "名称", dataIndex: "name", width: "20%" },
  { title: "Provider", dataIndex: "provider", width: "13%" },
  { title: "Context Window", dataIndex: "contextWindow", width: "15%" },
  { title: "Max Tokens", dataIndex: "maxTokens", width: "15%" },
  { title: "", dataIndex: "action", width: "15%" },
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
  modelsData.list.push({ id: "", name: "", provider: "", contextWindow: 200000, maxTokens: 16384 });
}

function updateModelField(record: Record<string, unknown>, field: "id" | "provider", value: unknown) {
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
  return (copilotModelsMap[provider]?.items || []).filter((model) => !isModelConfigured(provider, model.id)).length;
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
  const keys = Array.isArray(value) ? value.map((item) => String(item)) : [String(value ?? "")].filter(Boolean);
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
      name: provider === "github-copilot" ? "GitHub Copilot" : `GitHub Copilot (${provider.replace("github-copilot-", "")})`,
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
  modelsData.list.push({
    id: model.id,
    name: model.name || model.id,
    provider,
    contextWindow: model.contextWindow ?? 200000,
    maxTokens: model.maxTokens ?? 16384,
  });
}

function addCopilotModelFromRecordFor(record: Record<string, unknown>, provider: string) {
  addCopilotModelFor({
    id: String(record.id || ""),
    name: String(record.name || record.id || ""),
    vendor: String(record.vendor || ""),
    version: String(record.version || ""),
    preview: Boolean(record.preview),
    contextWindow: typeof record.contextWindow === "number" ? record.contextWindow : null,
    maxTokens: typeof record.maxTokens === "number" ? record.maxTokens : null,
  }, provider);
}

function addAllCopilotModelsFor(provider: string) {
  ensureCopilotAuthState(provider);
  const allItems = copilotModelsMap[provider]?.items || [];
  const pending = allItems.filter((model) => !isModelConfigured(provider, model.id));
  if (!pending.length) {
    message.info("Copilot 模型已全部加入当前配置");
    return;
  }
  pending.forEach((m) => addCopilotModelFor(m, provider));
  message.success(`已添加 ${pending.length} 个 Copilot 模型，请点击"保存模型配置"生效`);
}

function clearCopilotTimersFor(provider: string) {
  if (pollTimers[provider]) {
    clearInterval(pollTimers[provider]!);
    pollTimers[provider] = null;
  }
  if (countdownTimers[provider]) {
    clearInterval(countdownTimers[provider]!);
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
  if (pollTimers[provider]) clearInterval(pollTimers[provider]!);
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
const agentDetail = ref<{ frontmatter: Record<string, unknown>; body: string } | null>(null);
const agentLoading = ref(false);

async function onAgentSelect({ key }: { key: string | number }) {
  const agentKey = String(key);
  agentLoading.value = true;
  try {
    agentSelected.value = [agentKey];
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
const skillDetail = ref<{ frontmatter: Record<string, unknown>; body: string } | null>(null);
const skillLoading = ref(false);

async function onSkillSelect({ key }: { key: string | number }) {
  const skillKey = String(key);
  skillLoading.value = true;
  try {
    skillSelected.value = [skillKey];
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
const strategyLoading = ref(false);
const strategySaving = ref(false);

const CATEGORY_LABELS: Record<string, string> = {
  quick: "快速查询",
  deep: "深度开发",
  ops: "运维操作",
  security: "安全审计",
  architecture: "架构设计",
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

const HOOK_SECTIONS = [
  { trigger: "pre-execution", title: "执行前 Hook", emptyText: "暂无执行前 Hook" },
  { trigger: "post-execution", title: "执行后 Hook", emptyText: "暂无执行后 Hook" },
  { trigger: "on-failure", title: "失败后 Hook", emptyText: "暂无失败后 Hook" },
  { trigger: "pre-resume", title: "续跑前 Hook", emptyText: "暂无续跑前 Hook" },
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

async function saveStrategy() {
  strategySaving.value = true;
  try {
    await updateOrchestrationStrategy({
      categoryAgentMap: strategyData.categoryAgentMap,
      categoryModelMap: strategyData.categoryModelMap,
      enablePipeline: strategyData.enablePipeline,
      hooks: strategyData.hooks,
      templates: strategyData.templates,
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
const policyLoading = ref(false);
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
    const validationErrors = getModelValidationErrors();
    if (validationErrors.length > 0) {
      message.error(validationErrors[0]);
      return;
    }
    const res = await updateModelsConfig({
      defaults: modelsData.defaults,
      providers: modelsData.providers,
      list: modelsData.list,
    });
    message.success(
      res.restartRequired
        ? "模型配置已保存到 opencode.json；需重启 OpenCode 运行时后，新任务才会使用新配置"
        : "模型配置已保存到 opencode.json；新任务将自动使用最新配置",
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
    message.success(`MCP 配置已保存${res.restartRequired ? "（需重启 OpenCode 生效）" : ""}`);
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

  // Load overview for quick lists
  try {
    const overview = await getConfigOverview();
    const d = overview.data;
    agentsList.value = d.agents;
    skillsList.value = d.skills as SkillSummary[];
    Object.assign(modelsData.defaults, d.models.defaults);
    modelsData.list = d.models.list;

    // MCP
    Object.assign(mcpData, d.mcp);

    // Plugins
    pluginsList.value = d.plugins;
  } catch {
    message.error("加载配置概览失败");
  }

  await Promise.allSettled([loadAdminUsers(), loadReconcileAuditEvents()]);

  // Load models providers separately (overview doesn't include them)
  try {
    const modelsRes = await getModelsConfig();
    Object.assign(modelsData.providers, modelsRes.data.providers);
  } catch {
    /* ignore */
  }

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

  // Copilot auth status
  await loadCopilotStatus();

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
