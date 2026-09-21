import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

if (process.platform === "darwin") {
  // Node-API v8 is ABI-stable across the build Node and Electron runtimes.
  const headers =
    process.env.OPENERX_NODE_INCLUDE_DIR ||
    path.resolve(path.dirname(realpathSync(process.execPath)), "../include/node");
  if (!existsSync(path.join(headers, "node_api.h")))
    throw new Error("MAC_SCREEN_PERMISSION_NODE_HEADERS_MISSING: set OPENERX_NODE_INCLUDE_DIR");
  const output = path.resolve(
    argument("--output", path.join(desktop, ".native-build", "openerx-screen-permission.node")),
  );
  const arch = argument("--arch", process.arch);
  if (!["arm64", "x64", "universal"].includes(arch))
    throw new Error("MAC_SCREEN_PERMISSION_ARCH_UNSUPPORTED");
  mkdirSync(path.dirname(output), { recursive: true });
  function compile(destination, target) {
    execFileSync(
      "xcrun",
      [
        "clang",
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-DNAPI_VERSION=8",
        "-bundle",
        "-undefined",
        "dynamic_lookup",
        "-arch",
        target === "x64" ? "x86_64" : target,
        "-mmacosx-version-min=12.0",
        "-I",
        headers,
        path.join(desktop, "native", "macos-screen-permission.c"),
        "-framework",
        "CoreGraphics",
        "-o",
        destination,
      ],
      { stdio: "inherit" },
    );
  }
  if (arch === "universal") {
    const temporary = mkdtempSync(path.join(tmpdir(), "openerx-screen-permission-"));
    try {
      const arm64 = path.join(temporary, "arm64.node"),
        x64 = path.join(temporary, "x64.node");
      compile(arm64, "arm64");
      compile(x64, "x64");
      execFileSync("xcrun", ["lipo", "-create", arm64, x64, "-output", output], {
        stdio: "inherit",
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } else compile(output, arch);
  console.log(`[screen-permission] built (${arch})`);
}
