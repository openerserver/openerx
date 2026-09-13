import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileImportDataInputSchema } from "@openerx/contracts";
import { ChatRepository, FileRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { FileAppService, MultiFormatParser } from "../src";

const roots: string[] = [];
const services: FileAppService[] = [];
function fixture(maxFileBytes?: number) {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-pasted-files-"));
  roots.push(root);
  const database = path.join(root, "openerx.sqlite");
  const service = new FileAppService(new FileRepository(database), root, {
    ...(maxFileBytes === undefined ? {} : { maxFileBytes }),
    parser: new MultiFormatParser({
      extract: async () => ({ text: "clipboard screenshot", citations: [] }),
    }),
  });
  services.push(service);
  return { root, database, service };
}
afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("pasted file imports", () => {
  it("stores XLS clipboard bytes as a durable file without creating a path permission", async () => {
    const { root, database, service } = fixture();
    const bytes = readFileSync(path.join(import.meta.dirname, "fixtures/legacy-sales.xls"));
    const [file] = await service.importData({
      files: [{ displayName: "销售.XLS", bytesBase64: bytes.toString("base64") }],
      conversationId: null,
    });
    expect(file).toMatchObject({ format: "xls", parseStatus: "ready", sourceScopeId: null });
    if (!file) throw new Error("missing imported file");
    expect(service.previewFile(file.id).parsedText).toContain("D2: =B2*C2 → 58.50");
    expect(service.readObject(file.objectRef)).toEqual(bytes);
    const chats = new ChatRepository(database);
    const { receipt } = chats.createGeneration({
      text: "读取粘贴附件",
      idempotencyKey: "paste-file-test-001",
    });
    chats.close();
    service.attach(receipt.conversationId, file.id, receipt.userMessageId);
    const reopened = new FileAppService(new FileRepository(database), root);
    services.push(reopened);
    expect(reopened.attachments(receipt.conversationId)[0]?.personalFileId).toBe(file.id);
    expect(reopened.previewFile(file.id).citations).toHaveLength(2);
  });

  it("makes a pasted image available for preview and model image input", async () => {
    const { database, service } = fixture();
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const chats = new ChatRepository(database);
    const { receipt } = chats.createGeneration({
      text: "看图",
      idempotencyKey: "paste-image-test-001",
    });
    chats.close();
    const [file] = await service.importData({
      files: [{ displayName: "截图.png", bytesBase64: png }],
      conversationId: receipt.conversationId,
    });
    if (!file) throw new Error("missing imported file");
    expect(service.previewFile(file.id).imageDataUrl).toBe(`data:image/png;base64,${png}`);
    expect(service.modelImages(receipt.conversationId)[0]?.data).toBe(png);
  });

  it.each([
    { displayName: "archive.zip", bytesBase64: "eA==", code: "FILE_UNSUPPORTED" },
    { displayName: "bad.txt", bytesBase64: "invalid!", code: "FILE_CORRUPT" },
  ])("validates the complete batch before importing: $code", async ({ code, ...invalid }) => {
    const { service } = fixture();
    await expect(
      service.importData({ files: [{ displayName: "valid.txt", bytesBase64: "b2s=" }, invalid] }),
    ).rejects.toMatchObject({ code });
    expect(service.listFiles()).toHaveLength(0);
  });

  it("enforces service size limits even when the renderer passes a payload", async () => {
    const { service } = fixture(2);
    await expect(
      service.importData({ files: [{ displayName: "note.txt", bytesBase64: "YWJj" }] }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(service.listFiles()).toHaveLength(0);
  });

  it("rejects raw filesystem paths and filename traversal at the contract boundary", () => {
    expect(fileImportDataInputSchema.safeParse({ localPaths: ["/private/file.xls"] }).success).toBe(
      false,
    );
    for (const displayName of ["../file.txt", "C:\\private\\file.txt", "file\nname.txt"]) {
      expect(
        fileImportDataInputSchema.safeParse({ files: [{ displayName, bytesBase64: "eA==" }] })
          .success,
      ).toBe(false);
    }
  });
});
