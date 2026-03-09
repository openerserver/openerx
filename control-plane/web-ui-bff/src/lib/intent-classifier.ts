// ── Intent Classifier ──────────────────────────────────────────────
// Mirrors opencode-fork/.opencode/plugins/orchestrator-plugin.ts logic.

export type TaskCategory = "quick" | "deep" | "ops" | "security" | "architecture";
export type Complexity = "low" | "medium" | "high";

export interface IntentClassification {
  category: TaskCategory;
  complexity: Complexity;
  suggestedAgents: string[];
  requiresPlan: boolean;
  confidence: number;
}

const CATEGORY_PATTERNS: Record<TaskCategory, RegExp[]> = {
  quick: [
    /\b(what|where|how|explain|show|find|search|look up|describe)\b/i,
    /\b(what does .+ do)\b/i,
    /\b(quick|simple|brief)\b/i,
  ],
  deep: [
    /\b(implement|create|build|develop|add|write|refactor|redesign|migrate)\b/i,
    /\b(feature|module|component|service|endpoint|api)\b/i,
    /\b(fix bug|resolve issue|patch)\b/i,
  ],
  ops: [
    /\b(deploy|release|rollback|restart|monitor|alert|incident|outage)\b/i,
    /\b(log|metric|trace|health|status|diagnos)\b/i,
    /\b(runbook|playbook|sop)\b/i,
  ],
  security: [
    /\b(security|vulnerability|cve|exploit|injection|xss|csrf|auth)\b/i,
    /\b(audit|compliance|penetration|scan|sast|dast)\b/i,
    /\b(secret|credential|permission|access control)\b/i,
  ],
  architecture: [
    /\b(architect|design|pattern|trade-?off|scalab|performance)\b/i,
    /\b(review|evaluate|assess|analyze|technical debt)\b/i,
    /\b(system design|high level|overview)\b/i,
  ],
};

function estimateComplexity(message: string): Complexity {
  const wordCount = message.split(/\s+/).length;
  const hasMultipleFiles = /\b(files|modules|components|services)\b/i.test(message);
  const hasComplexKeywords = /\b(complex|large|entire|all|complete|full)\b/i.test(message);

  if (wordCount > 100 || hasMultipleFiles || hasComplexKeywords) return "high";
  if (wordCount > 30) return "medium";
  return "low";
}

function getAgentsForCategory(category: TaskCategory, _complexity: Complexity): string[] {
  switch (category) {
    case "quick":
      return ["explore-enterprise"];
    case "deep":
      return ["sisyphus-enterprise", "prometheus-enterprise", "hephaestus-enterprise"];
    case "ops":
      return ["oracle-enterprise"];
    case "security":
      return ["oracle-enterprise", "hephaestus-enterprise"];
    case "architecture":
      return ["prometheus-enterprise", "oracle-enterprise"];
  }
}

export function classifyIntent(message: string): IntentClassification {
  const scores: Record<TaskCategory, number> = {
    quick: 0,
    deep: 0,
    ops: 0,
    security: 0,
    architecture: 0,
  };

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        scores[category as TaskCategory] += 1;
      }
    }
  }

  const entries = Object.entries(scores) as [TaskCategory, number][];
  entries.sort((a, b) => b[1] - a[1]);

  const [topCategory = "quick", topScore = 0] = entries[0] ?? [];
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);

  const complexity = estimateComplexity(message);
  const confidence = totalScore > 0 ? topScore / totalScore : 0.5;

  return {
    category: topScore > 0 ? topCategory : "quick",
    complexity,
    suggestedAgents: getAgentsForCategory(topCategory, complexity),
    requiresPlan: topCategory === "deep" || topCategory === "architecture",
    confidence,
  };
}
