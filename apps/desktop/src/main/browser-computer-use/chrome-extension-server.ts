import { execFile } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
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
  type BrowserDiscoveredTab,
  type BrowserManagementRequest,
  browserBridgeAuthorizeTabMessageSchema,
  browserTabListSchema,
} from "./browser-bridge-protocol";
import { type BrowserSitePermissions, browserSiteHost } from "./browser-site-permissions";
import { BrowserObservationError } from "./ui-observation-registry";

export const OPENERX_EXTENSION_ID = manifest.extensionId;
const extensionOrigin = `chrome-extension://${OPENERX_EXTENSION_ID}`;
const execFileAsync = promisify(execFile);

type Delivery = {
  message: BrowserBridgeRequest | BrowserBridgePostMessage | BrowserManagementRequest;
  expiresAt: number;
};
class PollingEndpoint implements BrowserBridgeEndpoint {
  constructor(private readonly onPost: (message: BrowserBridgePostMessage) => void = () => {}) {}
  queue: Delivery[] = [];
  waiter: (() => void) | null = null;
  listener: ((message: unknown) => void) | null = null;
  pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void; signal: AbortSignal }
  >();
  request(
    message: BrowserBridgeRequest | BrowserManagementRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
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
        180000,
      );
      this.pending.set(message.requestId, {
        signal,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: fail,
      });
      signal.addEventListener("abort", abort, { once: true });
      this.queue.push({ message, expiresAt: Date.now() + 175000 });
      this.waiter?.();
    });
  }
  post(message: BrowserBridgePostMessage): void {
    this.onPost(message);
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
  token = randomBytes(32).toString("base64url");
  readonly grants: BrowserBridgeGrantRegistry;
  readonly #nonce = randomBytes(32).toString("base64url");
  #discovered = new Map<string, BrowserDiscoveredTab>();
  #intents = new Map<
    string,
    { scope: string; signal: AbortSignal; url: string; tab?: BrowserDiscoveredTab }
  >();
  #grantScopes = new Map<string, { scope: string; signal: AbortSignal }>();
  #lifetime = new AbortController();
  #savedPort = 0;
  #server: Server | null = null;
  #starting: Promise<void> | null = null;
  #port = 0;
  #endpoint: PollingEndpoint | null = null;
  #connection: BrowserBridgeConnection | null = null;
  #lastSeen = 0;
  readonly #timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly resolveChromePid = chromeProcessId,
    private readonly options: { directory?: string; permissions?: BrowserSitePermissions } = {},
  ) {
    if (options.directory) {
      try {
        const saved = JSON.parse(
          readFileSync(path.join(options.directory, "browser-bridge-connection.json"), "utf8"),
        );
        if (
          /^[A-Za-z0-9_-]{43}$/u.test(saved.token) &&
          Number.isInteger(saved.port) &&
          saved.port > 0 &&
          saved.port < 65536
        ) {
          this.token = saved.token;
          this.#savedPort = saved.port;
        }
      } catch {
        /* First pairing allocates a private loopback port. */
      }
    }
    this.grants = new BrowserBridgeGrantRegistry({
      expectedExtensionOrigin: `${extensionOrigin}/`,
      mainChannelNonce: this.#nonce,
      supportedApplicationIds: ["com.google.Chrome"],
      ...(options.permissions
        ? {
            isUrlAllowed: (grantId: string, url: string) => {
              const owner = this.#grantScopes.get(grantId);
              return (
                !!owner && !owner.signal.aborted && options.permissions!.allows(url, owner.scope)
              );
            },
          }
        : {}),
    });
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
  async restore(): Promise<void> {
    if (this.#savedPort) await this.pairingCode();
  }
  #saveConnection(): void {
    if (!this.options.directory) return;
    mkdirSync(this.options.directory, { recursive: true });
    const file = path.join(this.options.directory, "browser-bridge-connection.json");
    writeFileSync(`${file}.tmp`, JSON.stringify({ port: this.#port, token: this.token }), {
      mode: 0o600,
    });
    renameSync(`${file}.tmp`, file);
  }
  unpair(): void {
    this.disconnect();
    this.token = randomBytes(32).toString("base64url");
    if (this.#port) this.#saveConnection();
  }
  async contexts(
    signal: AbortSignal,
  ): Promise<{ browserContextRef: string; url: string; title: string }[]> {
    const endpoint = this.#endpoint;
    if (!endpoint) return [];
    const response = (await endpoint.request(
      { kind: "list_tabs", requestId: `list_${randomUUID()}` },
      signal,
    )) as { tabs?: unknown };
    if (endpoint !== this.#endpoint)
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    const blocked = this.options.permissions?.policy.blockedHosts ?? [];
    const tabs = browserTabListSchema
      .parse(response.tabs)
      .filter((tab) => !blocked.includes(browserSiteHost(tab.url)));
    const previous = this.#discovered;
    this.#discovered = new Map();
    return tabs.map((tab) => {
      // Retain references only while the exact observed tab identity is unchanged.
      const ref =
        [...previous].find(([, old]) => JSON.stringify(old) === JSON.stringify(tab))?.[0] ??
        `btab_${randomUUID()}`;
      this.#discovered.set(ref, tab);
      return { browserContextRef: ref, url: tab.url, title: tab.title };
    });
  }
  async prepareTab(
    url: string,
    browserContextRef: string | undefined,
    scope: string,
    signal: AbortSignal,
  ): Promise<{ browserContextRef: string; url: string }> {
    const endpoint = this.#endpoint;
    if (!endpoint) throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    let tab = browserContextRef ? this.#discovered.get(browserContextRef) : undefined;
    if (browserContextRef && (!tab || tab.url !== new URL(url).href))
      throw new BrowserObservationError("BROWSER_SURFACE_MISMATCH");
    if (!browserContextRef) {
      const contexts = await this.contexts(signal);
      const matches = contexts.filter((item) => item.url === new URL(url).href);
      if (matches.length > 1)
        throw new BrowserObservationError("BROWSER_BRIDGE_AUTHORIZATION_REQUIRED");
      if (matches.length === 1) tab = this.#discovered.get(matches[0]!.browserContextRef);
    }
    const lifetime = AbortSignal.any([signal, this.#lifetime.signal]);
    await this.options.permissions?.require(url, scope, lifetime);
    if (endpoint !== this.#endpoint || lifetime.aborted)
      throw new BrowserObservationError("BROWSER_BRIDGE_DISCONNECTED");
    const requestId = `claim_${randomUUID()}`;
    this.#intents.set(requestId, {
      scope,
      signal: lifetime,
      url: new URL(url).href,
      ...(tab ? { tab } : {}),
    });
    try {
      const response = (await endpoint.request(
        tab ? { kind: "claim_tab", requestId, tab } : { kind: "create_tab", requestId, url },
        lifetime,
      )) as { browserContextRef?: string; error?: string };
      if (response.error)
        throw new BrowserObservationError(
          response.error === "BROWSER_SURFACE_MISMATCH"
            ? "BROWSER_SURFACE_MISMATCH"
            : "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED",
        );
      const authorization = this.grants
        .availableAuthorizations()
        .find((value) => value.browserContextRef === response.browserContextRef);
      if (!authorization) throw new BrowserObservationError("BROWSER_SURFACE_MISMATCH");
      return { browserContextRef: authorization.browserContextRef, url: authorization.url };
    } finally {
      this.#intents.delete(requestId);
    }
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
      server.listen(this.#savedPort, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("BROWSER_BRIDGE_DISCONNECTED");
    this.#port = address.port;
    this.#saveConnection();
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
          "authorization,content-type,x-openerx-connection,x-openerx-bridge-version",
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
        if (this.options.permissions && request.headers["x-openerx-bridge-version"] !== "2")
          return reply(426, { error: "BROWSER_EXTENSION_UPDATE_REQUIRED" });
        this.disconnect();
        this.#endpoint = new PollingEndpoint((message) => {
          if (message.kind === "grant_accepted") {
            const intent = this.#intents.get(message.authorizationMessageId);
            if (intent) this.#grantScopes.set(message.grantId, intent);
          } else this.#grantScopes.delete(message.grantId);
        });
        this.#connection = this.grants.connect({
          callerOrigin: `${extensionOrigin}/`,
          mainChannelNonce: this.#nonce,
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
      if (request.url === "/heartbeat") return reply(200, { ok: true });
      if (request.url === "/site-check") {
        const input = body as {
          grantId?: string;
          intentId?: string;
          requestId?: string;
          url?: string;
          checkOnly?: boolean;
        };
        const owner = input.grantId
          ? this.grants.hasActiveGrant(input.grantId)
            ? this.#grantScopes.get(input.grantId)
            : undefined
          : input.intentId
            ? this.#intents.get(input.intentId)
            : undefined;
        if (!owner || typeof input.url !== "string" || owner.signal.aborted)
          return reply(403, { allowed: false });
        const actionSignal = input.requestId
          ? endpoint.pending.get(input.requestId)?.signal
          : undefined;
        if (input.requestId && !actionSignal) return reply(200, { allowed: false });
        const permissionSignal = actionSignal
          ? AbortSignal.any([owner.signal, actionSignal])
          : owner.signal;
        browserSiteHost(input.url);
        if (!input.checkOnly) {
          try {
            await this.options.permissions?.require(input.url, owner.scope, permissionSignal);
          } catch {
            return reply(200, { allowed: false });
          }
        }
        return reply(200, {
          allowed:
            this.#connection === connection &&
            !permissionSignal.aborted &&
            !!this.options.permissions?.allows(input.url, owner.scope),
        });
      }
      if (request.url === "/authorize") {
        const message = browserBridgeAuthorizeTabMessageSchema.parse(body);
        const intent = this.#intents.get(message.messageId);
        if (
          this.options.permissions &&
          (!intent ||
            intent.signal.aborted ||
            !this.options.permissions.allows(message.binding.url, intent.scope) ||
            (intent.tab &&
              (message.binding.url !== intent.url ||
                message.binding.tabId !== intent.tab.tabId ||
                message.binding.browserWindowId !== intent.tab.browserWindowId)))
        )
          return reply(403, { error: "BROWSER_BRIDGE_AUTHORIZATION_REQUIRED" });
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
    this.#lifetime.abort();
    this.#lifetime = new AbortController();
    for (const owner of this.#grantScopes.values()) this.options.permissions?.release(owner.scope);
    this.#grantScopes.clear();
    this.#discovered.clear();
    this.#intents.clear();
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
