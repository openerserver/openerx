<template>
  <div style="padding: 24px">
    <a-typography-title :level="3">设置</a-typography-title>

    <a-tabs :activeKey="activeTab" @update:activeKey="setActiveTab">
      <!-- ═══════════ 模型 ═══════════ -->
      <a-tab-pane key="models" tab="模型">
        <a-spin :spinning="modelsLoading">
          <a-card title="快速预设">
            <a-space>
              <a-button @click="applyPreset('copilot')">GitHub Copilot</a-button>
              <a-button @click="applyPreset('copilot-claude')">Copilot + Claude</a-button>
              <a-button @click="applyPreset('github-models')">GitHub Models</a-button>
            </a-space>
          </a-card>

          <!-- Copilot OAuth -->
          <a-card title="GitHub Copilot 认证" style="margin-top: 16px">
            <template v-if="copilotAuth.authenticated">
              <a-result status="success" title="已登录 GitHub Copilot"
                :sub-title="copilotAuth.loginAt ? `登录时间: ${copilotAuth.loginAt}` : ''">
                <template #extra>
                  <a-space>
                    <a-button @click="loadCopilotModels" :loading="copilotModels.loading">读取模型列表</a-button>
                    <a-button danger @click="doCopilotLogout" :loading="copilotAuth.loading">退出登录</a-button>
                  </a-space>
                </template>
              </a-result>

              <a-card size="small" title="Copilot 可用模型" style="margin-top: 16px">
                <template v-if="copilotModels.error">
                  <a-alert type="error" :message="copilotModels.error" show-icon style="margin-bottom: 12px" />
                </template>
                <template v-if="copilotModels.items.length">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; flex-wrap: wrap">
                    <span style="color: #888; font-size: 12px">认证成功后可从 Copilot 读取当前账号可用模型，并添加到下方模型配置。</span>
                    <a-space>
                      <a-radio-group :value="copilotModelFilter" @update:value="copilotModelFilter = String($event)">
                        <a-radio-button value="all">全部</a-radio-button>
                        <a-radio-button value="unconfigured">只显示未配置模型</a-radio-button>
                      </a-radio-group>
                      <a-button type="primary" @click="addAllCopilotModels">添加全部未配置模型</a-button>
                    </a-space>
                  </div>
                  <a-table :dataSource="filteredCopilotModels" :columns="copilotModelColumns" :pagination="false" rowKey="id" size="small">
                    <template #bodyCell="{ column, record }">
                      <template v-if="column.dataIndex === 'contextWindow'">
                        {{ record.contextWindow || '-' }}
                      </template>
                      <template v-else-if="column.dataIndex === 'maxTokens'">
                        {{ record.maxTokens || '-' }}
                      </template>
                      <template v-else-if="column.dataIndex === 'action'">
                        <a-button size="small" :disabled="isModelConfigured(String(record.id || ''))" @click="addCopilotModelFromRecord(record)">
                          {{ isModelConfigured(record.id) ? '已添加' : '添加' }}
                        </a-button>
                      </template>
                    </template>
                  </a-table>
                </template>
                <template v-else>
                  <a-empty description="认证成功后可读取 Copilot 可用模型" />
                </template>
              </a-card>
            </template>

            <template v-else-if="copilotAuth.deviceCode">
              <a-steps :current="1" size="small" style="margin-bottom: 20px">
                <a-step title="获取验证码" />
                <a-step title="在 GitHub 授权" />
                <a-step title="完成" />
              </a-steps>
              <div style="text-align: center; padding: 16px 0">
                <div style="margin-bottom: 12px; color: #888">请在浏览器中打开以下链接，并输入验证码：</div>
                <div style="margin-bottom: 12px">
                  <a :href="copilotAuth.verificationUri" target="_blank" rel="noopener noreferrer"
                    style="font-size: 16px">
                    {{ copilotAuth.verificationUri }}
                  </a>
                </div>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; font-family: monospace; padding: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; display: inline-block; user-select: all">
                  {{ copilotAuth.userCode }}
                </div>
                <div style="margin-top: 12px; color: #888">
                  <a-spin size="small" /> 等待授权中... ({{ copilotAuth.countdown }}s 后超时)
                </div>
              </div>
            </template>

            <template v-else>
              <div style="display: flex; align-items: center; gap: 16px">
                <a-button type="primary" @click="startCopilotAuth" :loading="copilotAuth.loading">
                  使用 GitHub 帐号登录
                </a-button>
                <span style="color: #888; font-size: 12px">通过 OAuth Device Flow 认证，无需输入 Token</span>
              </div>
            </template>
          </a-card>

          <a-card title="默认 Agent 模型" style="margin-top: 16px">
            <a-form layout="vertical">
              <a-form-item label="Model ID">
                <a-select
                  :value="getRecordString(modelsData.defaults, 'model')"
                  show-search
                  style="width: 100%"
                  placeholder="anthropic/claude-sonnet-4-20250514"
                  :options="defaultModelSelectOptions"
                  option-filter-prop="label"
                  @update:value="setRecordString(modelsData.defaults, 'model', $event)"
                />
              </a-form-item>
              <a-form-item label="Provider">
                <a-select
                  :value="getRecordString(modelsData.defaults, 'provider')"
                  style="width: 100%"
                  placeholder="选择 Provider"
                  @update:value="setRecordString(modelsData.defaults, 'provider', $event)"
                >
                  <a-select-option v-for="pk in Object.keys(modelsData.providers)" :key="pk" :value="pk">{{ pk }}</a-select-option>
                </a-select>
              </a-form-item>
            </a-form>
          </a-card>

          <a-card title="Provider 列表" style="margin-top: 16px">
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
            <a-table :dataSource="modelsData.list" :columns="modelColumns" :pagination="false" rowKey="id" size="small">
              <template #bodyCell="{ column, record, index }">
                <template v-if="column.dataIndex === 'id'">
                  <a-input :value="record.id" size="small" @update:value="record.id = String($event ?? '')" />
                </template>
                <template v-else-if="column.dataIndex === 'name'">
                  <a-input :value="record.name" size="small" @update:value="record.name = String($event ?? '')" />
                </template>
                <template v-else-if="column.dataIndex === 'provider'">
                  <a-select :value="record.provider" size="small" style="width:100%" @update:value="record.provider = String($event ?? '')">
                    <a-select-option v-for="pk in Object.keys(modelsData.providers)" :key="pk" :value="pk">{{ pk }}</a-select-option>
                  </a-select>
                </template>
                <template v-else-if="column.dataIndex === 'contextWindow'">
                  <a-input-number :value="record.contextWindow" size="small" :min="1" style="width:100%" @update:value="record.contextWindow = Number($event ?? 1)" />
                </template>
                <template v-else-if="column.dataIndex === 'maxTokens'">
                  <a-input-number :value="record.maxTokens" size="small" :min="1" style="width:100%" @update:value="record.maxTokens = Number($event ?? 1)" />
                </template>
                <template v-else-if="column.dataIndex === 'action'">
                  <a-button danger size="small" @click="modelsData.list.splice(index, 1)">删除</a-button>
                </template>
              </template>
            </a-table>
            <a-button type="dashed" block style="margin-top: 8px" @click="addModel">+ 添加模型</a-button>
          </a-card>

          <a-button type="primary" style="margin-top: 16px" :loading="saving" @click="saveModels">保存模型配置</a-button>
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ Agent ═══════════ -->
      <a-tab-pane key="agents" tab="Agent">
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
      <a-tab-pane key="skills" tab="Skill">
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
      <a-tab-pane key="mcp" tab="MCP 服务">
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
      <a-tab-pane key="commands" tab="命令">
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
      <a-tab-pane key="security" tab="安全基线">
        <a-spin :spinning="securityLoading">
          <a-card title="SECURITY-BASELINE.md">
            <a-textarea :value="securityRaw" :rows="22" style="font-family: monospace; font-size: 13px" @update:value="securityRaw = String($event ?? '')" />
            <a-button type="primary" style="margin-top: 12px" :loading="saving" @click="saveSecurity">保存</a-button>
          </a-card>
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ 插件 ═══════════ -->
      <a-tab-pane key="plugins" tab="插件">
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
      <a-tab-pane key="strategy" tab="编排策略">
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
                    @change="(v: unknown) => updateStrategyAgent(record.category, v as string[])"
                  />
                </template>
                <template v-else-if="column.dataIndex === 'model'">
                  <a-input
                    :value="record.model"
                    size="small"
                    placeholder="使用默认模型"
                    @change="(e: Event) => updateStrategyModel(record.category, (e.target as HTMLInputElement).value)"
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

          <a-button type="primary" style="margin-top: 16px" :loading="strategySaving" @click="saveStrategy">保存编排策略</a-button>
        </a-spin>
      </a-tab-pane>

      <!-- ═══════════ 恢复策略 ═══════════ -->
      <a-tab-pane key="policy" tab="恢复策略">
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
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import {
  type AgentDetail,
  type AgentSummary,
  type CommandDetail,
  type CommandSummary,
  type ContinuationPolicy,
  type CopilotModelInfo,
  type McpServer,
  type OrchestrationStrategy,
  type PluginCompatResult,
  type PluginInfo,
  type SkillDetail,
  type SkillSummary,
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
  getOrchestrationStrategy,
  getSecurityBaseline,
  getSkill,
  installPlugin,
  listPlugins,
  pollCopilotToken,
  requestCopilotDeviceCode,
  uninstallPlugin,
  updateAgent,
  updateCommand,
  updateContinuationPolicy,
  updateMcpConfig,
  updateModelsConfig,
  updateOrchestrationStrategy,
  updateSecurityBaseline,
  updateSkill,
} from "../lib/api";

