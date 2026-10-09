import { describe, expect, it } from "vitest";
import {
  chatCommandEnvelopeSchema,
  parseChatCommandResult,
  piRuntimeSettingsUpdateInputSchema,
} from "../src";

describe("Pi runtime settings contract", () => {
  it("requires an explicit boolean and rejects tool or model overrides", () => {
    expect(piRuntimeSettingsUpdateInputSchema.safeParse({}).success).toBe(false);
    expect(
      piRuntimeSettingsUpdateInputSchema.safeParse({ nativeToolsEnabled: "true" }).success,
    ).toBe(false);
    expect(
      piRuntimeSettingsUpdateInputSchema.safeParse({ nativeToolsEnabled: true, models: true })
        .success,
    ).toBe(false);
    expect(
      chatCommandEnvelopeSchema.parse({
        command: "pi.runtime.settings.update",
        input: { nativeToolsEnabled: true },
      }).input,
    ).toEqual({ nativeToolsEnabled: true });
    expect(
      parseChatCommandResult("pi.runtime.settings.get", {
        ownerProfileId: "local-default",
        nativeToolsEnabled: false,
        updatedAt: null,
      }).nativeToolsEnabled,
    ).toBe(false);
  });
});
