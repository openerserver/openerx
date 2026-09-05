import { BROWSER_COMPUTER_USE_CONTRACT_VERSION, type ToolOperation } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { HostCapabilityAdapter } from "../src/host-adapter";
import {
  capabilityRequirement,
  hasUncertainExternalSideEffect,
  operationDigest,
  summarizeOperation,
} from "../src/policy";

const sessionId = "11111111-1111-4111-8111-111111111111";
const observationId = "22222222-2222-4222-8222-222222222222";
const elementRef = `el_${"a".repeat(24)}`;

describe("BCU-003 Browser Computer-Use policy", () => {
  it("binds open to a domain scope and high-impact submit to per-call approval", () => {
    const open: ToolOperation = {
      operation: "browser_computer_use",
      idempotencyKey: "browser-v2-open-policy-0001",
      request: {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "open",
        url: "https://www.baidu.com/",
      },
    };
    expect(capabilityRequirement(open)).toMatchObject({
      capability: "browser",
      resourceType: "domain",
      resource: "www.baidu.com",
      actions: ["navigate"],
      approval: "scope",
    });

    const submit: ToolOperation = {
      operation: "browser_computer_use",
      idempotencyKey: "browser-v2-submit-policy-0001",
      request: {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "submit",
        sessionId,
        observationId,
        target: { elementRef },
      },
    };
    expect(capabilityRequirement(submit)).toMatchObject({
      risk: "L4",
      actions: ["external_write"],
      approval: "per_call",
    });
    expect(hasUncertainExternalSideEffect(submit)).toBe(true);
  });

  it("keeps entered text out of summaries while binding it into the approval digest", () => {
    const base: ToolOperation = {
      operation: "browser_computer_use",
      idempotencyKey: "browser-v2-value-policy-0001",
      request: {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId,
        observationId,
        target: { elementRef },
        text: "secret-canary-one",
      },
    };
    expect(JSON.stringify(summarizeOperation(base))).not.toContain("secret-canary-one");
    const changed: ToolOperation = {
      operation: "browser_computer_use",
      idempotencyKey: base.idempotencyKey,
      request: {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "setValue",
        sessionId,
        observationId,
        target: { elementRef },
        text: "secret-canary-two",
      },
    };
    expect(operationDigest(base)).not.toBe(operationDigest(changed));
  });

  it("routes V2 operations through the Main capability host", async () => {
    const execute = vi.fn(async () => ({
      summary: "observed",
      content: [{ type: "text" as const, text: "observed" }],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: false,
      durationMs: 1,
    }));
    const adapter = new HostCapabilityAdapter({ execute });
    const request: ToolOperation = {
      operation: "browser_computer_use",
      idempotencyKey: "browser-v2-observe-adapter-0001",
      request: {
        contractVersion: BROWSER_COMPUTER_USE_CONTRACT_VERSION,
        action: "observe",
        sessionId,
      },
    };
    await adapter.execute(request, { signal: new AbortController().signal });
    expect(execute).toHaveBeenCalledWith(request, expect.any(AbortSignal));
  });
});
