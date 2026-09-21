import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowsInteraction } from "../src/main/desktop-control/windows-interaction";

function child() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      process.emit("close", 0);
      return true;
    }),
  });
  const frames: Array<{ id: string; method: string }> = [];
  process.stdin.on("data", (data) => frames.push(JSON.parse(data.toString())));
  return {
    process: process as unknown as ChildProcessWithoutNullStreams,
    frames,
    stdout: process.stdout,
    kill: process.kill,
    reply(result: unknown) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: frames.at(-1)?.id, result })}\n`,
      );
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("persistent Windows interaction process", () => {
  it("keeps focus and input in one process and replaces an exited process", async () => {
    const first = child();
    const second = child();
    const spawn = vi
      .fn()
      .mockResolvedValueOnce(first.process)
      .mockResolvedValueOnce(second.process);
    const transport = new WindowsInteraction(spawn);
    for (const method of ["focus", "act"] as const) {
      const pending = transport.request(method, {}, new AbortController().signal);
      await Promise.resolve();
      first.reply({ ok: true });
      await expect(pending).resolves.toEqual({ ok: true });
    }
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(first.frames.map((frame) => frame.method)).toEqual(["focus", "act"]);
    first.process.emit("close", 0);
    const pending = transport.request("focus", {}, new AbortController().signal);
    await Promise.resolve();
    second.reply({ focused: true });
    await expect(pending).resolves.toEqual({ focused: true });
    expect(spawn).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it("kills cancelled work exactly once and accepts later work only in a fresh process", async () => {
    const first = child();
    const second = child();
    const spawn = vi
      .fn()
      .mockResolvedValueOnce(first.process)
      .mockResolvedValueOnce(second.process);
    const transport = new WindowsInteraction(spawn);
    const controller = new AbortController();
    const pending = transport.request("act", {}, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow("TOOL_CANCELLED");
    first.reply({ late: true });
    expect(first.kill).toHaveBeenCalledTimes(1);
    const next = transport.request("focus", {}, new AbortController().signal);
    await Promise.resolve();
    second.reply({ focused: true });
    await expect(next).resolves.toEqual({ focused: true });
    transport.close();
  });

  it("terminates a hung provider on timeout", async () => {
    vi.useFakeTimers();
    const worker = child();
    const transport = new WindowsInteraction(async () => worker.process, 50);
    const pending = transport.request("act", {}, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("DESKTOP_NATIVE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(worker.kill).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch or resurrect a process when close races with spawning", async () => {
    const worker = child();
    let release!: (value: ChildProcessWithoutNullStreams) => void;
    const transport = new WindowsInteraction(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = transport.request("act", {}, new AbortController().signal);
    transport.close();
    release(worker.process);
    await expect(pending).rejects.toThrow("TOOL_CANCELLED");
    expect(worker.frames).toHaveLength(0);
    expect(worker.kill).toHaveBeenCalledTimes(1);
  });

  it.each(["wrong-id", "malformed", "oversize"])("fails closed for %s responses", async (kind) => {
    const worker = child();
    const transport = new WindowsInteraction(async () => worker.process);
    const pending = transport.request("focus", {}, new AbortController().signal);
    await Promise.resolve();
    worker.stdout.write(
      kind === "oversize"
        ? Buffer.alloc(18 * 1024 * 1024 + 1)
        : kind === "malformed"
          ? "invalid\n"
          : '{"jsonrpc":"2.0","id":"wrong","result":true}\n',
    );
    await expect(pending).rejects.toThrow(
      kind === "oversize" ? "DESKTOP_RESPONSE_TOO_LARGE" : "DESKTOP_PROTOCOL_INVALID",
    );
    expect(worker.kill).toHaveBeenCalledTimes(1);
  });

  it("rejects overlapping input without dispatching it", async () => {
    const worker = child();
    const transport = new WindowsInteraction(async () => worker.process);
    const pending = transport.request("focus", {}, new AbortController().signal);
    await Promise.resolve();
    await expect(transport.request("act", {}, new AbortController().signal)).rejects.toThrow(
      "DESKTOP_INTERACTION_BUSY",
    );
    expect(worker.frames).toHaveLength(1);
    worker.reply(true);
    await pending;
    transport.close();
  });
});
