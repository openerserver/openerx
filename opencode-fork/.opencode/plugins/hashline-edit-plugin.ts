import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type Plugin, tool } from "@opencode-ai/plugin";

// ── Types ──────────────────────────────────────────────────────────

interface HashlineEntry {
  lineNumber: number;
  hash: string;
  content: string;
}

interface EditOperation {
  lineHash: string; // LINE#{lineNumber}#{hash6}
  newContent: string;
}

interface EditResult {
  success: boolean;
  filePath: string;
  linesEdited: number;
  errors: string[];
}

// ── Core Functions ─────────────────────────────────────────────────

const fileLocks = new Set<string>();

function computeLineHash(lineNumber: number, content: string): string {
  const input = `${lineNumber}:${content}`;
  return createHash("sha256").update(input).digest("hex").substring(0, 6);
}

function annotateFileContent(filePath: string): { annotated: string; entries: HashlineEntry[] } {
  if (!existsSync(filePath)) {
    return { annotated: `[Error] File not found: ${filePath}`, entries: [] };
  }

  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");
  const entries: HashlineEntry[] = [];
  const annotatedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const content = lines[i] ?? "";
    const hash = computeLineHash(lineNumber, content);
    entries.push({ lineNumber, hash, content });
    annotatedLines.push(`LINE#${lineNumber}#${hash} | ${content}`);
  }

  return { annotated: annotatedLines.join("\n"), entries };
}

