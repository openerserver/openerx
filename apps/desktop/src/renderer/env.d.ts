import type { DesktopBridge } from "@openerx/contracts";

declare global {
  interface Window {
    openerx: DesktopBridge;
  }
}
