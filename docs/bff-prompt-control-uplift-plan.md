# BFF Prompt 控制权上移方案

> 状态：Draft  
> 日期：2026-03-21  
> 作者：AI Architecture Assistant

## 0. 背景

当前 BFF 调用 OpenCode Runtime 时只传递了精简参数（prompt 文本 + 模型 + agent 名称），OpenCode 在内部通过插件链完成 system prompt 注入、工具定义收集、意图分类等大量加工。BFF 对 LLM 最终接收的输入缺乏可观测性和控制力。

**目标**：将 system prompt 构造和工具白名单控制上移到 BFF，使 OpenCode 降级为纯执行引擎（Agentic Loop + 工具执行 + SSE 广播），BFF 成为 prompt 编排的单一控制面。

---

## 1. 现状分析

### 1.1 当前 BFF `buildPromptBody()` 输出

```typescript
// control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts
function buildPromptBody(text: string, options?: PromptOptions) {
  return {
    parts: [{ type: "text", text: `${executionContext}${text}` }],
    model: { providerID, modelID },
    agent: "hephaestus-enterprise",  // 可选
    noReply: false,                   // 可选
  };
}
```

**未使用的 API 参数**：`system`（系统 prompt 覆盖）、`tools`（工具开关）。

### 1.2 OpenCode 内部加工链（6 个插件 + Agent 定义）

| 阶段 | 由谁完成 | 具体操作 |
|------|---------|---------|
| ① 意图分类 | orchestrator-plugin | 63 个正则模式 → 5 分类（quick/deep/ops/security/architecture）→ 选 agent + model |
| ② System Prompt 组装 | OpenCode 核心 + Agent 定义 | 基础 prompt + `.opencode/agents/xxx.md` 内容 |
| ③ 项目规则注入 | context-injection-plugin | 递归扫描所有 `AGENTS.md` → 按 glob/agent 过滤 → 追加到 system prompt |
| ④ Skill 指令注入 | skills-plugin | 已激活 Skill 的 `SKILL.md` 指令 → 追加到 system prompt |
| ⑤ 工具收集 | OpenCode 核心 | 内置工具 + 插件工具 + MCP 工具 → JSON Schema 列表 |
| ⑥ 参数定制 | chat.params 钩子 | temperature / topP / maxTokens |

### 1.3 BFF 已有但未利用的数据

| 数据 | 存储位置 | 当前用途 |
|------|---------|---------|
| `role_agents.toolProfile` | PG `role_agents` 表 | 仅用于 UI 展示和审计 |
| `role_agents.permissionProfile` | PG `role_agents` 表 | 仅用于 preflight 检查 |
| `role_agent_bindings.runtimeAgent` | PG `role_agent_bindings` 表 | 映射到 agent 名称，但 prompt 内容仍由 OpenCode 读取 |
| `role_agent_project_overrides` | PG `role_agent_project_overrides` 表 | 项目级覆盖，未用于 prompt 构造 |
| `workflow_template_stages` | PG `workflow_template_stages` 表 | 阶段定义，未映射到工具白名单 |

---

## 2. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│ BFF（控制面 — "What to do"）                                 │
│                                                             │
│  ① 意图分类 → 选择 agent + model                            │
│  ② 从 DB 读取 role prompt / project prompt / skill 指令      │
│  ③ 构造完整 system prompt                                    │
│  ④ 根据 role.toolProfile + stage 计算工具白名单              │
│  ⑤ 调用 prompt_async：                                       │
│     {                                                       │
│       system: "完整 system prompt",         ← 新增           │
│       tools: { shell: false, ... },         ← 新增           │
│       model: { providerID, modelID },                       │
│       agent: "hephaestus-enterprise",                       │
│       parts: [{ text: "执行上下文\n用户prompt" }]            │
│     }                                                       │
│  ⑥ 将完整 prompt 写入审计日志                                │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP POST
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ OpenCode Runtime（执行面 — "How to do"）                      │
│                                                             │
│  - 接收 system / tools / model，不再自行组装                  │
│  - 维护消息历史 + 上下文窗口裁剪                              │
│  - 执行 Agentic Loop（tool_use → execute → re-call LLM）    │
│  - 工具执行（read_file, edit_file, shell, tmux, MCP...）    │
│  - 广播 SSE 事件（message.updated, tool.execute.*）         │
│  - Provider 认证 + LLM API 调用                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 职责边界

