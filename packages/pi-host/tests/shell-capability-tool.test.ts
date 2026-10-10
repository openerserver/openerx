import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createProductCapabilityTools,
  type PiCapabilityToolTransport,
  shellCommandDescription,
} from "../src/capability-tools";

describe("shell platform guidance", () => {
  it("gives Windows executable, batch and Unicode guidance without pretending to parse shell syntax", () => {
    const description = shellCommandDescription("win32");
    expect(description).toContain("Host OS: Windows");
    expect(description).toContain("cmd.exe /d /c");
    expect(description).toContain("powershell.exe");
    expect(description).toContain("OutputEncoding");
    expect(description).toContain("literal argv");
    expect(shellCommandDescription("darwin")).toContain("/bin/sh -c");
    expect(shellCommandDescription("linux")).toContain(
      "unavailable without a supported OS sandbox",
    );
  });

  it("sends the executable and literal arguments unchanged instead of implicitly wrapping a shell", async () => {
    const request = vi.fn<PiCapabilityToolTransport["request"]>(async () => ({
      summary: "done",
      content: [],
      data: {},
      sources: [],
      artifacts: [],
      sideEffectCommitted: true,
      durationMs: 1,
    }));
    const shell = createProductCapabilityTools({
      generationId: randomUUID(),
      conversationId: randomUUID(),
      branchId: randomUUID(),
      assistantMessageId: randomUUID(),
      transport: { request },
    }).find(({ name }) => name === "openerx_shell");
    if (!shell) throw new Error("shell tool missing");
    const args = ["literal&argument", "中文🙂", "$HOME", "space in argument"];
    await shell.execute(
      "literal-argv",
      {
        workspaceGrantId: randomUUID(),
        command: "node",
        args,
        encoding: { stdout: "cp936", stderr: "utf16le" },
      },
      undefined,
      undefined,
      {} as never,
    );
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      operation: {
        command: "node",
        args,
        allowNetwork: false,
        background: false,
        encoding: { stdin: "utf8", stdout: "cp936", stderr: "utf16le" },
      },
    });
  });
});
