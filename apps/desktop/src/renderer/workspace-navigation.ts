export type DesktopWorkspaceMode = "personal" | "enterprise";

export function workspaceHomePath(_mode: DesktopWorkspaceMode): string {
  return "/chat/new";
}

export function workspaceSettingsSection(
  mode: DesktopWorkspaceMode,
  section: string | null,
): string | null {
  if (mode !== "enterprise") return section;
  if (["model", "assistants", "memory"].includes(section ?? "")) return "enterprise";
  if (["account", "billing", "remote"].includes(section ?? "")) return "extension";
  return section;
}

// An edition's navigation policy never grants membership or model authority.
// Both editions use the existing workspace pages; the registered bridge owns data scope.
export function workspaceNavigationTarget(input: {
  mode: DesktopWorkspaceMode;
  signedIn: boolean | null;
  pathname: string;
  search: string;
  justSignedIn?: boolean;
}): string | null {
  if (input.mode === "personal" || input.signedIn === null) return null;
  if (input.justSignedIn) return workspaceHomePath(input.mode);
  if (input.pathname.startsWith("/settings")) {
    const params = new URLSearchParams(input.search);
    const requested = params.get("section");
    const section = workspaceSettingsSection(input.mode, requested);
    if (section !== requested && section) {
      params.set("section", section);
      return `/settings/account?${params}`;
    }
    if (input.pathname === "/settings") {
      if (!requested) params.set("section", "extension");
      return `/settings/account?${params}`;
    }
    if (input.pathname !== "/settings/account") return "/settings/account?section=extension";
    return null;
  }
  if (!input.signedIn) return "/settings/account?section=extension";
  if (input.pathname === "/enterprise" || input.pathname.startsWith("/enterprise/")) {
    return workspaceHomePath(input.mode);
  }
  return null;
}
