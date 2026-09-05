import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { desktopBrand } from "../../../../packages/branding/src/index";

interface PendingOAuthSession {
  serverId: string;
  redirectUrl: string;
  server: Server;
  callback: Promise<string>;
  resolve(value: string): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export interface OAuthLoopbackSession {
  sessionId: string;
  redirectUrl: string;
}

function trustedAuthorizationUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new Error("MCP_OAUTH_AUTHORIZATION_URL_DENIED");
  }
  return url;
}

function completionPage(success: boolean): string {
  const heading = success ? `授权已返回 ${desktopBrand.productName}` : "授权回调无效";
  const detail = success
    ? "现在可以关闭此页面并返回桌面应用。"
    : `请返回 ${desktopBrand.productName} 重新授权。`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${heading}</title><style>body{font:16px system-ui;margin:48px;color:#20241f}main{max-width:560px;margin:auto}h1{font-size:24px}</style></head><body><main><h1>${heading}</h1><p>${detail}</p></main></body></html>`;
}

export class OAuthLoopbackController {
  readonly #sessions = new Map<string, PendingOAuthSession>();

  constructor(
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly timeoutMs = 5 * 60_000,
  ) {}

  async prepare(serverId: string): Promise<OAuthLoopbackSession> {
    const sessionId = randomUUID();
    const callbackPath = `/oauth/mcp/${randomBytes(24).toString("base64url")}`;
    let resolveCallback: (value: string) => void = () => undefined;
    let rejectCallback: (error: Error) => void = () => undefined;
    const callback = new Promise<string>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    void callback.catch(() => undefined);
    const server = createServer((request, response) => {
      const session = this.#sessions.get(sessionId);
      if (!session || request.method !== "GET" || !request.url || request.url.length > 16_384) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const callbackUrl = new URL(request.url, session.redirectUrl);
      if (
        callbackUrl.origin !== new URL(session.redirectUrl).origin ||
        callbackUrl.pathname !== callbackPath
      ) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const valid = callbackUrl.searchParams.has("code") || callbackUrl.searchParams.has("error");
      response.writeHead(valid ? 200 : 400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      response.end(completionPage(valid));
      if (valid) this.#complete(sessionId, () => session.resolve(callbackUrl.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("MCP_OAUTH_LOOPBACK_UNAVAILABLE");
    }
    const redirectUrl = `http://127.0.0.1:${address.port}${callbackPath}`;
    const timeout = setTimeout(
      () => this.#complete(sessionId, () => rejectCallback(new Error("MCP_OAUTH_TIMEOUT"))),
      this.timeoutMs,
    );
    this.#sessions.set(sessionId, {
      serverId,
      redirectUrl,
      server,
      callback,
      resolve: resolveCallback,
      reject: rejectCallback,
      timeout,
    });
    return { sessionId, redirectUrl };
  }

  async authorize(sessionId: string, authorizationUrl: string): Promise<string> {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error("MCP_OAUTH_SESSION_NOT_FOUND");
    const target = trustedAuthorizationUrl(authorizationUrl);
    await this.openExternal(target.toString());
    return await session.callback;
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#complete(sessionId, () => session.reject(new Error("MCP_OAUTH_CANCELLED")));
  }

  close(): void {
    for (const sessionId of [...this.#sessions.keys()]) void this.cancel(sessionId);
  }

  #complete(sessionId: string, complete: () => void): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#sessions.delete(sessionId);
    clearTimeout(session.timeout);
    complete();
    session.server.close();
  }
}
