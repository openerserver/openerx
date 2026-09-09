import type { PiToolRequestFrame } from "@openerx/contracts";
import { BROWSER_COMPUTER_USE_CONTRACT_VERSION } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { createProductCapabilityTools } from "../src/capability-tools";

function fixture(browserComputerUseV2: boolean) {
  const frames: PiToolRequestFrame[] = [];
  const tools = createProductCapabilityTools({
    generationId: "11111111-1111-4111-8111-111111111111",
    conversationId: "22222222-2222-4222-8222-222222222222",
    branchId: "33333333-3333-4333-8333-333333333333",
    assistantMessageId: "44444444-4444-4444-8444-444444444444",
    browserComputerUseV2,
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
  const browser = tools.find(({ name }) => name === "openerx_browser");
  if (!browser) throw new Error("browser tool missing");
  return { browser, frames };
}

describe("BCU-003 Pi browser projection", () => {
  it("projects the semantic V2 tool without selector, DOM or script fields", async () => {
    const { browser, frames } = fixture(true);
    const schema = JSON.stringify(browser.parameters);
    expect(browser.label).toBe("Use browser");
    expect(browser.parameters).toMatchObject({ type: "object", anyOf: expect.any(Array) });
    expect(schema).toContain("elementRef");
    expect(schema).toContain("observationId");
    expect(schema).not.toMatch(/selector|javascript|xpath|devtools|html/u);

    await browser.execute(
      "browser-open",
      { action: "open", url: "https://www.baidu.com/" },
      undefined,
      undefined,
      {} as never,
    );
    expect(frames[0]?.operation).toMatchObject({
      operation: "browser_computer_use",
      request: {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "open",
        url: "https://www.baidu.com/",
      },
    });
  });

  it("restores only the frozen legacy projection when the rollback flag is off", async () => {
    const { browser, frames } = fixture(false);
    const schema = JSON.stringify(browser.parameters);
    expect(browser.label).toBe("Use legacy isolated browser");
    expect(schema).toContain("selector");

    await browser.execute(
      "legacy-open",
      { action: "open", url: "https://example.test/" },
      undefined,
      undefined,
      {} as never,
    );
    expect(frames[0]?.operation).toMatchObject({ operation: "browser", action: "open" });
  });
});
