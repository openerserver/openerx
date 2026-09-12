import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { contentPreviewSchema } from "@openerx/contracts";
import { ChatRepository, FileRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { FileAppService } from "../src";

const cleanups: Array<() => void> = [];
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-html-preview-"));
  const database = path.join(directory, "app.sqlite");
  const chats = new ChatRepository(database);
  const files = new FileAppService(new FileRepository(database), directory);
  cleanups.push(() => {
    files.close();
    chats.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const conversation = () =>
    chats.createGeneration({ text: "website", idempotencyKey: randomUUID() }).receipt
      .conversationId;
  return { directory, files, conversation };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("website resource snapshots", () => {
  it("bundles the same conversation and workspace, retaining paths, bytes and current versions", () => {
    const { files, conversation } = fixture();
    const conversationId = conversation();
    const capture = (relativePath: string, text: string, id = conversationId, root = "/website") =>
      files.captureWorkspaceArtifact({
        conversationId: id,
        workspaceRootPath: root,
        relativePath,
        sourceRevision: randomUUID(),
        bytes: Buffer.from(text),
      });
    const index = capture("pages/index.html", '<link href="../assets/style.css">');
    capture("assets/style.css", "body { color: red }");
    capture("assets/style.css", "body { color: blue }");
    capture("assets/app.mjs", "export const value = 42");
    capture("assets/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    capture("assets/photo.png", "image-bytes");
    capture("data.json", '{"name":"website"}');
    capture("notes.md", "not a website dependency");
    capture("secrets.json", "other conversation", conversation());
    capture("outside.json", "other root", conversationId, "/another-website");
    // No live /website directory exists: all dependencies must come from saved content.
    const preview = contentPreviewSchema.parse(
      files.previewArtifact(index.id, { includeHtmlResources: true }),
    );
    expect(files.previewArtifact(index.id).htmlBundle).toBeUndefined();
    expect(preview.htmlBundle?.entryPath).toBe("pages/index.html");
    expect(preview.htmlBundle?.resources.map((resource) => resource.relativePath).sort()).toEqual([
      "assets/app.mjs",
      "assets/logo.svg",
      "assets/photo.png",
      "assets/style.css",
      "data.json",
      "pages/index.html",
    ]);
    const css = preview.htmlBundle?.resources.find((r) => r.relativePath === "assets/style.css");
    expect(Buffer.from(css?.bytesBase64 ?? "", "base64").toString()).toBe("body { color: blue }");
    expect(preview.source).toBe('<link href="../assets/style.css">');
  });

  it("previews an imported website from its own saved directory scope after source removal", async () => {
    const { directory, files } = fixture();
    const website = path.join(directory, "website");
    mkdirSync(path.join(website, "assets"), { recursive: true });
    writeFileSync(path.join(website, "index.html"), '<img src="assets/logo.svg">');
    writeFileSync(
      path.join(website, "assets/logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    const imported = await files.importPaths([website]);
    const entry = imported.find((file) => file.format === "html");
    if (!entry) throw new Error("missing entry");
    writeFileSync(path.join(directory, "unrelated.json"), "{}");
    await files.importPaths([path.join(directory, "unrelated.json")]);
    rmSync(website, { recursive: true });
    const bundle = files.previewFile(entry.id, { includeHtmlResources: true }).htmlBundle;
    expect(bundle?.resources.map((resource) => resource.relativePath).sort()).toEqual([
      "assets/logo.svg",
      "index.html",
    ]);
  });

  it("supports standalone HTML titles and does not attach unrelated artifacts", () => {
    const { files } = fixture();
    const artifact = files.createArtifact({
      displayName: "Website preview",
      format: "html",
      mediaType: "text/html",
      bytesBase64: Buffer.from("<h1>Hello</h1>").toString("base64"),
    });
    files.createArtifact({
      displayName: "secret.json",
      format: "json",
      mediaType: "application/json",
      bytesBase64: Buffer.from("{}").toString("base64"),
    });
    expect(files.previewArtifact(artifact.id, { includeHtmlResources: true }).htmlBundle).toEqual({
      entryPath: "index.html",
      resources: [
        {
          relativePath: "index.html",
          bytesBase64: Buffer.from("<h1>Hello</h1>").toString("base64"),
        },
      ],
    });
  });
});