| 职责 | 改前（OpenCode） | 改后（BFF） | 改后（OpenCode） |
|------|-----------------|------------|----------------|
| System Prompt 构造 | ✅ 插件链组装 | ✅ BFF 组装 | ❌ 透传 |
| 工具白名单 | ✅ 全量注册 | ✅ BFF 按角色过滤 | ❌ 按 `tools` 参数过滤 |
| 意图分类 | ✅ orchestrator-plugin | ✅ BFF 实现 | ❌ 不再分类 |
| Agent 选择 | ✅ 分类结果决定 | ✅ BFF 决定 | ❌ 透传 agent 名 |
| 消息历史管理 | ✅ | — | ✅ 保留 |
| 工具执行 | ✅ | — | ✅ 保留 |
| Agentic Loop | ✅ | — | ✅ 保留 |
| SSE 广播 | ✅ | — | ✅ 保留 |

---

## 3. 详细设计

### 3.1 System Prompt 构造

新增 BFF 模块 `control-plane/web-ui-bff/src/modules/agent-control/prompt-assembler.ts`，负责组装完整 system prompt。

#### 3.1.1 Prompt 分层结构

```
┌──────────────────────────────────────┐
│ Layer 0: 基础 Agent Prompt            │ ← 从 agent 定义文件读取或 DB 存储
│   "You are an AI coding assistant..." │
│   "Your role is: 开发者..."           │
├──────────────────────────────────────┤
│ Layer 1: 项目级规则                    │ ← 从 DB projects 表 / 配置读取
│   "本项目使用 TypeScript + Bun..."    │
│   "代码风格遵循 biome.json..."        │
├──────────────────────────────────────┤
│ Layer 2: 角色级约束                    │ ← 从 role_agents 表读取
│   "你的权限范围: code-read+write+test" │
│   "允许阶段: implement, verify, fix"  │
├──────────────────────────────────────┤
│ Layer 3: Skill 指令（可选）            │ ← 从 workflow_template_stages 或配置读取
│   "Testing skill: 使用 vitest..."     │
├──────────────────────────────────────┤
│ Layer 4: 安全护栏                      │ ← BFF 固定注入
│   "禁止执行 rm -rf / ..."             │
│   "禁止访问 /etc/shadow ..."          │
└──────────────────────────────────────┘
```

#### 3.1.2 接口定义

```typescript
// prompt-assembler.ts

interface PromptAssemblerInput {
  /** 角色 Agent 配置 */
  roleAgent: {
    id: string;                      // e.g., "role.developer"
    permissionProfile: string;       // e.g., "perm.code-implementation"
    toolProfile: string;             // e.g., "tools.code-read+write+test"
    allowedStages: string[];         // e.g., ["implement", "verify", "fix"]
    riskLevel: string;               // e.g., "medium"
  };

  /** Agent 绑定（运行时 agent + 模型） */
  binding: {
    runtimeAgent: string;            // e.g., "hephaestus-enterprise"
    model?: string;                  // e.g., "github-copilot:claude-sonnet-4"
  };

  /** 项目配置 */
  project: {
    id: string;
    name: string;
    repositoryUrl?: string;
    customInstructions?: string;     // 项目级自定义指令（新增字段）
  };

  /** 当前工作流阶段（可选） */
  stage?: string;                    // e.g., "implement"

  /** 项目级角色覆盖（可选） */
  override?: {
    toolProfile?: string;
    permissionProfile?: string;
  };
}

interface AssembledPrompt {
  system: string;                     // 完整 system prompt
  tools: Record<string, boolean>;     // 工具白名单
  model: { providerID: string; modelID: string };
  agent: string;                      // runtime agent 名称
}

async function assemblePrompt(input: PromptAssemblerInput): Promise<AssembledPrompt>;
```

#### 3.1.3 Agent Prompt 来源

**Phase 1（立即可做）**：从 `.opencode/agents/*.md` 文件读取 agent prompt，缓存在 BFF 内存中。

