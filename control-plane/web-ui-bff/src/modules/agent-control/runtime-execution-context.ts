import type { RuntimeRepoContext } from "./runtime-provider-types";

export type ExecutionContextOptions = {
  taskId?: string;
  projectId?: string;
  repoContext?: RuntimeRepoContext;
};

function appendExecutionContextLines(lines: string[], options?: ExecutionContextOptions): void {
  if (!options?.taskId || !options?.projectId) {
    return;
  }

  lines.push(
    "Execution context:",
    `- Opener-X task ID: ${options.taskId}`,
    `- Project ID: ${options.projectId}`,
  );
}

function appendRepoContextLines(lines: string[], repoContext?: RuntimeRepoContext): void {
  if (!repoContext) {
    return;
  }

  if (repoContext.repoName) lines.push(`- Repository: ${repoContext.repoName}`);
  if (repoContext.remoteUrl) lines.push(`- Remote URL: ${repoContext.remoteUrl}`);
  if (repoContext.workingBranch) lines.push(`- Working branch: ${repoContext.workingBranch}`);
  if (repoContext.gitAuthorName || repoContext.gitAuthorEmail) {
    lines.push(
      `- Git author: ${repoContext.gitAuthorName ?? ""} <${repoContext.gitAuthorEmail ?? ""}>`,
    );
  }
  if (repoContext.gitCommitterName || repoContext.gitCommitterEmail) {
    lines.push(
      `- Git committer: ${repoContext.gitCommitterName ?? ""} <${repoContext.gitCommitterEmail ?? ""}>`,
    );
  }
}

export function buildExecutionContext(options?: ExecutionContextOptions): string {
  const lines: string[] = [];
  appendExecutionContextLines(lines, options);
  appendRepoContextLines(lines, options?.repoContext);
  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}
