import type { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppServiceRequest, ModelAuthorization } from "@openerx/contracts";
import { afterEach, beforeEach, expect, type Mock, test, vi } from "vitest";
import { AppServiceSupervisor } from "../src/main/app-service-supervisor";

type TestPort = EventEmitter & {
  postMessage: Mock<(frame: Record<string, unknown>) => void>;
  start: Mock;
  close: Mock;
};
type TestChild = EventEmitter & {
  postMessage: Mock<(frame: Record<string, unknown>) => void>;
  kill: Mock;
};
const electron = vi.hoisted(() => ({ ports: [] as TestPort[], children: [] as TestChild[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Port extends EventEmitter {
    postMessage = vi.fn();
    start = vi.fn();
    close = vi.fn();
  }
  return {
    MessageChannelMain: class {
      port1 = new Port();
      port2 = new Port();
      constructor() {
        electron.ports.push(this.port1);
      }
    },
    utilityProcess: {
      fork: vi.fn(() => {
        const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() });
        electron.children.push(child);
        return child;
      }),
    },
  };
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing Electron fixture");
  return value;
}

let directory: string;
let supervisor: AppServiceSupervisor;
beforeEach(() => {
  electron.ports.length = 0;
  electron.children.length = 0;
  directory = mkdtempSync(path.join(tmpdir(), "openerx-workspace-access-"));
  supervisor = new AppServiceSupervisor(directory);
});
afterEach(() => {
  supervisor.stop();
  rmSync(directory, { recursive: true, force: true });
});
async function ready(started: Promise<void>, index = 0) {
  // The optional authority resolver may yield before spawning.
  await Promise.resolve();
  await Promise.resolve();
  const bootstrap = required(
    required(required(electron.children[index + 1]).postMessage.mock.calls[0])[0],
  );
  required(electron.ports[index]).emit("message", {
    data: { kind: "app-service.ready", contractVersion: 1, nonce: bootstrap.nonce },
  });
  await started;
}

test("enterprise mode rejects personal reads and writes without starting workers or automations", async () => {
  supervisor.setWorkspaceAccessAllowed(false);
  for (const request of [
    { command: "chat.list", input: {} },
    { command: "project.list", input: {} },
    { command: "file.list", input: {} },
    { command: "automation.list", input: {} },
  ] as const)
    await expect(supervisor.request(request as AppServiceRequest)).rejects.toThrow(
      "ENTERPRISE_WORKSPACE_REQUIRED",
    );
  expect(electron.children).toHaveLength(0);
});

test("membership revalidation can close personal access before any database request is posted", async () => {
  await ready(supervisor.start());
  supervisor.setWorkspaceAccessResolver(async () => supervisor.setWorkspaceAccessAllowed(false));
  await expect(supervisor.request({ command: "chat.list", input: {} })).rejects.toThrow(
    "ENTERPRISE_WORKSPACE_REQUIRED",
  );
  expect(electron.children.every((child) => child.kill.mock.calls.length === 1)).toBe(true);
  expect(
    required(electron.ports[0]).postMessage.mock.calls.some(
      ([frame]) => frame.kind === "app-service.request",
    ),
  ).toBe(false);
});

test("switching authority cancels pending reads and permits a fresh personal runtime later", async () => {
  await ready(supervisor.start());
  const pending = supervisor.request({ command: "chat.list", input: {} });
  const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  supervisor.setWorkspaceAccessAllowed(false);
  await rejected;
  await supervisor.switchProfile(path.join(directory, "another-account"), "another-account", false);
  expect(electron.children).toHaveLength(3);
  supervisor.setWorkspaceAccessAllowed(true);
  await ready(supervisor.start(), 3);
  expect(electron.children).toHaveLength(6);
});

test("a delayed model credential cannot leak into a replacement account worker", async () => {
  let authorize!: (value: ModelAuthorization) => void;
  supervisor.setModelAuthorizationProvider(
    () =>
      new Promise((resolve) => {
        authorize = resolve;
      }),
  );
  await ready(supervisor.start());
  required(electron.ports[0]).emit("message", {
    data: {
      kind: "model.authorization.request",
      requestId: "11111111-1111-4111-8111-111111111111",
      accountId: "22222222-2222-4222-8222-222222222222",
      rejectedAccessToken: "expired".repeat(6),
    },
  });
  await Promise.resolve();
  expect(authorize).toBeTypeOf("function");
  supervisor.setWorkspaceAccessAllowed(false);
  await supervisor.switchProfile(path.join(directory, "another-account"), "another-account", false);
  supervisor.setWorkspaceAccessAllowed(true);
  await ready(supervisor.start(), 3);
  authorize({
    accountId: "22222222-2222-4222-8222-222222222222",
    accessToken: "old-account-token".repeat(3),
    accessTokenExpiresAt: "2026-10-10T00:00:00.000Z",
    platformBaseUrl: "https://model.example.test",
    modelApiVersion: "v3",
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(
    required(electron.ports[3]).postMessage.mock.calls.some(
      ([frame]) => frame.kind === "model.authorization.response",
    ),
  ).toBe(false);
});

test("an old crash retry cannot start a second runtime after an identity switch", async () => {
  vi.useFakeTimers();
  try {
    await ready(supervisor.start());
    required(electron.children[1]).emit("exit", 1);
    supervisor.setWorkspaceAccessAllowed(false);
    await supervisor.switchProfile(path.join(directory, "new-account"), "new-account", false);
    supervisor.setWorkspaceAccessAllowed(true);
    await ready(supervisor.start(), 3);
    await vi.advanceTimersByTimeAsync(200);
    expect(electron.children).toHaveLength(6);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
