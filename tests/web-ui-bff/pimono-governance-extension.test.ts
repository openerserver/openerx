/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const extensionModulePath =
  "../../control-plane/web-ui-bff/src/modules/agent-control/pimono-governance-extension";

type ToolCallHandler = (
  event: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
  ctx: { ui: { confirm(title: string, message: string): Promise<boolean> } },
) => Promise<{ block?: boolean; reason?: string } | void>;

function createRegisteredHandler() {
  let handler: ToolCallHandler | undefined;
  return {
    api: {
      on(event: "tool_call", next: ToolCallHandler) {
        if (event === "tool_call") {
          handler = next;
        }
      },
    },
    getHandler() {
      if (!handler) {
        throw new Error("tool_call handler was not registered");
      }
      return handler;
    },
  };
}

beforeEach(() => {
  process.env.OPENERX_PI_MONO_ALLOWED_ROOTS = JSON.stringify(["/workspace"]);
});

afterEach(() => {
  process.env.OPENERX_PI_MONO_ALLOWED_ROOTS = undefined;
});

describe("pimono governance extension", () => {
  test("requests external_directory approval for file tools outside allowed roots", async () => {
    const { default: registerExtension } = await import(extensionModulePath);
    const registration = createRegisteredHandler();
    registerExtension(registration.api);
    const handler = registration.getHandler();
    const confirmMock = mock(async () => true);

    const result = await handler(
      {
        toolCallId: "tool-read-1",
        toolName: "read",
        input: { path: "/tmp/demo.txt" },
      },
      { ui: { confirm: confirmMock } },
    );

    expect(result).toBeUndefined();
    expect(confirmMock).toHaveBeenCalledWith(
      "external_directory",
      expect.stringContaining('"filepath":"/tmp/demo.txt"'),
    );
  });

  test("blocks external_directory access when approval is rejected", async () => {
    const { default: registerExtension } = await import(extensionModulePath);
    const registration = createRegisteredHandler();
    registerExtension(registration.api);
    const handler = registration.getHandler();

    const result = await handler(
      {
        toolCallId: "tool-read-2",
        toolName: "read",
        input: { path: "/tmp/rejected.txt" },
      },
      { ui: { confirm: async () => false } },
    );

    expect(result).toEqual({
      block: true,
      reason: "Blocked external directory access to /tmp/rejected.txt",
    });
  });

  test("does not request approval for paths inside allowed roots", async () => {
    const { default: registerExtension } = await import(extensionModulePath);
    const registration = createRegisteredHandler();
    registerExtension(registration.api);
    const handler = registration.getHandler();
    const confirmMock = mock(async () => true);

    const result = await handler(
      {
        toolCallId: "tool-read-3",
        toolName: "read",
        input: { path: "/workspace/src/index.ts" },
      },
      { ui: { confirm: confirmMock } },
    );

    expect(result).toBeUndefined();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  test("blocks writes to protected paths without prompting", async () => {
    const { default: registerExtension } = await import(extensionModulePath);
    const registration = createRegisteredHandler();
    registerExtension(registration.api);
    const handler = registration.getHandler();
    const confirmMock = mock(async () => true);

    const result = await handler(
      {
        toolCallId: "tool-write-1",
        toolName: "write",
        input: { path: "/workspace/.env.local", content: "SECRET=1" },
      },
      { ui: { confirm: confirmMock } },
    );

    expect(result).toEqual({
      block: true,
      reason: "Blocked write to protected path /workspace/.env.local",
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  test("requests command_execution approval for dangerous or external bash commands", async () => {
    const { default: registerExtension } = await import(extensionModulePath);
    const registration = createRegisteredHandler();
    registerExtension(registration.api);
    const handler = registration.getHandler();
    const confirmMock = mock(async () => true);

    const result = await handler(
      {
        toolCallId: "tool-bash-1",
        toolName: "bash",
        input: { command: "cat /tmp/demo.txt && sudo rm -rf /tmp/demo.txt" },
      },
      { ui: { confirm: confirmMock } },
    );

    expect(result).toBeUndefined();
    expect(confirmMock).toHaveBeenCalledWith(
      "command_execution",
      expect.stringContaining('"command":"cat /tmp/demo.txt && sudo rm -rf /tmp/demo.txt"'),
    );
  });
});