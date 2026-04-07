import { describe, expect, test } from "bun:test";

import {
  formatModelRoute,
  resolveModelRoute,
} from "../../control-plane/web-ui-bff/src/lib/model-config";

describe("resolveModelRoute", () => {
  test("uses the fallback provider for plain Copilot model ids", () => {
    expect(resolveModelRoute("claude-sonnet-4")).toEqual({
      providerId: "github-copilot",
      modelId: "claude-sonnet-4",
    });
  });

  test("keeps direct provider model ids on their configured provider", () => {
    expect(resolveModelRoute("anthropic/claude-sonnet-4-20250514")).toEqual({
      providerId: "anthropic",
      modelId: "anthropic/claude-sonnet-4-20250514",
    });
  });

  test("normalizes slash-prefixed Copilot model ids", () => {
    expect(resolveModelRoute("github-copilot/claude-sonnet-4")).toEqual({
      providerId: "github-copilot",
      modelId: "claude-sonnet-4",
    });
  });

  test("formats direct provider model ids without duplicating the provider prefix", () => {
    expect(
      formatModelRoute({
        providerId: "anthropic",
        modelId: "anthropic/claude-sonnet-4-20250514",
      }),
    ).toBe("anthropic/claude-sonnet-4-20250514");
  });
});
