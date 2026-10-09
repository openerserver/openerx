import { describe, expect, it } from "vitest";
import { createNativeWorkerOutputBoundary } from "../src/codemode-worker-boundary";

describe("production codemode worker output boundary", () => {
  it("stops output flooding before host dispatch and drops subsequent calls", () => {
    const sent: unknown[] = [];
    let interrupts = 0;
    const allow = createNativeWorkerOutputBoundary(
      (message) => sent.push(message),
      () => {
        interrupts += 1;
      },
    );
    expect(allow({ type: "output", item: { type: "text", text: "x".repeat(40_000) } })).toBe(true);
    expect(allow({ type: "output", item: { type: "text", text: "x".repeat(40_000) } })).toBe(false);
    expect(allow({ type: "call", id: 1, target: "tool", name: "write" })).toBe(false);
    expect(allow({ type: "done", ok: true, value: '"complete"', writes: "[]" })).toBe(false);
    expect(interrupts).toBe(1);
    expect(sent).toEqual([
      expect.objectContaining({
        type: "done",
        ok: false,
        error: expect.stringContaining("PI_NATIVE_OUTPUT_LIMIT"),
      }),
    ]);
  });

  it("also bounds the top-level returned value, including bytes of multibyte strings", () => {
    const sent: unknown[] = [];
    const allow = createNativeWorkerOutputBoundary(
      (message) => sent.push(message),
      () => {},
    );
    expect(
      allow({ type: "done", ok: true, value: JSON.stringify("中".repeat(30_000)), writes: "[]" }),
    ).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it.each([
    { target: "tool", count: 64, code: "PI_NATIVE_TOOL_CALL_LIMIT" },
    { target: "global", count: 128, code: "PI_NATIVE_GLOBAL_CALL_LIMIT" },
  ])("rejects a $target call flood before the host receives it", ({ target, count, code }) => {
    const sent: unknown[] = [];
    const allow = createNativeWorkerOutputBoundary(
      (message) => sent.push(message),
      () => {},
    );
    for (let index = 0; index < count; index += 1) {
      expect(allow({ type: "call", target, name: "probe", id: index, args: "{}" })).toBe(true);
    }
    expect(allow({ type: "call", target, name: "probe", id: count, args: "{}" })).toBe(false);
    expect(sent).toEqual([
      expect.objectContaining({ type: "done", ok: false, error: expect.stringContaining(code) }),
    ]);
  });

  it("bounds the encoded arguments before host parsing or tool dispatch", () => {
    const sent: unknown[] = [];
    const allow = createNativeWorkerOutputBoundary(
      (message) => sent.push(message),
      () => {},
    );
    expect(allow({ type: "call", target: "tool", args: "x".repeat(1024 * 1024 + 1) })).toBe(false);
    expect(sent).toEqual([
      expect.objectContaining({
        type: "done",
        ok: false,
        error: expect.stringContaining("PI_NATIVE_ARGUMENT_LIMIT"),
      }),
    ]);
  });

  it.each([
    { type: "done", ok: false, error: "x".repeat(70_000) },
    { type: "crash", message: "x".repeat(70_000) },
  ])("bounds $type failures before the host parses them", (message) => {
    const sent: unknown[] = [];
    const allow = createNativeWorkerOutputBoundary(
      (value) => sent.push(value),
      () => {},
    );
    expect(allow(message)).toBe(false);
    expect(sent).toEqual([
      expect.objectContaining({
        type: "done",
        ok: false,
        error: expect.stringContaining("PI_NATIVE_OUTPUT_LIMIT"),
      }),
    ]);
  });
});
