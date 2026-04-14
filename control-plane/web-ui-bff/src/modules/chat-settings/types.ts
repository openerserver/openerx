export type ChatSettingsConfigType =
  | "orchestration-strategy"
  | "models"
  | "agents"
  | "mcp"
  | "skills"
  | "commands"
  | "security"
  | "plugins";

export type ModelBillingStatus = "free" | "paid";
export type ModelBillingMethod = "token_metered" | "request_metered" | "run_metered";

export interface ModelBillingPrice {
  currency: "USD";
  inputPerMillionTokens?: number;
  outputPerMillionTokens?: number;
  perRequestUsd?: number;
  perRunUsd?: number;
  [key: string]: unknown;
}

export interface ModelListItem {
  id?: string;
  name?: string;
  provider?: string;
  route?: string;
  contextWindow?: number;
  maxTokens?: number;
  billingStatus?: ModelBillingStatus;
  billingMethod?: ModelBillingMethod;
  price?: ModelBillingPrice;
  [key: string]: unknown;
}

export interface ModelsConfig {
  defaults: Record<string, unknown>;
  providers: Record<string, unknown>;
  list: ModelListItem[];
}

export interface McpServer {
  type?: string;
  command: string | string[];
  args?: string[];
  env?: Record<string, string>;
  environment?: Record<string, string>;
  description?: string;
}

export interface MarkdownConfigDetail {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface MarkdownConfigPatch {
  name: string;
  frontmatterPatch?: Record<string, unknown>;
  body?: string;
}

export interface SkillSummary {
  dirName: string;
  name: string;
  description: string;
  permissions?: Record<string, unknown>;
}

export interface CommandSummary {
  fileName: string;
  name: string;
  description: string;
}

export interface SecurityBaselineConfig {
  raw: string;
}

export interface PluginConfigItem {
  path: string;
  name: string;
  exists?: boolean;
  enabled?: boolean;
}

export interface PluginsConfig {
  plugins: PluginConfigItem[];
}

export interface PluginInstallSource {
  source: string;
  name: string;
  installed: boolean;
  enabled: boolean;
}

export interface PluginOperationPatch {
  operation: "install" | "uninstall" | "replace";
  source?: string;
  name?: string;
  plugins?: PluginConfigItem[];
}

export type OrchestrationExecutionMode = "single" | "parallel" | "sequential-chain" | "unknown";

export interface OrchestrationCategorySummary {
  category: string;
  templateName: string;
  executionMode: OrchestrationExecutionMode;
  pipelineEnabled: boolean;
  judgeEnabled: boolean;
  judgeAgent: string;
  judgeModel: string;
  primaryAgents: string[];
  primaryModel: string;
  notes: string[];
}

export interface OrchestrationJudgeChange {
  changed: boolean;
  beforeEnabled: boolean;
  afterEnabled: boolean;
  beforeAgent: string;
  afterAgent: string;
  beforeModel: string;
  afterModel: string;
}

export interface OrchestrationTemplateChange {
  category: string;
  beforeTemplate: string;
  afterTemplate: string;
  beforeMode: OrchestrationExecutionMode;
  afterMode: OrchestrationExecutionMode;
}

export interface OrchestrationChangeCard {
  id: string;
  category: string;
  changeType: "template" | "judge" | "model" | "agent" | "pipeline";
  title: string;
  summary: string;
  beforeLabel: string;
  afterLabel: string;
  riskLevel: "low" | "medium" | "high";
  affectsJudge: boolean;
  affectsTemplate: boolean;
  mermaidCode?: string;
}

export interface OrchestrationRiskHint {
  level: "low" | "medium" | "high";
  summary: string;
}

export interface OrchestrationStrategyPreview {
  configVersion: string;
  explanation: string;
  affectedCategories: string[];
  changeCards: OrchestrationChangeCard[];
  judgeChange: OrchestrationJudgeChange;
  templateChanges: OrchestrationTemplateChange[];
  strategySummaryBefore: OrchestrationCategorySummary[];
  strategySummaryAfter: OrchestrationCategorySummary[];
  riskHints: OrchestrationRiskHint[];
  mermaidPreview: Record<string, string>;
  rawPatch: Record<string, unknown>;
}
