import type { ReactNode } from "react";

declare const __OPENERX_BRAND__: { platformAccountEnabled?: boolean } | undefined;
// UWA's real shared App retains its edition branches without accessing a central account.
export const desktopExtensionLabel =
  typeof __OPENERX_BRAND__ === "undefined" || __OPENERX_BRAND__.platformAccountEnabled !== false
    ? null
    : "UWA";
export const desktopMcpPresets = [];
export const useDesktopExtensionSignedIn = () => (desktopExtensionLabel ? true : null);
export const DesktopExtensionWorkspaceBoundary = ({ children }: { children: ReactNode }) =>
  children;
export const DesktopExtensionSettings = () => null;
export const DesktopExtensionNotice = () => null;
