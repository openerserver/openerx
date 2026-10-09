import type { DesktopBridge } from "@openerx/contracts";

let workspaceBridge: DesktopBridge | null = null;
const draftScopes = new WeakMap<DesktopBridge, object>();
export type DesktopWorkspaceCapabilities = {
  mode: "personal" | "enterprise";
  toolProviderSettings: boolean;
  directoryImport: boolean;
  projectDirectories: boolean;
  additionalDirectories: boolean;
  customWorkspaceExpiry: boolean;
  automationRetryPolicies: readonly ("none" | "transient_3")[];
};
const personalCapabilities: DesktopWorkspaceCapabilities = {
  mode: "personal",
  toolProviderSettings: true,
  directoryImport: true,
  projectDirectories: true,
  additionalDirectories: true,
  customWorkspaceExpiry: true,
  automationRetryPolicies: ["none", "transient_3"],
};
export const enterpriseWorkspaceCapabilities: DesktopWorkspaceCapabilities = Object.freeze({
  mode: "enterprise",
  toolProviderSettings: true,
  directoryImport: false,
  projectDirectories: false,
  additionalDirectories: false,
  customWorkspaceExpiry: false,
  automationRetryPolicies: ["none"] as const,
});
const workspaceCapabilities = new WeakMap<DesktopBridge, DesktopWorkspaceCapabilities>();

/** Edition hosts register their scoped data/execution bridge before mounting workspace pages. */
export function setDesktopWorkspaceBridge(
  bridge: DesktopBridge | null,
  draftScope?: object,
  capabilities?: DesktopWorkspaceCapabilities,
): void {
  if (bridge && draftScope) draftScopes.set(bridge, draftScope);
  if (bridge && capabilities) workspaceCapabilities.set(bridge, capabilities);
  workspaceBridge = bridge;
}

/** Presentation follows the active host's supported contracts, never a failed IPC probe. */
export function desktopWorkspaceCapabilities(): DesktopWorkspaceCapabilities {
  return workspaceCapabilities.get(desktopWorkspaceBridge()) ?? personalCapabilities;
}

/** Hosts may reuse an opaque draft scope only after revalidating the same identity. */
export function desktopWorkspaceDraftScope(bridge: DesktopBridge): object {
  return draftScopes.get(bridge) ?? bridge;
}

/** Personal desktops use the preload bridge; enterprise hosts register a fail-closed adapter. */
export function desktopWorkspaceBridge(): DesktopBridge {
  return workspaceBridge ?? (window as unknown as { openerx: DesktopBridge }).openerx;
}
