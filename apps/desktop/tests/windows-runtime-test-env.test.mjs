import { describe, expect, it } from "vitest";
import { buildWindowsRuntimeTestEnvironment } from "../scripts/windows-runtime-test-env.mjs";

describe("ordinary Windows runtime test environment", () => {
  it("uses only the Machine+User PATH even when the test runner has development tools and overrides", () => {
    const source = {
      Path: "C:\\codex-build-node;C:\\developer-npm",
      SYSTEMROOT: "C:\\Windows",
      APPDATA: "C:\\Users\\qa\\AppData\\Roaming",
      OPENERX_WINDOWS_SANDBOX_BACKEND: "mxc",
      OPENERX_CODEX_EXECUTABLE: "C:\\developer-codex.exe",
      OPENERX_NODE_EXECUTABLE: "C:\\developer-node.exe",
      OPENERX_E2E: "1",
      NODE_PATH: "C:\\developer-node-modules",
      NODE_OPTIONS: "--require C:\\developer-hook.js",
      ELECTRON_RUN_AS_NODE: "1",
      npm_config_prefix: "C:\\developer-npm",
      SECRET_TOKEN: "must-not-inherit",
    };
    const result = buildWindowsRuntimeTestEnvironment({
      env: source,
      machinePath: "C:\\Windows\\System32",
      userPath: "C:\\Users\\qa\\WindowsApps",
    });
    expect(result).toEqual({
      PATH: "C:\\Windows\\System32;C:\\Users\\qa\\WindowsApps",
      SystemRoot: source.SYSTEMROOT,
      APPDATA: source.APPDATA,
    });
    expect(source.OPENERX_WINDOWS_SANDBOX_BACKEND).toBe("mxc");
  });

  it("accepts an absent user PATH but refuses an ambiguous or empty snapshot", () => {
    expect(
      buildWindowsRuntimeTestEnvironment({ env: {}, machinePath: "C:\\Windows", userPath: "" }),
    ).toEqual({ PATH: "C:\\Windows" });
    expect(() =>
      buildWindowsRuntimeTestEnvironment({ env: {}, machinePath: undefined, userPath: "" }),
    ).toThrow("PATH_SNAPSHOT_REQUIRED");
    expect(() =>
      buildWindowsRuntimeTestEnvironment({ env: {}, machinePath: "", userPath: "" }),
    ).toThrow("PATH_EMPTY");
  });
});
