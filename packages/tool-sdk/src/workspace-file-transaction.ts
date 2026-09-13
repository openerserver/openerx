import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { WorkspaceChangeSetEntry } from "@openerx/contracts";

export interface WorkspaceFileMutation {
  workspaceGrantId: string;
  relativePath: string;
  beforeText: string | null;
  afterText: string | null;
  beforeMode?: number;
  afterMode?: number;
}

export function readWorkspaceText(target: string): string {
  if (statSync(target).size > 5_000_000) throw new Error("WORKSPACE_FILE_TOO_LARGE");
  const bytes = readFileSync(target);
  if (bytes.includes(0)) throw new Error("WORKSPACE_BINARY_FILE_UNSUPPORTED");
  try {
    // Preserve a UTF-8 BOM and reject lossy decoding of binary/non-UTF-8 files.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("WORKSPACE_BINARY_FILE_UNSUPPORTED");
  }
}

export function atomicWorkspaceWrite(target: string, content: string, mode?: number): void {
  const temporary = path.join(path.dirname(target), `.openerx-${randomUUID()}.tmp`);
  const fileMode = mode ?? (existsSync(target) ? statSync(target).mode & 0o7777 : 0o600);
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: fileMode, flag: "wx" });
    chmodSync(temporary, fileMode);
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function changeSetMutations(entries: WorkspaceChangeSetEntry[]): WorkspaceFileMutation[] {
  return entries.flatMap((entry): WorkspaceFileMutation[] => {
    if (!entry.applySupported || entry.entryType !== "file") {
      throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
    }
    if (entry.kind === "renamed") {
      if (!entry.previousRelativePath) throw new Error("WORKSPACE_CHANGE_SET_BLOCKED");
      return [
        {
          workspaceGrantId: entry.workspaceGrantId,
          relativePath: entry.previousRelativePath,
          beforeText: entry.beforeText,
          afterText: null,
          beforeMode: entry.beforeMode,
        },
        {
          workspaceGrantId: entry.workspaceGrantId,
          relativePath: entry.relativePath,
          beforeText: null,
          afterText: entry.afterText,
          afterMode: entry.afterMode ?? entry.beforeMode,
        },
      ];
    }
    return [
      {
        workspaceGrantId: entry.workspaceGrantId,
        relativePath: entry.relativePath,
        beforeText: entry.beforeText,
        afterText: entry.afterText,
        beforeMode: entry.beforeMode,
        afterMode: entry.afterMode,
      },
    ];
  });
}

export function reverseMutations(mutations: WorkspaceFileMutation[]): WorkspaceFileMutation[] {
  return [...mutations].reverse().map((mutation) => ({
    ...mutation,
    beforeText: mutation.afterText,
    afterText: mutation.beforeText,
    beforeMode: mutation.afterMode,
    afterMode: mutation.beforeMode,
  }));
}

export function workspaceFileMatches(target: string, text: string | null, mode?: number): boolean {
  if (!existsSync(target)) return text === null;
  return (
    text !== null &&
    readWorkspaceText(target) === text &&
    (mode === undefined || (statSync(target).mode & 0o7777) === mode)
  );
}

/** Preflight every file, recheck before each write, and compensate only our own writes. */
export function applyWorkspaceFileTransaction(
  mutations: WorkspaceFileMutation[],
  resolve: (mutation: WorkspaceFileMutation) => string,
): void {
  const targets = new Set<string>();
  for (const mutation of mutations) {
    const target = resolve(mutation);
    const key = process.platform === "linux" ? target : target.toLowerCase();
    if (targets.has(key)) throw new Error("WORKSPACE_PATCH_DUPLICATE_PATH");
    targets.add(key);
    if (!workspaceFileMatches(target, mutation.beforeText, mutation.beforeMode)) {
      throw new Error(`WORKSPACE_CHANGE_SET_CONFLICT: ${mutation.relativePath}`);
    }
  }
  const applied: WorkspaceFileMutation[] = [];
  const write = (mutation: WorkspaceFileMutation) => {
    let target = resolve(mutation);
    if (!workspaceFileMatches(target, mutation.beforeText, mutation.beforeMode)) {
      throw new Error(`WORKSPACE_CHANGE_SET_CONFLICT: ${mutation.relativePath}`);
    }
    if (mutation.afterText === null) {
      if (existsSync(target)) unlinkSync(target);
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      target = resolve(mutation);
      if (!workspaceFileMatches(target, mutation.beforeText, mutation.beforeMode)) {
        throw new Error(`WORKSPACE_CHANGE_SET_CONFLICT: ${mutation.relativePath}`);
      }
      atomicWorkspaceWrite(target, mutation.afterText, mutation.afterMode);
    }
  };
  try {
    for (const mutation of mutations) {
      write(mutation);
      applied.push(mutation);
    }
  } catch (error) {
    let recovered = true;
    for (const mutation of reverseMutations(applied)) {
      try {
        write(mutation);
      } catch {
        recovered = false;
      }
    }
    if (!recovered) throw new Error("WORKSPACE_CHANGE_SET_RECOVERY_REQUIRED", { cause: error });
    throw error;
  }
}
