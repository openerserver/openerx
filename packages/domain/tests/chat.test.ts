import { describe, expect, it } from "vitest";
import { assertMessageTransition, canTransitionMessage, deriveConversationTitle } from "../src";

describe("chat domain invariants", () => {
  it("allows only forward generation transitions", () => {
    expect(canTransitionMessage("pending", "streaming")).toBe(true);
    expect(canTransitionMessage("streaming", "completed")).toBe(true);
    expect(canTransitionMessage("completed", "streaming")).toBe(false);
    expect(() => assertMessageTransition("stopped", "completed")).toThrow(
      "Invalid message transition",
    );
  });

  it("derives a compact stable conversation title", () => {
    expect(deriveConversationTitle("  hello   world ")).toBe("hello world");
    expect(deriveConversationTitle(" ")).toBe("新对话");
    expect(deriveConversationTitle("a".repeat(50))).toBe(`${"a".repeat(41)}…`);
  });
});
