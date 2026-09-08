import type { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { signWindowsFile, verifyWindowsFile } from "../scripts/windows-signing.mjs";

const result = {
  pid: 1,
  status: 0,
  signal: null,
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  output: [],
};
const env = {
  OPENERX_SIGNTOOL_PATH: "C:/WindowsSDK/signtool.exe",
  OPENERX_WINDOWS_SIGN_THUMBPRINT: "a".repeat(40),
};
describe("Windows native signing", () => {
  it("signs with the selected store identity and verifies timestamp and trust", () => {
    const runner = vi.fn<typeof spawnSync>().mockReturnValue(result);
    signWindowsFile("helper.exe", env, runner);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "sign",
        "/fd",
        "SHA256",
        "/sha1",
        env.OPENERX_WINDOWS_SIGN_THUMBPRINT,
      ]),
    );
    expect(runner.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["verify", "/pa", "/all", "/tw"]),
    );
  });
  it("distinguishes an unavailable verifier from an invalid signature", () => {
    const runner = vi
      .fn<typeof spawnSync>()
      .mockReturnValue({ ...result, status: null, error: new Error("cannot start") });
    expect(() => verifyWindowsFile("helper.exe", env, runner)).toThrow(
      "WINDOWS_SIGNTOOL_UNAVAILABLE",
    );
    runner.mockReturnValue({ ...result, status: 1 });
    expect(() => verifyWindowsFile("helper.exe", env, runner)).toThrow(
      "WINDOWS_AUTHENTICODE_INVALID",
    );
  });
  it("does not accept a successful sign when signature verification fails", () => {
    const runner = vi
      .fn<typeof spawnSync>()
      .mockReturnValueOnce(result)
      .mockReturnValueOnce({ ...result, status: 1 });
    expect(() => signWindowsFile("helper.exe", env, runner)).toThrow(
      "WINDOWS_AUTHENTICODE_INVALID",
    );
  });
  it("does not expose native arguments or credentials in signing errors", () => {
    const runner = vi.fn<typeof spawnSync>().mockImplementation(() => {
      throw new Error("args /p SECRET_CANARY");
    });
    expect(() =>
      signWindowsFile(
        "helper.exe",
        {
          OPENERX_SIGNTOOL_PATH: env.OPENERX_SIGNTOOL_PATH,
          WINDOWS_CERTIFICATE_FILE: "test.pfx",
          WINDOWS_CERTIFICATE_PASSWORD: "SECRET_CANARY",
        },
        runner,
      ),
    ).toThrow(/^WINDOWS_SIGNTOOL_UNAVAILABLE$/u);
  });
});
