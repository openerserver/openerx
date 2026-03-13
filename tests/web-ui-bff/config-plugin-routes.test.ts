import { describe, expect, test } from "bun:test";

import {
  getConfiguredPluginPaths,
  getDisabledPluginPaths,
  normalizePluginConfigPath,
  setConfiguredPluginState,
} from "../../control-plane/web-ui-bff/src/modules/config/routes";

describe("plugin config compatibility helpers", () => {
  test("reads active plugins from runtime plugin key first", () => {
    const config = {
      plugin: ["./.opencode/plugins/orchestrator-plugin.ts"],
      plugins: ["./.opencode/plugins/legacy-plugin.ts"],
      _disabledPlugins: ["./.opencode/plugins/tmux-plugin.ts"],
    } satisfies Record<string, unknown>;

    expect(getConfiguredPluginPaths(config)).toEqual([
      "./.opencode/plugins/orchestrator-plugin.ts",
    ]);
    expect(getDisabledPluginPaths(config)).toEqual(["./.opencode/plugins/tmux-plugin.ts"]);
  });

  test("falls back to legacy plugins key when runtime key is absent", () => {
    const config = {
      plugins: ["./.opencode/plugins/hashline-edit-plugin.ts"],
    } satisfies Record<string, unknown>;

    expect(getConfiguredPluginPaths(config)).toEqual([
      "./.opencode/plugins/hashline-edit-plugin.ts",
    ]);
  });

  test("writes back to runtime plugin key and removes legacy plugins key", () => {
    const config = {
      plugins: ["./.opencode/plugins/legacy-plugin.ts"],
    } satisfies Record<string, unknown>;

    setConfiguredPluginState(
      config,
      [
        "./.opencode/plugins/orchestrator-plugin.ts",
        "./.opencode/plugins/orchestrator-plugin.ts",
      ],
      ["./.opencode/plugins/tmux-plugin.ts"],
    );

    expect(config.plugin).toEqual(["./.opencode/plugins/orchestrator-plugin.ts"]);
    expect(config._disabledPlugins).toEqual(["./.opencode/plugins/tmux-plugin.ts"]);
    expect("plugins" in config).toBe(false);
  });

  test("normalizes installed plugin paths to runtime format", () => {
    expect(normalizePluginConfigPath("custom-plugin.ts")).toBe(
      "./.opencode/plugins/custom-plugin.ts",
    );
  });
});