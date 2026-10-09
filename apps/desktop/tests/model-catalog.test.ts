import type { ModelCatalogEntry } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { defaultModelNotice, resolveDefaultModel } from "../src/renderer/model-catalog";

const model = (ref: string, recommended = false): ModelCatalogEntry => ({
  modelRef: ref,
  displayName: ref,
  version: "v1",
  catalogVersion: "release-1",
  recommended,
  capabilities: {
    textInput: true,
    imageInput: false,
    fileInput: false,
    functionCalling: true,
    structuredOutput: false,
  },
  contextWindow: 8192,
  maxOutputTokens: 512,
  status: "available",
  priceRef: "base",
  priceSummary: "基础额度",
  free: true,
});
describe("published model catalogue", () => {
  it("preserves an authorized personal choice when the server recommendation changes", () => {
    const models = [model("platform/a"), model("platform/b", true)];
    expect(resolveDefaultModel(models, "platform/a")?.modelRef).toBe("platform/a");
    expect(defaultModelNotice(models, "platform/a")).toBeNull();
  });
  it("explains revoked or unavailable defaults and selects the available recommendation", () => {
    const models = [
      { ...model("platform/a"), status: "unavailable" as const },
      model("platform/b", true),
    ];
    expect(resolveDefaultModel(models, "platform/a")?.modelRef).toBe("platform/b");
    expect(defaultModelNotice(models, "platform/a")).toContain("下架或当前账号无权使用");
    expect(defaultModelNotice(models, "platform/removed")).toContain("platform/b");
    expect(defaultModelNotice(models, "platform/auto")).toBeNull();
  });
  it("does not invent a fallback when every model is unavailable", () => {
    expect(
      resolveDefaultModel([{ ...model("platform/a", true), status: "unavailable" }], "platform/a"),
    ).toBeUndefined();
  });
});
