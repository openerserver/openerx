import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(desktopDirectory, "native", "macos-browser-accessibility.swift");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function targetTriple(arch) {
  if (arch === "arm64") return "arm64-apple-macos12.0";
  if (arch === "x64") return "x86_64-apple-macos12.0";
  throw new Error(`MAC_BROWSER_HELPER_ARCH_UNSUPPORTED:${arch}`);
}

function compile(output, arch) {
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-O",
      "-whole-module-optimization",
      "-target",
      targetTriple(arch),
      source,
      "-o",
      output,
      "-framework",
      "AppKit",
      "-framework",
      "ApplicationServices",
      "-framework",
      "CoreGraphics",
    ],
    { stdio: "inherit" },
  );
}

if (process.platform === "darwin") {
  const output = path.resolve(
    argument(
      "--output",
      path.join(desktopDirectory, ".vite", "native", "openerx-browser-accessibility"),
    ),
  );
  const arch = argument("--arch", process.arch);
  mkdirSync(path.dirname(output), { recursive: true });
  if (arch === "universal") {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "openerx-browser-accessibility-"));
    try {
      const arm64 = path.join(temporaryDirectory, "helper-arm64");
      const x64 = path.join(temporaryDirectory, "helper-x64");
      compile(arm64, "arm64");
      compile(x64, "x64");
      execFileSync("xcrun", ["lipo", "-create", arm64, x64, "-output", output], {
        stdio: "inherit",
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  } else {
    compile(output, arch);
  }
  chmodSync(output, 0o755);
  console.log(`[browser-helper] built ${path.relative(desktopDirectory, output)} (${arch})`);
}
