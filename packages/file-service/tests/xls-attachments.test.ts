import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { supportedFileExtensions, supportedFileTypes } from "@openerx/contracts";
import { ChatRepository, FileRepository } from "@openerx/storage";
import { afterEach, describe, expect, it } from "vitest";
import { detectFileFormat, FileAppService, MultiFormatParser } from "../src";

const fixturePath = path.join(import.meta.dirname, "fixtures/legacy-sales.xls");
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-xls-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("attachment formats and legacy Excel", () => {
  it("detects every selectable extension, including uppercase names", () => {
    expect(new Set(supportedFileExtensions).size).toBe(supportedFileExtensions.length);
    expect(supportedFileExtensions).toEqual(
      expect.arrayContaining(["xls", "xlsx", "tsv", "sql", "xml", "java"]),
    );
    for (const { format, mediaType, extensions } of supportedFileTypes) {
      for (const extension of extensions) {
        expect(detectFileFormat(`/资料/文件.${extension.toUpperCase()}`)).toEqual({
          format,
          mediaType,
        });
      }
    }
    expect(() => detectFileFormat("unsupported.zip")).toThrow("Unsupported file extension");
  });

  it("reads a real BIFF8 workbook with Chinese sheets, formatted dates, and cached formulas", async () => {
    expect(readFileSync(fixturePath).subarray(0, 8).toString("hex")).toBe("d0cf11e0a1b11ae1");
    const parsed = await new MultiFormatParser().parse(fixturePath, "xls");
    expect(parsed.text).toContain("[销售明细]");
    expect(parsed.text).toContain("A2: 女士衬衫");
    expect(parsed.text).toContain("C2: 19.50");
    expect(parsed.text).toContain("D2: =B2*C2 → 58.50");
    expect(parsed.text).toContain("E2: 2026-09-12");
    expect(parsed.text).toContain("[汇总]\nB3: 0\nB4: FALSE");
    expect(parsed.citations.map(({ locator }) => locator)).toEqual([
      { kind: "sheet_range", sheet: "销售明细", range: "A1:E2" },
      { kind: "sheet_range", sheet: "汇总", range: "B3:B4" },
    ]);
  });

  it("imports, previews, searches and persists an XLS attached to a conversation", async () => {
    const root = temporaryDirectory();
    const source = path.join(root, "销售报表.XLS");
    copyFileSync(fixturePath, source);
    const database = path.join(root, "openerx.sqlite");
    const chats = new ChatRepository(database);
    const { receipt } = chats.createGeneration({
      text: "读取附件",
      idempotencyKey: "xls-attachment-0001",
    });
    chats.close();
    const service = new FileAppService(new FileRepository(database), root);
    let fileId = "";
    try {
      const [file] = await service.importPaths([source], receipt.conversationId);
      expect(file).toMatchObject({
        format: "xls",
        mediaType: "application/vnd.ms-excel",
        parseStatus: "ready",
        parseErrorCode: null,
      });
      fileId = file?.id ?? "";
      expect(service.listFiles(receipt.conversationId).map(({ id }) => id)).toEqual([fileId]);
      expect(service.previewFile(fileId).parsedText).toContain("D2: =B2*C2 → 58.50");
      expect(service.search("女士衬衫", [fileId])[0]?.citations[0]?.locator).toEqual({
        kind: "sheet_range",
        sheet: "销售明细",
        range: "A1:E2",
      });
    } finally {
      service.close();
    }
    // Reading the attachment after restart uses the controlled copy, not its source path.
    rmSync(source);
    const reopened = new FileAppService(new FileRepository(database), root);
    try {
      expect(reopened.readParsedFile(fileId).text).toContain("女士衬衫");
      expect(reopened.attachments(receipt.conversationId)[0]?.personalFileId).toBe(fileId);
      expect(reopened.previewFile(fileId).citations).toHaveLength(2);
    } finally {
      reopened.close();
    }
  });

  it("imports TSV through the same text-table parser", async () => {
    const root = temporaryDirectory();
    const source = path.join(root, "sales.tsv");
    writeFileSync(source, "商品\t金额\n女士衬衫\t58.50");
    const service = new FileAppService(new FileRepository(path.join(root, "openerx.sqlite")), root);
    try {
      const [file] = await service.importPaths([source], null);
      expect(file).toMatchObject({
        format: "csv",
        mediaType: "text/tab-separated-values",
        parseStatus: "ready",
      });
      expect(service.readParsedFile(file?.id ?? "").text).toContain("女士衬衫\t58.50");
    } finally {
      service.close();
    }
  });

  it.each([Buffer.from("not an Excel workbook"), Buffer.from("d0cf11e0a1b11ae1", "hex")])(
    "rejects damaged XLS data and can still parse the next workbook",
    async (bytes) => {
      const corrupt = path.join(temporaryDirectory(), "corrupt.xls");
      writeFileSync(corrupt, bytes);
      const parser = new MultiFormatParser();
      await expect(parser.parse(corrupt, "xls")).rejects.toMatchObject({ code: "FILE_CORRUPT" });
      expect((await parser.parse(fixturePath, "xls")).text).toContain("女士衬衫");
    },
  );

  it("classifies password-protected BIFF workbooks as encrypted", async () => {
    const encrypted = path.join(temporaryDirectory(), "encrypted.xls");
    // BIFF8 workbook BOF, XOR FilePass, EOF: no password is supplied by the importer.
    writeFileSync(
      encrypted,
      Buffer.from("0908100000060500bb0dcc0700000000060000002f0006000000123456780a000000", "hex"),
    );
    await expect(new MultiFormatParser().parse(encrypted, "xls")).rejects.toMatchObject({
      code: "FILE_ENCRYPTED",
    });
  });
});
