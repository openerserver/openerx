import { afterAll, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.restore();

async function loadDagSyncModule() {
  return import("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync?dag-sync-test");
}

const tempPaths: string[] = [];

afterAll(() => {
  for (const tempPath of tempPaths) {
    rmSync(tempPath, { recursive: true, force: true });
  }
});

test("resolveGraphStorageDirs includes observed workspace task graph directory", async () => {
  const { observeGraphWorkspaceDir, resolveGraphStorageDirs } = await loadDagSyncModule();
  const workspaceDir = mkdtempSync(join(tmpdir(), "openerx-dag-sync-"));
  const graphDir = join(workspaceDir, ".opencode", "state", "task-graphs");
  mkdirSync(graphDir, { recursive: true });
  tempPaths.push(workspaceDir);

  observeGraphWorkspaceDir(workspaceDir);

  expect(resolveGraphStorageDirs()).toContain(graphDir);
});

test("resolveGraphStorageDirs prefers explicit workspace directory when provided", async () => {
  const { resolveGraphStorageDirs } = await loadDagSyncModule();
  const workspaceDir = mkdtempSync(join(tmpdir(), "openerx-dag-sync-preferred-"));
  const graphDir = join(workspaceDir, ".opencode", "state", "task-graphs");
  mkdirSync(graphDir, { recursive: true });
  tempPaths.push(workspaceDir);

  expect(resolveGraphStorageDirs(workspaceDir)).toContain(graphDir);
});
