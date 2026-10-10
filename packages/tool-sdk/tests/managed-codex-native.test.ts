import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import {
  managedCodexRuntimeCacheKey,
  verifyManagedCodexRuntime,
} from "../src/managed-codex-runtime";

const directory = path.join(
  process.env.LOCALAPPDATA ?? "",
  "openerx-runtime-cache",
  "runtimes",
  managedCodexRuntimeCacheKey,
  `win32-${process.arch}`,
);
test.skipIf(process.platform !== "win32" || !existsSync(path.join(directory, "manifest.json")))(
  "runs the verified official binary without an external Codex or Node PATH",
  () => {
    const executable = verifyManagedCodexRuntime(
      path.join(directory, "files"),
      path.join(directory, "manifest.json"),
    );
    const output = execFileSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    });
    expect(output.trim()).toBe("codex-cli 0.162.0");
  },
);
