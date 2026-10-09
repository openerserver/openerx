import type { ProjectDetail, ProjectSummary } from "@openerx/contracts";
import { desktopWorkspaceBridge } from "@openerx/desktop-ui/workspace-bridge";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const projectKeys = {
  root: ["projects"] as const,
  list: (includeArchived: boolean) => ["projects", "list", includeArchived] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
};

export function useProjectList(includeArchived = false): UseQueryResult<ProjectSummary[]> {
  return useQuery({
    queryKey: projectKeys.list(includeArchived),
    queryFn: () => desktopWorkspaceBridge().listProjects({ includeArchived }),
  });
}

export function useProject(projectId: string): UseQueryResult<ProjectDetail> {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => desktopWorkspaceBridge().getProject({ projectId }),
    enabled: projectId.length > 0,
  });
}
