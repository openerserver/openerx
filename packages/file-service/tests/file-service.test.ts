import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChatRepository, FileRepository } from "@openerx/storage";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContentStore,
  compileOfficeArtifact,
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
  it("materializes attached images as bounded model-ready base64 from the controlled store", async () => {
    const { root, database, profile } = fixture();
    const sourceImage = path.join(root, "fixture.png");
    const imageBytes = Buffer.from("controlled-image-bytes", "utf8");
    writeFileSync(sourceImage, imageBytes);
    const chats = new ChatRepository(database);
    const draft = chats.createGeneration({
      text: "解析图片",
      idempotencyKey: "m4-vision-conversation-0001",
    });
    chats.close();
    const parser = new MultiFormatParser({
      extract: async () => ({ text: "", citations: [] }),
    });
    const service = new FileAppService(new FileRepository(database), profile, { parser });
    const [file] = await service.importPaths([sourceImage], draft.receipt.conversationId);
    if (!file) throw new Error("IMAGE_FIXTURE_IMPORT_FAILED");

    expect(service.modelImages(draft.receipt.conversationId)).toEqual([
      {
        personalFileId: file.id,
        displayName: "fixture.png",
        data: imageBytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(service.previewFile(file.id).imageDataUrl).toBe(
      `data:image/png;base64,${imageBytes.toString("base64")}`,
    );
    expect(service.attachments(draft.receipt.conversationId)).toMatchObject([
      { personalFileId: file.id, messageId: null },
    ]);
    service.close();
  });

  it("keeps message images isolated across conversation branches", async () => {
    const { root, database, profile } = fixture();
    const imageAPath = path.join(root, "branch-a.png");
    const imageBPath = path.join(root, "branch-b.png");
    writeFileSync(imageAPath, Buffer.from("branch-image-a"));
    writeFileSync(imageBPath, Buffer.from("branch-image-b"));
    const chats = new ChatRepository(database);
    const branchA = chats.createGeneration({
      text: "分支 A",
      idempotencyKey: "image-branch-a-0001",
    });
    chats.appendPiEvent(branchA.receipt.assistantMessageId, {
      eventId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: "completed",
    });
    const branchB = chats.editGeneration({
      conversationId: branchA.receipt.conversationId,
      messageId: branchA.receipt.userMessageId as string,
      text: "分支 B",
      idempotencyKey: "image-branch-b-0001",
    });
    const service = new FileAppService(new FileRepository(database), profile, {
      parser: new MultiFormatParser({ extract: async () => ({ text: "", citations: [] }) }),
    });
    const [imageA] = await service.importPaths([imageAPath], null);
    const [imageB] = await service.importPaths([imageBPath], null);
    if (!imageA || !imageB || !branchA.receipt.userMessageId || !branchB.receipt.userMessageId) {
      throw new Error("branch image fixture missing");
    }
    service.attach(branchA.receipt.conversationId, imageA.id, branchA.receipt.userMessageId);
    service.attach(branchA.receipt.conversationId, imageB.id, branchB.receipt.userMessageId);

    expect(
      service
        .attachedFilesForMessages(
          branchA.receipt.conversationId,
          chats.branchMessageIds(branchA.receipt.assistantMessageId),
        )
        .map(({ id }) => id),
    ).toEqual([imageA.id]);
    expect(
      service
        .attachedFilesForMessages(
          branchB.receipt.conversationId,
          chats.branchMessageIds(branchB.receipt.assistantMessageId),
        )
        .map(({ id }) => id),
    ).toEqual([imageB.id]);
    expect(service.modelImagesForMessage(branchA.receipt.userMessageId)[0]?.data).toBe(
      Buffer.from("branch-image-a").toString("base64"),
    );
    expect(service.modelImagesForMessage(branchB.receipt.userMessageId)[0]?.data).toBe(
      Buffer.from("branch-image-b").toString("base64"),
    );
    service.close();
    chats.close();
  });

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
    // Directory junctions exercise reparse-point rejection without Windows admin rights.
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    symlinkSync(
      outside,
      path.join(source, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
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
  it("compiles real Office binaries and renders every requested review surface", async () => {
    const { root } = fixture();
    const parser = new MultiFormatParser();
    const cases = [
      compileOfficeArtifact({
        format: "docx",
        title: "季度复盘",
        pages: [
          { heading: "摘要", paragraphs: ["第一季度保持增长。"], bullets: [] },
          { heading: "下一步", paragraphs: [], bullets: ["扩大试点", "复核预算"] },
        ],
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
      }),
      compileOfficeArtifact({
        format: "xlsx",
        title: "预算",
        sheets: [
          {
            name: "明细",
            rows: [
              ["项目", "金额"],
              ["研发", 120],
            ],
            headerRows: 1,
          },
          {
            name: "汇总",
            rows: [
              ["指标", "值"],
              ["总额", { formula: "=SUM(明细!B2:B2)", value: 120 }],
            ],
            headerRows: 1,
          },
        ],
        theme: { accentColor: "#0F766E", backgroundColor: "#FFFFFF" },
      }),
      compileOfficeArtifact({
        format: "pptx",
        title: "发布计划",
        slides: [
          { title: "目标", subtitle: "可靠交付", bullets: [] },
          { title: "路径", bullets: ["小流量", "逐步扩大"] },
        ],
        theme: { accentColor: "#7C3AED", backgroundColor: "#FFFFFF" },
      }),
      compileOfficeArtifact({
        format: "pdf",
        title: "决策记录",
        pages: [
          { heading: "结论", paragraphs: ["批准第一阶段。"], bullets: [] },
          { heading: "约束", paragraphs: [], bullets: ["预算不超过上限"] },
        ],
        theme: { accentColor: "#B45309", backgroundColor: "#FFFFFF" },
      }),
    ];

    for (const compiled of cases) {
      const output = path.join(root, `generated.${compiled.format}`);
      writeFileSync(output, compiled.bytes);
      const parsed = await parser.parse(output, compiled.format);
      expect(compiled.bytes.byteLength).toBeGreaterThan(500);
      expect(compiled.renderedSurfaces).toHaveLength(2);
      expect(
        compiled.renderedSurfaces.every(({ imageDataUrl }) =>
          imageDataUrl.startsWith("data:image/svg+xml;base64,"),
        ),
      ).toBe(true);
      expect(
        compiled.renderedSurfaces.every(({ modelImageDataUrl }) => {
          if (!modelImageDataUrl) return false;
          const encoded = modelImageDataUrl.split(",", 2)[1];
          return (
            modelImageDataUrl.startsWith("data:image/png;base64,") &&
            encoded !== undefined &&
            Buffer.from(encoded, "base64").subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          );
        }),
      ).toBe(true);
      expect(parsed.text.length).toBeGreaterThan(0);
    }
  });

  it("creates and edits a generated Office Artifact through immutable versions", () => {
    const { database, profile } = fixture();
    const service = new FileAppService(new FileRepository(database), profile);
    const first = service.writeOfficeArtifact({
      displayName: "路线图",
      spec: {
        format: "pptx",
        title: "路线图",
        slides: [{ title: "第一版", body: "初始范围", bullets: [] }],
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
      },
    });
    const second = service.writeOfficeArtifact({
      artifactId: first.id,
      displayName: "ignored-name.pptx",
      spec: {
        format: "pptx",
        title: "路线图",
        slides: [
          { title: "第二版", body: "修订范围", bullets: [] },
          { title: "验收", bullets: ["逐页检查"] },
        ],
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
      },
    });
    const preview = service.previewArtifact(first.id, { includeModelImages: false });

    expect(first.displayName).toBe("路线图.pptx");
    expect(second).toMatchObject({ id: first.id, currentVersion: 2 });
    expect(second.versions).toHaveLength(2);
    expect(preview.parsedText).toContain("第二版");
    expect(preview.renderedSurfaces.map(({ label }) => label)).toEqual(["幻灯片 1", "幻灯片 2"]);
    expect(
      preview.renderedSurfaces.every(({ modelImageDataUrl }) => modelImageDataUrl === undefined),
    ).toBe(true);
    service.close();
  });

  it("rejects visual overflow and ambiguous workbook structure before storing bytes", () => {
    expect(() =>
      compileOfficeArtifact({
        format: "docx",
        title: "Overflow",
        pages: [
          {
            heading: "Too much content",
            paragraphs: Array.from({ length: 30 }, () =>
              "A paragraph that wraps across the page ".repeat(8),
            ),
            bullets: [],
          },
        ],
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
      }),
    ).toThrow("OFFICE_PAGE_OVERFLOW:1");
    expect(() =>
      compileOfficeArtifact({
        format: "xlsx",
        title: "Duplicate",
        sheets: [
          { name: "Data", rows: [["A"]], headerRows: 1 },
          { name: "data", rows: [["B"]], headerRows: 1 },
        ],
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
      }),
    ).toThrow("Worksheet names must be unique");
    expect(() =>
      compileOfficeArtifact({
        format: "xlsx",
        title: "External formula",
        sheets: [
          {
            name: "Data",
            rows: [["Result"], [{ value: "", formula: '=WEBSERVICE("https://example.test")' }]],
            headerRows: 1,
          },
        ],
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
      }),
    ).toThrow("Formula network and file URLs are not allowed");
    expect(() =>
      compileOfficeArtifact({
        format: "xlsx",
        title: "DDE formula",
        sheets: [
          {
            name: "Data",
            rows: [["Result"], [{ value: "", formula: "=cmd|' /C calc'!A0" }]],
            headerRows: 1,
          },
        ],
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
      }),
    ).toThrow("External workbook and DDE formula syntax is not allowed");
  });

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