```typescript
// 启动时加载一次，监听文件变化热更新
const agentPromptCache = new Map<string, string>();

async function loadAgentPrompt(agentName: string): Promise<string> {
  if (agentPromptCache.has(agentName)) return agentPromptCache.get(agentName)!;
  const content = await readFile(
    path.join(OPENCODE_AGENTS_DIR, `${agentName}.md`)
  );
  // 去除 YAML frontmatter，提取 body 作为 system prompt
  const body = stripFrontmatter(content);
  agentPromptCache.set(agentName, body);
  return body;
}
```

**Phase 2（后续）**：将 agent prompt 存入 DB `role_agent_bindings` 表（新增 `systemPrompt` TEXT 字段），支持 UI 在线编辑。

### 3.2 工具白名单计算

#### 3.2.1 ToolProfile → OpenCode Tools 映射表

```typescript
// tool-whitelist.ts

/** toolProfile 中的能力关键词 → OpenCode 工具名列表 */
const CAPABILITY_TO_TOOLS: Record<string, string[]> = {
  "discovery": [
    "read_file", "find_text", "find_files", "find_symbols",
    "hashline_read",
    "context_get_rules", "context_for_agent",
    "skill_list",
    // MCP tools
    "exa_search", "context7_resolve_library_id", "context7_get_library_docs",
    "grep_app_search",
  ],
  "design": [
    "read_file", "find_text", "find_files", "find_symbols",
    "todo",
    "task_graph_query",
  ],
  "code-read": [
    "read_file", "find_text", "find_files", "find_symbols",
    "hashline_read",
    "lsp_diagnostics",
  ],
  "write": [
    "edit_file", "write_file",
    "hashline_edit", "hashline_insert", "hashline_delete",
    "lsp_rename",
  ],
  "test": [
    "shell",           // 运行测试命令
    "tmux_create_session", "tmux_send_keys", "tmux_read_output",
  ],
  "security-audit": [
    "read_file", "find_text", "find_files",
    "shell",           // lint, audit 命令
  ],
  "release-plan": [
    "read_file", "find_text", "find_files",
    "shell",           // git, deploy 命令
    "todo",
  ],
  "ops-observe": [
    "read_file", "find_text",
    "shell",           // 监控、日志查询
    "tmux_create_session", "tmux_send_keys", "tmux_read_output",
  ],
};

/**
 * 从 toolProfile 字符串解析出允许的 OpenCode 工具集
 * @example parseToolProfile("tools.code-read+write+test")
 *          → { read_file: true, find_text: true, edit_file: true, shell: true, ... }
 */
function parseToolProfile(toolProfile: string): Record<string, boolean> {
  // "tools.code-read+write+test" → ["code-read", "write", "test"]
  const capabilities = toolProfile.replace("tools.", "").split("+");

  const allowed = new Set<string>();
  for (const cap of capabilities) {
    const tools = CAPABILITY_TO_TOOLS[cap];
    if (tools) tools.forEach((t) => allowed.add(t));
  }

  // 构造 { toolName: true } 格式（OpenCode API 只需要列出启用的工具）
  const result: Record<string, boolean> = {};
  for (const tool of allowed) {
    result[tool] = true;
  }
  return result;
}
```

#### 3.2.2 阶段级工具限制（可选增强）

```typescript
/** 某些阶段可进一步收窄工具集 */
const STAGE_TOOL_RESTRICTIONS: Record<string, string[]> = {
  // "review" 阶段禁止写入
  review: ["edit_file", "write_file", "hashline_edit", "hashline_insert", "hashline_delete"],
  // "plan" 阶段禁止执行 shell
  plan: ["shell", "tmux_create_session", "tmux_send_keys"],
};

function applyStageRestrictions(
  tools: Record<string, boolean>,
  stage?: string,
): Record<string, boolean> {
  if (!stage) return tools;
  const denied = STAGE_TOOL_RESTRICTIONS[stage];
  if (!denied) return tools;

  const filtered = { ...tools };
  for (const tool of denied) {
    delete filtered[tool];
  }
  return filtered;
}
```

### 3.3 意图分类上移

将 orchestrator-plugin 中的 63 个正则模式和 5 分类逻辑移植到 BFF：

