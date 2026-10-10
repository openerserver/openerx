import { execFileSync } from "node:child_process";
import path from "node:path";

const inheritedKeys = [
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "SystemRoot",
  "SystemDrive",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOMEDRIVE",
  "HOMEPATH",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "USERNAME",
  "USERDOMAIN",
];

/** Test runner dependencies must not leak into the desktop process being tested. */
export function buildWindowsRuntimeTestEnvironment({ env = process.env, machinePath, userPath }) {
  if (typeof machinePath !== "string" || typeof userPath !== "string")
    throw new Error("WINDOWS_RUNTIME_TEST_PATH_SNAPSHOT_REQUIRED");
  const runtimePath = [machinePath, userPath].filter(Boolean).join(";");
  if (!runtimePath.trim()) throw new Error("WINDOWS_RUNTIME_TEST_PATH_EMPTY");
  const lookup = new Map(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]));
  const result = { PATH: runtimePath };
  for (const key of inheritedKeys) {
    const value = lookup.get(key.toUpperCase());
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

export function readWindowsRuntimeTestEnvironment(env = process.env) {
  if (process.platform !== "win32") throw new Error("WINDOWS_RUNTIME_TEST_PLATFORM_REQUIRED");
  const systemRoot = Object.entries(env).find(([key]) => key.toUpperCase() === "SYSTEMROOT")?.[1];
  if (!systemRoot) throw new Error("WINDOWS_RUNTIME_TEST_SYSTEM_ROOT_REQUIRED");
  const powershell = path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const snapshot = JSON.parse(
    execFileSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @{machinePath=[string]([Environment]::GetEnvironmentVariable('Path','Machine'));userPath=[string]([Environment]::GetEnvironmentVariable('Path','User'))} | ConvertTo-Json -Compress",
      ],
      { env, encoding: "utf8", windowsHide: true },
    ).replace(/^\uFEFF/u, ""),
  );
  return buildWindowsRuntimeTestEnvironment({ env, ...snapshot });
}
