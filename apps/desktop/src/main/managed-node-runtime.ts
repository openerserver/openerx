import os from "node:os";
import path from "node:path";
import {
  type ManagedNodeRuntimeState,
  managedNodeRuntimeCacheKey,
  readManagedNodeRuntimeState,
} from "@openerx/tool-sdk";
import { app } from "electron";

let runtime: ManagedNodeRuntimeState | undefined;
/** Called only in Main. Packaged startup is offline and cannot fall back to system Node. */
export function desktopNodeRuntimeState(): ManagedNodeRuntimeState {
  if (runtime) return runtime;
  const directory = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "runtime", "node")
    : path.join(
        process.platform === "win32" && process.env.LOCALAPPDATA
          ? process.env.LOCALAPPDATA
          : path.join(os.homedir(), ".cache"),
        "openerx-runtime-cache",
        "runtimes",
        managedNodeRuntimeCacheKey,
        `${process.platform}-${process.arch}`,
      );
  const manifest = app.isPackaged
    ? path.join(app.getAppPath(), "runtime", "node", "manifest.json")
    : path.join(directory, "manifest.json");
  runtime = readManagedNodeRuntimeState(path.join(directory, "files"), manifest);
  return runtime;
}
