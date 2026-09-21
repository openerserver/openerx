import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DESKTOP_CONTROL_VERSION } from "@openerx/contracts";

interface Worker {
  child: ChildProcessWithoutNullStreams;
  pending?: { id: string; finish(error?: Error, value?: unknown): void };
  chunks: Buffer[];
  size: number;
  discarded?: boolean;
}

// Only focus/input share this process. Observations and takeover monitoring are
// isolated so a hung provider cannot prevent cancellation or user takeover.
export class WindowsInteraction {
  #worker: Worker | undefined;
  #busy = false;
  #epoch = 0;
  constructor(
    private readonly spawn: (signal: AbortSignal) => Promise<ChildProcessWithoutNullStreams>,
    private readonly timeoutMs = 12_000,
  ) {}

  #discard(worker: Worker, error: Error) {
    if (worker.discarded) return;
    worker.discarded = true;
    if (this.#worker === worker) this.#worker = undefined;
    worker.pending?.finish(error);
    worker.child.kill();
  }

  async request(method: "focus" | "act", params: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.#busy) throw new Error("DESKTOP_INTERACTION_BUSY");
    this.#busy = true;
    const epoch = this.#epoch;
    try {
      const id = randomUUID();
      const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params: { contractVersion: DESKTOP_CONTROL_VERSION, ...params } })}\n`;
      if (Buffer.byteLength(payload, "utf8") > 256 * 1024)
        throw new Error("DESKTOP_REQUEST_TOO_LARGE");
      let worker = this.#worker;
      if (!worker) {
        const child = await this.spawn(signal);
        if (epoch !== this.#epoch || signal.aborted) {
          child.kill();
          throw new Error("TOOL_CANCELLED");
        }
        worker = { child, chunks: [], size: 0 };
        this.#worker = worker;
        const current = worker;
        child.once("error", () => this.#discard(current, new Error("DESKTOP_HELPER_UNAVAILABLE")));
        child.once("close", () => this.#discard(current, new Error("DESKTOP_HELPER_UNAVAILABLE")));
        child.stdin.on("error", () =>
          this.#discard(current, new Error("DESKTOP_HELPER_UNAVAILABLE")),
        );
        child.stdout.on("data", (chunk: Buffer) => {
          if (!current.pending) {
            this.#discard(current, new Error("DESKTOP_PROTOCOL_INVALID"));
            return;
          }
          current.size += chunk.length;
          if (current.size > 18 * 1024 * 1024) {
            this.#discard(current, new Error("DESKTOP_RESPONSE_TOO_LARGE"));
            return;
          }
          current.chunks.push(chunk);
          if (!chunk.includes(10)) return;
          try {
            const frame = JSON.parse(Buffer.concat(current.chunks).toString("utf8"));
            if (frame?.jsonrpc !== "2.0" || frame.id !== current.pending.id)
              throw new Error("DESKTOP_PROTOCOL_INVALID");
            if (frame.error) {
              const message = frame.error.message;
              throw new Error(
                typeof message === "string" && /^DESKTOP_[A-Z_]+$/u.test(message)
                  ? message
                  : "DESKTOP_NATIVE_FAILED",
              );
            }
            if (!("result" in frame)) throw new Error("DESKTOP_PROTOCOL_INVALID");
            current.pending.finish(undefined, frame.result);
          } catch (error) {
            this.#discard(
              current,
              error instanceof Error && /^DESKTOP_/u.test(error.message)
                ? error
                : new Error("DESKTOP_PROTOCOL_INVALID"),
            );
          }
        });
      }
      const current = worker;
      return await new Promise<unknown>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, value?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          current.pending = undefined;
          current.chunks = [];
          current.size = 0;
          if (error) reject(error);
          else resolve(value);
        };
        const abort = () => this.#discard(current, new Error("TOOL_CANCELLED"));
        const timer = setTimeout(
          () => this.#discard(current, new Error("DESKTOP_NATIVE_TIMEOUT")),
          this.timeoutMs,
        );
        current.pending = { id, finish };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
        try {
          current.child.stdin.write(payload);
        } catch {
          this.#discard(current, new Error("DESKTOP_HELPER_UNAVAILABLE"));
        }
      });
    } finally {
      this.#busy = false;
    }
  }

  close() {
    this.#epoch++;
    if (this.#worker) this.#discard(this.#worker, new Error("TOOL_CANCELLED"));
  }
}
