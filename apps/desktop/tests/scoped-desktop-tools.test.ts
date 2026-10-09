import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionContext } from "@openerx/tool-sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createScopedDesktopTools,
  getScopedDesktopToolAvailability,
  stopScopedDesktopTools,
} from "../src/main/scoped-desktop-tools";

const state = vi.hoisted(() => ({
  paths: [] as string[],
  credentials: [] as string[],
  fail: false,
  execute: vi.fn(),
  close: vi.fn(),
  stop: vi.fn(),
  availability: vi.fn(),
}));
vi.mock("../src/main/credential-vault", () => ({
  ToolCredentialVault: class {
    constructor(file: string) {
      state.credentials.push(file);
    }
  },
}));
vi.mock("../src/main/tool-capability-host", () => ({
  ElectronToolCapabilityHost: class {
    constructor(directory: string) {
      state.paths.push(directory);
      if (state.fail) throw new Error("fixture host init error");
    }
    execute(...args: unknown[]) {
      return state.execute(...args);
    }
    close() {
      state.close();
    }
    stopDesktopControl() {
      state.stop();
    }
    availability() {
      return state.availability();
    }
  },
}));
const output = {
  summary: "native screenshot",
  content: [{ type: "image" as const, data: "fixture", mimeType: "image/png" as const }],
  data: { captureId: "capture" },
  sources: [],
  artifacts: [],
  sideEffectCommitted: false,
  durationMs: 0,
};
const capture = {
  operation: "desktop" as const,
  action: "screenshot" as const,
  application: "TextEdit",
  idempotencyKey: "screenshot",
};
function context(runId: string): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    toolCallId: randomUUID(),
    update() {},
    projection: {
      generationId: runId,
      runId,
      workItemId: randomUUID(),
      conversationId: randomUUID(),
      assistantMessageId: randomUUID(),
      piToolCallId: "fixture",
      toolName: "openerx_desktop",
    },
  };
}
function hostDirectory(): string {
  const directory = state.paths[0];
  if (!directory) throw new Error("fixture host was not created");
  return directory;
}
beforeEach(() => {
  state.paths = [];
  state.credentials = [];
  state.fail = false;
  vi.clearAllMocks();
  state.execute.mockResolvedValue(output);
});
afterEach(async () => {
  await stopScopedDesktopTools();
});

test("reuses native screenshot/control with task-owned captures, owner and isolated empty credentials", async () => {
  const runId = randomUUID();
  const adapter = createScopedDesktopTools(runId);
  expect(state.paths).toEqual([]);
  expect(await adapter.execute(capture, context(runId))).toEqual(output);
  expect(state.execute.mock.calls[0]?.[2]).toEqual({ conversationId: runId, generationId: runId });
  expect(state.paths[0]).toContain("openerx-desktop-task-");
  expect(state.credentials[0]).toBe(join(hostDirectory(), "credentials.bin"));
  expect(existsSync(hostDirectory())).toBe(true);
  await adapter.execute(
    {
      operation: "desktop_control",
      idempotencyKey: "apps",
      request: {
        contractVersion: "desktop_control_v2",
        action: "list_apps",
      },
    },
    context(runId),
  );
  await adapter.stopAll?.();
  await adapter.stopAll?.();
  expect(state.stop).toHaveBeenCalledTimes(1);
  expect(state.close).toHaveBeenCalledTimes(1);
  expect(existsSync(hostDirectory())).toBe(false);
  await expect(adapter.execute(capture, context(runId))).rejects.toThrow("DESKTOP_CANCELLED");
});

test("rejects a missing/foreign trusted generation and non-desktop operations before allocating native state", async () => {
  const runId = randomUUID();
  const adapter = createScopedDesktopTools(runId);
  const withoutOwner = context(runId);
  delete withoutOwner.projection;
  await expect(adapter.execute(capture, withoutOwner)).rejects.toThrow(
    "DESKTOP_CONTEXT_OUT_OF_SCOPE",
  );
  await expect(adapter.execute(capture, context(randomUUID()))).rejects.toThrow(
    "DESKTOP_CONTEXT_OUT_OF_SCOPE",
  );
  await expect(
    adapter.execute(
      {
        operation: "browser",
        action: "navigate",
        url: "https://example.test",
        idempotencyKey: "browser",
      },
      context(runId),
    ),
  ).rejects.toThrow("DESKTOP_OPERATION_NOT_SUPPORTED");
  expect(state.execute).not.toHaveBeenCalled();
  expect(state.paths).toEqual([]);
});

test("retains exclusive desktop ownership between observations and releases it only after stopping", async () => {
  const firstId = randomUUID(),
    secondId = randomUUID();
  const first = createScopedDesktopTools(firstId),
    second = createScopedDesktopTools(secondId);
  await first.execute(capture, context(firstId));
  await expect(second.execute(capture, context(secondId))).rejects.toThrow("DESKTOP_CONTROL_BUSY");
  await first.stopAll?.();
  await second.execute(capture, context(secondId));
  expect(state.paths).toHaveLength(2);
  expect(state.paths[0]).not.toBe(state.paths[1]);
});

test("stop aborts in-flight native work and rejects late results before releasing ownership", async () => {
  const runId = randomUUID(),
    adapter = createScopedDesktopTools(runId);
  let finish: (value: typeof output) => void = () => {};
  state.execute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = adapter.execute(capture, context(runId));
  const rejection = expect(pending).rejects.toThrow("DESKTOP_CANCELLED");
  const stopped = adapter.stopAll?.();
  expect(state.execute.mock.calls[0]?.[1].aborted).toBe(true);
  expect(existsSync(hostDirectory())).toBe(true);
  finish(output);
  await rejection;
  await stopped;
  expect(existsSync(hostDirectory())).toBe(false);
});

test("returns real native readiness and permission reasons without exposing browser status", async () => {
  state.availability.mockResolvedValue({
    availableToolNames: ["openerx_browser", "openerx_desktop"],
    unavailableReasons: {
      "openerx_desktop:interact": "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED",
      openerx_browser: "irrelevant",
    },
    missingPermissions: { openerx_desktop: ["accessibility"], openerx_browser: ["screen_capture"] },
  });
  expect(await getScopedDesktopToolAvailability()).toEqual({
    availableToolNames: ["openerx_desktop"],
    unavailableReasons: { "openerx_desktop:interact": "DESKTOP_ACCESSIBILITY_PERMISSION_REQUIRED" },
    missingPermissions: { openerx_desktop: ["accessibility"] },
  });
  expect(state.close).toHaveBeenCalledTimes(1);
  expect(existsSync(hostDirectory())).toBe(false);
});

test("a failed native initialization removes its temporary profile without taking the desktop lease", async () => {
  const before = readdirSync(tmpdir()).filter((name) => name.startsWith("openerx-desktop-task-"));
  const runId = randomUUID(),
    adapter = createScopedDesktopTools(runId);
  state.fail = true;
  await expect(adapter.execute(capture, context(runId))).rejects.toThrow("fixture host init error");
  expect(readdirSync(tmpdir()).filter((name) => name.startsWith("openerx-desktop-task-"))).toEqual(
    before,
  );
  state.fail = false;
  await adapter.execute(capture, context(runId));
});
