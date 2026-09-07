import { describe, expect, it, vi } from "vitest";
import { adaptForgePackagerOptions, runForgeCliAction } from "../../scripts/forge-runner.mjs";

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

describe("Forge CLI action dispatch", () => {
  it("explicitly invokes and awaits make with the parsed CLI options", async () => {
    const options = { dir: "fixture", arch: "x64", skipPackage: true, interactive: true };
    const getMakeOptions = vi.fn(async () => options);
    const initializeProxy = vi.fn();
    let complete: () => void = () => {};
    const make = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const modules = {
      "make-entry": { getMakeOptions },
      "@electron/get": { initializeProxy },
      "@electron-forge/core": { api: { make } },
    };
    const require = vi.fn((name: keyof typeof modules) => modules[name]);
    let finished = false;
    const running = runForgeCliAction("make", "make-entry", require).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(getMakeOptions).toHaveBeenCalledOnce();
    expect(initializeProxy).toHaveBeenCalledOnce();
    expect(make).toHaveBeenCalledExactlyOnceWith(options);
    expect(finished).toBe(false);
    complete();
    await running;
    expect(finished).toBe(true);
  });

  it("propagates make failures instead of reporting successful completion", async () => {
    const require = (name: string) => {
      if (name === "make-entry") return { getMakeOptions: async () => ({}) };
      if (name === "@electron/get") return { initializeProxy: () => {} };
      return {
        api: {
          make: async () => {
            throw new Error("MAKE_FAILED");
          },
        },
      };
    };
    await expect(runForgeCliAction("make", "make-entry", require)).rejects.toThrow("MAKE_FAILED");
  });

  it.each(["start", "package"])("loads the self-running %s entry only once", async (action) => {
    const require = vi.fn(() => ({}));
    await runForgeCliAction(action, "cli-entry", require);
    expect(require).toHaveBeenCalledExactlyOnceWith("cli-entry");
  });
});
