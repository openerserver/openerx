import { cpFetch } from "../../lib/control-plane-client";
import { getSessionMessages } from "../agent-control/opencode-adapter";

// ── Change Collector ───────────────────────────────────────────────
// Collects file-level code changes from OpenCode session messages
// and posts them to the Control Plane as a code_change record.

const FILE_EDIT_TOOLS = new Set([
  "edit_file",
  "hashline_edit",
  "write_to_file",
  "create_file",
  "delete_file",
  "replace_in_file",
  "str_replace_editor",
]);

interface FileChangeEntry {
  filePath: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  insertions: number;
  deletions: number;
}

interface SessionToolPart {
  type: string;
  toolName?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: string;
}

interface SessionMessage {
  parts?: SessionToolPart[];
}

function accumulateFileChange(fileMap: Map<string, FileChangeEntry>, part: SessionToolPart): void {
  if (part.type !== "tool" || !part.toolName || part.state !== "completed") return;
  if (!FILE_EDIT_TOOLS.has(part.toolName)) return;

  const filePath = extractFilePath(part.toolName, part.input);
  if (!filePath) return;

  const existing = fileMap.get(filePath);
  if (existing) {
    existing.insertions += estimateInsertions(part.output);
    existing.deletions += estimateDeletions(part.output);
    return;
  }

  fileMap.set(filePath, {
    filePath,
    changeType: inferChangeType(part.toolName, filePath, fileMap),
    insertions: estimateInsertions(part.output),
    deletions: estimateDeletions(part.output),
  });
}

function collectFileChanges(messages: SessionMessage[]): FileChangeEntry[] {
  const fileMap = new Map<string, FileChangeEntry>();

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      accumulateFileChange(fileMap, part);
    }
  }

  return Array.from(fileMap.values());
}

function buildChangeSummary(files: FileChangeEntry[]): string {
  const totalInsertions = files.reduce((sum, file) => sum + file.insertions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return `${files.length} 个文件变更 (+${totalInsertions} -${totalDeletions})`;
}

/**
 * Collect code changes from a completed session and persist them.
 * Called after task completion.
 */
export async function collectChangesFromSession(params: {
  taskId: string;
  sessionId: string;
  repoId?: string | null;
  agentRunId?: string | null;
  authorization: string;
}): Promise<{ ok: boolean; changeId?: string; error?: string }> {
  try {
    const msgResult = await getSessionMessages(params.sessionId, {
      taskId: params.taskId,
      authorization: params.authorization,
    });
    if (!msgResult.ok || !Array.isArray(msgResult.data)) {
      return { ok: false, error: "Failed to fetch session messages" };
    }

    const files = collectFileChanges(msgResult.data as SessionMessage[]);
    if (files.length === 0) {
      return { ok: true }; // No file changes detected
    }

    const result = await cpFetch<{ id: string }>("/api/code-changes", {
      method: "POST",
      authorization: params.authorization,
      body: {
        taskId: params.taskId,
        repoId: params.repoId || undefined,
        agentRunId: params.agentRunId || undefined,
        changeSource: "runtime_diff",
        summary: buildChangeSummary(files),
        files,
      },
    });

    if (!result.ok) {
      return { ok: false, error: `CP code-changes creation failed: ${result.status}` };
    }

    // Trigger governance evaluation (fire-and-forget)
    if (result.data?.id) {
      cpFetch(`/api/governance/evaluate/${encodeURIComponent(result.data.id)}`, {
        method: "POST",
        authorization: params.authorization,
      }).catch((err) => {
        console.error(`Governance evaluation failed for change ${result.data?.id}:`, err);
      });
    }

    return { ok: true, changeId: result.data?.id };
  } catch (error) {
    console.error(`Change collection failed for task ${params.taskId}:`, error);
    return { ok: false, error: String(error) };
  }
}

function extractFilePath(_toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  // Different tools use different param names for file path
  const candidates = ["filePath", "file_path", "path", "target_file", "file"];
  for (const key of candidates) {
    if (typeof input[key] === "string" && input[key]) {
      return input[key] as string;
    }
  }
  return undefined;
}

function inferChangeType(
  toolName: string,
  filePath: string,
  existingFiles: Map<string, FileChangeEntry>,
): "added" | "modified" | "deleted" {
  if (toolName === "delete_file") return "deleted";
  if (toolName === "create_file" || toolName === "write_to_file") {
    return existingFiles.has(filePath) ? "modified" : "added";
  }
  return "modified";
}

function estimateInsertions(output?: string): number {
  if (!output) return 1;
  // Rough heuristic: count lines in output that look like additions
  const lines = output.split("\n").length;
  return Math.max(1, Math.ceil(lines / 3));
}

function estimateDeletions(output?: string): number {
  if (!output) return 0;
  const lines = output.split("\n").length;
  return Math.max(0, Math.ceil(lines / 6));
}
