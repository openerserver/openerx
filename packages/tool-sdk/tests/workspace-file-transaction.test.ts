import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceFileTransaction,
  reverseMutations,
  type WorkspaceFileMutation,
  workspaceFileMatches,
  workspaceFileModeMatches,
} from "../src/workspace-file-transaction";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("workspace file permission comparisons", () => {
  it("compares supported Windows attributes while retaining exact POSIX checks", () => {
    expect(workspaceFileModeMatches(0o666, 0o600, "win32")).toBe(true);
    expect(workspaceFileModeMatches(0o444, 0o400, "win32")).toBe(true);
    expect(workspaceFileModeMatches(0o444, 0o600, "win32")).toBe(false);
    expect(workspaceFileModeMatches(0o666, 0o400, "win32")).toBe(false);
    expect(workspaceFileModeMatches(0o666, 0o600, "linux")).toBe(false);
    expect(workspaceFileModeMatches(0o644, 0o600, "darwin")).toBe(false);
    expect(workspaceFileModeMatches(0o751, 0o751, "linux")).toBe(true);
  });

  it("undoes a newly created file but refuses changed content or a read-only change", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-file-mode-"));
    directories.push(directory);
    const target = path.join(directory, "created.txt");
    const mutations: WorkspaceFileMutation[] = [
      {
        workspaceGrantId: "fixture",
        relativePath: "created.txt",
        beforeText: null,
        afterText: "created",
        afterMode: 0o600,
      },
    ];
    applyWorkspaceFileTransaction(mutations, () => target);
    expect(workspaceFileMatches(target, "created", 0o600)).toBe(true);
    expect(workspaceFileMatches(target, "different", 0o600)).toBe(false);
    chmodSync(target, 0o400);
    try {
      expect(() =>
        applyWorkspaceFileTransaction(reverseMutations(mutations), () => target),
      ).toThrow("WORKSPACE_CHANGE_SET_CONFLICT");
      expect(readFileSync(target, "utf8")).toBe("created");
    } finally {
      chmodSync(target, 0o600);
    }
    applyWorkspaceFileTransaction(reverseMutations(mutations), () => target);
    expect(existsSync(target)).toBe(false);
  });
});
