import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const roots = [root];
const enclosing = path.dirname(root);
const read = (directory: string, file: string) =>
  JSON.parse(readFileSync(path.join(directory, file), "utf8"));
if (existsSync(path.join(enclosing, "package.json"))) {
  const parent = read(enclosing, "package.json");
  if (parent.workspaces?.includes(`${path.basename(root)}/apps/*`)) roots.push(enclosing);
}

for (const directory of roots) {
  describe(`build dependency security in ${path.basename(directory)}`, () => {
    test("pins reviewed replacements and removes the unpatched ZIP extractor", () => {
      const manifest = read(directory, "package.json");
      const lock = read(directory, "package-lock.json");
      const versions = {
        "@electron/packager": "20.3.0",
        "@electron/rebuild": "4.2.0",
        "@electron/get": "5.0.0",
        tar: "7.5.22",
        tmp: "0.2.7",
      };
      for (const [name, version] of Object.entries(versions)) {
        expect(manifest.overrides[name]).toBe(version);
        const entries = Object.entries(lock.packages).filter(([key]) =>
          key.endsWith(`node_modules/${name}`),
        );
        expect(entries.length).toBeGreaterThan(0);
        for (const [key, entry] of entries)
          expect((entry as { version: string }).version, key).toBe(version);
      }
      for (const [key, entry] of Object.entries(lock.packages)) {
        expect(key.endsWith("node_modules/extract-zip"), key).toBe(false);
        if (key.endsWith("node_modules/image-size"))
          expect((entry as { version: string }).version, key).toBe("2.0.4");
      }
    });

    test("audits development dependencies as well as production dependencies", () => {
      const scripts = read(directory, "package.json").scripts;
      expect(scripts["audit:v2"]).toContain("npm audit --audit-level=high");
      expect(scripts["audit:v2"]).not.toMatch(/--omit|--production/u);
      if (scripts["check:local"]) expect(scripts["check:local"]).toContain("npm run audit:v2");
    });
  });
}
