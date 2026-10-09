export type WorkspaceAccessMode = "personal" | "enterprise" | "resolving";

/** Personal reads, writes and inference share one authority boundary. */
export function assertPersonalWorkspaceAllowed(mode: WorkspaceAccessMode): void {
  if (mode !== "personal") throw new Error("ENTERPRISE_WORKSPACE_REQUIRED");
}

// Enterprise data and execution belong to the scoped enterprise controller.
// Never expose the personal database or BYOK runtime while that authority is active.
export function assertWorkspaceExecutionAllowed(mode: WorkspaceAccessMode, _command: string): void {
  assertPersonalWorkspaceAllowed(mode);
}

export function assertWorkspaceRemoteAllowed(
  mode: WorkspaceAccessMode,
  _payload?: { kind: string; decision?: string },
): void {
  assertPersonalWorkspaceAllowed(mode);
}
