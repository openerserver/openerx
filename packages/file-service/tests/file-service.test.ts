import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatRepository, FileRepository } from "@openerx/storage";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContentStore,
  FileAppService,
  FileScopeBroker,
  MultiFormatParser,
  type OcrAdapter,
} from "../src";

const temporaryDirectories: string[] = [];

function fixture(): { root: string; database: string; profile: string } {
  const root = mkdtempSync(path.join(tmpdir(), "openerx-files-"));
  temporaryDirectories.push(root);
  const profile = path.join(root, "profile");
  mkdirSync(profile, { recursive: true });
  return { root, database: path.join(profile, "openerx.sqlite"), profile };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("M4 file scope and controlled copies", () => {
  it("imports a folder, creates searchable stable citations and survives permission revocation", async () => {
    const { root, database, profile } = fixture();
    const source = path.join(root, "source");
    mkdirSync(source);
    const sourceFile = path.join(source, "requirements.md");
    writeFileSync(sourceFile, "# M4\n\nStable citation marker: ORCHID-42", "utf8");
    const chats = new ChatRepository(database);
    const conversation = chats.createGeneration({
      text: "读取需求",
      idempotencyKey: "m4-file-conversation-0001",
    });
    chats.close();
    const repository = new FileRepository(database);
    const service = new FileAppService(repository, profile);

    const imported = await service.importPaths([source], conversation.receipt.conversationId);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ parseStatus: "ready", format: "markdown" });
    expect(service.search("ORCHID-42", [imported[0]?.id ?? ""])[0]?.citations[0]?.locator).toEqual({
      kind: "text_range",
      startLine: 1,
      endLine: 3,
    });
    expect(service.listFiles(conversation.receipt.conversationId)).toHaveLength(1);

    writeFileSync(sourceFile, "original changed after import", "utf8");
    service.revokeScope(imported[0]?.sourceScopeId ?? "");
    const copied = service.readObject(imported[0]?.objectRef ?? "").toString("utf8");
    expect(copied).toContain("ORCHID-42");
    service.close();
  });

  it("blocks symlinks and lexical path escape", () => {
    const { root, database } = fixture();
    const repository = new FileRepository(database);
    const broker = new FileScopeBroker(repository);
    const source = path.join(root, "scope");
    mkdirSync(source);
    writeFileSync(path.join(source, "inside.txt"), "inside");
    writeFileSync(path.join(root, "outside.txt"), "outside");
    symlinkSync(path.join(root, "outside.txt"), path.join(source, "escape.txt"));
    const scope = broker.grant(source);

    expect(() => broker.resolve(scope.id, "../outside.txt")).toThrow("FILE_PATH_ESCAPE");
    expect(() => broker.selectedFiles(scope.id)).toThrow("FILE_SYMLINK_BLOCKED");
    repository.close();
  });

  it("exports without overwriting an existing destination", () => {
    const { root, database } = fixture();
    const repository = new FileRepository(database);
    const broker = new FileScopeBroker(repository);
    const output = path.join(root, "output");
    mkdirSync(output);
    const generated = path.join(root, "generated.txt");
    writeFileSync(generated, "new");
    writeFileSync(path.join(output, "result.txt"), "original");
    const scope = broker.grant(output, "read_write");

    const exported = broker.exportNewFile(scope.id, "result.txt", generated);
    expect(path.basename(exported)).toBe("result (2).txt");
    expect(readFileSync(path.join(output, "result.txt"), "utf8")).toBe("original");
    repository.close();
  });
});

