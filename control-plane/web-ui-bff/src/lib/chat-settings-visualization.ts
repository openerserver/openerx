import type { ModelsConfig } from "../modules/chat-settings/types";
import type { OrchestrationStrategy } from "./orchestration-strategy";
import { buildStrategyMermaidMap } from "./orchestration-mermaid";

export interface ChatSettingsVisualization {
  kind: "mermaid" | "json";
  title: string;
  content: string;
}

export function buildModelsFlowchart(config: ModelsConfig): string {
  const lines = ["flowchart LR", "  Defaults[默认模型]"];
  const defaultModel = typeof config.defaults?.model === "string" ? config.defaults.model.trim() : "";

  if (defaultModel) {
    lines.push(`  Defaults --> DefaultRoute[${defaultModel.replace(/"/g, "'")}]`);
  }

  const providers = Object.keys(config.providers || {});
  providers.forEach((providerKey, providerIndex) => {
    const providerNode = `Provider_${providerIndex}`;
    lines.push(`  ${providerNode}[${providerKey.replace(/"/g, "'")}]`);
    const providerModels = config.list.filter((item) => item.provider === providerKey);
    if (providerModels.length === 0) {
      lines.push(`  ${providerNode} --> ${providerNode}_empty[无模型]`);
      return;
    }

    providerModels.forEach((item, index) => {
      const modelNode = `${providerNode}_Model_${index}`;
      const modelLabel = `${String(item.id || "unknown")}`.replace(/"/g, "'");
      lines.push(`  ${providerNode} --> ${modelNode}[${modelLabel}]`);
    });
  });

  return lines.join("\n");
}

export function buildStrategyVisualizations(strategy: OrchestrationStrategy): ChatSettingsVisualization[] {
  return Object.entries(buildStrategyMermaidMap(strategy)).map(([category, content]) => ({
    kind: "mermaid",
    title: `编排时序 · ${category}`,
    content,
  }));
}

export function buildModelsVisualizations(config: ModelsConfig): ChatSettingsVisualization[] {
  return [
    {
      kind: "mermaid",
      title: "模型路由关系图",
      content: buildModelsFlowchart(config),
    },
    {
      kind: "json",
      title: "模型配置快照",
      content: JSON.stringify(config, null, 2),
    },
  ];
}

export function buildJsonVisualizations(title: string, value: unknown): ChatSettingsVisualization[] {
  return [
    {
      kind: "json",
      title,
      content: JSON.stringify(value, null, 2),
    },
  ];
}