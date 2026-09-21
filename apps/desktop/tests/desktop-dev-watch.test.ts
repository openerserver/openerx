import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { isDesktopBuildArtifact } from "../scripts/desktop-dev-watch.mjs";

test("development ignores locked native output directories, but keeps source and renderer updates", () => {
  for (const relative of [
    "out", "out/openerx-win32-x64/openerx.exe",
    ".native-build", ".native-build/openerx-credential-store",
    "native/windows-desktop-helper/bin",
    "native/windows-desktop-helper/bin/publish/x64/openerx-desktop-helper.exe",
    "native/windows-desktop-helper/obj",
    "native/windows-desktop-helper/obj/Release/net10.0-windows/win-x64/apphost.exe",
  ]) {
    expect(isDesktopBuildArtifact(`C:/workspace/apps/desktop/${relative}`)).toBe(true);
    expect(isDesktopBuildArtifact(`C:/workspace/apps/desktop/${relative}`.replaceAll("/", "\\"))).toBe(true);
  }
  for (const relative of [
    "src/renderer/App.tsx", "src/renderer/styles.css",
    "native/windows-desktop-helper/Program.cs",
    "native/windows-desktop-helper/WindowsDesktopHelper.csproj",
    "src/outside.ts", "native/windows-desktop-helper/objects.ts",
  ]) {
    expect(isDesktopBuildArtifact(`C:/workspace/apps/desktop/${relative}`)).toBe(false);
    expect(isDesktopBuildArtifact(`C:/workspace/apps/desktop/${relative}`.replaceAll("/", "\\"))).toBe(false);
  }
  const config = readFileSync(new URL("../vite.renderer.config.mts", import.meta.url), "utf8");
  expect(config).toContain("ignored: isDesktopBuildArtifact");
});
