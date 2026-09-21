import {
  DESKTOP_CONTROL_FEATURE_FLAG,
  DESKTOP_CONTROL_VERSION,
  type PiToolRequestFrame,
} from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductCapabilityTools } from "../src/capability-tools";

const platform = process.platform;
afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
});

function fixture(targetPlatform: NodeJS.Platform, flag?: string) {
  Object.defineProperty(process, "platform", { value: targetPlatform, configurable: true });
  vi.stubEnv(DESKTOP_CONTROL_FEATURE_FLAG, flag);
  const frames: PiToolRequestFrame[] = [];
  const tools = createProductCapabilityTools({
    generationId: "11111111-1111-4111-8111-111111111111",
    conversationId: "22222222-2222-4222-8222-222222222222",
    branchId: "33333333-3333-4333-8333-333333333333",
    assistantMessageId: "44444444-4444-4444-8444-444444444444",
    transport: {
      async request(frame) {
        frames.push(frame);
        return {
          summary: "ok",
          content: [{ type: "text", text: "ok" }],
          data: {},
          sources: [],
          artifacts: [],
          sideEffectCommitted: false,
          durationMs: 1,
        };
      },
    },
  });
  const desktop = tools.find(({ name }) => name === "openerx_desktop");
  if (!desktop) throw new Error("desktop tool missing");
  return { desktop, frames };
}

describe("Windows desktop tool registration", () => {
  it("uses the native Windows contract without a developer environment flag", async () => {
    const { desktop, frames } = fixture("win32");
    expect(JSON.stringify(desktop.parameters)).toContain("list_apps");
    expect(JSON.stringify(desktop.parameters)).not.toContain("bundleId");
    await desktop.execute(
      "desktop-list",
      { action: "list_apps" },
      undefined,
      undefined,
      {} as never,
    );
    expect(frames[0]?.operation).toMatchObject({
      operation: "desktop_control",
      request: { contractVersion: DESKTOP_CONTROL_VERSION, action: "list_apps" },
    });
  });

  it.each(["0", "false"])(
    "does not register the Windows contract when explicitly disabled (%s)",
    (flag) => {
      const { desktop } = fixture("win32", flag);
      expect(JSON.stringify(desktop.parameters)).not.toContain("list_apps");
    },
  );

  it("preserves the macOS desktop contract", () => {
    const { desktop } = fixture("darwin");
    expect(JSON.stringify(desktop.parameters)).toContain("bundleId");
    expect(JSON.stringify(desktop.parameters)).not.toContain("list_apps");
  });
});
