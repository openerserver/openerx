import { describe, expect, it } from "vitest";
import {
  byokModelConfigurationSchema,
  byokModelRef,
  byokProviderIdSchema,
  byokProviderPresets,
  byokThinkingLevels,
  configuredByokProviders,
  defaultByokModelConfiguration,
  isByokModelRef,
  modelServiceSettingsSchema,
  resolveByokModelPreset,
} from "../src/model-service";

describe("BYOK model catalog (2026-09-21)", () => {
  it("covers every supported provider with valid, uniquely addressable presets", () => {
    expect(byokProviderPresets.map((provider) => provider.id)).toEqual(
      byokProviderIdSchema.options.filter((id) => id !== "qianfan"),
    );
    const refs = new Set<string>();
    for (const provider of byokProviderPresets) {
      for (const model of provider.models) {
        const ref = byokModelRef(provider.id, model.id);
        expect(refs.has(ref)).toBe(false);
        refs.add(ref);
        expect(byokModelConfigurationSchema.parse(model.configuration)).toEqual(
          model.configuration,
        );
        expect(isByokModelRef(ref)).toBe(true);
        expect(resolveByokModelPreset(ref)?.model).toEqual(model);
      }
    }
  });

  it.each([
    ["zhipu", "glm-5-3", "glm-5.3", false, 1_000_000, 131_072, ["low", "high", "max"]],
    ["zhipu", "glm-5-3-flash", "glm-5.3-flash", true, 1_000_000, 131_072, ["low", "high", "max"]],
    ["zhipu", "glm-5-3-flashx", "glm-5.3-flashx", true, 1_000_000, 131_072, ["low", "high", "max"]],
    ["kimi", "k3", "kimi-k3", true, 1_048_576, 131_072, ["low", "high", "max"]],
    ["kimi", "k2-7-code", "kimi-k2.7-code", true, 262_144, 32_768, ["medium"]],
    ["kimi", "k2-7-code-highspeed", "kimi-k2.7-code-highspeed", true, 262_144, 32_768, ["medium"]],
    ["qwen", "flash-3-8", "qwen3.8-flash", true, 1_000_000, 131_072, ["off", "medium", "high"]],
    [
      "doubao",
      "seed-2-1-pro-260915",
      "doubao-seed-2-1-pro-260915",
      true,
      1_000_000,
      65_536,
      ["off", "medium", "high"],
    ],
    [
      "doubao",
      "seed-2-lite-260428",
      "doubao-seed-2-0-lite-260428",
      true,
      262_144,
      32_768,
      ["off", "medium", "high"],
    ],
    ["hunyuan", "hy4-preview", "hy4-preview", false, 1_000_000, 64_000, ["off", "high"]],
    ["hunyuan", "hy3", "hy3", false, 256_000, 128_000, ["off", "low", "high"]],
  ])(
    "resolves %s/%s with its supported capabilities",
    (provider, id, modelId, imageInput, contextWindow, maxOutputTokens, levels) => {
      const model = resolveByokModelPreset(`platform/byok.${provider}.${id}`)?.model;
      expect(model?.configuration).toMatchObject({
        modelId,
        contextWindow,
        maxOutputTokens,
        capabilities: { imageInput },
      });
      if (!model) throw new Error(`Missing model preset ${provider}/${id}`);
      expect(byokThinkingLevels(model.configuration)).toEqual(levels);
    },
  );

  it("preserves saved model references and migrates retired DeepSeek vision to the current API alias", () => {
    for (const ref of [
      "deepseek.flash",
      "deepseek.pro",
      "deepseek.vision",
      "qwen.max",
      "qwen.plus",
      "qwen.flash",
      "kimi.k2-6",
      "zhipu.glm-5-2",
      "zhipu.glm-5",
      "doubao.seed-2-1-pro",
      "doubao.seed-2-lite",
    ]) {
      expect(resolveByokModelPreset(`platform/byok.${ref}`)).not.toBeNull();
    }
    expect(defaultByokModelConfiguration()).toMatchObject({
      modelId: "deepseek-flash",
      capabilities: { imageInput: true },
    });
    expect(
      resolveByokModelPreset("platform/byok.deepseek.vision")?.model.configuration.modelId,
    ).toBe("deepseek-flash");
  });

  it("replaces Baidu in the visible catalog while still accepting stored legacy settings", () => {
    expect(configuredByokProviders().map(({ id }) => id)).toEqual([
      "deepseek",
      "qwen",
      "kimi",
      "zhipu",
      "doubao",
      "hunyuan",
    ]);
    const legacy = modelServiceSettingsSchema.parse({
      mode: "byok",
      byok: defaultByokModelConfiguration(),
      credentialConfigured: false,
      providerCredentials: { qianfan: true },
      providerModels: { qianfan: [] },
      updatedAt: null,
    });
    expect(legacy.providerCredentials.qianfan).toBe(true);
    expect(legacy.providerCredentials.hunyuan).toBeUndefined();
  });

  it("retains custom models and the provider endpoint after adding new presets", () => {
    const custom = {
      ...defaultByokModelConfiguration(),
      modelId: "private-model",
      displayName: "Private",
    };
    const { baseUrl: _baseUrl, ...configuration } = custom;
    const providers = configuredByokProviders({ zhipu: [configuration] });
    expect(
      providers.find((provider) => provider.id === "zhipu")?.models.at(-1)?.configuration,
    ).toMatchObject({ modelId: "private-model", baseUrl: "https://open.bigmodel.cn/api/paas/v4" });
    expect(
      byokThinkingLevels({ ...custom, modelId: "glm-5.3", baseUrl: "https://custom.example/v1" }),
    ).toEqual(["off", "medium", "high"]);
  });
});