```typescript
// intent-classifier.ts

type IntentCategory = "quick" | "deep" | "ops" | "security" | "architecture";

interface ClassificationResult {
  category: IntentCategory;
  complexity: "low" | "medium" | "high";
  suggestedAgent: string;
  suggestedModel: { providerID: string; modelID: string };
}

/**
 * 对用户 prompt 进行意图分类，决定 agent 和 model 路由
 * 移植自 orchestrator-plugin.ts 的 classifyIntent()
 */
function classifyIntent(
  prompt: string,
  roleAgent: { id: string; riskLevel: string },
): ClassificationResult {
  // 快速类
  if (/\b(explain|what is|how does|show me|list)\b/i.test(prompt)) {
    return {
      category: "quick",
      complexity: "low",
      suggestedAgent: "explore-enterprise",
      suggestedModel: FAST_MODEL,
    };
  }

  // 安全类
  if (/\b(security|vulnerability|CVE|audit|OWASP)\b/i.test(prompt)) {
    return {
      category: "security",
      complexity: "high",
      suggestedAgent: "oracle-enterprise",
      suggestedModel: PRIMARY_MODEL,
    };
  }

  // 运维类
  if (/\b(deploy|release|rollback|monitor|incident)\b/i.test(prompt)) {
    return {
      category: "ops",
      complexity: "medium",
      suggestedAgent: "oracle-enterprise",
      suggestedModel: PRIMARY_MODEL,
    };
  }

  // 架构类
  if (/\b(architect|redesign|migration|refactor.*large|system design)\b/i.test(prompt)) {
    return {
      category: "architecture",
      complexity: "high",
      suggestedAgent: "prometheus-enterprise",
      suggestedModel: PRIMARY_MODEL,
    };
  }

  // 默认：深度开发
  return {
    category: "deep",
    complexity: "medium",
    suggestedAgent: "hephaestus-enterprise",
    suggestedModel: PRIMARY_MODEL,
  };
}
```

### 3.4 修改 `buildPromptBody()`

```typescript
// 改造后的 buildPromptBody

async function buildPromptBody(
  text: string,
  options?: PromptOptions & { taskContext?: TaskExecutionContext },
): Promise<Record<string, unknown>> {
  const executionContext = buildExecutionContext(options);

  // ── Phase 1: 意图分类（如果 BFF 未指定 agent） ──
  const roleAgent = options?.taskContext?.roleAgent;
  const classification = roleAgent
    ? classifyIntent(text, roleAgent)
    : undefined;

  // ── Phase 2: 确定 agent 和 model ──
  const agent = resolvePromptAgent(options?.agent ?? classification?.suggestedAgent);
  const model = resolvePromptModel(options) ?? classification?.suggestedModel;

  // ── Phase 3: 组装 system prompt ──
  let system: string | undefined;
  if (roleAgent) {
    const assembled = await assemblePrompt({
      roleAgent,
      binding: {
        runtimeAgent: agent,
        model: options?.taskContext?.binding?.model,
      },
      project: options?.taskContext?.project,
      stage: options?.taskContext?.stage,
      override: options?.taskContext?.override,
    });
    system = assembled.system;
  }

  // ── Phase 4: 计算工具白名单 ──
  let tools: Record<string, boolean> | undefined;
  if (roleAgent) {
    const effectiveToolProfile =
      options?.taskContext?.override?.toolProfile ?? roleAgent.toolProfile;
    tools = parseToolProfile(effectiveToolProfile);
    tools = applyStageRestrictions(tools, options?.taskContext?.stage);
  }

  // ── Phase 5: 构造请求体 ──
  return {
    parts: [{ type: "text", text: `${executionContext}${text}` }],
    model: {
      providerID: model.providerId,
      modelID: model.modelId,
    },
    ...(agent ? { agent } : {}),
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    ...(typeof options?.noReply === "boolean" ? { noReply: options.noReply } : {}),
  };
}
```

### 3.5 审计日志增强

在发送 prompt 后，将完整构造记录写入审计事件：

