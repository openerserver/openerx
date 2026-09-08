import { DESKTOP_CONTROL_VERSION, type ToolOperation } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { capabilityRequirement, hasUncertainExternalSideEffect } from "../src/policy";

const input: Extract<ToolOperation, { operation: "desktop_control" }> = {
  operation: "desktop_control",
  idempotencyKey: "desktop-policy-test",
  request: {
    contractVersion: DESKTOP_CONTROL_VERSION,
    action: "key",
    applicationId: "c:\\fixture.exe",
    sessionId: "00000000-0000-4000-8000-000000000001",
    observationId: "00000000-0000-4000-8000-000000000002",
    effect: "submit",
    key: "Enter",
  },
};
describe("Windows desktop policy", () => {
  it("requires per-call approval for committing keys and coordinates, not just named send actions", () => {
    expect(capabilityRequirement(input)).toMatchObject({
      capability: "desktop",
      approval: "per_call",
      resource: "c:\\fixture.exe",
      actions: ["high_impact"],
    });
    expect(hasUncertainExternalSideEffect(input)).toBe(true);
  });
  it("keeps app discovery scoped and ordinary interaction reusable", () => {
    expect(
      capabilityRequirement({
        ...input,
        request: { contractVersion: DESKTOP_CONTROL_VERSION, action: "list_apps" },
      }),
    ).toMatchObject({ approval: "scope", actions: ["capture"] });
    if (input.request.action !== "key") throw new Error("fixture");
    expect(
      capabilityRequirement({ ...input, request: { ...input.request, effect: "local" } }),
    ).toMatchObject({ approval: "scope", actions: ["capture", "interact"] });
  });
});
