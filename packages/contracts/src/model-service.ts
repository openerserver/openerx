import { z } from "zod";
import type { ThinkingLevel } from "./model";

export const modelServiceModeSchema = z.enum(["hosted", "byok"]);

export const byokProviderIdSchema = z.enum([
  "deepseek",
  "qwen",
  "kimi",
  "zhipu",
  "doubao",
  "hunyuan",
  // Read legacy settings without deleting or reusing the former provider key.
  "qianfan",
]);

export const byokModelConfigurationSchema = z
  .object({
    baseUrl: z.url(),
    modelId: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(120),
    contextWindow: z.number().int().min(1_024).max(10_000_000),
    maxOutputTokens: z.number().int().min(1).max(1_000_000),
    capabilities: z
      .object({
        imageInput: z.boolean(),
        functionCalling: z.boolean(),
        reasoning: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const providerModelsSchema = z.partialRecord(
  byokProviderIdSchema,
  z.array(byokModelConfigurationSchema.omit({ baseUrl: true })).max(100),
);

export function configuredByokProviders(
  models: z.infer<typeof providerModelsSchema> = {},
): ByokProviderPreset[] {
  return byokProviderPresets.map((provider) => ({
    ...provider,
    models: [
      ...provider.models,
      ...(models[provider.id] ?? []).map((model) => ({
        id: `custom-${encodeURIComponent(model.modelId)}`,
        label: model.displayName,
        configuration: { ...model, baseUrl: provider.models[0]!.configuration.baseUrl },
      })),
    ],
  }));
}

export const modelServiceSettingsSchema = z
  .object({
    mode: modelServiceModeSchema,
    providerModels: providerModelsSchema.optional(),
    byok: byokModelConfigurationSchema.nullable(),
    credentialConfigured: z.boolean(),
    providerCredentials: z.partialRecord(byokProviderIdSchema, z.boolean()).default({}),
    credentialIssue: z.enum(["unavailable", "unreadable"]).nullable().optional(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const modelServiceSettingsUpdateSchema = z
  .object({
    mode: modelServiceModeSchema,
    providerModels: providerModelsSchema.optional(),
    byok: byokModelConfigurationSchema.nullable(),
    apiKey: z.string().trim().min(1).max(20_000).optional(),
    providerApiKeys: z
      .partialRecord(byokProviderIdSchema, z.string().trim().min(1).max(20_000))
      .optional(),
    recoverUnreadableCredentials: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "byok" && !value.byok) {
      context.addIssue({
        code: "custom",
        message: "BYOK configuration is required",
        path: ["byok"],
      });
    }
  });

export const byokConnectionTestResultSchema = z
  .object({
    ok: z.boolean(),
    latencyMs: z.number().int().nonnegative(),
    reportedModel: z.string().nullable(),
  })
  .strict();

export type ModelServiceMode = z.infer<typeof modelServiceModeSchema>;
export type ByokProviderId = z.infer<typeof byokProviderIdSchema>;
export type ByokModelConfiguration = z.infer<typeof byokModelConfigurationSchema>;
export type ModelServiceSettings = z.infer<typeof modelServiceSettingsSchema>;
export type ModelServiceSettingsUpdate = z.infer<typeof modelServiceSettingsUpdateSchema>;
export type ByokConnectionTestResult = z.infer<typeof byokConnectionTestResultSchema>;

export interface ByokModelPreset {
  id: string;
  label: string;
  configuration: ByokModelConfiguration;
}

export interface ByokProviderPreset {
  id: ByokProviderId;
  label: string;
  apiKeyPlaceholder: string;
  models: readonly ByokModelPreset[];
}

/** Keep model-specific reasoning constraints consistent in the picker and transport. */
export function byokReasoningProfile(
  configuration: Pick<ByokModelConfiguration, "baseUrl" | "modelId">,
) {
  const host = new URL(configuration.baseUrl).hostname;
  const id = configuration.modelId;
  if (host === "open.bigmodel.cn" && /^glm-5\.3(?:-flashx?)?$/u.test(id)) return "glm-5.3";
  if (host === "api.moonshot.cn" || host === "api.moonshot.ai") {
    if (id === "kimi-k3") return "kimi-k3";
    if (/^kimi-k2\.7-code(?:-highspeed)?$/u.test(id)) return "kimi-k2.7";
  }
  if (host === "tokenhub.tencentmaas.com") {
    if (id === "hy4-preview") return "hy4";
    if (id === "hy3") return "hy3";
  }
  return null;
}

export function byokThinkingLevels(configuration: ByokModelConfiguration): ThinkingLevel[] {
  if (!configuration.capabilities.reasoning) return ["off"];
  switch (byokReasoningProfile(configuration)) {
    case "glm-5.3":
    case "kimi-k3":
      return ["low", "high", "max"];
    case "kimi-k2.7":
      return ["medium"];
    case "hy4":
      return ["off", "high"];
    case "hy3":
      return ["off", "low", "high"];
    default:
      return ["off", "medium", "high"];
  }
}

// Verified 2026-09-21. Sources and compatibility notes:
// docs/models.md
export const byokProviderPresets: readonly ByokProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    apiKeyPlaceholder: "输入 DeepSeek API Key",
    models: [
      {
        id: "flash",
        label: "DeepSeek V4.1 Flash",
        configuration: {
          baseUrl: "https://api.deepseek.com",
          modelId: "deepseek-flash",
          displayName: "DeepSeek V4.1 Flash",
          contextWindow: 1_000_000,
          maxOutputTokens: 384_000,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "pro",
        label: "DeepSeek V4 Pro",
        configuration: {
          baseUrl: "https://api.deepseek.com",
          modelId: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
          contextWindow: 1_000_000,
          maxOutputTokens: 384_000,
          capabilities: { imageInput: false, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "vision",
        label: "DeepSeek V4.1 Flash（兼容入口）",
        configuration: {
          baseUrl: "https://api.deepseek.com",
          modelId: "deepseek-flash",
          displayName: "DeepSeek V4.1 Flash（兼容入口）",
          contextWindow: 1_000_000,
          maxOutputTokens: 384_000,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
    ],
  },
  {
    id: "qwen",
    label: "阿里云百炼 · 通义千问",
    apiKeyPlaceholder: "输入百炼 API Key（中国内地）",
    models: [
      {
        id: "max",
        label: "Qwen 3.8 Max",
        configuration: {
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          modelId: "qwen3.8-max",
          displayName: "Qwen 3.8 Max",
          contextWindow: 1_000_000,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "plus",
        label: "Qwen 3.7 Plus",
        configuration: {
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          modelId: "qwen3.7-plus",
          displayName: "Qwen 3.7 Plus",
          contextWindow: 1_000_000,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "flash-3-8",
        label: "Qwen 3.8 Flash",
        configuration: {
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          modelId: "qwen3.8-flash",
          displayName: "Qwen 3.8 Flash",
          contextWindow: 1_000_000,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "flash",
        label: "Qwen 3.7 Flash",
        configuration: {
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          modelId: "qwen3.7-flash",
          displayName: "Qwen 3.7 Flash",
          contextWindow: 1_000_000,
          maxOutputTokens: 65_536,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
    ],
  },
  {
    id: "kimi",
    label: "月之暗面 · Kimi",
    apiKeyPlaceholder: "输入 Moonshot API Key",
    models: [
      {
        id: "k3",
        label: "Kimi K3",
        configuration: {
          baseUrl: "https://api.moonshot.cn/v1",
          modelId: "kimi-k3",
          displayName: "Kimi K3",
          contextWindow: 1_048_576,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "k2-7-code",
        label: "Kimi K2.7 Code",
        configuration: {
          baseUrl: "https://api.moonshot.cn/v1",
          modelId: "kimi-k2.7-code",
          displayName: "Kimi K2.7 Code",
          contextWindow: 262_144,
          maxOutputTokens: 32_768,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "k2-7-code-highspeed",
        label: "Kimi K2.7 Code HighSpeed",
        configuration: {
          baseUrl: "https://api.moonshot.cn/v1",
          modelId: "kimi-k2.7-code-highspeed",
          displayName: "Kimi K2.7 Code HighSpeed",
          contextWindow: 262_144,
          maxOutputTokens: 32_768,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "k2-6",
        label: "Kimi K2.6",
        configuration: {
          baseUrl: "https://api.moonshot.cn/v1",
          modelId: "kimi-k2.6",
          displayName: "Kimi K2.6",
          contextWindow: 262_144,
          maxOutputTokens: 32_768,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
    ],
  },
  {
    id: "zhipu",
    label: "智谱 AI · GLM",
    apiKeyPlaceholder: "输入智谱 API Key",
    models: [
      {
        id: "glm-5-3",
        label: "GLM-5.3",
        configuration: {
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          modelId: "glm-5.3",
          displayName: "GLM-5.3",
          contextWindow: 1_000_000,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: false, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "glm-5-3-flash",
        label: "GLM-5.3 Flash",
        configuration: {
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          modelId: "glm-5.3-flash",
          displayName: "GLM-5.3 Flash",
          contextWindow: 1_000_000,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "glm-5-3-flashx",
        label: "GLM-5.3 FlashX",
        configuration: {
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          modelId: "glm-5.3-flashx",
          displayName: "GLM-5.3 FlashX",
          contextWindow: 1_000_000,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "glm-5-2",
        label: "GLM-5.2",
        configuration: {
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          modelId: "glm-5.2",
          displayName: "GLM-5.2",
          contextWindow: 1_000_000,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: false, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "glm-5",
        label: "GLM-5",
        configuration: {
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          modelId: "glm-5",
          displayName: "GLM-5",
          contextWindow: 202_752,
          maxOutputTokens: 131_072,
          capabilities: { imageInput: false, functionCalling: true, reasoning: true },
        },
      },
    ],
  },
  {
    id: "doubao",
    label: "火山方舟 · 豆包",
    apiKeyPlaceholder: "输入火山方舟 API Key",
    models: [
      {
        id: "seed-2-1-pro-260915",
        label: "Doubao Seed 2.1 Pro · 260915",
        configuration: {
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          modelId: "doubao-seed-2-1-pro-260915",
          displayName: "Doubao Seed 2.1 Pro · 260915",
          contextWindow: 1_000_000,
          maxOutputTokens: 65_536,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "seed-2-lite-260428",
        label: "Doubao Seed 2.0 Lite · 260428",
        configuration: {
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          modelId: "doubao-seed-2-0-lite-260428",
          displayName: "Doubao Seed 2.0 Lite · 260428",
          contextWindow: 262_144,
          maxOutputTokens: 32_768,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "seed-2-1-pro",
        label: "Doubao Seed 2.1 Pro",
        configuration: {
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          modelId: "doubao-seed-2-1-pro-260628",
          displayName: "Doubao Seed 2.1 Pro",
          contextWindow: 262_144,
          maxOutputTokens: 65_536,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "seed-2-lite",
        label: "Doubao Seed 2.0 Lite",
        configuration: {
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          modelId: "doubao-seed-2-0-lite-260215",
          displayName: "Doubao Seed 2.0 Lite",
          contextWindow: 262_144,
          maxOutputTokens: 32_768,
          capabilities: { imageInput: true, functionCalling: true, reasoning: true },
        },
      },
    ],
  },
  {
    id: "hunyuan",
    label: "腾讯云 · 混元",
    apiKeyPlaceholder: "输入 TokenHub API Key（广州）",
    models: [
      {
        id: "hy4-preview",
        label: "Tencent Hy4 Preview",
        configuration: {
          baseUrl: "https://tokenhub.tencentmaas.com/v1",
          modelId: "hy4-preview",
          displayName: "Tencent Hy4 Preview",
          contextWindow: 1_000_000,
          maxOutputTokens: 64_000,
          capabilities: { imageInput: false, functionCalling: true, reasoning: true },
        },
      },
      {
        id: "hy3",
        label: "Tencent Hy3",
        configuration: {
          baseUrl: "https://tokenhub.tencentmaas.com/v1",
          modelId: "hy3",
          displayName: "Tencent Hy3",
          contextWindow: 256_000,
          maxOutputTokens: 128_000,
          capabilities: { imageInput: false, functionCalling: true, reasoning: true },
        },
      },
    ],
  },
] as const;

export function byokModelRef(providerId: ByokProviderId, modelId: string): string {
  return `platform/byok.${providerId}.${modelId}`;
}

export const defaultByokModelRef = byokModelRef("deepseek", "flash");

export function resolveByokModelPreset(
  modelRef: string,
  models?: z.infer<typeof providerModelsSchema>,
): {
  provider: ByokProviderPreset;
  model: ByokModelPreset;
} | null {
  for (const provider of configuredByokProviders(models)) {
    const model = provider.models.find(({ id }) => byokModelRef(provider.id, id) === modelRef);
    if (model) return { provider, model };
  }
  return null;
}

export function isByokModelRef(modelRef: string): boolean {
  return (
    modelRef === "platform/byok" ||
    /^platform\/byok\.(deepseek|qwen|kimi|zhipu|doubao|hunyuan|qianfan)\.custom-.+$/u.test(
      modelRef,
    ) ||
    resolveByokModelPreset(modelRef) !== null
  );
}

export function defaultByokModelConfiguration(): ByokModelConfiguration {
  const configuration = byokProviderPresets[0]?.models[0]?.configuration;
  if (!configuration) throw new Error("DEFAULT_BYOK_MODEL_PRESET_MISSING");
  return {
    ...configuration,
    capabilities: { ...configuration.capabilities },
  };
}

export interface ModelServiceBridge {
  getModelServiceSettings(): Promise<ModelServiceSettings>;
  updateModelServiceSettings(input: ModelServiceSettingsUpdate): Promise<ModelServiceSettings>;
  testByokConnection(input: ModelServiceSettingsUpdate): Promise<ByokConnectionTestResult>;
  clearByokApiKey(providerId?: ByokProviderId): Promise<ModelServiceSettings>;
}