function parseLineHash(hashStr: string): { lineNumber: number; hash: string } | null {
  const match = hashStr.match(/^LINE#(\d+)#([a-f0-9]{6})$/);
  if (!match) return null;
  const [, lineNumber, hash] = match;
  return { lineNumber: Number.parseInt(lineNumber, 10), hash };
}

function getLineContent(lines: string[], lineNumber: number): string | null {
  return lines[lineNumber - 1] ?? null;
}

function validateEditOperations(lines: string[], operations: EditOperation[]): string[] {
  const errors: string[] = [];

  for (const op of operations) {
    const parsed = parseLineHash(op.lineHash);
    if (!parsed) {
      errors.push(`Invalid hash format: ${op.lineHash}`);
      continue;
    }

    const { lineNumber, hash } = parsed;
    if (lineNumber < 1 || lineNumber > lines.length) {
      errors.push(`Line ${lineNumber} out of range (file has ${lines.length} lines)`);
      continue;
    }

    const currentContent = getLineContent(lines, lineNumber);
    if (currentContent === null) {
      errors.push(`Line ${lineNumber} out of range (file has ${lines.length} lines)`);
      continue;
    }

    const currentHash = computeLineHash(lineNumber, currentContent);
    if (currentHash !== hash) {
      errors.push(
        `Hash mismatch at line ${lineNumber}: expected ${hash}, got ${currentHash}. File has changed since last read. Please re-read the file.`,
      );
    }
  }

  return errors;
}

function applyEditOperations(lines: string[], operations: EditOperation[]): number {
  let linesEdited = 0;

  for (const op of operations) {
    const parsed = parseLineHash(op.lineHash);
    if (!parsed) {
      continue;
    }
    lines[parsed.lineNumber - 1] = op.newContent;
    linesEdited++;
  }

  return linesEdited;
}

function withFileLock<T>(filePath: string, callback: () => T): T | EditResult | string {
  if (fileLocks.has(filePath)) {
    return {
      success: false,
      filePath,
      linesEdited: 0,
      errors: ["File is locked by another edit operation. Please retry."],
    } satisfies EditResult;
  }

  fileLocks.add(filePath);
  try {
    return callback();
  } finally {
    fileLocks.delete(filePath);
  }
}

function collectDeletionTargets(lines: string[], hashes: string[]) {
  const linesToDelete = new Set<number>();
  const errors: string[] = [];

  for (const hash of hashes) {
    const parsed = parseLineHash(hash);
    if (!parsed) {
      errors.push(`Invalid hash: ${hash}`);
      continue;
    }

    const currentContent = getLineContent(lines, parsed.lineNumber);
    if (currentContent === null) {
      errors.push(`Line ${parsed.lineNumber} out of range`);
      continue;
    }

    const currentHash = computeLineHash(parsed.lineNumber, currentContent);
    if (currentHash !== parsed.hash) {
      errors.push(`Hash mismatch at line ${parsed.lineNumber}`);
      continue;
    }

    linesToDelete.add(parsed.lineNumber - 1);
  }

  return { linesToDelete, errors };
}

function validateAndApplyEdits(filePath: string, operations: EditOperation[]): EditResult {
  if (!existsSync(filePath)) {
    return { success: false, filePath, linesEdited: 0, errors: ["File not found"] };
  }

  const result = withFileLock(filePath, () => {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    const errors = validateEditOperations(lines, operations);

    if (errors.length > 0) {
      return { success: false, filePath, linesEdited: 0, errors };
    }

    const linesEdited = applyEditOperations(lines, operations);
    writeFileSync(filePath, lines.join("\n"), "utf-8");
    return { success: true, filePath, linesEdited, errors: [] };
  });

  return typeof result === "string"
    ? { success: false, filePath, linesEdited: 0, errors: [result] }
    : result;
}

// ── Plugin Export ──────────────────────────────────────────────────

export const HashlineEditPlugin: Plugin = async () => {
  return {
    tool: {
      hashline_read: tool({
        description:
          "Read a file with Hashline annotations. Each line is prefixed with LINE#{number}#{hash} for safe editing. Use the hash identifiers when calling hashline_edit.",
        args: {
          filePath: tool.schema.string("Absolute path to the file to read"),
        },
        async execute({ filePath }) {
          const { annotated } = annotateFileContent(filePath);
          return annotated;
        },
      }),

      hashline_edit: tool({
        description:
          "Edit file lines using Hashline verification. Each edit must reference the LINE#{number}#{hash} from a previous hashline_read. If the hash doesn't match (file changed), the edit is rejected and you must re-read.",
        args: {
          filePath: tool.schema.string("Absolute path to the file to edit"),
          operations: tool.schema.string(
            'JSON array of edits: [{"lineHash": "LINE#5#abc123", "newContent": "new line content"}]',
          ),
        },
        async execute({ filePath, operations: opsJson }) {
          const ops = JSON.parse(opsJson) as EditOperation[];
          if (ops.length === 0) {
            return JSON.stringify({ error: "No operations provided" });
          }
          const result = validateAndApplyEdits(filePath, ops);
          return JSON.stringify(result, null, 2);
        },
      }),

      hashline_insert: tool({
        description:
          "Insert new lines after a Hashline-verified anchor line. The anchor line hash must match current file state.",
        args: {
          filePath: tool.schema.string("Absolute path to the file"),
          afterLineHash: tool.schema.string(
            "LINE#{number}#{hash} of the anchor line to insert after",
          ),
          newLines: tool.schema.string("JSON array of new line contents to insert"),
        },
        async execute({ filePath, afterLineHash, newLines: linesJson }) {
          const newLines = JSON.parse(linesJson) as string[];
          const parsed = parseLineHash(afterLineHash);
          if (!parsed) {
            return JSON.stringify({ error: `Invalid hash format: ${afterLineHash}` });
          }

          if (!existsSync(filePath)) {
            return JSON.stringify({ error: "File not found" });
          }

          if (fileLocks.has(filePath)) {
            return JSON.stringify({ error: "File is locked" });
          }

          fileLocks.add(filePath);
          try {
            const raw = readFileSync(filePath, "utf-8");
            const lines = raw.split("\n");

            const { lineNumber, hash } = parsed;
            if (lineNumber < 1 || lineNumber > lines.length) {
              return JSON.stringify({ error: `Line ${lineNumber} out of range` });
            }

            const currentContent = getLineContent(lines, lineNumber);
            if (currentContent === null) {
              return JSON.stringify({ error: `Line ${lineNumber} out of range` });
            }

            const currentHash = computeLineHash(lineNumber, currentContent);
            if (currentHash !== hash) {
              return JSON.stringify({
                error: `Hash mismatch at line ${lineNumber}. File changed, please re-read.`,
              });
            }

            lines.splice(lineNumber, 0, ...newLines);
            writeFileSync(filePath, lines.join("\n"), "utf-8");

            return JSON.stringify({
              success: true,
              insertedAfterLine: lineNumber,
              linesInserted: newLines.length,
            });
          } finally {
            fileLocks.delete(filePath);
          }
        },
      }),

      hashline_delete: tool({
        description: "Delete lines by their Hashline identifiers (must match current state)",
        args: {
          filePath: tool.schema.string("Absolute path to the file"),
          lineHashes: tool.schema.string(
            "JSON array of LINE#{number}#{hash} identifiers to delete",
          ),
        },
        async execute({ filePath, lineHashes: hashesJson }) {
          const hashes = JSON.parse(hashesJson) as string[];
          if (!existsSync(filePath)) {
            return JSON.stringify({ error: "File not found" });
          }

          const result = withFileLock(filePath, () => {
            const raw = readFileSync(filePath, "utf-8");
            const lines = raw.split("\n");
            const { linesToDelete, errors } = collectDeletionTargets(lines, hashes);

            if (errors.length > 0) {
              return JSON.stringify({ success: false, errors });
            }

            const newLines = lines.filter((_, i) => !linesToDelete.has(i));
            writeFileSync(filePath, newLines.join("\n"), "utf-8");

            return JSON.stringify({
              success: true,
              linesDeleted: linesToDelete.size,
            });
          });

          if (typeof result !== "string") {
            return JSON.stringify(result);
          }

          return result;
        },
      }),
    },

    // Intercept read_file results to append hashline info hint
    "tool.execute.after": async (input) => {
      if (input.properties?.toolName === "read_file") {
        // Log that hashline-annotated read is available
        console.log("[hashline] Tip: Use hashline_read for safe editing with content verification");
      }
    },
  };
};

export default HashlineEditPlugin;