// ── Tab ────────────────────────────────────────────────────────────
const activeTab = ref("models");

function setActiveTab(value: unknown) {
  activeTab.value = String(value);
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

function buildModelSelectOptions(currentModel = "") {
  const options = modelsData.list
    .map((model) => {
      const id = getRecordString(model, "id");
      if (!id) return null;

      const name = getRecordString(model, "name");
      const provider = getRecordString(model, "provider");
      const meta = [name, provider].filter(Boolean).join(" / ");

      return {
        value: id,
        label: meta ? `${id} (${meta})` : id,
      };
    })
    .filter((option): option is { value: string; label: string } => Boolean(option));

  if (currentModel && !options.some((option) => option.value === currentModel)) {
    options.unshift({ value: currentModel, label: `${currentModel} (当前值)` });
  }

  return options;
}

const modelSelectOptions = computed(() => buildModelSelectOptions());

const defaultModelSelectOptions = computed(() =>
  buildModelSelectOptions(getRecordString(modelsData.defaults, "model")),
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

function deleteProvider(key: string) {
  delete modelsData.providers[key];
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

// ── Presets ────────────────────────────────────────────────────────
const COPILOT_PRESETS: Record<
  string,
  {
    providers: Record<string, Record<string, unknown>>;
    defaults: Record<string, unknown>;
    list: Array<Record<string, unknown>>;
  }
> = {
  copilot: {
    providers: {
      "github-copilot": { api: "github-copilot", name: "GitHub Copilot" },
    },
    defaults: { model: "claude-sonnet-4", provider: "github-copilot" },
    list: [
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4 (via Copilot)",
        provider: "github-copilot",
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: "claude-opus-4",
        name: "Claude Opus 4 (via Copilot)",
        provider: "github-copilot",
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1 (via Copilot)",
        provider: "github-copilot",
        contextWindow: 1047576,
        maxTokens: 32768,
      },
      {
        id: "gpt-5-mini",
        name: "GPT-5 Mini (via Copilot)",
        provider: "github-copilot",
        contextWindow: 1047576,
        maxTokens: 32768,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro (via Copilot)",
        provider: "github-copilot",
        contextWindow: 1048576,
        maxTokens: 65536,
      },
    ],
  },
  "copilot-claude": {
    providers: {
      "github-copilot": { api: "github-copilot", name: "GitHub Copilot" },
      anthropic: { api: "anthropic", name: "Anthropic (Direct)" },
    },
    defaults: { model: "claude-sonnet-4", provider: "github-copilot" },
    list: [
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4 (Copilot, Free)",
        provider: "github-copilot",
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: "claude-opus-4",
        name: "Claude Opus 4 (Copilot, Free)",
        provider: "github-copilot",
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: "anthropic/claude-sonnet-4-20250514",
        name: "Claude Sonnet 4 (Direct API)",
        provider: "anthropic",
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1 (Copilot)",
        provider: "github-copilot",
        contextWindow: 1047576,
        maxTokens: 32768,
      },
    ],
  },
  "github-models": {
    providers: {
      "github-models": {
        api: "github-models",
        name: "GitHub Models",
        baseURL: "https://models.github.ai/inference",
      },
    },
    defaults: { model: "openai/gpt-4.1", provider: "github-models" },
    list: [
      {
        id: "openai/gpt-4.1",
        name: "GPT-4.1 (GitHub Models)",
        provider: "github-models",
        contextWindow: 1047576,
        maxTokens: 32768,
      },
      {
        id: "openai/gpt-4o",
        name: "GPT-4o (GitHub Models)",
        provider: "github-models",
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  },
};

function applyPreset(presetKey: string) {
  const preset = COPILOT_PRESETS[presetKey];
  if (!preset) return;
  for (const [k, v] of Object.entries(preset.providers)) {
    modelsData.providers[k] = v;
  }
  Object.assign(modelsData.defaults, preset.defaults);
  modelsData.list = [...preset.list];
  message.info("已应用预设，记得点击「保存模型配置」生效");
}

// ── Copilot OAuth ──────────────────────────────────────────────────
const copilotAuth = reactive({
  authenticated: false,
  loginAt: null as string | null,
  loading: false,
  deviceCode: "",
  userCode: "",
  verificationUri: "",
  countdown: 0,
  interval: 5,
});
const copilotModels = reactive<{
  loading: boolean;
  error: string;
  items: CopilotModelInfo[];
}>({
  loading: false,
  error: "",
  items: [],
});
const copilotModelFilter = ref("all");
let pollTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

function ensureCopilotProvider() {
  if (!modelsData.providers["github-copilot"]) {
    modelsData.providers["github-copilot"] = {
      api: "github-copilot",
      name: "GitHub Copilot",
    };
  }
}

function isModelConfigured(modelId: string) {
  return modelsData.list.some((model) => getRecordString(model, "id") === modelId);
}

const filteredCopilotModels = computed(() => {
  if (copilotModelFilter.value !== "unconfigured") {
    return copilotModels.items;
  }

  return copilotModels.items.filter((model) => !isModelConfigured(model.id));
});

function addCopilotModel(model: CopilotModelInfo) {
  if (isModelConfigured(model.id)) return;
  ensureCopilotProvider();
  modelsData.list.push({
    id: model.id,
    name: model.name || model.id,
    provider: "github-copilot",
    contextWindow: model.contextWindow ?? 200000,
    maxTokens: model.maxTokens ?? 16384,
  });
}

function addCopilotModelFromRecord(record: Record<string, unknown>) {
  addCopilotModel({
    id: String(record.id || ""),
    name: String(record.name || record.id || ""),
    vendor: String(record.vendor || ""),
    version: String(record.version || ""),
    preview: Boolean(record.preview),
    contextWindow: typeof record.contextWindow === "number" ? record.contextWindow : null,
    maxTokens: typeof record.maxTokens === "number" ? record.maxTokens : null,
  });
}

function addAllCopilotModels() {
  const pending = copilotModels.items.filter((model) => !isModelConfigured(model.id));
  if (!pending.length) {
    message.info("Copilot 模型已全部加入当前配置");
    return;
  }

  pending.forEach(addCopilotModel);
  message.success(`已添加 ${pending.length} 个 Copilot 模型，请点击“保存模型配置”生效`);
}

function clearCopilotTimers() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

async function loadCopilotStatus() {
  try {
    const res = await getCopilotStatus();
    copilotAuth.authenticated = res.data.authenticated;
    copilotAuth.loginAt = res.data.login_at || null;
    if (copilotAuth.authenticated) {
      await loadCopilotModels();
    }
  } catch {
    /* ignore */
  }
}

async function loadCopilotModels() {
  if (!copilotAuth.authenticated) return;

  copilotModels.loading = true;
  copilotModels.error = "";
  try {
    const res = await getCopilotModels();
    copilotModels.items = res.data;
  } catch (e: unknown) {
    copilotModels.error = e instanceof Error ? e.message : "读取 Copilot 模型失败";
  } finally {
    copilotModels.loading = false;
  }
}

async function startCopilotAuth() {
  copilotAuth.loading = true;
  try {
    const res = await requestCopilotDeviceCode();
    const d = res.data;
    copilotAuth.deviceCode = d.device_code;
    copilotAuth.userCode = d.user_code;
    copilotAuth.verificationUri = d.verification_uri;
    copilotAuth.interval = Math.max(d.interval || 5, 5);
    copilotAuth.countdown = d.expires_in || 900;

    // Countdown timer
    countdownTimer = setInterval(() => {
      copilotAuth.countdown--;
      if (copilotAuth.countdown <= 0) {
        clearCopilotTimers();
        copilotAuth.deviceCode = "";
        message.error("验证码已过期，请重新发起认证");
      }
    }, 1000);

    // Poll timer
    startPolling();
  } catch (e: unknown) {
    message.error("发起认证失败");
  } finally {
    copilotAuth.loading = false;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const pollRes = await pollCopilotToken(copilotAuth.deviceCode);
      const status = pollRes.data.status;
      if (status === "success") {
        clearCopilotTimers();
        copilotAuth.deviceCode = "";
        copilotAuth.authenticated = true;
        copilotAuth.loginAt = new Date().toISOString();
        await loadCopilotModels();
        message.success("GitHub Copilot 认证成功！");
      } else if (status === "slow_down") {
        copilotAuth.interval = (pollRes.data.interval || copilotAuth.interval) + 3;
        startPolling();
      }
      // "authorization_pending" — keep polling
    } catch {
      // Network error — keep trying
    }
  }, copilotAuth.interval * 1000);
}

async function doCopilotLogout() {
  copilotAuth.loading = true;
  try {
    await copilotLogout();
    copilotAuth.authenticated = false;
    copilotAuth.loginAt = null;
    copilotModels.items = [];
    copilotModels.error = "";
    message.success("已退出 Copilot 登录");
  } catch {
    message.error("退出失败");
  } finally {
    copilotAuth.loading = false;
  }
}

onUnmounted(() => {
  clearCopilotTimers();
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

function updateStrategyModel(category: string, model: string) {
  strategyData.categoryModelMap[category] = model;
}

async function saveStrategy() {
  strategySaving.value = true;
  try {
    await updateOrchestrationStrategy({
      categoryAgentMap: strategyData.categoryAgentMap,
      categoryModelMap: strategyData.categoryModelMap,
      enablePipeline: strategyData.enablePipeline,
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

// ── Saving ─────────────────────────────────────────────────────────
const saving = ref(false);

async function saveModels() {
  saving.value = true;
  try {
    const res = await updateModelsConfig({
      defaults: modelsData.defaults,
      providers: modelsData.providers,
      list: modelsData.list,
    });
    message.success(`模型配置已保存${res.restartRequired ? "（需重启 OpenCode 生效）" : ""}`);
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
