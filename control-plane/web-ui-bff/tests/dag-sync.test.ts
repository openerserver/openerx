import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { observeGraphWorkspaceDir, resolveGraphStorageDirs } from "../src/modules/realtime/dag-sync";

const tempPaths: string[] = [];

afterAll(() => {
  for (const tempPath of tempPaths) {
    rmSync(tempPath, { recursive: true, force: true });
  }
});

test("resolveGraphStorageDirs includes observed workspace task graph directory", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "openerx-dag-sync-"));
  const graphDir = join(workspaceDir, ".opencode", "state", "task-graphs");
  mkdirSync(graphDir, { recursive: true });
  tempPaths.push(workspaceDir);

  observeGraphWorkspaceDir(workspaceDir);

  expect(resolveGraphStorageDirs()).toContain(graphDir);
});

test("resolveGraphStorageDirs prefers explicit workspace directory when provided", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "openerx-dag-sync-preferred-"));
  const graphDir = join(workspaceDir, ".opencode", "state", "task-graphs");
  mkdirSync(graphDir, { recursive: true });
  tempPaths.push(workspaceDir);

  expect(resolveGraphStorageDirs(workspaceDir)).toContain(graphDir);
});