```typescript
// 在 continueTaskExecution() 中
const promptBody = await buildPromptBody(prompt, { taskContext });

// 记录完整 prompt 到审计日志（不含消息历史，仅记录 BFF 侧构造）
await recordAuditEvent({
  type: "prompt.assembled",
  taskId: task.id,
  projectId: task.projectId,
  payload: {
    system: promptBody.system ? `[${promptBody.system.length} chars]` : null,
    tools: promptBody.tools ? Object.keys(promptBody.tools) : null,
    model: promptBody.model,
    agent: promptBody.agent,
    executionContext: "...",  // 脱敏
    classification: classification,
  },
});
```

---

## 4. OpenCode 侧变更

### 4.1 插件退役计划

| 插件 | 处理 | 原因 |
|------|------|------|
| **orchestrator-plugin** | Phase 2 退役 | 意图分类上移 BFF |
| **context-injection-plugin** | Phase 2 退役 | AGENTS.md 规则改由 BFF 读取并拼入 system |
| **skills-plugin** | Phase 3 退役 | Skill 指令改由 BFF 从 DB 读取 |
| hashline-edit-plugin | **保留** | 工具执行必须在 runtime |
| tmux-plugin | **保留** | 工具执行必须在 runtime |
| task-graph-plugin | **保留** | DAG 验证在 runtime 侧执行 |
| session-tools | **保留** | 子 session 管理在 runtime |

### 4.2 OpenCode 行为变化

当 BFF 传入 `system` 参数时，OpenCode 应：
- **跳过** `chat.system.transform` 钩子链（不再由插件修改 system prompt）
- **直接使用** BFF 传入的 system prompt
- Agent 定义文件（`.opencode/agents/xxx.md`）只作为 fallback（当 BFF 未传 `system` 时）

当 BFF 传入 `tools` 参数时，OpenCode 应：
- **只注册** `tools` 中值为 `true` 的工具
- **跳过** 未列出的工具（即使插件注册了也不发送给 LLM）

> 注意：需验证 OpenCode 对 `system` 和 `tools` 参数的实际行为是否符合预期。如果 OpenCode 当前是「追加」而非「覆盖」语义，需要在 fork 中调整为覆盖模式。

---

## 5. 数据库变更

### 5.1 新增字段

```sql
-- projects 表新增：项目级自定义指令
ALTER TABLE projects ADD COLUMN custom_instructions TEXT;

-- role_agent_bindings 表新增：agent system prompt 文本
ALTER TABLE role_agent_bindings ADD COLUMN system_prompt TEXT;

-- role_agent_bindings 表新增：agent system prompt 版本（用于缓存失效）
ALTER TABLE role_agent_bindings ADD COLUMN system_prompt_version INTEGER NOT NULL DEFAULT 1;
```

### 5.2 新增配置表（Phase 2）

```sql
-- 工具能力映射表（替代硬编码的 CAPABILITY_TO_TOOLS）
CREATE TABLE tool_capability_mappings (
  id              TEXT PRIMARY KEY,
  capability_key  TEXT NOT NULL,          -- e.g., "code-read", "write", "test"
  tool_name       TEXT NOT NULL,          -- e.g., "read_file", "edit_file"
  is_default      BOOLEAN NOT NULL DEFAULT true,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_tcm_cap_tool
  ON tool_capability_mappings (capability_key, tool_name);
```

---

## 6. 分阶段实施

### Phase 1：System Prompt 接管（低风险，立即可做）

**范围**：BFF 开始传入 `system` 参数，但保留 OpenCode 插件作为 fallback。

**步骤**：

1. 新增 `prompt-assembler.ts` 模块
2. 从 `.opencode/agents/*.md` 文件加载 agent prompt 内容
3. 从 `role_agents` + `role_agent_bindings` 表读取角色配置
4. 组装 system prompt（Layer 0~4）
5. 在 `buildPromptBody()` 中增加 `system` 字段
6. 记录审计日志
7. **验证**：对比 BFF 构造的 system prompt 与 OpenCode 原生组装的版本，确认语义一致

**回滚策略**：通过环境变量 `BFF_PROMPT_CONTROL=false` 关闭 `system` 字段，回退到 OpenCode 自行组装。

**预计改动文件**：
- 新增：`control-plane/web-ui-bff/src/modules/agent-control/prompt-assembler.ts`
- 修改：`control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts`（`buildPromptBody`）
- 修改：`control-plane/web-ui-bff/src/modules/tasks/routes.ts`（传入 taskContext）

### Phase 2：工具白名单接管 + 意图分类上移

