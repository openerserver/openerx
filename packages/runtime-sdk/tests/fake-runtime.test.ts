import { describe, expect, it } from "vitest";
import { FakeRuntimeAdapter, type RuntimeEvent } from "../src";

async function collect(
  adapter: FakeRuntimeAdapter,
  handle: { id: string },
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of adapter.stream(handle)) {
    events.push(event);
  }
  return events;
}

describe("Fake Runtime Adapter", () => {
  it("streams ordered deltas and a single completion", async () => {
    const adapter = new FakeRuntimeAdapter({ chunkDelayMs: 0 });
    const handle = await adapter.start({ conversationId: "conversation" });
    await adapter.send(handle, {
      assistantMessageId: "assistant",
      history: [{ role: "user", text: "法国的首都是哪里？" }],
    });

    const events = await collect(adapter, handle);
    expect(events.map(({ sequence }) => sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.at(-1)?.type).toBe("completed");
    expect(events.filter(({ type }) => type === "completed")).toHaveLength(1);
    expect(
      events
        .filter(({ type }) => type === "delta")
        .map(({ delta }) => delta)
        .join(""),
    ).toBe("巴黎。");
  });

  it("stops without emitting later deltas", async () => {
    const adapter = new FakeRuntimeAdapter({ chunkDelayMs: 2 });
    const handle = await adapter.start({ conversationId: "conversation" });
    await adapter.send(handle, {
      assistantMessageId: "assistant",
      history: [{ role: "user", text: "写 2000 字 [FAKE_SLOW]" }],
    });

    const seen: RuntimeEvent[] = [];
    for await (const event of adapter.stream(handle)) {
      seen.push(event);
      if (event.type === "delta") {
        await adapter.stop(handle);
      }
    }

    expect(seen.at(-1)?.type).toBe("stopped");
    expect(seen.map(({ type }) => type).lastIndexOf("delta")).toBeLessThan(seen.length - 1);
  });

  it("preserves partial output before a deterministic failure", async () => {
    const adapter = new FakeRuntimeAdapter({ chunkDelayMs: 0 });
    const handle = await adapter.start({ conversationId: "conversation" });
    await adapter.send(handle, {
      assistantMessageId: "assistant",
      history: [{ role: "user", text: "请失败 [FAKE_FAIL]" }],
    });

    const events = await collect(adapter, handle);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      errorCode: "FAKE_RUNTIME_FAILURE",
    });
    expect(events.some(({ type }) => type === "delta")).toBe(true);

    const retry = await adapter.start({ conversationId: "conversation" });
    await adapter.send(retry, {
      assistantMessageId: "assistant-retry",
      history: [{ role: "user", text: "请失败 [FAKE_FAIL]" }],
    });
    expect((await collect(adapter, retry)).at(-1)?.type).toBe("completed");
  });
});
