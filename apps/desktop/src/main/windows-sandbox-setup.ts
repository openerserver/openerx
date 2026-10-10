import {
  type WindowsSandboxSetupResult,
  windowsSandboxSetupResultSchema,
} from "@openerx/contracts";
import { assertTrustedIpcSender } from "./ipc-security";

/** A host setup action, separate from chat execution and workspace authorization. */
export function createWindowsSandboxSetupHandler(
  setup: () => Promise<WindowsSandboxSetupResult>,
): (event: Electron.IpcMainInvokeEvent) => Promise<WindowsSandboxSetupResult> {
  return async (event) => {
    assertTrustedIpcSender(event);
    return windowsSandboxSetupResultSchema.parse(await setup());
  };
}
