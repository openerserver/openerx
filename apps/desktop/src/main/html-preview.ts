import { createHash, randomBytes } from "node:crypto";
import {
  type ContentPreview,
  contentPreviewSchema,
  htmlPreviewMediaType,
  htmlPreviewPathSchema,
  htmlPreviewProtocol,
  maxHtmlPreviewBytes,
} from "@openerx/contracts";

interface PreviewResource {
  bytes: Uint8Array<ArrayBuffer>;
  mediaType: string;
}

interface PreviewSession {
  resources: Map<string, PreviewResource>;
  sizeBytes: number;
  fingerprint: string;
}

const previewCsp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

// No filesystem or application bridge is exposed to this separate protocol/origin.
// Session URLs identify a bounded, immutable snapshot of one website.
export class HtmlPreviewRegistry {
  readonly #sessions = new Map<string, PreviewSession>();
  readonly #maxSessions: number;
  readonly #maxBytes: number;
  #totalBytes = 0;

  constructor(options: { maxSessions?: number; maxBytes?: number } = {}) {
    this.#maxSessions = options.maxSessions ?? 16;
    this.#maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
  }

  prepare(input: unknown): ContentPreview {
    const { htmlBundle, htmlPreviewUrl: _url, ...preview } = contentPreviewSchema.parse(input);
    if (preview.format !== "html" || preview.source === null || !htmlBundle) return preview;
    const resources = new Map<string, PreviewResource>();
    let sizeBytes = 0;
    for (const resource of htmlBundle.resources) {
      const mediaType = htmlPreviewMediaType(resource.relativePath);
      if (!mediaType || resources.has(resource.relativePath))
        throw new Error("INVALID_HTML_PREVIEW_RESOURCE");
      const bytes = new Uint8Array(Buffer.from(resource.bytesBase64, "base64"));
      sizeBytes += bytes.byteLength;
      if (sizeBytes > Math.min(maxHtmlPreviewBytes, this.#maxBytes))
        throw new Error("HTML_PREVIEW_TOO_LARGE");
      resources.set(resource.relativePath, { bytes, mediaType });
    }
    if (!resources.get(htmlBundle.entryPath)?.mediaType.startsWith("text/html"))
      throw new Error("HTML_PREVIEW_ENTRY_NOT_FOUND");
    const digest = createHash("sha256").update(
      JSON.stringify([preview.objectKind, preview.objectId, htmlBundle.entryPath]),
    );
    for (const [relativePath, resource] of [...resources].sort(([a], [b]) => a.localeCompare(b))) {
      digest.update(JSON.stringify([relativePath, resource.bytes.byteLength]));
      digest.update(resource.bytes);
    }
    const fingerprint = digest.digest("hex");
    const entryPath = htmlBundle.entryPath.split("/").map(encodeURIComponent).join("/");
    // React Query can refresh on window focus. Keep an unchanged site's URL so
    // it does not reload the iframe or discard its page navigation/localStorage.
    for (const [id, session] of this.#sessions) {
      if (session.fingerprint !== fingerprint) continue;
      this.#sessions.delete(id);
      this.#sessions.set(id, session);
      return { ...preview, htmlPreviewUrl: `${htmlPreviewProtocol}://${id}/${entryPath}` };
    }
    while (
      this.#sessions.size >= this.#maxSessions ||
      this.#totalBytes + sizeBytes > this.#maxBytes
    ) {
      const oldest = this.#sessions.keys().next().value;
      if (!oldest) throw new Error("HTML_PREVIEW_TOO_LARGE");
      this.#totalBytes -= this.#sessions.get(oldest)?.sizeBytes ?? 0;
      this.#sessions.delete(oldest);
    }
    const id = randomBytes(16).toString("hex");
    this.#sessions.set(id, { resources, sizeBytes, fingerprint });
    this.#totalBytes += sizeBytes;
    return { ...preview, htmlPreviewUrl: `${htmlPreviewProtocol}://${id}/${entryPath}` };
  }

  clear(): void {
    this.#sessions.clear();
    this.#totalBytes = 0;
  }

  respond(request: Pick<Request, "method" | "url">): Response {
    if (request.method !== "GET" && request.method !== "HEAD")
      return this.#response("Method not allowed", 405);
    let url: URL;
    let relativePath: string;
    try {
      url = new URL(request.url);
      if (
        url.protocol !== `${htmlPreviewProtocol}:` ||
        !/^[a-f0-9]{32}$/u.test(url.hostname) ||
        url.username ||
        url.password ||
        url.port
      )
        return this.#response("Not found", 404);
      relativePath = decodeURIComponent(url.pathname.slice(1));
      if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
      if (!htmlPreviewPathSchema.safeParse(relativePath).success)
        return this.#response("Not found", 404);
    } catch {
      return this.#response("Not found", 404);
    }
    const session = this.#sessions.get(url.hostname);
    if (!session) return this.#response("预览已过期，请重新打开该文件。", 410);
    const resource = session.resources.get(relativePath);
    if (!resource) return this.#response("Not found", 404);
    this.#sessions.delete(url.hostname);
    this.#sessions.set(url.hostname, session);
    return new Response(request.method === "HEAD" ? null : resource.bytes, {
      headers: {
        "Content-Type": resource.mediaType,
        "Content-Length": String(resource.bytes.byteLength),
        "Content-Security-Policy": previewCsp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  }

  #response(message: string, status: number): Response {
    return new Response(message, {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
