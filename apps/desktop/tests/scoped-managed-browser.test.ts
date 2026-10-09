import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { beforeEach, expect, test, vi } from "vitest";
import { createScopedManagedBrowserTools } from "../src/main/browser-computer-use/scoped-managed-browser";

const state = vi.hoisted(() => ({
  driver: null as any,
  fail: false,
  execute: vi.fn(),
  close: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../src/main/browser-computer-use/managed-chromium-driver", () => ({
  ManagedChromiumDriver: class {
    constructor(readonly permissions: any) {
      if (state.fail) throw new Error("fixture init error");
      state.driver = this;
    }
    contexts(owner: string) {
      return [{ sessionId: "owned-session", url: "https://company.test", title: owner }];
    }
    close() {
      state.close();
    }
  },
}));
vi.mock("../src/main/browser-computer-use/system-default-browser-adapter", () => ({
  SystemDefaultBrowserAdapter: class {
    execute(...args: unknown[]) {
      state.execute(...args);
      return {
        summary: "fixture",
        content: [],
        data: {},
        sources: [],
        artifacts: [],
        sideEffectCommitted: false,
        durationMs: 0,
      };
    }
    descriptors() {
      return [{ sessionId: "owned-session" }];
    }
    async releaseGeneration(id: string) {
      state.release(id);
    }
  },
}));
beforeEach(() => {
  state.fail = false;
  vi.clearAllMocks();
});
const context = () => ({
  signal: new AbortController().signal,
  toolCallId: randomUUID(),
  update() {},
});
const request = (value: any) => ({
  operation: "browser_computer_use" as const,
  request: { contractVersion: "browser_computer_use_v2" as const, ...value },
  idempotencyKey: "test",
});
test("only a task-owned managed profile is available and contexts never list personal tabs", async () => {
  const tools = createScopedManagedBrowserTools("owner");
  try {
    const contexts = await tools.execute(request({ action: "contexts" }), context());
    expect(contexts.data).toEqual({
      managedSessions: [
        { sessionId: "owned-session", url: "https://company.test", title: "owner" },
      ],
      contexts: [],
    });
    await tools.execute(request({ action: "open", url: "https://company.test" }), context());
    expect(state.execute.mock.calls[0]?.[0]).toMatchObject({
      requestedBackend: "managed_chromium",
    });
    expect(state.execute.mock.calls[0]?.[2]).toBe("owner");
    expect(state.driver.permissions.allows("https://company.test/page", "owner")).toBe(true);
    await expect(
      state.driver.permissions.require("https://other.test", "owner", new AbortController().signal),
    ).rejects.toThrow("BROWSER_NAVIGATION_DENIED");
  } finally {
    await tools.stopAll?.();
  }
  expect(state.close).toHaveBeenCalledTimes(1);
  expect(state.release).toHaveBeenCalledWith("owner");
  await expect(tools.execute(request({ action: "contexts" }), context())).rejects.toThrow(
    "BROWSER_CANCELLED",
  );
});
test("system profiles, bridge references, foreign sessions and generations are rejected", async () => {
  const tools = createScopedManagedBrowserTools("owner");
  try {
    for (const value of [
      { action: "open", url: "https://company.test", requestedBackend: "system_default" },
      { action: "open", url: "https://company.test", browserContextRef: "private-chrome-tab" },
      { action: "observe", sessionId: "other-task" },
    ])
      await expect(tools.execute(request(value), context())).rejects.toThrow(
        "BROWSER_CONTEXT_OUT_OF_SCOPE",
      );
    await expect(
      tools.execute(request({ action: "contexts" }), {
        ...context(),
        projection: {
          generationId: "other",
          workItemId: randomUUID(),
          runId: randomUUID(),
          conversationId: randomUUID(),
          assistantMessageId: randomUUID(),
          piToolCallId: "test",
          toolName: "openerx_browser",
        },
      }),
    ).rejects.toThrow("BROWSER_CONTEXT_OUT_OF_SCOPE");
    expect(state.execute).not.toHaveBeenCalled();
  } finally {
    await tools.stopAll?.();
  }
});
test("initialization failure cleans the private directory", () => {
  const before = readdirSync(tmpdir()).filter((name) => name.startsWith("openerx-browser-task-"));
  state.fail = true;
  expect(() => createScopedManagedBrowserTools("owner")).toThrow("fixture init error");
  expect(readdirSync(tmpdir()).filter((name) => name.startsWith("openerx-browser-task-"))).toEqual(
    before,
  );
});
