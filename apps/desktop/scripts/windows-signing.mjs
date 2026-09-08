import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
export function signToolPath(env = process.env) {
  if (env.OPENERX_SIGNTOOL_PATH) return path.resolve(env.OPENERX_SIGNTOOL_PATH);
  // Use the Microsoft tool already distributed with Electron's packager.
  const packager = createRequire(require.resolve("@electron/packager/package.json"));
  return path.join(
    path.dirname(packager.resolve("@electron/windows-sign/package.json")),
    "vendor",
    "signtool.exe",
  );
}

function run(args, failure, env, runner) {
  let result;
  try {
    result = runner(signToolPath(env), args, {
      windowsHide: true,
      encoding: "utf8",
      timeout: 60_000,
    });
  } catch {
    throw new Error("WINDOWS_SIGNTOOL_UNAVAILABLE");
  }
  // Do not propagate spawn args/stdout/stderr: SignTool's /p can contain a PFX password.
  if (result.error || result.status === null) throw new Error("WINDOWS_SIGNTOOL_UNAVAILABLE");
  if (result.status !== 0) throw new Error(failure);
}

export function verifyWindowsFile(
  file,
  env = process.env,
  runner = spawnSync,
  requireTimestamp = false,
) {
  run(
    ["verify", "/pa", "/all", ...(requireTimestamp ? ["/tw"] : []), "/q", path.resolve(file)],
    "WINDOWS_AUTHENTICODE_INVALID",
    env,
    runner,
  );
}

export function signWindowsFile(file, env = process.env, runner = spawnSync) {
  const args = [
    "sign",
    "/fd",
    "SHA256",
    "/tr",
    env.WINDOWS_TIMESTAMP_SERVER || "http://timestamp.digicert.com",
    "/td",
    "SHA256",
  ];
  if (env.OPENERX_WINDOWS_SIGN_THUMBPRINT) {
    const thumbprint = env.OPENERX_WINDOWS_SIGN_THUMBPRINT.replaceAll(" ", "");
    if (!/^[a-f0-9]{40}$/iu.test(thumbprint)) throw new Error("WINDOWS_SIGN_THUMBPRINT_INVALID");
    args.push("/sha1", thumbprint, "/s", "My");
  } else if (env.WINDOWS_CERTIFICATE_FILE) {
    args.push("/f", path.resolve(env.WINDOWS_CERTIFICATE_FILE));
    if (env.WINDOWS_CERTIFICATE_PASSWORD) args.push("/p", env.WINDOWS_CERTIFICATE_PASSWORD);
  } else throw new Error("WINDOWS_SIGNING_IDENTITY_REQUIRED");
  args.push("/q", path.resolve(file));
  run(args, "WINDOWS_SIGNING_FAILED", env, runner);
  verifyWindowsFile(file, env, runner, true);
}
