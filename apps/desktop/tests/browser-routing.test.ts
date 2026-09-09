import { BROWSER_COMPUTER_USE_CONTRACT_VERSION as contractVersion } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { routeBrowserOpen } from "../src/main/browser-computer-use/browser-routing";

const request = { contractVersion, action: "open" as const, url: "https://fixture.test/page" };
const tab = { url: request.url, browserContextRef: "bctx_real_authorization" };
describe("browser profile selection", () => {
  it("uses an ephemeral managed browser when no authorized tab matches", () => {
    expect(routeBrowserOpen(request, "auto", []).requestedBackend).toBe("managed_chromium");
    expect(
      routeBrowserOpen(request, "auto", [{ ...tab, url: "https://fixture.test/other" }])
        .requestedBackend,
    ).toBe("managed_chromium");
  });
  it("selects exactly one explicitly authorized matching tab", () => {
    expect(routeBrowserOpen(request, "auto", [tab]).browserContextRef).toBe(tab.browserContextRef);
  });
  it("fails ambiguous or missing connected-tab selection without changing profiles", () => {
    expect(() =>
      routeBrowserOpen(request, "auto", [
        tab,
        { ...tab, browserContextRef: "bctx_another_authorization" },
      ]),
    ).toThrow("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
    expect(() => routeBrowserOpen(request, "connected_chrome", [])).toThrow(
      "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED",
    );
  });
  it("honors explicit references and managed requests, including conflicts for downstream validation", () => {
    const managed = { ...request, requestedBackend: "managed_chromium" as const };
    expect(routeBrowserOpen(managed, "auto", [tab])).toEqual(managed);
    const explicit = { ...request, browserContextRef: "bctx_invalid_dont_fallback" };
    expect(routeBrowserOpen(explicit, "auto", [])).toEqual(explicit);
    expect(() => routeBrowserOpen(explicit, "managed_chromium", [])).toThrow(
      "BROWSER_BACKEND_DOWNGRADE_REJECTED",
    );
    expect(routeBrowserOpen(request, "os_accessibility", [tab]).requestedBackend).toBe(
      "system_default",
    );
  });
});
