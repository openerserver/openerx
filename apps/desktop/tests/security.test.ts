import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertTrustedIpcSender, parseInitialAppServiceReady } from "../src/main/ipc-security";
import {
  createWindowOptions,
  isTrustedExternalUrl,
  resolveRendererAssetPath,
} from "../src/main/security";

describe("desktop window security", () => {
  it("keeps the renderer sandboxed and isolated", () => {
    const options = createWindowOptions("/tmp/openerx-preload.js");

    expect(options.webPreferences).toMatchObject({
      preload: "/tmp/openerx-preload.js",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    });
  });

  it("opens only HTTPS external URLs", () => {
    expect(isTrustedExternalUrl("https://openerx.example/path")).toBe(true);
    expect(isTrustedExternalUrl("http://openerx.example/path")).toBe(false);
    expect(isTrustedExternalUrl("file:///tmp/secret")).toBe(false);
    expect(isTrustedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedExternalUrl("not a url")).toBe(false);
  });

  it("serves only renderer assets from the privileged app protocol", () => {
    const rendererRoot = path.resolve("/opt/openerx/renderer");

    expect(resolveRendererAssetPath(rendererRoot, "openerx://renderer/index.html")).toBe(
      path.join(rendererRoot, "index.html"),
    );
    expect(resolveRendererAssetPath(rendererRoot, "file:///etc/passwd")).toBeUndefined();
    expect(resolveRendererAssetPath(rendererRoot, "openerx://other/index.html")).toBeUndefined();
    expect(
      resolveRendererAssetPath(rendererRoot, "openerx://renderer/..%2F..%2Fsecret"),
    ).toBeUndefined();
    expect(
      resolveRendererAssetPath(rendererRoot, "openerx://user@renderer/index.html"),
    ).toBeUndefined();
  });
});

describe("desktop IPC security", () => {
  it("accepts only the sender main frame", () => {
    const mainFrame = {};
    expect(() =>
      assertTrustedIpcSender({ senderFrame: mainFrame, sender: { mainFrame } } as never),
    ).not.toThrow();
    expect(() =>
      assertTrustedIpcSender({ senderFrame: {}, sender: { mainFrame } } as never),
    ).toThrow("sender is not the main frame");
  });

  it("accepts one matching App Service handshake and rejects mismatch or replay", () => {
    const nonce = "a".repeat(64);
    const frame = { kind: "app-service.ready", contractVersion: 1, nonce };
    expect(parseInitialAppServiceReady(frame, nonce, false)).toEqual(frame);
    expect(() => parseInitialAppServiceReady(frame, "b".repeat(64), false)).toThrow(
      "nonce mismatch",
    );
    expect(() => parseInitialAppServiceReady(frame, nonce, true)).toThrow("Duplicate");
  });
});
