import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vitest";
import { packagerTemporaryDirectory } from "../scripts/packager-temporary-directory.mjs";

const directories: string[] = [];
const require = createRequire(import.meta.url);
const packagerModule = path.join(
  path.dirname(require.resolve("@electron/packager")),
  "packager.js",
);
const { Packager } = await import(pathToFileURL(packagerModule).href);

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("starting Packager for a second checkout preserves the first checkout's staging files", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "packager-isolation-"));
  directories.push(root);
  const firstDesktop = path.join(root, "first", "apps", "desktop");
  const secondDesktop = path.join(root, "second", "apps", "desktop");
  mkdirSync(firstDesktop, { recursive: true });
  mkdirSync(secondDesktop, { recursive: true });
  const temporaryRoot = path.join(root, "temporary");
  const first = new Packager({ tmpdir: packagerTemporaryDirectory(firstDesktop, temporaryRoot) });
  const second = new Packager({ tmpdir: packagerTemporaryDirectory(secondDesktop, temporaryRoot) });
  await first.ensureTempDir();
  mkdirSync(first.tempBase, { recursive: true });
  const firstFile = path.join(first.tempBase, "runtime-npm-lifecycle.js");
  writeFileSync(firstFile, "first checkout runtime");
  await second.ensureTempDir();
  expect(existsSync(firstFile)).toBe(true);
  mkdirSync(second.tempBase, { recursive: true });
  const secondFile = path.join(second.tempBase, "second-checkout-runtime.js");
  writeFileSync(secondFile, "second checkout runtime");
  // The installed Packager still performs its normal cleanup within its own tree.
  await first.ensureTempDir();
  expect(existsSync(firstFile)).toBe(false);
  expect(existsSync(secondFile)).toBe(true);
});

test("the temporary parent is stable for equivalent checkout paths", () => {
  const root = mkdtempSync(path.join(tmpdir(), "packager-path-"));
  directories.push(root);
  const desktop = path.join(root, "apps", "desktop");
  mkdirSync(desktop, { recursive: true });
  const temporaryRoot = path.join(root, "temporary");
  expect(packagerTemporaryDirectory(desktop, temporaryRoot)).toBe(
    packagerTemporaryDirectory(path.join(desktop, "..", "desktop"), temporaryRoot),
  );
});
