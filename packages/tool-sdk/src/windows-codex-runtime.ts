import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { managedCodexRuntimeCacheKey, readManagedCodexRuntimeState } from "./managed-codex-runtime";

/** Trusted application paths only. A packaged app never downloads or scans user installations. */
export function windowsCodexRuntimeState(): ReturnType<typeof readManagedCodexRuntimeState> {
  const resources =
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ??
    path.join(path.dirname(process.execPath), "resources");
  const archive = path.join(resources, "app.asar");
  if (existsSync(archive))
    return readManagedCodexRuntimeState(
      path.join(`${archive}.unpacked`, "runtime", "codex", "files"),
      path.join(archive, "runtime", "codex", "manifest.json"),
    );
  const configured = process.env.OPENERX_CODEX_EXECUTABLE;
  if (configured && ["development", "test"].includes(process.env.NODE_ENV ?? "")) {
    try {
      if (path.isAbsolute(configured) && statSync(configured).isFile())
        return { executable: realpathSync(configured) };
    } catch {
      // An explicit development override must not fall back to another executable.
    }
    return { error: "MANAGED_CODEX_RUNTIME_UNAVAILABLE" };
  }
  const directory = path.join(
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? process.env.LOCALAPPDATA
      : path.join(os.homedir(), ".cache"),
    "openerx-runtime-cache",
    "runtimes",
    managedCodexRuntimeCacheKey,
    `${process.platform}-${process.arch}`,
  );
  return readManagedCodexRuntimeState(
    path.join(directory, "files"),
    path.join(directory, "manifest.json"),
  );
}
