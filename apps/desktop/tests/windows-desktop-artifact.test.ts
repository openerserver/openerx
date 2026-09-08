import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  finalizeHelperArtifact,
  requiresHelperSigning,
} from "../scripts/windows-desktop-helper-artifact.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function artifact() {
  const directory = mkdtempSync(path.join(tmpdir(), "wdc-artifact-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "openerx-desktop-helper.exe"), "unsigned fixture bytes");
  return directory;
}
describe("desktop helper signing order", () => {
  it("hashes final signed bytes, never the unsigned input", () => {
    const directory = artifact();
    finalizeHelperArtifact(directory, "x64", (file: string) =>
      writeFileSync(file, "signed fixture bytes"),
    );
    const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
    expect(manifest.sha256).toBe(createHash("sha256").update("signed fixture bytes").digest("hex"));
  });
  it("removes stale manifests when signing fails", () => {
    const directory = artifact();
    writeFileSync(path.join(directory, "manifest.json"), "old manifest");
    expect(() =>
      finalizeHelperArtifact(directory, "x64", () => {
        throw new Error("untrusted signer");
      }),
    ).toThrow("untrusted signer");
    expect(existsSync(path.join(directory, "manifest.json"))).toBe(false);
  });
  it("requires signing for release builds or explicitly configured identities", () => {
    expect(requiresHelperSigning({ OPENERX_RELEASE_MODE: "1" })).toBe(true);
    expect(requiresHelperSigning({ OPENERX_REQUIRE_SIGNED_WINDOWS: "1" })).toBe(true);
    expect(requiresHelperSigning({ WINDOWS_CERTIFICATE_FILE: "build.pfx" })).toBe(true);
    expect(requiresHelperSigning({ OPENERX_WINDOWS_SIGN_THUMBPRINT: "a".repeat(40) })).toBe(true);
    expect(requiresHelperSigning({})).toBe(false);
  });
  it("allows Store package signing without weakening direct EXE release signing", () => {
    expect(
      requiresHelperSigning({ OPENERX_RELEASE_MODE: "1", OPENERX_DISTRIBUTION: "ms-store" }),
    ).toBe(false);
    expect(
      requiresHelperSigning({
        OPENERX_RELEASE_MODE: "1",
        OPENERX_DISTRIBUTION: "ms-store",
        OPENERX_REQUIRE_SIGNED_WINDOWS: "1",
      }),
    ).toBe(true);
    expect(
      requiresHelperSigning({
        OPENERX_RELEASE_MODE: "1",
        OPENERX_DISTRIBUTION: "ms-store",
        WINDOWS_CERTIFICATE_FILE: "existing.pfx",
      }),
    ).toBe(true);
    expect(
      requiresHelperSigning({ OPENERX_RELEASE_MODE: "1", OPENERX_DISTRIBUTION: "direct" }),
    ).toBe(true);
  });
});
