import { describe, expect, it } from "vitest";
import { DesktopCaptureRegistry } from "../src/main/desktop-capture-registry";

describe("DesktopCaptureRegistry", () => {
  it("binds an interaction to a recent capture, exact app identity and image bounds", () => {
    let now = 1_000;
    const registry = new DesktopCaptureRegistry(() => now, 60_000);
    const capture = registry.record({
      application: "TextEdit",
      bundleId: "com.apple.TextEdit",
      windowTitle: "d3-fixture.txt",
      imageWidth: 1_200,
      imageHeight: 800,
    });
    expect(
      registry.resolve({
        captureId: capture.captureId,
        application: "TextEdit",
        bundleId: "com.apple.TextEdit",
        x: 1_199,
        y: 799,
      }),
    ).toEqual(capture);
    expect(() =>
      registry.resolve({
        captureId: capture.captureId,
        application: "TextEdit",
        bundleId: "com.apple.finder",
      }),
    ).toThrow("DESKTOP_CAPTURE_IDENTITY_MISMATCH");
    expect(() =>
      registry.resolve({
        captureId: capture.captureId,
        application: "TextEdit",
        bundleId: "com.apple.TextEdit",
        x: 1_200,
        y: 799,
      }),
    ).toThrow("DESKTOP_COORDINATES_OUTSIDE_CAPTURE");
    now += 60_001;
    expect(() =>
      registry.resolve({
        captureId: capture.captureId,
        application: "TextEdit",
        bundleId: "com.apple.TextEdit",
      }),
    ).toThrow("DESKTOP_CAPTURE_EXPIRED");
  });

  it("does not permit interaction from a screenshot without stable bundle identity", () => {
    const registry = new DesktopCaptureRegistry();
    const capture = registry.record({
      application: "TextEdit",
      windowTitle: "fixture",
      imageWidth: 100,
      imageHeight: 100,
    });
    expect(() =>
      registry.resolve({
        captureId: capture.captureId,
        application: "TextEdit",
        bundleId: "com.apple.TextEdit",
      }),
    ).toThrow("DESKTOP_CAPTURE_IDENTITY_MISSING");
  });

  it("rejects invalid native identities and image dimensions", () => {
    const registry = new DesktopCaptureRegistry();
    expect(() =>
      registry.record({
        application: "TextEdit",
        bundleId: "com.apple.TextEdit",
        windowTitle: "fixture",
        nativeProcessId: 0,
        nativeWindowId: 10,
        imageWidth: 100,
        imageHeight: 100,
      }),
    ).toThrow("DESKTOP_CAPTURE_IDENTITY_INVALID");
    expect(() =>
      registry.record({
        application: "TextEdit",
        windowTitle: "fixture",
        imageWidth: Number.NaN,
        imageHeight: 100,
      }),
    ).toThrow("DESKTOP_CAPTURE_DIMENSIONS_INVALID");
  });
});