describe("M4 parsers and artifacts", () => {
  it("parses DOCX, XLSX and PPTX containers with stable locators", async () => {
    const { root } = fixture();
    const parser = new MultiFormatParser();
    const docx = path.join(root, "sample.docx");
    const xlsx = path.join(root, "sample.xlsx");
    const pptx = path.join(root, "sample.pptx");
    writeFileSync(
      docx,
      zipSync({
        "word/document.xml": new TextEncoder().encode(
          "<w:document><w:body><w:p><w:r><w:t>Document marker</w:t></w:r></w:p></w:body></w:document>",
        ),
      }),
    );
    writeFileSync(
      xlsx,
      zipSync({
        "xl/workbook.xml": new TextEncoder().encode(
          '<workbook><sheets><sheet name="Budget" sheetId="1"/></sheets></workbook>',
        ),
        "xl/worksheets/sheet1.xml": new TextEncoder().encode(
          '<worksheet><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>',
        ),
      }),
    );
    writeFileSync(
      pptx,
      zipSync({
        "ppt/slides/slide1.xml": new TextEncoder().encode("<p:sld><a:t>Slide marker</a:t></p:sld>"),
      }),
    );

    expect((await parser.parse(docx, "docx")).citations[0]?.locator.kind).toBe("text_range");
    expect((await parser.parse(xlsx, "xlsx")).citations[0]?.locator).toEqual({
      kind: "sheet_range",
      sheet: "Budget",
      range: "A1:A1",
    });
    expect((await parser.parse(pptx, "pptx")).citations[0]?.locator).toEqual({
      kind: "slide",
      slide: 1,
    });
  });

  it("keeps OCR uncertainty explicit through the adapter confidence", async () => {
    const adapter: OcrAdapter = {
      extract: async () => ({
        text: "maybe 184",
        citations: [
          {
            locator: { kind: "image_region", label: "center" },
            excerpt: "maybe 184",
            confidence: 0.61,
          },
        ],
      }),
    };
    const { root } = fixture();
    const image = path.join(root, "scan.png");
    writeFileSync(image, "fixture");
    const parsed = await new MultiFormatParser(adapter).parse(image, "png");
    expect(parsed.citations[0]?.confidence).toBe(0.61);
  });

  it("returns typed corrupt errors without invalidating the parser instance", async () => {
    const { root } = fixture();
    const corrupt = path.join(root, "corrupt.docx");
    const valid = path.join(root, "valid.json");
    writeFileSync(corrupt, "not-a-zip");
    writeFileSync(valid, '{"still":"works"}');
    const parser = new MultiFormatParser();
    await expect(parser.parse(corrupt, "docx")).rejects.toMatchObject({ code: "FILE_CORRUPT" });
    expect((await parser.parse(valid, "json")).text).toContain("still");
  });

  it("stores immutable artifact versions in the content-addressed store", () => {
    const { root, database, profile } = fixture();
    const repository = new FileRepository(database);
    const service = new FileAppService(repository, profile);
    const artifact = service.createArtifact({
      displayName: "report.txt",
      format: "text",
      mediaType: "text/plain",
      bytesBase64: Buffer.from("version one").toString("base64"),
    });
    const updated = service.addArtifactVersion({
      artifactId: artifact.id,
      format: "text",
      mediaType: "text/plain",
      bytesBase64: Buffer.from("version two").toString("base64"),
    });

    expect(updated.currentVersion).toBe(2);
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0]?.objectRef).not.toBe(updated.versions[1]?.objectRef);
    expect(service.readObject(updated.versions[0]?.objectRef ?? "").toString()).toBe("version one");
    const selectedPath = path.join(root, "report.txt");
    writeFileSync(selectedPath, "existing");
    const exported = service.exportArtifact(updated.id, selectedPath);
    expect(exported).toMatchObject({ fileName: "report (2).txt", version: 2 });
    expect(readFileSync(selectedPath, "utf8")).toBe("existing");
    expect(readFileSync(path.join(root, exported.fileName), "utf8")).toBe("version two");
    service.close();
  });

  it("validates object references before resolving storage paths", () => {
    const { profile } = fixture();
    const store = new ContentStore(profile);
    expect(() => store.resolve("../../outside")).toThrow("INVALID_OBJECT_REF");
  });
});
