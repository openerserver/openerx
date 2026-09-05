import { describe, expect, it, vi } from "vitest";
import { adaptForgePackagerOptions } from "../../scripts/forge-runner.mjs";

describe("Forge 7 to Packager 20 hook adapter", () => {
  it("preserves options and awaits callback hooks with their positional arguments", async () => {
    const hook = vi.fn((buildPath, version, platform, arch, done) => {
      expect([buildPath, version, platform, arch]).toEqual(["fixture", "44.0.0", "win32", "x64"]);
      setTimeout(done, 5);
    });
    const input = { asar: { unpack: "*.node" }, afterCopy: [hook] };
    const adapted = adaptForgePackagerOptions(input);
    await adapted.afterCopy[0]({
      buildPath: "fixture",
      electronVersion: "44.0.0",
      platform: "win32",
      arch: "x64",
    });
    expect(hook).toHaveBeenCalledOnce();
    expect(adapted.asar).toBe(input.asar);
    expect(input.afterCopy[0]).toBe(hook);
  });
  it("passes target arrays and propagates callback failures", async () => {
    const targets = [{ platform: "darwin", arch: "arm64" }];
    const adapter = adaptForgePackagerOptions({
      afterFinalizePackageTargets: [
        (input, done) => {
          expect(input).toBe(targets);
          done();
        },
      ],
      afterPrune: [(_path, _version, _platform, _arch, done) => done(new Error("hook-failed"))],
    });
    await adapter.afterFinalizePackageTargets[0](targets);
    await expect(adapter.afterPrune[0]({})).rejects.toThrow("hook-failed");
  });
});
