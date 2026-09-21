import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { SourceLocator, SupportedFileFormat } from "@openerx/contracts";
import { strFromU8, unzipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { FileServiceError } from "./errors";

const execFileAsync = promisify(execFile);
const maxExpandedArchiveBytes = 200 * 1024 * 1024;

export interface ParsedCitation {
  locator: SourceLocator;
  excerpt: string;
  confidence: number;
}

export interface ParsedFile {
  text: string;
  citations: ParsedCitation[];
}

export interface OcrAdapter {
  extract(filePath: string): Promise<ParsedFile>;
}

export class TesseractCliOcrAdapter implements OcrAdapter {
  async extract(filePath: string): Promise<ParsedFile> {
    try {
      const { stdout } = await execFileAsync("tesseract", [filePath, "stdout", "tsv"], {
        maxBuffer: 20 * 1024 * 1024,
      });
      const rows = stdout
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split("\t"))
        .filter((columns) => columns.length >= 12 && columns[11]?.trim());
      const words = rows.map((columns) => columns[11]?.trim() ?? "").filter(Boolean);
      const confidences = rows
        .map((columns) => Number(columns[10]))
        .filter((value) => Number.isFinite(value) && value >= 0);
      if (words.length === 0) return { text: "", citations: [] };
      const text = words.join(" ");
      const confidence =
        confidences.length === 0
          ? 0.5
          : confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100;
      return {
        text,
        citations: [
          {
            locator: { kind: "image_region", label: "OCR 全图" },
            excerpt: text.slice(0, 1_000),
            confidence: Math.max(0, Math.min(1, confidence)),
          },
        ],
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new FileServiceError("FILE_OCR_UNAVAILABLE");
      throw new FileServiceError("FILE_CORRUPT", "Image OCR failed");
    }
  }
}

export class MultiFormatParser {
  readonly #ocr: OcrAdapter;

  constructor(ocr: OcrAdapter = new TesseractCliOcrAdapter()) {
    this.#ocr = ocr;
  }

  async parse(filePath: string, format: SupportedFileFormat): Promise<ParsedFile> {
    if (format === "pdf") return await this.#pdf(filePath);
    if (format === "docx") return this.#docx(filePath);
    if (format === "xls") {
      const { parseXls } = await import("./xls-parser");
      return parseXls(readFileSync(filePath));
    }
    if (format === "xlsx") return this.#xlsx(filePath);
    if (format === "pptx") return this.#pptx(filePath);
    if (format === "png" || format === "jpeg" || format === "gif" || format === "webp") {
      return await this.#ocr.extract(filePath);
    }
    return this.#text(filePath, format);
  }

  async #pdf(filePath: string): Promise<ParsedFile> {
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const document = await pdfjs.getDocument({
        data: new Uint8Array(readFileSync(filePath)),
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;
      const citations: ParsedCitation[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const excerpt = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        citations.push({
          locator: { kind: "page", page: pageNumber },
          excerpt,
          confidence: 1,
        });
      }
      return { text: citations.map(({ excerpt }) => excerpt).join("\n\n"), citations };
    } catch (error) {
      const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
      if (message.includes("password")) throw new FileServiceError("FILE_ENCRYPTED");
      throw new FileServiceError("FILE_CORRUPT", "PDF parsing failed");
    }
  }

  #docx(filePath: string): ParsedFile {
    const archive = this.#archive(filePath);
    const documentXml = archive["word/document.xml"];
    if (!documentXml) throw new FileServiceError("FILE_CORRUPT", "DOCX document.xml missing");
    const paragraphs = strFromU8(documentXml)
      .split(/<w:p(?:\s[^>]*)?>/)
      .slice(1)
      .map((paragraph) => xmlText(paragraph))
      .filter(Boolean);
    const citations = paragraphs.map((excerpt, index) => ({
      locator: { kind: "text_range", startLine: index + 1, endLine: index + 1 } as const,
      excerpt,
      confidence: 1,
    }));
    return { text: paragraphs.join("\n"), citations };
  }

  #xlsx(filePath: string): ParsedFile {
    const archive = this.#archive(filePath);
    const workbook = archive["xl/workbook.xml"];
    if (!workbook) throw new FileServiceError("FILE_CORRUPT", "XLSX workbook.xml missing");
    const sharedStrings = archive["xl/sharedStrings.xml"]
      ? [
          ...strFromU8(archive["xl/sharedStrings.xml"]).matchAll(
            /<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g,
          ),
        ].map((match) => xmlText(match[1] ?? ""))
      : [];
    const sheetNames = [
      ...strFromU8(workbook).matchAll(/<(?:\w+:)?sheet\b[^>]*name="([^"]+)"/g),
    ].map((match) => decodeXml(match[1] ?? "Sheet"));
    const sheetEntries = Object.entries(archive)
      .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort(([left], [right]) => numericSuffix(left) - numericSuffix(right));
    const citations: ParsedCitation[] = [];
    sheetEntries.forEach(([name, bytes], index) => {
      const xml = strFromU8(bytes);
      const cells = [...xml.matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)].map(
        (match) => {
          const attributes = match[1] ?? "";
          const body = match[2] ?? "";
          const ref = /\br="([^"]+)"/.exec(attributes)?.[1] ?? "A1";
          const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
          const raw = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1] ?? xmlText(body);
          const value = type === "s" ? (sharedStrings[Number(raw)] ?? raw) : decodeXml(raw);
          const formula = /<(?:\w+:)?f(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?f>/.exec(body)?.[1];
          return { ref, value: formula ? `=${decodeXml(formula)} → ${value}` : value };
        },
      );
      const sheet = sheetNames[index] ?? `Sheet${index + 1}`;
      const excerpt = cells.map(({ ref, value }) => `${ref}: ${value}`).join("\n");
      const lastRef = cells.at(-1)?.ref ?? "A1";
      citations.push({
        locator: { kind: "sheet_range", sheet, range: `A1:${lastRef}` },
        excerpt,
        confidence: 1,
      });
      void name;
    });
    return { text: citations.map(({ excerpt }) => excerpt).join("\n\n"), citations };
  }

  #pptx(filePath: string): ParsedFile {
    const archive = this.#archive(filePath);
    const slides = Object.entries(archive)
      .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort(([left], [right]) => numericSuffix(left) - numericSuffix(right));
    if (slides.length === 0) throw new FileServiceError("FILE_CORRUPT", "PPTX has no slides");
    const citations = slides.map(([, bytes], index) => ({
      locator: { kind: "slide", slide: index + 1 } as const,
      excerpt: xmlText(strFromU8(bytes)),
      confidence: 1,
    }));
    return { text: citations.map(({ excerpt }) => excerpt).join("\n\n"), citations };
  }

  #text(filePath: string, format: SupportedFileFormat): ParsedFile {
    const source = readFileSync(filePath, "utf8");
    if (format === "json") {
      try {
        JSON.parse(source);
      } catch {
        throw new FileServiceError("FILE_CORRUPT", "Invalid JSON");
      }
    }
    if (format === "yaml") {
      try {
        parseYaml(source);
      } catch {
        throw new FileServiceError("FILE_CORRUPT", "Invalid YAML");
      }
    }
    const text = format === "html" ? htmlText(source) : source;
    const lines = text.split(/\r?\n/);
    const citations: ParsedCitation[] = [];
    const chunkSize = format === "csv" ? 50 : 80;
    for (let index = 0; index < lines.length; index += chunkSize) {
      const excerpt = lines
        .slice(index, index + chunkSize)
        .join("\n")
        .trim();
      if (!excerpt) continue;
      citations.push({
        locator: {
          kind: "text_range",
          startLine: index + 1,
          endLine: Math.min(lines.length, index + chunkSize),
        },
        excerpt,
        confidence: 1,
      });
    }
    return { text, citations };
  }

  #archive(filePath: string): Record<string, Uint8Array> {
    try {
      const archive = unzipSync(new Uint8Array(readFileSync(filePath)));
      const expanded = Object.values(archive).reduce((sum, bytes) => sum + bytes.byteLength, 0);
      if (expanded > maxExpandedArchiveBytes) throw new FileServiceError("FILE_TOO_LARGE");
      return archive;
    } catch (error) {
      if (error instanceof FileServiceError) throw error;
      const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
      if (message.includes("password") || message.includes("encrypted")) {
        throw new FileServiceError("FILE_ENCRYPTED");
      }
      throw new FileServiceError("FILE_CORRUPT", "Office archive parsing failed");
    }
  }
}

function numericSuffix(value: string): number {
  return Number(/(\d+)(?:\.xml)?$/.exec(value)?.[1] ?? 0);
}

function xmlText(value: string): string {
  return [...value.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function htmlText(value: string): string {
  return decodeXml(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}
