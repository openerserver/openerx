import { read, set_cptable, utils } from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import { FileServiceError } from "./errors";
import type { ParsedCitation, ParsedFile } from "./parser";

// Pre-Unicode XLS workbooks carry a code page (including Chinese encodings).
set_cptable(cptable);

export function parseXls(bytes: Buffer): ParsedFile {
  // SheetJS also reads plain text. Do not silently accept a damaged XLS as CSV.
  const compoundFile = bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  const biffStream =
    bytes.length >= 4 && bytes[0] === 0x09 && [0, 2, 4, 8].includes(bytes[1] ?? -1);
  if (!compoundFile && !biffStream) {
    throw new FileServiceError("FILE_CORRUPT", "XLS workbook signature missing");
  }
  try {
    const workbook = read(bytes, { type: "buffer", cellFormula: true, cellText: true });
    if (workbook.SheetNames.length === 0) {
      throw new FileServiceError("FILE_CORRUPT", "XLS workbook has no sheets");
    }
    const citations: ParsedCitation[] = [];
    for (const sheet of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheet];
      if (!worksheet) throw new FileServiceError("FILE_CORRUPT", "XLS worksheet missing");
      // Walk stored cells, not the potentially enormous declared used range.
      const cells = Object.keys(worksheet)
        .filter((ref) => /^[A-Z]+[1-9]\d*$/.test(ref))
        .map((ref) => ({ ref, position: utils.decode_cell(ref), cell: worksheet[ref] }))
        .filter(({ cell }) => cell && cell.t !== "z" && (cell.v !== undefined || cell.f))
        .sort((a, b) => a.position.r - b.position.r || a.position.c - b.position.c);
      if (cells.length === 0) continue;
      const start = { r: Number.POSITIVE_INFINITY, c: Number.POSITIVE_INFINITY };
      const end = { r: 0, c: 0 };
      const excerpt = cells
        .map(({ ref, position, cell }) => {
          start.r = Math.min(start.r, position.r);
          start.c = Math.min(start.c, position.c);
          end.r = Math.max(end.r, position.r);
          end.c = Math.max(end.c, position.c);
          const value = utils.format_cell(cell);
          const content = cell.f ? `=${cell.f}${value ? ` → ${value}` : ""}` : value;
          return `${ref}: ${content}`;
        })
        .join("\n");
      citations.push({
        locator: {
          kind: "sheet_range",
          sheet,
          range: `${utils.encode_cell(start)}:${utils.encode_cell(end)}`,
        },
        excerpt,
        confidence: 1,
      });
    }
    return {
      text: citations
        .map(
          ({ locator, excerpt }) =>
            `${locator.kind === "sheet_range" ? `[${locator.sheet}]\n` : ""}${excerpt}`,
        )
        .join("\n\n"),
      citations,
    };
  } catch (error) {
    if (error instanceof FileServiceError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/i.test(message)) throw new FileServiceError("FILE_ENCRYPTED");
    throw new FileServiceError("FILE_CORRUPT", "XLS parsing failed");
  }
}
