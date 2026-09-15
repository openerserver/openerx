import type { BrowserComputerUseOperationV2, BrowserMode } from "@openerx/contracts";
import { BrowserObservationError } from "./ui-observation-registry";

type OpenRequest = Extract<BrowserComputerUseOperationV2, { action: "open" }>;
/** Selection happens before creating a session. Never retry another profile after failure. */
export function routeBrowserOpen(
  request: OpenRequest,
  mode: BrowserMode,
  tabs: readonly { url: string; browserContextRef: string }[],
): OpenRequest {
  if (
    mode === "managed_chromium" &&
    (request.browserContextRef || request.requestedBackend === "system_default")
  )
    throw new BrowserObservationError("BROWSER_BACKEND_DOWNGRADE_REJECTED");
  if (request.browserContextRef || request.requestedBackend) return request;
  const matches = tabs.filter((tab) => new URL(tab.url).href === new URL(request.url).href);
  if ((mode === "auto" || mode === "connected_chrome") && matches.length === 1)
    return { ...request, browserContextRef: matches[0]!.browserContextRef };
  if (mode === "connected_chrome" || (mode === "auto" && matches.length > 1))
    throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
  return {
    ...request,
    requestedBackend: mode === "os_accessibility" ? "system_default" : "managed_chromium",
  };
}
