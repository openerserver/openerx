import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  exists: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
  runtime: vi.fn(),
}));
vi.mock("node:fs", () => ({
  existsSync: fakes.exists,
  realpathSync: fakes.realpath,
  statSync: fakes.stat,
}));
vi.mock("../src/managed-codex-runtime", () => ({
  managedCodexRuntimeCacheKey: "codex-0.162.0-1",
  readManagedCodexRuntimeState: fakes.runtime,
}));

import { windowsCodexRuntimeState } from "../src/windows-codex-runtime";

const originalResources = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const resources = path.resolve("fixture app resources");
beforeEach(() => {
  vi.clearAllMocks();
  fakes.exists.mockReturnValue(false);
  fakes.runtime.mockReturnValue({ error: "MANAGED_CODEX_RUNTIME_UNAVAILABLE" });
  fakes.stat.mockReturnValue({ isFile: () => true });
  fakes.realpath.mockImplementation((value: string) => value);
  Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true });
  vi.stubEnv("OPENERX_CODEX_EXECUTABLE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (originalResources) Object.defineProperty(process, "resourcesPath", originalResources);
  else Reflect.deleteProperty(process, "resourcesPath");
});
test("a packaged corrupt runtime cannot fall back to cache or an environment override", () => {
  const archive = path.join(resources, "app.asar");
  fakes.exists.mockImplementation((file: string) => file === archive);
  fakes.runtime.mockReturnValue({ error: "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED" });
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("OPENERX_CODEX_EXECUTABLE", path.resolve("external/codex.exe"));
  expect(windowsCodexRuntimeState()).toEqual({ error: "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED" });
  expect(fakes.runtime).toHaveBeenCalledExactlyOnceWith(
    path.join(`${archive}.unpacked`, "runtime", "codex", "files"),
    path.join(archive, "runtime", "codex", "manifest.json"),
  );
  expect(fakes.stat).not.toHaveBeenCalled();
});
test("production uses only the locked runtime resolver even when a valid external executable is configured", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OPENERX_CODEX_EXECUTABLE", path.resolve("external/codex.exe"));
  vi.stubEnv("LOCALAPPDATA", path.resolve("local app data"));
  fakes.runtime.mockReturnValue({ error: "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED" });
  expect(windowsCodexRuntimeState()).toEqual({ error: "MANAGED_CODEX_RUNTIME_INTEGRITY_FAILED" });
  expect(fakes.runtime).toHaveBeenCalledTimes(1);
  const [root, manifest] = fakes.runtime.mock.calls[0]!;
  expect(root).toContain(
    path.join(
      "openerx-runtime-cache",
      "runtimes",
      "codex-0.162.0-1",
      `${process.platform}-${process.arch}`,
    ),
  );
  expect(manifest).toBe(path.join(path.dirname(root), "manifest.json"));
  expect(fakes.stat).not.toHaveBeenCalled();
});
test("an invalid development override fails without trying the bundled development cache", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("OPENERX_CODEX_EXECUTABLE", "relative/codex.exe");
  expect(windowsCodexRuntimeState()).toEqual({ error: "MANAGED_CODEX_RUNTIME_UNAVAILABLE" });
  expect(fakes.runtime).not.toHaveBeenCalled();
});
test("an explicit test-only override preserves the absolute canonical executable", () => {
  vi.stubEnv("NODE_ENV", "test");
  const executable = path.resolve("external/codex.exe");
  vi.stubEnv("OPENERX_CODEX_EXECUTABLE", executable);
  expect(windowsCodexRuntimeState()).toEqual({ executable });
  expect(fakes.runtime).not.toHaveBeenCalled();
});
test("a utility process without resourcesPath uses the Electron executable resource directory", () => {
  Reflect.deleteProperty(process, "resourcesPath");
  const archive = path.join(path.dirname(process.execPath), "resources", "app.asar");
  fakes.exists.mockImplementation((file: string) => file === archive);
  windowsCodexRuntimeState();
  expect(fakes.runtime).toHaveBeenCalledExactlyOnceWith(
    path.join(`${archive}.unpacked`, "runtime", "codex", "files"),
    path.join(archive, "runtime", "codex", "manifest.json"),
  );
});
