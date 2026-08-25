import { type DesktopBridge, desktopEnvironmentSchema, ipcChannels } from "@openerx/contracts";
import { contextBridge, ipcRenderer } from "electron";

const bridge: DesktopBridge = Object.freeze({
  getEnvironment: async () => {
    const result: unknown = await ipcRenderer.invoke(ipcChannels.environmentGet);
    return desktopEnvironmentSchema.parse(result);
  },
});

contextBridge.exposeInMainWorld("openerx", bridge);
