import { describe, expect, it, vi } from "vitest";
import { localByokUsage } from "../src/main/model-usage";

describe("Desktop usage source routing", () => {
  it("reads BYOK usage locally without requiring a platform account", async () => {
    const read = vi
      .fn()
      .mockResolvedValue({ selectedModelRef: "platform/byok.deepseek.flash", records: [] });
    await expect(localByokUsage({}, "hosted", read)).resolves.toEqual([]);
    expect(read).toHaveBeenCalledOnce();
  });
  it("keeps historical hosted messages on the hosted accounting path after switching to BYOK", async () => {
    await expect(
      localByokUsage({}, "byok", async () => ({ selectedModelRef: "platform/auto", records: [] })),
    ).resolves.toBeNull();
  });
  it("uses the current source for an overall query with no selected message", async () => {
    const read = async () => ({ selectedModelRef: null, records: [] });
    await expect(localByokUsage({}, "byok", read)).resolves.toEqual([]);
    await expect(localByokUsage({}, "hosted", read)).resolves.toBeNull();
  });
});
