import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  finalizeHelperArtifact,
  requiresHelperSigning,
} from "./windows-desktop-helper-artifact.mjs";
import { signWindowsFile } from "./windows-signing.mjs";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const arch = option("--arch", process.arch);
if (process.platform !== "win32" && !args.includes("--cross")) process.exit(0);
if (arch !== "x64") throw new Error("DESKTOP_HELPER_ARCH_UNSUPPORTED");
const signed = requiresHelperSigning();
if (signed && !process.env.WINDOWS_CERTIFICATE_FILE && !process.env.OPENERX_WINDOWS_SIGN_THUMBPRINT)
  throw new Error("WINDOWS_SIGNING_IDENTITY_REQUIRED");
if (signed && process.platform !== "win32")
  throw new Error("WINDOWS_SIGNATURE_REQUIRES_WINDOWS_RUNNER");
const output = path.resolve(
  option(
    "--output",
    path.join(desktop, "native", "windows-desktop-helper", "bin", "publish", arch),
  ),
);
mkdirSync(output, { recursive: true });
execFileSync(
  process.env.OPENERX_DOTNET ?? "dotnet",
  [
    "publish",
    path.join(desktop, "native", "windows-desktop-helper", "WindowsDesktopHelper.csproj"),
    "-c",
    "Release",
    "-r",
    `win-${arch}`,
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-p:DebugType=None",
    "-o",
    output,
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
  },
);
const executable = path.join(output, "openerx-desktop-helper.exe");
finalizeHelperArtifact(output, arch, signed ? (file) => signWindowsFile(file) : undefined);
console.log(`Windows desktop helper built: ${executable}`);
