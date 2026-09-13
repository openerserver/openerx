import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { type FileAppService, FileServiceError } from "@openerx/file-service";
import type {
  ToolRepository,
  WorkspaceArtifactLink,
  WorkspaceOutputCandidate,
} from "@openerx/storage";

const maxOutputBytes = 50 * 1024 * 1024;
const unavailableCodes = new Set([
  "ENOENT",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "ELOOP",
  "WORKSPACE_GRANT_INACTIVE",
  "WORKSPACE_GRANT_NOT_FOUND",
  "WORKSPACE_GRANT_CONVERSATION_MISMATCH",
]);

function outputKey(
  output: Pick<WorkspaceArtifactLink, "conversationId" | "workspaceRootPath" | "relativePath">,
): string {
  return JSON.stringify([output.conversationId, output.workspaceRootPath, output.relativePath]);
}

function readOutput(candidate: WorkspaceOutputCandidate, tools: ToolRepository): Buffer | null {
  const grant = tools.activeWorkspaceGrant(candidate.workspaceGrantId, candidate.conversationId);
  const segments = candidate.relativePath.split(/[\\/]+/u);
  if (
    path.isAbsolute(candidate.relativePath) ||
    path.win32.isAbsolute(candidate.relativePath) ||
    segments.some((segment) => segment === ".." || segment === "." || !segment)
  )
    return null;
  const root = realpathSync(grant.rootPath);
  let selected = root;
  for (const segment of segments) {
    selected = path.join(selected, segment);
    if (lstatSync(selected).isSymbolicLink()) return null;
  }
  const resolved = realpathSync(selected);
  const relative = path.relative(root, resolved);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative === "..")
    return null;
  const descriptor = openSync(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxOutputBytes) return null;
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength > maxOutputBytes) return null;
    // A historical write must match the current file before it is imported.
    // Later user edits, failed writes and unrelated attachments are not outputs.
    return createHash("sha256").update(bytes).digest("hex") === candidate.afterSha256
      ? bytes
      : null;
  } finally {
    closeSync(descriptor);
  }
}

export function captureWorkspaceArtifacts(
  tools: ToolRepository,
  files: FileAppService,
  conversationId?: string,
): void {
  const existing = new Map(
    files.workspaceArtifactLinks(conversationId).map((link) => [outputKey(link), link]),
  );
  for (const candidate of tools.workspaceOutputCandidates(conversationId)) {
    if (
      !candidate.afterSha256 ||
      existing.get(outputKey(candidate))?.sourceRevision === candidate.sourceRevision
    )
      continue;
    try {
      const bytes = readOutput(candidate, tools);
      if (!bytes) continue;
      files.captureWorkspaceArtifact({
        conversationId: candidate.conversationId,
        workspaceRootPath: candidate.workspaceRootPath,
        relativePath: candidate.relativePath,
        sourceRevision: candidate.sourceRevision,
        bytes,
      });
    } catch (error) {
      // An unavailable workspace must not hide other, already captured results.
      if (
        error instanceof FileServiceError &&
        ["FILE_UNSUPPORTED", "FILE_TOO_LARGE"].includes(error.code)
      )
        continue;
      const code =
        error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? error.message) : "";
      if (unavailableCodes.has(code)) continue;
      throw error;
    }
  }
}
