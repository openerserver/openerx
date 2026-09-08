import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { DESKTOP_CONTROL_VERSION } from "@openerx/contracts";
import { z } from "zod";
import {
  assertTargetIdentity,
  type DesktopNativeDriver,
  type DesktopObservedAction,
  type NativeElement,
  type NativeObservation,
  type NativeTarget,
  nativeObservationSchema,
  nativeTargetSchema,
} from "./driver";
import { WindowsInteraction } from "./windows-interaction";

export class WindowsDesktopDriver implements DesktopNativeDriver {
  readonly #children = new Set<ChildProcessWithoutNullStreams>();
  #verified: string | null = null;
  readonly #interaction: WindowsInteraction;
  constructor(
    private readonly executable: string,
    private readonly manifestPath: string,
    private readonly timeoutMs = 12_000,
  ) {
    this.#interaction = new WindowsInteraction(
      (signal) => this.#spawn("--session", signal),
      timeoutMs,
    );
  }

  async #verify(): Promise<void> {
    const info = await stat(this.executable).catch(() => {
      throw new Error("DESKTOP_HELPER_MISSING");
    });
    const key = `${info.size}:${info.mtimeMs}`;
    if (this.#verified === key) return;
    const manifest = z
      .object({
        contractVersion: z.literal(DESKTOP_CONTROL_VERSION),
        architecture: z.literal("x64"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .parse(JSON.parse(await readFile(this.manifestPath, "utf8")));
    if (process.arch !== manifest.architecture) throw new Error("DESKTOP_HELPER_ARCH_UNSUPPORTED");
    const hash = createHash("sha256")
      .update(await readFile(this.executable))
      .digest("hex");
    if (hash !== manifest.sha256) throw new Error("DESKTOP_HELPER_INTEGRITY_FAILED");
    this.#verified = key;
  }

  async #spawn(
    mode: "--request" | "--monitor" | "--session",
    signal: AbortSignal,
  ): Promise<ChildProcessWithoutNullStreams> {
    signal.throwIfAborted();
    await this.#verify();
    signal.throwIfAborted();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.executable, [mode, String(process.pid)], {
        windowsHide: true,
        stdio: "pipe",
      });
    } catch {
      throw new Error("DESKTOP_HELPER_UNAVAILABLE");
    }
    this.#children.add(child);
    child.once("close", () => this.#children.delete(child));
    // Never include raw stdout/stderr (which can contain app data) in errors.
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    return child;
  }

  async #request(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (method === "focus" || method === "act")
      return this.#interaction.request(method, params, signal);
    const child = await this.#spawn("--request", signal);
    return await new Promise((resolve, reject) => {
      const id = randomUUID();
      let size = 0;
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) {
          child.kill();
          reject(error);
        } else resolve(value);
      };
      const abort = () => finish(new Error("TOOL_CANCELLED"));
      const timer = setTimeout(() => finish(new Error("DESKTOP_NATIVE_TIMEOUT")), this.timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", () => finish(new Error("DESKTOP_HELPER_UNAVAILABLE")));
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 18 * 1024 * 1024) finish(new Error("DESKTOP_RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      child.once("close", () => {
        if (settled) return;
        try {
          const frame = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
            string,
            unknown
          >;
          if (frame.jsonrpc !== "2.0" || frame.id !== id)
            throw new Error("DESKTOP_PROTOCOL_INVALID");
          if (frame.error) {
            const message = (frame.error as { message?: unknown }).message;
            throw new Error(
              typeof message === "string" && /^DESKTOP_[A-Z_]+$/u.test(message)
                ? message
                : "DESKTOP_NATIVE_FAILED",
            );
          }
          if (!("result" in frame)) throw new Error("DESKTOP_PROTOCOL_INVALID");
          finish(undefined, frame.result);
        } catch (error) {
          finish(
            error instanceof Error && /^DESKTOP_/u.test(error.message)
              ? error
              : new Error("DESKTOP_PROTOCOL_INVALID"),
          );
        }
      });
      if (signal.aborted) {
        abort();
        return;
      }
      child.stdin.end(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params: { contractVersion: DESKTOP_CONTROL_VERSION, ...params } })}\n`,
      );
    });
  }

  async probe(signal: AbortSignal): Promise<void> {
    z.object({
      contractVersion: z.literal(DESKTOP_CONTROL_VERSION),
      interactive: z.literal(true),
      architecture: z.literal("x64"),
    })
      .strict()
      .parse(await this.#request("probe", {}, signal));
  }
  async list(signal: AbortSignal): Promise<NativeTarget[]> {
    return nativeTargetSchema
      .array()
      .max(128)
      .parse(await this.#request("list", {}, signal));
  }
  async open(applicationId: string, signal: AbortSignal): Promise<void> {
    z.object({ launched: z.literal(true) })
      .strict()
      .parse(await this.#request("open", { applicationId }, signal));
  }
  async focus(target: NativeTarget, signal: AbortSignal): Promise<void> {
    z.object({ focused: z.literal(true) })
      .strict()
      .parse(await this.#request("focus", { target }, signal));
  }
  async observe(target: NativeTarget, signal: AbortSignal): Promise<NativeObservation> {
    const observation = nativeObservationSchema.parse(
      await this.#request("observe", { target }, signal),
    );
    assertTargetIdentity(target, observation.target);
    if (observation.pngBase64) {
      const png = Buffer.from(observation.pngBase64, "base64");
      if (
        png.length < 24 ||
        !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        png.readUInt32BE(16) !== observation.imageWidth ||
        png.readUInt32BE(20) !== observation.imageHeight
      )
        throw new Error("DESKTOP_CAPTURE_INVALID");
    } else if (observation.imageWidth !== 0 || observation.imageHeight !== 0)
      throw new Error("DESKTOP_CAPTURE_INVALID");
    return observation;
  }
  async act(
    target: NativeTarget,
    observation: NativeObservation,
    action: DesktopObservedAction,
    element: NativeElement | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const params: Record<string, unknown> = {
      ...action,
      target,
      revision: observation.revision,
      ...(element ? { runtimeId: element.runtimeId } : {}),
    };
    if ("x" in action) {
      if (
        !observation.pngBase64 ||
        action.x >= observation.imageWidth ||
        action.y >= observation.imageHeight
      )
        throw new Error("DESKTOP_COORDINATES_INVALID");
      params.screenX =
        target.bounds.x + Math.floor((action.x * target.bounds.width) / observation.imageWidth);
      params.screenY =
        target.bounds.y + Math.floor((action.y * target.bounds.height) / observation.imageHeight);
    }
    z.object({ dispatched: z.literal(true) })
      .strict()
      .parse(await this.#request("act", params, signal));
  }

  async monitor(
    onInput: () => void,
    onLost: () => void,
    signal: AbortSignal,
  ): Promise<{ close(): void }> {
    const child = await this.#spawn("--monitor", signal);
    return await new Promise((resolve, reject) => {
      let ready = false;
      let closed = false;
      const lines = createInterface({ input: child.stdout });
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        lines.close();
        child.kill();
      };
      const fail = () => {
        if (closed) return;
        const wasReady = ready;
        close();
        if (wasReady) {
          this.#interaction.close();
          onLost();
        } else reject(new Error("DESKTOP_MONITOR_UNAVAILABLE"));
      };
      const abort = () => {
        close();
        if (!ready) reject(new Error("TOOL_CANCELLED"));
      };
      const timer = setTimeout(fail, 4000);
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", fail);
      child.once("close", fail);
      lines.on("line", (line) => {
        if (closed) return;
        if (line === '{"event":"ready"}' && !ready) {
          ready = true;
          clearTimeout(timer);
          resolve({ close });
        } else if (line === '{"event":"user_input"}' && ready) {
          this.#interaction.close();
          onInput();
        } else fail();
      });
      if (signal.aborted) abort();
    });
  }
  cancelInteractions(): void {
    this.#interaction.close();
  }
  close(): void {
    this.cancelInteractions();
    for (const child of this.#children) child.kill();
    this.#children.clear();
  }
}
