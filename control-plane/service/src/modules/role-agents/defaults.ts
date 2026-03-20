export interface RoleAgentSeedDefinition {
  role: {
    id: string;
    name: string;
    description: string;
    scope: "system";
    permissionProfile: string;
    toolProfile: string;
    defaultExecutionMode: "single" | "parallel-review" | "round-robin";
    aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review";
    maxActiveBindings?: number;
    requireConsensus?: boolean;
    riskLevel?: "low" | "medium" | "high" | "critical";
    requiresApprovalForWrite?: boolean;
    allowedStages: string[];
    outputSchemaId?: string;
    ownerTeam?: string;
    tags?: string[];
  };
  bindings: Array<{
    bindingKey: string;
    runtimeAgent: string;
    label: string;
    enabled?: boolean;
    priority: number;
    model?: string;
    tags?: string[];
  }>;
}

export const DEFAULT_ROLE_AGENT_DEFINITIONS: RoleAgentSeedDefinition[] = [
  {
    role: {
      id: "role.product",
      name: "产品 Agent",
      description: "负责需求澄清、范围边界与验收标准整理。",
      scope: "system",
      permissionProfile: "perm.readonly-analysis",
      toolProfile: "tools.discovery+design",
      defaultExecutionMode: "single",
      allowedStages: ["intake", "clarify", "plan", "review"],
      outputSchemaId: "artifact.product-brief.v1",
      ownerTeam: "platform",
      tags: ["default", "product"],
    },
    bindings: [
      {
        bindingKey: "product-a",
        runtimeAgent: "prometheus-enterprise",
        label: "产品 A",
        enabled: true,
        priority: 1,
      },
    ],
  },
  {
    role: {
      id: "role.architect",
      name: "架构师 Agent",
      description: "负责方案设计、边界划分与技术风险评审。",
      scope: "system",
      permissionProfile: "perm.design-governance",
      toolProfile: "tools.discovery+design+code-read",
      defaultExecutionMode: "parallel-review",
      aggregationStrategy: "merge-summary",
      riskLevel: "medium",
      allowedStages: ["clarify", "design", "plan", "review"],
      outputSchemaId: "artifact.architecture-decision.v1",
      ownerTeam: "platform",
      tags: ["default", "architecture"],
    },
    bindings: [
      {
        bindingKey: "architect-a",
        runtimeAgent: "oracle-enterprise",
        label: "架构 A",
        enabled: true,
        priority: 1,
      },
      {
        bindingKey: "architect-b",
        runtimeAgent: "prometheus-enterprise",
        label: "架构 B",
        enabled: true,
        priority: 2,
      },
    ],
  },
  {
    role: {
      id: "role.developer",
      name: "开发者 Agent",
      description: "负责项目主代码实现、自测和缺陷修复。",
      scope: "system",
      permissionProfile: "perm.code-implementation",
      toolProfile: "tools.code-read+write+test",
      defaultExecutionMode: "single",
      riskLevel: "medium",
      requiresApprovalForWrite: false,
      allowedStages: ["implement", "verify", "fix"],
      outputSchemaId: "artifact.developer-change.v1",
      ownerTeam: "platform",
      tags: ["default", "developer"],
    },
    bindings: [
      {
        bindingKey: "developer-main",
        runtimeAgent: "hephaestus-enterprise",
        label: "开发者主执行",
        enabled: true,
        priority: 1,
      },
    ],
  },
  {
    role: {
      id: "role.visual",
      name: "美术 Agent",
      description: "负责视觉规范、信息表达和页面呈现建议。",
      scope: "system",
      permissionProfile: "perm.readonly-analysis",
      toolProfile: "tools.discovery+design",
      defaultExecutionMode: "single",
      allowedStages: ["design", "review"],
      outputSchemaId: "artifact.visual-spec.v1",
      ownerTeam: "platform",
      tags: ["default", "visual"],
    },
    bindings: [
      {
        bindingKey: "visual-a",
        runtimeAgent: "multimodal-enterprise",
        label: "美术 A",
        enabled: true,
        priority: 1,
      },
    ],
  },
  {
    role: {
      id: "role.security",
      name: "安全 Agent",
      description: "负责风险评估、加固建议和高风险阶段阻断。",
      scope: "system",
      permissionProfile: "perm.security-review",
      toolProfile: "tools.code-read+security-audit+test",
      defaultExecutionMode: "parallel-review",
      aggregationStrategy: "merge-summary",
      maxActiveBindings: 2,
      riskLevel: "high",
      allowedStages: ["clarify", "design", "implement", "verify", "release"],
      outputSchemaId: "artifact.security-review.v1",
      ownerTeam: "platform",
      tags: ["default", "security"],
    },
    bindings: [
      {
        bindingKey: "security-a",
        runtimeAgent: "oracle-enterprise",
        label: "安全 A",
        enabled: true,
        priority: 1,
      },
      {
        bindingKey: "security-b",
        runtimeAgent: "prometheus-enterprise",
        label: "安全 B",
        enabled: true,
        priority: 2,
      },
    ],
  },
  {
    role: {
      id: "role.release",
      name: "部署 Agent",
      description: "负责发布计划、回滚预案和环境发布前核查。",
      scope: "system",
      permissionProfile: "perm.release-management",
      toolProfile: "tools.discovery+release-plan+test",
      defaultExecutionMode: "single",
      riskLevel: "high",
      allowedStages: ["release", "post-release"],
      outputSchemaId: "artifact.release-plan.v1",
      ownerTeam: "platform",
      tags: ["default", "release"],
    },
    bindings: [
      {
        bindingKey: "release-a",
        runtimeAgent: "oracle-enterprise",
        label: "部署 A",
        enabled: true,
        priority: 1,
      },
    ],
  },
  {
    role: {
      id: "role.operations",
      name: "运维 Agent",
      description: "负责观测、诊断、故障处置建议和回滚建议。",
      scope: "system",
      permissionProfile: "perm.operations-control",
      toolProfile: "tools.discovery+ops-observe+test",
      defaultExecutionMode: "parallel-review",
      aggregationStrategy: "merge-summary",
      riskLevel: "high",
      allowedStages: ["verify", "release", "post-release", "retrospective"],
      outputSchemaId: "artifact.ops-runbook.v1",
      ownerTeam: "platform",
      tags: ["default", "operations"],
    },
    bindings: [
      {
        bindingKey: "operations-a",
        runtimeAgent: "oracle-enterprise",
        label: "运维 A",
        enabled: true,
        priority: 1,
      },
      {
        bindingKey: "operations-b",
        runtimeAgent: "prometheus-enterprise",
        label: "运维 B",
        enabled: true,
        priority: 2,
      },
    ],
  },
  {
    role: {
      id: "role.qa",
      name: "QA Agent",
      description: "负责回归验证、验收结论与阻塞项输出。",
      scope: "system",
      permissionProfile: "perm.readonly-analysis",
      toolProfile: "tools.code-read+test-verify",
      defaultExecutionMode: "parallel-review",
      aggregationStrategy: "merge-summary",
      riskLevel: "medium",
      allowedStages: ["verify", "release", "retrospective"],
      outputSchemaId: "artifact.qa-report.v1",
      ownerTeam: "platform",
      tags: ["default", "qa"],
    },
    bindings: [
      {
        bindingKey: "qa-a",
        runtimeAgent: "momus-enterprise",
        label: "QA A",
        enabled: true,
        priority: 1,
      },
      {
        bindingKey: "qa-b",
        runtimeAgent: "prometheus-enterprise",
        label: "QA B",
        enabled: true,
        priority: 2,
      },
    ],
  },
  {
    role: {
      id: "role.flash-assistant",
      name: "Flash 助手",
      description: "使用 Gemini Flash 模型的通用辅助 Agent，适用于低延迟、高吞吐的简单任务。",
      scope: "system",
      permissionProfile: "perm.readonly-analysis",
      toolProfile: "tools.discovery+design",
      defaultExecutionMode: "single",
      allowedStages: ["clarify", "plan", "review"],
      ownerTeam: "platform",
      tags: ["default", "flash"],
    },
    bindings: [
      {
        bindingKey: "flash-main",
        runtimeAgent: "prometheus-enterprise",
        label: "Flash 主执行",
        enabled: true,
        priority: 1,
        model: "github-copilot:gemini-3-flash-preview",
      },
    ],
  },
];
