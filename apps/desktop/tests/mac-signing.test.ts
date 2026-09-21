import { describe, expect, it } from "vitest";
import { resolveMacSigningIdentity } from "../scripts/mac-signing.mjs";

const developer = "Developer ID Application: Build Owner (ABCDEFGHIJ)";
const one = `  1) ${"A".repeat(40)} "${developer}"\n  2) ${"B".repeat(40)} "Apple Development: Build Owner (ABCDEFGHIJ)"\n     2 valid identities found`;

describe("macOS signing identity", () => {
  it("uses the available Developer ID for repeat local package builds", () => {
    expect(resolveMacSigningIdentity({}, () => ({ status: 0, stdout: one }))).toBe(developer);
  });
  it("honors an explicit certificate without consulting the local keychain", () => {
    expect(
      resolveMacSigningIdentity({ OPENERX_MAC_SIGN_IDENTITY: " explicit-certificate " }, () => {
        throw new Error("unexpected lookup");
      }),
    ).toBe("explicit-certificate");
  });
  it("keeps unsigned development possible on machines without a distribution certificate", () => {
    expect(
      resolveMacSigningIdentity({}, () => ({ status: 0, stdout: "0 valid identities found" })),
    ).toBeNull();
  });
  it("does not silently choose a different team or downgrade on lookup failure", () => {
    expect(() =>
      resolveMacSigningIdentity({}, () => ({
        status: 0,
        stdout:
          one + `\n 3) ${"C".repeat(40)} "Developer ID Application: Other Owner (KLMNOPQRST)"`,
      })),
    ).toThrow("MAC_SIGNING_IDENTITY_AMBIGUOUS");
    expect(() => resolveMacSigningIdentity({}, () => ({ status: 1, stdout: "" }))).toThrow(
      "MAC_SIGNING_IDENTITY_LOOKUP_FAILED",
    );
  });
  it("keeps an explicit signing identity mandatory for release gates", () => {
    for (const env of [{ OPENERX_RELEASE_MODE: "1" }, { OPENERX_REQUIRE_SIGNED_MACOS: "1" }])
      expect(() =>
        resolveMacSigningIdentity(env, () => {
          throw new Error("unexpected lookup");
        }),
      ).toThrow("RELEASE_ENV_REQUIRED:OPENERX_MAC_SIGN_IDENTITY");
  });
});
