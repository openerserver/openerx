import { describe, expect, it } from "vitest";
import {
  DESKTOP_CONTROL_VERSION,
  desktopControlOperationSchema,
  toolOperationSchema,
  windowsDesktopControlEnabled,
} from "../src";

const session = {
  contractVersion: DESKTOP_CONTROL_VERSION,
  applicationId: "c:\\windows\\system32\\notepad.exe",
  sessionId: "00000000-0000-4000-8000-000000000001",
};
describe("desktop control v2 contract", () => {
  it("keeps the rollout opt-in and requires explicit action-specific fields", () => {
    expect(windowsDesktopControlEnabled(undefined)).toBe(false);
    expect(windowsDesktopControlEnabled("true")).toBe(false);
    expect(windowsDesktopControlEnabled("1")).toBe(true);
    expect(
      desktopControlOperationSchema.safeParse({ ...session, action: "click", x: 4, y: 5 }).success,
    ).toBe(false);
    expect(
      desktopControlOperationSchema.safeParse({ ...session, action: "observe", bundleId: "spoof" })
        .success,
    ).toBe(false);
    expect(desktopControlOperationSchema.safeParse({ ...session, action: "resume" }).success).toBe(
      false,
    );
  });
  it("accepts the versioned operation while preserving macOS's original contract", () => {
    expect(
      toolOperationSchema.safeParse({
        operation: "desktop_control",
        idempotencyKey: "desktop-versioned-test",
        request: { ...session, action: "observe" },
      }).success,
    ).toBe(true);
    expect(
      toolOperationSchema.safeParse({
        operation: "desktop",
        idempotencyKey: "desktop-legacy-test",
        action: "screenshot",
        application: "TextEdit",
        bundleId: "com.apple.TextEdit",
      }).success,
    ).toBe(true);
  });
});
