import { z } from "zod";

export const modelServiceModeSchema = z.enum(["hosted", "byok"]);

export const byokProviderIdSchema = z.enum([
  "deepseek",
  "qwen",
  "kimi",
  "zhipu",
  "doubao",
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

export const byokProviderPresets: readonly ByokProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    apiKeyPlaceholder: "输入 DeepSeek API Key",
    models: [
      {
        id: "flash",
        label: "DeepSeek V4 Flash",
        configuration: {
          baseUrl: "https://api.deepseek.com",
          modelId: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          contextWindow: 1_000_000,
          maxOutputTokens: 384_000,
          capabilities: { imageInput: false, functionCalling: true, reasoning: true },
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
        label: "DeepSeek V4 Flash Vision",
        configuration: {
          baseUrl: "https://api.deepseek.com",
          modelId: "deepseek-v4-flash-vision-exp",
          displayName: "DeepSeek V4 Flash Vision",
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
    id: "qianfan",
    label: "百度智能云千帆 · 文心",
    apiKeyPlaceholder: "输入千帆 API Key",
    models: [
      {
        id: "ernie-5",
        label: "ERNIE 5.0",
        configuration: {
          baseUrl: "https://qianfan.baidubce.com/v2",
          modelId: "ernie-5.0",
          displayName: "ERNIE 5.0",
          contextWindow: 131_072,
          maxOutputTokens: 65_536,
          capabilities: { imageInput: true, functionCalling: true, reasoning: false },
        },
      },
      {
        id: "ernie-4-5-turbo",
        label: "ERNIE 4.5 Turbo 128K",
        configuration: {
          baseUrl: "https://qianfan.baidubce.com/v2",
          modelId: "ernie-4.5-turbo-128k",
          displayName: "ERNIE 4.5 Turbo 128K",
          contextWindow: 131_072,
          maxOutputTokens: 12_288,
          capabilities: { imageInput: false, functionCalling: true, reasoning: false },
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
    /^platform\/byok\.(deepseek|qwen|kimi|zhipu|doubao|qianfan)\.custom-.+$/u.test(modelRef) ||
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