**范围**：BFF 传入 `tools` 参数；意图分类逻辑从 orchestrator-plugin 移植到 BFF。

**步骤**：

1. 新增 `tool-whitelist.ts` 模块
2. 新增 `intent-classifier.ts` 模块（移植 orchestrator-plugin 的 63 个正则）
3. 在 `buildPromptBody()` 中增加 `tools` 字段
4. 验证 OpenCode 的 `tools` 参数是否为覆盖语义（如不是，需在 fork 中修改）
5. 在 staging 环境灰度测试
6. 确认无误后，禁用 orchestrator-plugin 和 context-injection-plugin

**预计改动文件**：
- 新增：`control-plane/web-ui-bff/src/modules/agent-control/tool-whitelist.ts`
- 新增：`control-plane/web-ui-bff/src/modules/agent-control/intent-classifier.ts`
- 修改：`control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter.ts`
- 修改：`opencode.json`（移除已退役插件）

### Phase 3：DB 驱动的 Prompt 管理

**范围**：Agent prompt 和工具映射从文件/硬编码迁移到 DB；支持 UI 在线编辑。

**步骤**：

1. `role_agent_bindings` 表新增 `system_prompt` 字段
2. `projects` 表新增 `custom_instructions` 字段
3. 新增 `tool_capability_mappings` 表
4. BFF 优先从 DB 读取 prompt，文件作为 fallback
5. 管理后台新增 prompt 编辑器
6. skills-plugin 退役，Skill 指令改由 DB 管理

---

## 7. 收益矩阵

| 维度 | 改前 | Phase 1 后 | Phase 2 后 | Phase 3 后 |
|------|------|-----------|-----------|-----------|
| **Prompt 可观测** | BFF 不知道 LLM 收到什么 | 完整记录 system prompt | 完整记录 system + tools | 全链路审计 |
| **租户级定制** | 所有项目共用 agent 文件 | 项目级规则注入 | 角色级工具限制 | DB 在线编辑 |
| **安全控制** | 工具全开 | — | 按角色精确开关 | 动态策略 |
| **部署耦合** | agent 文件必须在磁盘 | BFF 缓存 | — | 纯 DB 驱动 |
| **OpenCode 插件依赖** | 6 个插件 | 5 个（context-injection 可选） | 3 个（核心执行类） | 3 个 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| OpenCode `system` 参数为追加语义而非覆盖 | BFF 的 system prompt 会与 OpenCode 默认 prompt 叠加 | Phase 1 中先验证行为；如需覆盖，在 fork 中修改 |
| 意图分类不一致（BFF 移植 vs 原 Plugin） | agent/model 选择偏差 | 并行运行两套分类器，对比结果，差异率 <5% 时切换 |
| 工具白名单遗漏某些必须工具 | Agentic Loop 中工具调用失败 | 增加 `CRITICAL_TOOLS` 最小集（read_file, find_text 始终可用）|
| 消息历史中包含被禁工具的调用 | 历史上下文与当前工具集不匹配 | 消息历史中的工具调用/结果不受白名单影响，仅新请求受限 |
| DB 查询延迟影响 prompt 构造速度 | 增加每次请求 latency | BFF 启动时预热缓存 + 监听变更事件刷新 |

---

## 9. 验收标准

### Phase 1 验收

- [ ] BFF 传入 `system` 后，LLM 收到的 system prompt 与预期一致
- [ ] 环境变量开关可正常关闭 `system` 字段
- [ ] 审计日志完整记录 prompt 构造元信息
- [ ] 已有测试用例通过（`test:service`, `test:bff` 无回归）

### Phase 2 验收

- [ ] BFF 传入 `tools` 后，OpenCode 仅注册白名单内工具
- [ ] 只读角色（如 `role.product`）无法触发 `edit_file` / `shell`
- [ ] 意图分类与原 orchestrator-plugin 输出一致率 ≥ 95%
- [ ] orchestrator-plugin 和 context-injection-plugin 已从 `opencode.json` 移除

### Phase 3 验收

- [ ] DB 中的 system prompt 修改后，下一次请求立即生效
- [ ] 管理后台支持 prompt 在线编辑 + 版本历史
- [ ] skills-plugin 已退役
