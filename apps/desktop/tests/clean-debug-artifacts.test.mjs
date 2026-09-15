import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDebugArtifacts,
  planDebugArtifactCleanup,
} from "../scripts/clean-debug-artifacts.mjs";

let root;
let desktop;

function file(relative, content = "fixture") {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

function electronOutput(relative, complete = true) {
  file(`${relative}/LICENSE`);
  file(`${relative}/LICENSES.chromium.html`);
  file(`${relative}/version`, "44.0.0");
  if (complete) file(`${relative}/openerx.app/Contents/MacOS/openerx`);
  return path.join(root, relative);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "openerx-clean-debug-test-"));
  desktop = path.join(root, "openerx/apps/desktop");
  mkdirSync(desktop, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("desktop debug artifact cleanup", () => {
  it("previews then removes debug copies while preserving fixed packages and user evidence", () => {
    file("openerx/apps/desktop/.vite/build/main.js");
    const duplicate = electronOutput("openerx/apps/desktop/out/openerx-preview-darwin-arm64");
    const current = electronOutput("openerx/apps/desktop/out/openerx-darwin-arm64");
    electronOutput("openerx/apps/desktop/out/OpenerX-darwin-x64", false);
    const release = file("openerx/apps/desktop/out/make/openerx.dmg");
    const source = file("openerx/apps/desktop/src/main.ts");
    const checkpoint = "openerx-checkpoints/ui-20260912";
    const oldBuild = electronOutput(`${checkpoint}/build/openerx-darwin-arm64`);
    const evidence = ["source.patch", "database-before.sqlite", "screenshot.png"].map((name) =>
      file(`${checkpoint}/${name}`),
    );

    const plan = planDebugArtifactCleanup(desktop, { legacyCheckpoints: true });
    const preview = cleanDebugArtifacts(plan, { processCommands: "" });
    expect(preview).toHaveLength(4);
    expect(preview.every((entry) => entry.status === "would-remove")).toBe(true);
    expect(existsSync(duplicate)).toBe(true);
    expect(existsSync(oldBuild)).toBe(true);

    const result = cleanDebugArtifacts(plan, { apply: true, processCommands: "" });
    expect(result.every((entry) => entry.status === "removed")).toBe(true);
    expect(existsSync(duplicate)).toBe(false);
    expect(existsSync(oldBuild)).toBe(false);
    expect(existsSync(current)).toBe(true);
    for (const preserved of [source, release, ...evidence]) {
      expect(readFileSync(preserved, "utf8")).toBe("fixture");
    }
    expect(planDebugArtifactCleanup(desktop, { legacyCheckpoints: true })).toEqual([]);
  });

  it("keeps checkpoint builds opt-in and leaves unrecognized directories alone", () => {
    const oldBuild = electronOutput("openerx-checkpoints/task/build/openerx-darwin-arm64");
    const source = file("openerx/apps/desktop/out/openerx-custom-darwin-arm64/source.ts");
    const otherProduct = electronOutput("openerx/apps/desktop/out/another-product-darwin-arm64");
    expect(planDebugArtifactCleanup(desktop)).toEqual([]);
    expect(existsSync(oldBuild)).toBe(true);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(otherProduct)).toBe(true);
  });

  it("removes orphaned Windows runtime files while preserving an executable package", () => {
    const broken = electronOutput("openerx/apps/desktop/out/OpenerX-win32-x64", false);
    file("openerx/apps/desktop/out/OpenerX-win32-x64/ffmpeg.dll");
    file("openerx/apps/desktop/out/OpenerX-win32-x64/resources/app.asar");
    const valid = electronOutput("openerx/apps/desktop/out/openerx-win32-arm64", false);
    file("openerx/apps/desktop/out/openerx-win32-arm64/openerx.exe");
    const result = cleanDebugArtifacts(planDebugArtifactCleanup(desktop), {
      apply: true,
      processCommands: "",
    });
    expect(result).toHaveLength(1);
    expect(existsSync(broken)).toBe(false);
    expect(existsSync(valid)).toBe(true);
  });

  it("skips running packages and dev caches while cleaning unrelated debug artifacts", () => {
    file("openerx/apps/desktop/.vite/build/main.js");
    const running = electronOutput("openerx/apps/desktop/out/openerx-running-darwin-arm64");
    const unused = electronOutput("openerx/apps/desktop/out-codex/openerx-darwin-arm64");
    const result = cleanDebugArtifacts(planDebugArtifactCleanup(desktop), {
      apply: true,
      processCommands: `${running}/openerx.app/Contents/MacOS/openerx\nnode electron-forge start`,
    });
    expect(result.filter((entry) => entry.status === "skipped-running")).toHaveLength(2);
    expect(existsSync(running)).toBe(true);
    expect(existsSync(path.join(desktop, ".vite/build/main.js"))).toBe(true);
    expect(existsSync(unused)).toBe(false);
  });

  it("never follows linked output roots or linked checkpoint build directories", () => {
    electronOutput("outside/openerx-preview-darwin-arm64");
    const outside = path.join(root, "outside");
    symlinkSync(outside, path.join(desktop, "out"), "junction");
    const checkpoint = path.join(root, "openerx-checkpoints/task");
    mkdirSync(checkpoint, { recursive: true });
    symlinkSync(outside, path.join(checkpoint, "build"), "junction");
    expect(planDebugArtifactCleanup(desktop, { legacyCheckpoints: true })).toEqual([]);
    expect(existsSync(path.join(outside, "openerx-preview-darwin-arm64"))).toBe(true);
  });

  it("rechecks containment if a planned directory is replaced by a link", () => {
    file("openerx/apps/desktop/.vite/build/main.js");
    const plan = planDebugArtifactCleanup(desktop);
    const important = file("important/user.txt");
    const cache = path.join(desktop, ".vite");
    rmSync(cache, { recursive: true });
    symlinkSync(path.dirname(important), cache, "junction");
    expect(cleanDebugArtifacts(plan, { apply: true, processCommands: "" })[0].status).toBe(
      "skipped-path-changed",
    );
    expect(readFileSync(important, "utf8")).toBe("fixture");
  });
});
