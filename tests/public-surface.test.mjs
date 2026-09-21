import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { publicDocuments, publicSurfaceViolations } from "../scripts/check-public-surface.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-public-surface-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [...publicDocuments, "LICENSE"]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "# openerx\n");
  }
  return { root, files: [...publicDocuments, "LICENSE"] };
}

test("keeps public guides, runtime sources, test documents and license notices", (t) => {
  const { root, files } = fixture(t);
  files.push("packages/skills/src/builtins.ts", "tests/fixtures/sample.pdf", "vendor/NOTICE");
  assert.deepEqual(publicSurfaceViolations(root, files), []);
});

test("rejects archived docs and presentations even when git already tracks them", (t) => {
  const { root, files } = fixture(t);
  const rejected = [
    "v1-backup/notes.md",
    "docs/v2/plan.md",
    "deliverables/pitch.pptx",
    "notes.md",
    "demo.pdf",
  ];
  const failures = publicSurfaceViolations(root, [...files, ...rejected]);
  for (const file of rejected) assert.ok(failures.some((message) => message.includes(file)));
});

test("rejects private names and dangling relative links without rejecting API version URLs", (t) => {
  const { root, files } = fixture(t);
  writeFileSync(
    path.join(root, "README.md"),
    "[API](https://example.com/v1)\n[Guide](docs/models.md)\n",
  );
  assert.deepEqual(publicSurfaceViolations(root, files), []);
  writeFileSync(path.join(root, "README.md"), "UWA\n[Old guide](docs/removed.md)\n");
  const failures = publicSurfaceViolations(root, files);
  assert.ok(failures.some((message) => message.includes("Private or obsolete")));
  assert.ok(failures.some((message) => message.includes("Broken or external")));
});
