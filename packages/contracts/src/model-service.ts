import { z } from "zod";

export const modelServiceModeSchema = z.enum(["hosted", "byok"]);

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

export const modelServiceSettingsSchema = z
  .object({
    mode: modelServiceModeSchema,
    byok: byokModelConfigurationSchema.nullable(),
    credentialConfigured: z.boolean(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const modelServiceSettingsUpdateSchema = z
  .object({
    mode: modelServiceModeSchema,
    byok: byokModelConfigurationSchema.nullable(),
    apiKey: z.string().trim().min(1).max(20_000).optional(),
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
export type ByokModelConfiguration = z.infer<typeof byokModelConfigurationSchema>;
export type ModelServiceSettings = z.infer<typeof modelServiceSettingsSchema>;
export type ModelServiceSettingsUpdate = z.infer<typeof modelServiceSettingsUpdateSchema>;
export type ByokConnectionTestResult = z.infer<typeof byokConnectionTestResultSchema>;

export function defaultByokModelConfiguration(): ByokModelConfiguration {
  return {
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    capabilities: { imageInput: false, functionCalling: true, reasoning: true },
  };
}

export interface ModelServiceBridge {
  getModelServiceSettings(): Promise<ModelServiceSettings>;
  updateModelServiceSettings(input: ModelServiceSettingsUpdate): Promise<ModelServiceSettings>;
  testByokConnection(input: ModelServiceSettingsUpdate): Promise<ByokConnectionTestResult>;
  clearByokApiKey(): Promise<ModelServiceSettings>;
}
