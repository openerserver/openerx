import { randomUUID } from "node:crypto";
import { contentPreviewSchema, htmlPreviewUrlSchema } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { HtmlPreviewRegistry } from "../src/main/html-preview";

function preview() {
  const files = {
    "pages/index.html": '<link href="../assets/style.css"><script src="../assets/app.js"></script>',
    "assets/style.css": 'body { background-image: url("logo%20%E4%B8%AD.svg") }',
    "assets/app.js": "localStorage.setItem('ready', 'yes')",
    "assets/logo 中.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
  return contentPreviewSchema.parse({
    objectKind: "artifact",
    objectId: randomUUID(),
    displayName: "pages/index.html",
    format: "html",
    source: files["pages/index.html"],
    parsedText: "",
    citations: [],
    htmlBundle: {
      entryPath: "pages/index.html",
      resources: Object.entries(files).map(([relativePath, text]) => ({
        relativePath,
        bytesBase64: Buffer.from(text).toString("base64"),
      })),
    },
  });
}

describe("isolated website preview protocol", () => {
  it("keeps an unchanged preview stable across focus refreshes and snapshots changed bytes", async () => {
    const registry = new HtmlPreviewRegistry();
    const input = preview();
    const first = registry.prepare(input).htmlPreviewUrl ?? "";
    input.htmlBundle?.resources.reverse();
    expect(registry.prepare(input).htmlPreviewUrl).toBe(first);
    const css = input.htmlBundle?.resources.find((resource) =>
      resource.relativePath.endsWith(".css"),
    );
    if (!css) throw new Error("missing fixture stylesheet");
    css.bytesBase64 = Buffer.from("body { color: blue }").toString("base64");
    const second = registry.prepare(input).htmlPreviewUrl ?? "";
    expect(second).not.toBe(first);
    const savedCss = (url: string) =>
      registry.respond({ method: "GET", url: new URL("../assets/style.css", url).href }).text();
    expect(await savedCss(second)).toBe("body { color: blue }");
    expect(await savedCss(first)).toContain("background-image");
  });
  it("serves nested assets with browser MIME types, query strings, encoded names and immutable bytes", async () => {
    const registry = new HtmlPreviewRegistry();
    const input = preview();
    const result = registry.prepare(input);
    expect(result.htmlBundle).toBeUndefined();
    expect(result.source).toBe(input.source);
    expect(htmlPreviewUrlSchema.safeParse(result.htmlPreviewUrl).success).toBe(true);
    const url = result.htmlPreviewUrl ?? "";
    const request = (relative: string, method = "GET") =>
      registry.respond({ method, url: new URL(relative, url).href });
    expect(await request("").text()).toBe(input.source);
    const css = request("../assets/style.css?v=2");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css.headers.get("x-content-type-options")).toBe("nosniff");
    expect(css.headers.get("content-security-policy")).toContain("frame-src 'none'");
    expect(request("../assets/app.js").headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(request("../assets/logo%20%E4%B8%AD.svg").headers.get("content-type")).toBe(
      "image/svg+xml",
    );
    expect(await request("../assets/app.js", "HEAD").text()).toBe("");
    input.htmlBundle?.resources.splice(0);
    expect(await request("").text()).toBe(input.source);
  });

  it("rejects unknown resources, path escapes, foreign schemes and writes", () => {
    const registry = new HtmlPreviewRegistry();
    const url = registry.prepare(preview()).htmlPreviewUrl ?? "";
    const base = url.slice(0, url.indexOf("/pages/"));
    for (const suffix of ["/missing.css", "/..%2Fsecret.json", "/%00", "/%5Csecret.json", "/%ZZ"])
      expect(registry.respond({ method: "GET", url: base + suffix }).status).toBe(404);
    for (const other of [
      "file:///etc/passwd",
      "openerx://renderer/index.html",
      url.replace("://", "://user@"),
    ])
      expect(registry.respond({ method: "GET", url: other }).status).toBe(404);
    expect(registry.respond({ method: "POST", url }).status).toBe(405);
    expect(htmlPreviewUrlSchema.safeParse("openerx://renderer/index.html").success).toBe(false);
    expect(htmlPreviewUrlSchema.safeParse("https://example.com").success).toBe(false);
  });

  it("bounds retained snapshots and invalidates them on profile changes", () => {
    const registry = new HtmlPreviewRegistry({ maxSessions: 1 });
    const first = registry.prepare(preview()).htmlPreviewUrl ?? "";
    const second = registry.prepare(preview()).htmlPreviewUrl ?? "";
    expect(first).not.toBe(second);
    expect(registry.respond({ method: "GET", url: first }).status).toBe(410);
    expect(registry.respond({ method: "GET", url: second }).status).toBe(200);
    registry.clear();
    expect(registry.respond({ method: "GET", url: second }).status).toBe(410);
    expect(() => new HtmlPreviewRegistry({ maxBytes: 1 }).prepare(preview())).toThrow(
      "HTML_PREVIEW_TOO_LARGE",
    );
  });
});
