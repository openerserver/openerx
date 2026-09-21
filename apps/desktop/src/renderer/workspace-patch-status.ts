import {
  type ToolCall,
  type WorkspaceEditSummary,
  workspacePatchRecoveryMessage,
} from "@openerx/contracts";

// Match patch contents, not just filenames: an unrelated later write is not recovery.
// Deliberately conservative when the model regenerates a different context patch.
function patchIntents(call: ToolCall): Map<string, string> {
  const input = call.input;
  if (input?.operation === "workspace_apply_patch") {
    return new Map([
      [
        input.relativePath,
        JSON.stringify([input.expectedSha256, input.replacements, input.instructionDigests]),
      ],
    ]);
  }
  if (input?.operation !== "workspace_patch") return new Map();
  const lines = input.patch.replace(/\r\n/g, "\n").trimEnd().split("\n");
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") return new Map();
  const intents = new Map<string, string>();
  let target: string | null = null;
  let block: string[] = [];
  const save = () => {
    if (target) intents.set(target, block.join("\n"));
  };
  for (const line of lines) {
    const header = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      save();
      target = header[1] ?? null;
      block = [line];
    } else if (target) {
      block.push(line);
    } else {
      return new Map();
    }
  }
  save(); // In a rejected Delete+Add replacement, only the final Add is the intent.
  return intents;
}

export function workspacePatchStatus(
  call: ToolCall,
  calls: readonly ToolCall[],
  edits: readonly WorkspaceEditSummary[],
): { label: string; message: string; recovered: boolean } | null {
  const input = call.input;
  if (input?.operation !== "workspace_patch" && input?.operation !== "workspace_apply_patch")
    return null;
  const recovery =
    call.status === "failed" && call.errorCode
      ? workspacePatchRecoveryMessage(call.errorCode)
      : null;
  // Older versions incorrectly persisted these no-write outcomes as completed.
  const legacy =
    call.status === "completed" &&
    call.resultSummary === "工作区补丁需要先完成前置读取，未写入文件";
  if (!recovery && !legacy) return null;
  const intents = patchIntents(call);
  const remaining = new Set(intents.keys());
  const completedAt = call.completedAt;
  for (const candidate of calls) {
    const next = candidate.input;
    if (
      !completedAt ||
      candidate.id === call.id ||
      candidate.runId !== call.runId ||
      candidate.status !== "completed" ||
      candidate.errorCode ||
      !candidate.startedAt ||
      candidate.startedAt < completedAt ||
      !candidate.completedAt ||
      next?.operation !== input.operation ||
      next.workspaceGrantId !== input.workspaceGrantId
    )
      continue;
    const nextIntents = patchIntents(candidate);
    for (const part of candidate.resultContent) {
      if (part.type !== "diff") continue;
      const applied = edits.some(
        (edit) =>
          edit.id === part.workspaceChangeId &&
          edit.workspaceGrantId === input.workspaceGrantId &&
          edit.status === "applied" &&
          edit.relativePaths.includes(part.relativePath),
      );
      if (
        applied &&
        intents.has(part.relativePath) &&
        nextIntents.get(part.relativePath) === intents.get(part.relativePath)
      )
        remaining.delete(part.relativePath);
    }
  }
  const recovered = intents.size > 0 && remaining.size === 0;
  return {
    recovered,
    label: recovered ? "后续重试成功" : "未写入 · 需修正后重试",
    message: recovered
      ? "此调用当时未写入；相同补丁内容已在本轮后续调用中成功写入。原始记录保留供核查。"
      : (recovery ?? "此调用没有写入文件。请检查前置读取或补丁格式，修正后重试。"),
  };
}
