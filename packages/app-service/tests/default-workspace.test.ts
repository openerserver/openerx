import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkspaceDirectory } from "../src/default-workspace";

const roots: string[] = [];
function root() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "openerx-workspace-upgrade-"));
  roots.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("uses openerx for a fresh installation", () => {
  const directory = root();
  expect(defaultWorkspaceDirectory(directory)).toBe(path.join(directory, "openerx Workspace"));
});

it("keeps the original workspace and its files even when both names exist", () => {
  const directory = root();
  const legacy = path.join(directory, "UWA Workspace");
  mkdirSync(legacy);
  mkdirSync(path.join(directory, "openerx Workspace"));
  writeFileSync(path.join(legacy, "existing.txt"), "existing user content");
  expect(defaultWorkspaceDirectory(directory)).toBe(legacy);
  expect(readFileSync(path.join(legacy, "existing.txt"), "utf8")).toBe("existing user content");
});

it("does not adopt a file with the legacy directory name", () => {
  const directory = root();
  writeFileSync(path.join(directory, "UWA Workspace"), "keep me");
  expect(defaultWorkspaceDirectory(directory)).toBe(path.join(directory, "openerx Workspace"));
});
