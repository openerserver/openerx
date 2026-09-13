import { createTwoFilesPatch } from "diff";

export interface WorkspacePatchHunk {
  anchor: string;
  lines: string[];
  endOfFile: boolean;
}

export type WorkspaceFilePatch =
  | { kind: "created"; path: string; content: string }
  | { kind: "deleted"; path: string }
  | { kind: "modified"; path: string; moveTo?: string; hunks: WorkspacePatchHunk[] };

function invalid(message: string): never {
  throw new Error(`WORKSPACE_PATCH_INVALID: ${message}`);
}

/** Parse the file-oriented context patch format; paths are authorized by the adapter. */
export function parseWorkspacePatch(patch: string): WorkspaceFilePatch[] {
  if (Buffer.byteLength(patch, "utf8") > 5_000_000) invalid("Patch exceeds 5 MB");
  if (patch.includes("\0")) invalid("NUL is not allowed");
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") {
    invalid("Expected Begin Patch and End Patch markers");
  }
  const files: WorkspaceFilePatch[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = lines[index++] ?? "";
    const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/u.exec(header);
    if (!match) invalid(`Expected a file operation: ${header}`);
    const action = match[1];
    const path = match[2] ?? "";
    if (!path.trim() || path.length > 2_048) invalid("Invalid file path");
    if (files.length >= 100) invalid("At most 100 files per patch");
    if (action === "Delete") {
      files.push({ kind: "deleted", path });
      continue;
    }
    if (action === "Add") {
      const content: string[] = [];
      while (index < lines.length && !lines[index]?.startsWith("*** ")) {
        const line = lines[index++] ?? "";
        if (!line.startsWith("+")) invalid("Added lines must start with +");
        content.push(line.slice(1));
      }
      files.push({
        kind: "created",
        path,
        content: content.length ? `${content.join("\n")}\n` : "",
      });
      continue;
    }
    let moveTo: string | undefined;
    if (lines[index]?.startsWith("*** Move to: ")) {
      moveTo = lines[index++]?.slice("*** Move to: ".length);
      if (!moveTo?.trim()) invalid("Move requires a destination");
    }
    const hunks: WorkspacePatchHunk[] = [];
    while (index < lines.length && !lines[index]?.startsWith("*** ")) {
      const marker = lines[index++] ?? "";
      if (marker !== "@@" && !marker.startsWith("@@ ")) invalid("Expected @@ before a hunk");
      const hunk: WorkspacePatchHunk = { anchor: marker.slice(3), lines: [], endOfFile: false };
      while (index < lines.length) {
        const line = lines[index] ?? "";
        if (line === "@@" || line.startsWith("@@ ") || line.startsWith("*** ")) break;
        if (!/^[ +-]/u.test(line)) invalid("Hunk lines must start with a space, +, or -");
        hunk.lines.push(line);
        index += 1;
      }
      if (lines[index] === "*** End of File") {
        hunk.endOfFile = true;
        index += 1;
      }
      if (!hunk.lines.length && !hunk.anchor) invalid("Empty hunk");
      hunks.push(hunk);
    }
    if (!hunks.length && !moveTo) invalid("Update requires a hunk or a rename");
    files.push({ kind: "modified", path, ...(moveTo ? { moveTo } : {}), hunks });
  }
  if (!files.length) invalid("Patch contains no files");
  return files;
}

function uniqueContext(
  lines: string[],
  context: string[],
  start: number,
  endOfFile: boolean,
  budget: { remaining: number },
): number {
  if (!context.length) {
    if (!lines.length) return 0;
    if (endOfFile) return lines.length;
    invalid("Insertion requires context or End of File");
  }
  // Trailing-space tolerance does not relax indentation or silently choose a duplicate.
  for (const trimEnd of [false, true]) {
    let found = -1;
    for (let index = start; index <= lines.length - context.length; index += 1) {
      if (endOfFile && index + context.length !== lines.length) continue;
      if (
        context.every((line, offset) => {
          if (--budget.remaining < 0)
            throw new Error("WORKSPACE_PATCH_TOO_COMPLEX: Split the patch into smaller edits");
          return trimEnd
            ? lines[index + offset]?.trimEnd() === line.trimEnd()
            : lines[index + offset] === line;
        })
      ) {
        if (found !== -1)
          throw new Error("WORKSPACE_PATCH_AMBIGUOUS: Add more context or an @@ anchor");
        found = index;
      }
    }
    if (found !== -1) return found;
  }
  throw new Error("WORKSPACE_PATCH_CONTEXT_MISMATCH: Read the file again and use current context");
}

export function applyWorkspaceHunks(before: string, hunks: WorkspacePatchHunk[]): string {
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  if (eol === "\r\n" && /(?<!\r)\n/u.test(before)) {
    invalid("Mixed line endings require an exact replacement");
  }
  const trailingNewline = before.endsWith("\n");
  const lines = before ? before.split(eol) : [];
  if (trailingNewline) lines.pop();
  const output: string[] = [];
  let cursor = 0;
  let copied = 0;
  const budget = { remaining: 2_000_000 };
  for (const hunk of hunks) {
    if (hunk.anchor) cursor = uniqueContext(lines, [hunk.anchor], cursor, false, budget) + 1;
    if (!hunk.lines.length) continue;
    const oldLines = hunk.lines.filter((line) => line[0] !== "+").map((line) => line.slice(1));
    const start =
      !oldLines.length && hunk.anchor && !hunk.endOfFile
        ? cursor
        : uniqueContext(lines, oldLines, cursor, hunk.endOfFile, budget);
    if (start < copied) invalid("Overlapping hunks");
    for (let index = copied; index < start; index += 1) output.push(lines[index] ?? "");
    let oldIndex = start;
    for (const line of hunk.lines) {
      if (line[0] === "+") output.push(line.slice(1));
      else if (line[0] === " ") output.push(lines[oldIndex++] ?? "");
      else oldIndex += 1;
    }
    copied = oldIndex;
    cursor = oldIndex;
  }
  for (let index = copied; index < lines.length; index += 1) output.push(lines[index] ?? "");
  return output.join(eol) + (output.length && trailingNewline ? eol : "");
}

/** A bounded contextual diff, including correct create/delete and rename headers. */
export function workspaceUnifiedDiff(
  relativePath: string,
  before: string | null,
  after: string | null,
  previousPath = relativePath,
): string {
  const patch = createTwoFilesPatch(
    before === null ? "/dev/null" : `a/${previousPath}`,
    after === null ? "/dev/null" : `b/${relativePath}`,
    before ?? "",
    after ?? "",
    undefined,
    undefined,
    { context: 3, timeout: 1_000 },
  );
  if (patch === undefined) throw new Error("WORKSPACE_DIFF_TOO_COMPLEX");
  if (Buffer.byteLength(patch, "utf8") > 5_000_000) throw new Error("WORKSPACE_DIFF_TOO_LARGE");
  return patch;
}
