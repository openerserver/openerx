import type { OfficeArtifactSpec, OfficeCell, OfficeCellValue } from "@openerx/contracts";
import {
  appProperties,
  cellDisplayValue,
  columnName,
  coreProperties,
  displayWidth,
  encodedSpec,
  escapeXml,
  packageRelationships,
  zipXml,
} from "./office-ooxml";

const officeCjkFont = process.platform === "win32" ? "Microsoft YaHei" : "Heiti SC";

/** Binary-only compiler. Callers must validate their bounded, host-created specification. */
export function compileOfficeSpreadsheet(
  spec: Extract<OfficeArtifactSpec, { format: "xlsx" }>,
  options: { createdAt?: string; creatorName?: string; frozenText?: boolean } = {},
): Buffer {
  const accent = spec.theme.accentColor.slice(1).toUpperCase();
  const entries: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
        ${spec.sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
        <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
      </Types>`,
    "_rels/.rels": packageRelationships("xl/workbook.xml"),
    "docProps/app.xml": appProperties("Microsoft Excel"),
    "docProps/core.xml": coreProperties(spec.title, options.createdAt, options.creatorName),
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${spec.sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
      <Relationship Id="rId${spec.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <!-- openerx-spec:${encodedSpec(spec)} -->
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
      ${spec.sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}
      </sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="2"><font><sz val="11"/><name val="${officeCjkFont}"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="${officeCjkFont}"/></font></fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${accent}"/><bgColor indexed="64"/></patternFill></fill></fills>
      <borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="${options.frozenText ? 49 : 0}" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"${options.frozenText ? ' applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' : "/>"}</cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  spec.sheets.forEach((sheet, sheetIndex) => {
    const columns = Math.max(1, ...sheet.rows.map((row) => row.length));
    const widths = Array.from({ length: columns }, (_, index) => {
      const max = Math.max(
        4,
        ...sheet.rows.map((row) => displayWidth(cellDisplayValue(row[index] ?? null))),
      );
      return Math.min(40, Math.max(10, max + 2));
    });
    const columnXml = widths
      .map(
        (width, index) =>
          `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
      )
      .join("");
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const lines = options.frozenText
          ? Math.max(
              1,
              ...row.map((cell, index) =>
                cellDisplayValue(cell)
                  .split("\n")
                  .reduce(
                    (sum, line) =>
                      sum + Math.max(1, Math.ceil(displayWidth(line) / (widths[index]! - 2))),
                    0,
                  ),
              ),
            )
          : 1;
        const height = Math.min(409, lines * 24);
        return `<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${row.map((cell, columnIndex) => xlsxCell(cell, columnIndex, rowIndex, rowIndex < sheet.headerRows)).join("")}</row>`;
      })
      .join("");
    entries[`xl/worksheets/sheet${sheetIndex + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.headerRows}" topLeftCell="A${sheet.headerRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columnXml}</cols><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zipXml(entries, options.createdAt !== undefined);
}

function xlsxCell(
  cell: OfficeCell,
  columnIndex: number,
  rowIndex: number,
  header: boolean,
): string {
  const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
  const structured =
    cell !== null && typeof cell === "object" && !Array.isArray(cell)
      ? cell
      : { value: cell as OfficeCellValue };
  const style = header ? 1 : 2;
  const formula = structured.formula?.replace(/^=/, "");
  const value = structured.value;
  if (formula) {
    const type =
      typeof value === "string" ? ' t="str"' : typeof value === "boolean" ? ' t="b"' : "";
    return `<c r="${reference}" s="${style}"${type}><f>${escapeXml(formula)}</f><v>${escapeXml(value === null ? "" : String(value))}</v></c>`;
  }
  if (typeof value === "number") return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === "boolean")
    return `<c r="${reference}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value ?? "")}</t></is></c>`;
}
