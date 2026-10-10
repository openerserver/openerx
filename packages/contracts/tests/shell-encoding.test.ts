import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shellEncodingSchema, toolOperationSchema } from "../src/tool";

const operation = {
  operation: "shell_execute",
  command: "cmd.exe",
  args: ["/d", "/u", "/c", "echo 中文"],
  cwd: "C:/workspace",
  timeoutMs: 5_000,
  background: false,
  allowNetwork: false,
  idempotencyKey: randomUUID(),
};

describe("shell encoding contract", () => {
  it("keeps old calls valid and defaults omitted members of explicit encoding", () => {
    expect(toolOperationSchema.parse(operation)).not.toHaveProperty("encoding");
    expect(
      toolOperationSchema.parse({ ...operation, encoding: { stdout: "utf16le", stderr: "cp936" } }),
    ).toMatchObject({
      encoding: { stdin: "utf8", stdout: "utf16le", stderr: "cp936" },
      command: operation.command,
      args: operation.args,
    });
  });
  it("rejects guessing, unsupported labels, and unknown stream names", () => {
    for (const encoding of [{ stdout: "auto" }, { stdin: "latin1" }, { output: "utf8" }])
      expect(toolOperationSchema.safeParse({ ...operation, encoding }).success).toBe(false);
    expect(shellEncodingSchema.parse({})).toEqual({
      stdin: "utf8",
      stdout: "utf8",
      stderr: "utf8",
    });
  });
});
