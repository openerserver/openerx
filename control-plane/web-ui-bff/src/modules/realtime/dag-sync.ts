let observedWorkspaceDir: string | null = null;

export function observeGraphWorkspaceDir(directory?: string | null): void {
  observedWorkspaceDir = typeof directory === "string" && directory.trim() ? directory.trim() : null;
}

export function resolveGraphStorageDirs(): string[] {
  if (!observedWorkspaceDir) {
    return [];
  }

  return [`${observedWorkspaceDir}/.opencode/state/task-graphs`];
}

export async function onGraphToolExecuted(): Promise<void> {
  return;
}

export async function syncAllGraphs(): Promise<number> {
  return 0;
}

export async function syncGraphsForTask(): Promise<number> {
  return 0;
}

export async function syncGraphsForSessionTask(
  _taskId: string,
  _sessionId?: string,
): Promise<{ synced: number; messages: unknown[] }> {
  return { synced: 0, messages: [] };
}
