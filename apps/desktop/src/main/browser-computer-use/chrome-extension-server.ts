import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import manifest from "../../../browser-extension/identity.json";
import {
  type BrowserBridgeConnection,
  type BrowserBridgeEndpoint,
  BrowserBridgeGrantRegistry,
} from "./browser-bridge-grant-registry";
import {
  type BrowserBridgePostMessage,
  type BrowserBridgeRequest,
  browserBridgeAuthorizeTabMessageSchema,
} from "./browser-bridge-protocol";
import { BrowserObservationError } from "./ui-observation-registry";

export const OPENERX_EXTENSION_ID = manifest.extensionId;
const extensionOrigin = `chrome-extension://${OPENERX_EXTENSION_ID}`;
const execFileAsync = promisify(execFile);

type Delivery = { message: BrowserBridgeRequest | BrowserBridgePostMessage; expiresAt: number };
class PollingEndpoint implements BrowserBridgeEndpoint {
  queue: Delivery[] = [];
  waiter: (() => void) | null = null;
  listener: ((message: unknown) => void) | null = null;
  pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  request(message: BrowserBridgeRequest, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) return Promise.reject(new BrowserObservationError("BROWSER_CANCELLED"));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.pending.delete(message.requestId);
        this.queue = this.queue.filter(
          (item) => !("requestId" in item.message) || item.message.requestId !== message.requestId,
        );
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const abort = () => fail(new BrowserObservationError("BROWSER_CANCELLED"));
      const timer = setTimeout(
        () => fail(new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED")),
        12000,
      );
      this.pending.set(message.requestId, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: fail,
      });
      signal.addEventListener("abort", abort, { once: true });
      this.queue.push({ message, expiresAt: Date.now() + 11000 });
      this.waiter?.();
    });
  }
  post(message: BrowserBridgePostMessage): void {
    if (this.queue.length >= 64) throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    this.queue.push({ message, expiresAt: Date.now() + 30000 });
    this.waiter?.();
  }
  subscribe(listener: (message: unknown) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  receive(raw: unknown): void {
    const data = raw as { kind?: string; requestId?: string };
    if (data.kind === "event") this.listener?.(raw);
    else if (data.requestId) this.pending.get(data.requestId)?.resolve(raw);
  }
  close(): void {
    for (const pending of [...this.pending.values()])
      pending.reject(new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED"));
    this.queue = [];
    this.waiter?.();
  }
}

/** Only the pinned extension, holding an explicit pairing secret, can access this loopback channel. */
export class ChromeExtensionServer {
  readonly token = randomBytes(32).toString("base64url");
  readonly grants = new BrowserBridgeGrantRegistry({
    expectedExtensionOrigin: `${extensionOrigin}/`,
    mainChannelNonce: this.token,
    supportedApplicationIds: ["com.google.Chrome"],
  });
  #server: Server | null = null;
  #starting: Promise<void> | null = null;
  #port = 0;
  #endpoint: PollingEndpoint | null = null;
  #connection: BrowserBridgeConnection | null = null;
  #lastSeen = 0;
  readonly #timer: ReturnType<typeof setInterval>;
  constructor(private readonly resolveChromePid = chromeProcessId) {
    this.#timer = setInterval(() => {
      if (this.#connection && Date.now() - this.#lastSeen > 45000) this.disconnect();
    }, 5000);
    this.#timer.unref();
  }
  async pairingCode(): Promise<string> {
    if (!this.#starting)
      this.#starting = this.#start().catch((error) => {
        this.#starting = null;
        throw error;
      });
    await this.#starting;
    return `http://127.0.0.1:${this.#port}#${this.token}`;
  }
  async #start(): Promise<void> {
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    server.maxConnections = 16;
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("BROWSER_BRIDGE_DISCONNECTED");
    this.#port = address.port;
  }
  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown) => {
      if (!response.destroyed && !response.writableEnded) {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(body));
      }
    };
    try {
      if (
        request.headers.host !== `127.0.0.1:${this.#port}` ||
        request.headers.origin !== extensionOrigin
      )
        return reply(403, { error: "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED" });
      response.setHeader("Access-Control-Allow-Origin", extensionOrigin);
      response.setHeader("Vary", "Origin");
      if (request.method === "OPTIONS") {
        response.setHeader(
          "Access-Control-Allow-Headers",
          "authorization,content-type,x-openerx-connection",
        );
        response.setHeader("Access-Control-Allow-Methods", "POST,GET");
        return reply(204, null);
      }
      const supplied = request.headers.authorization ?? "";
      const expected = `Bearer ${this.token}`;
      if (
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        return reply(403, { error: "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED" });
      if (request.url === "/connect" && request.method === "POST") {
        this.disconnect();
        this.#endpoint = new PollingEndpoint();
        this.#connection = this.grants.connect({
          callerOrigin: `${extensionOrigin}/`,
          mainChannelNonce: this.token,
          endpoint: this.#endpoint,
        });
        this.#lastSeen = Date.now();
        return reply(200, { connectionId: this.#connection.connectionId });
      }
      const connection = this.#connection,
        endpoint = this.#endpoint;
      if (
        !connection ||
        !endpoint ||
        request.headers["x-openerx-connection"] !== connection.connectionId
      )
        return reply(409, { error: "BROWSER_BRIDGE_DISCONNECTED" });
      this.#lastSeen = Date.now();
      if (request.url === "/poll" && request.method === "POST") {
        request.resume();
        if (endpoint.waiter) return reply(409, { error: "BROWSER_BRIDGE_BUSY" });
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            clearTimeout(timer);
            endpoint.waiter = null;
            response.off("close", cleanup);
            resolve();
          };
          const timer = setTimeout(cleanup, 20000);
          endpoint.waiter = cleanup;
          response.once("close", cleanup);
          if (endpoint.queue.length) cleanup();
        });
        if (this.#endpoint !== endpoint)
          return reply(409, { error: "BROWSER_BRIDGE_DISCONNECTED" });
        return reply(200, {
          deliveries: endpoint.queue.splice(0).filter((item) => item.expiresAt > Date.now()),
        });
      }
      if (request.method !== "POST") return reply(405, {});
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) return reply(413, {});
        chunks.push(chunk);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (request.url === "/authorize") {
        const message = browserBridgeAuthorizeTabMessageSchema.parse(body);
        const nativeProcessId = await this.resolveChromePid();
        if (this.#connection !== connection)
          return reply(409, { error: "BROWSER_BRIDGE_DISCONNECTED" });
        return reply(
          200,
          connection.authorizeTab(message, {
            applicationId: "com.google.Chrome",
            nativeProcessId,
            nativeWindowId: `chrome_window_${message.binding.browserWindowId}`,
          }),
        );
      }
      if (request.url === "/message") {
        endpoint.receive(body);
        return reply(200, { ok: true });
      }
      if (request.url === "/disconnect") {
        this.disconnect();
        return reply(200, { ok: true });
      }
      return reply(404, {});
    } catch {
      reply(400, { error: "BROWSER_BRIDGE_REQUEST_FAILED" });
    }
  }
  disconnect(): void {
    this.#connection?.disconnect();
    this.#connection = null;
    this.#endpoint?.close();
    this.#endpoint = null;
  }
  close(): void {
    clearInterval(this.#timer);
    this.disconnect();
    this.grants.close();
    this.#server?.close();
    this.#server?.closeAllConnections();
  }
}

async function chromeProcessId(): Promise<number> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -ExpandProperty Id",
      ],
      { timeout: 3000, windowsHide: true },
    );
    const pids = stdout.trim().split(/\s+/).map(Number).filter(Number.isSafeInteger);
    if (pids.length === 1 && pids[0]! > 0) return pids[0]!;
  } else {
    const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,comm="], { timeout: 3000 });
    const pids = stdout
      .split("\n")
      .filter((line) => /\/(?:Google Chrome|chrome|chromium)$/.test(line.trim()))
      .map((line) => Number(line.trim().split(/\s+/)[0]));
    if (pids.length === 1 && pids[0]! > 0) return pids[0]!;
  }
  throw new BrowserObservationError("BROWSER_BACKEND_UNAVAILABLE");
}
