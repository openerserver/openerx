import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";

export function requestMacScreenCapture(): boolean {
  const nativeDirectory = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "native")
    : path.join(app.getAppPath(), ".native-build");
  const load = createRequire(path.join(app.getAppPath(), "package.json"));
  const native = load(path.join(nativeDirectory, "openerx-screen-permission.node"));
  const granted: unknown = native.requestScreenCapture();
  if (typeof granted !== "boolean") throw new Error("DESKTOP_NATIVE_PERMISSION_REQUEST_INVALID");
  return granted;
}
