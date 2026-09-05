import type {
  OfficeArtifactSpec,
  OfficeCell,
  OfficeCellValue,
  RenderedSurface,
  SupportedFileFormat,
} from "@openerx/contracts";
import { officeArtifactSpecSchema } from "@openerx/contracts";
import { Resvg } from "@resvg/resvg-js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { desktopBrand } from "../../branding/src/index";

const officeMediaTypes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
const officeCjkFont = process.platform === "win32" ? "Microsoft YaHei" : "Heiti SC";

export interface CompiledOfficeArtifact {
  bytes: Buffer;
  format: "docx" | "xlsx" | "pptx" | "pdf";
  mediaType: string;
  parsedText: string;
  renderedSurfaces: RenderedSurface[];
}

export interface RenderedOfficeArtifact {
  parsedText: string;
  renderedSurfaces: RenderedSurface[];
}

export function compileOfficeArtifact(
  input: OfficeArtifactSpec,
  options: { includeModelImages?: boolean } = {},
): CompiledOfficeArtifact {
  const spec = officeArtifactSpecSchema.parse(input);
  const rendered = renderOfficeSpec(spec, options.includeModelImages);
  const bytes =
    spec.format === "docx"
      ? compileDocx(spec)
      : spec.format === "xlsx"
        ? compileXlsx(spec)
        : spec.format === "pptx"
          ? compilePptx(spec)
          : compilePdf(spec);
  return {
    bytes,
    format: spec.format,
    mediaType: officeMediaTypes[spec.format],
    ...rendered,
  };
}

export function renderOfficeArtifact(
  bytes: Uint8Array,
  format: SupportedFileFormat,
  options: { includeModelImages?: boolean } = {},
): RenderedOfficeArtifact | null {
  if (!isOfficeFormat(format)) return null;
  const encoded = embeddedSpec(bytes, format);
  if (!encoded) return null;
  try {
    return renderOfficeSpec(
      officeArtifactSpecSchema.parse(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))),
      options.includeModelImages,
    );
  } catch {
    return null;
  }
}

function isOfficeFormat(format: SupportedFileFormat): format is "docx" | "xlsx" | "pptx" | "pdf" {
  return format === "docx" || format === "xlsx" || format === "pptx" || format === "pdf";
}

function embeddedSpec(bytes: Uint8Array, format: "docx" | "xlsx" | "pptx" | "pdf"): string | null {
  if (format === "pdf") {
    return (
      /%openerx-spec:([A-Za-z0-9+/=]+)/.exec(Buffer.from(bytes).toString("latin1"))?.[1] ?? null
    );
  }
  try {
    const archive = unzipSync(bytes);
    const main =
      format === "docx"
        ? archive["word/document.xml"]
        : format === "xlsx"
          ? archive["xl/workbook.xml"]
          : archive["ppt/presentation.xml"];
    if (!main) return null;
    return /openerx-spec:([A-Za-z0-9+/=]+)/.exec(strFromU8(main))?.[1] ?? null;
  } catch {
    return null;
  }
}

function encodedSpec(spec: OfficeArtifactSpec): string {
  return Buffer.from(JSON.stringify(spec), "utf8").toString("base64");
}

function renderOfficeSpec(
  spec: OfficeArtifactSpec,
  includeModelImages = true,
): RenderedOfficeArtifact {
  if (spec.format === "xlsx") {
    return {
      parsedText: spec.sheets
        .map((sheet) =>
          [
            `[${sheet.name}]`,
            ...sheet.rows.map((row) => row.map(cellDisplayValue).join("\t")),
          ].join("\n"),
        )
        .join("\n\n"),
      renderedSurfaces: spec.sheets.map((sheet, index) =>
        sheetSurface(sheet, index + 1, spec.theme, includeModelImages),
      ),
    };
  }
  if (spec.format === "pptx") {
    return {
      parsedText: spec.slides
        .map((slide) =>
          [slide.title, slide.subtitle, slide.body, ...slide.bullets].filter(Boolean).join("\n"),
        )
        .join("\n\n"),
      renderedSurfaces: spec.slides.map((slide, index) =>
        slideSurface(slide, index + 1, spec.theme, includeModelImages),
      ),
    };
  }
  return {
    parsedText: spec.pages
      .map((page) =>
        [page.heading, ...page.paragraphs, ...page.bullets, page.footer].filter(Boolean).join("\n"),
      )
      .join("\n\n"),
    renderedSurfaces: spec.pages.map((page, index) =>
      pageSurface(page, index + 1, spec.title, spec.theme, includeModelImages),
    ),
  };
}

function pageSurface(
  page: Extract<OfficeArtifactSpec, { format: "docx" | "pdf" }>["pages"][number],
  index: number,
  documentTitle: string,
  theme: { accentColor: string; backgroundColor: string },
  includeModelImage = true,
): RenderedSurface {
  const lines: Array<{ text: string; kind: "heading" | "body" | "bullet" }> = [];
  if (page.heading) {
    for (const text of wrapText(page.heading, 32)) lines.push({ text, kind: "heading" });
  }
  for (const paragraph of page.paragraphs) {
    for (const text of wrapText(paragraph, 58)) lines.push({ text, kind: "body" });
    lines.push({ text: "", kind: "body" });
  }
  for (const bullet of page.bullets) {
    const wrapped = wrapText(bullet, 52);
    wrapped.forEach((text, lineIndex) => {
      lines.push({ text: `${lineIndex === 0 ? "• " : "  "}${text}`, kind: "bullet" });
    });
  }
  if (lines.length > 41) throw new Error(`OFFICE_PAGE_OVERFLOW:${index}`);
  let y = 150;
  const content = lines
    .map((line) => {
      if (!line.text) {
        y += 12;
        return "";
      }
      const size = line.kind === "heading" ? 30 : 19;
      const weight = line.kind === "heading" ? 700 : 400;
      const fill = line.kind === "heading" ? theme.accentColor : "#172033";
      const currentY = y;
      y += line.kind === "heading" ? 43 : 30;
      return `<text x="64" y="${currentY}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line.text)}</text>`;
    })
    .join("");
  const footer = page.footer
    ? `<text x="64" y="1070" font-size="14" fill="#64748B">${escapeXml(page.footer)}</text>`
    : "";
  return svgSurface(
    "page",
    index,
    `第 ${index} 页`,
    794,
    1123,
    `<rect width="794" height="1123" fill="${theme.backgroundColor}"/>
     <rect x="0" y="0" width="12" height="1123" fill="${theme.accentColor}"/>
     <text x="64" y="68" font-size="15" font-weight="700" fill="#64748B">${escapeXml(documentTitle)}</text>
     <line x1="64" y1="92" x2="730" y2="92" stroke="#E2E8F0"/>
     ${content}${footer}
     <text x="730" y="1070" text-anchor="end" font-size="14" fill="#94A3B8">${index}</text>`,
    includeModelImage,
  );
}

function sheetSurface(
  sheet: Extract<OfficeArtifactSpec, { format: "xlsx" }>["sheets"][number],
  index: number,
  theme: { accentColor: string; backgroundColor: string },
  includeModelImage = true,
): RenderedSurface {
  const columns = Math.max(1, ...sheet.rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) => {
    const max = Math.max(
      4,
      ...sheet.rows.map((row) => displayWidth(cellDisplayValue(row[column] ?? null))),
    );
    return Math.min(420, Math.max(88, max * 9 + 28));
  });
  const left = 54;
  const top = 104;
  const rowHeight = 34;
  const width = Math.max(720, left * 2 + widths.reduce((sum, value) => sum + value, 0));
  const height = Math.max(360, top + sheet.rows.length * rowHeight + 54);
  const xPositions = widths.reduce<number[]>(
    (positions, cellWidth) => {
      positions.push((positions.at(-1) ?? left) + cellWidth);
      return positions;
    },
    [left],
  );
  const cells = sheet.rows
    .flatMap((row, rowIndex) =>
      widths.map((cellWidth, columnIndex) => {
        const x = xPositions[columnIndex] ?? left;
        const y = top + rowIndex * rowHeight;
        const header = rowIndex < sheet.headerRows;
        const value = truncateText(cellDisplayValue(row[columnIndex] ?? null), cellWidth);
        return `<rect x="${x}" y="${y}" width="${cellWidth}" height="${rowHeight}" fill="${header ? theme.accentColor : rowIndex % 2 === 0 ? "#F8FAFC" : "#FFFFFF"}" stroke="#CBD5E1"/>
        <text x="${x + 10}" y="${y + 22}" font-size="14" font-weight="${header ? 700 : 400}" fill="${header ? "#FFFFFF" : "#172033"}">${escapeXml(value)}</text>`;
      }),
    )
    .join("");
  return svgSurface(
    "sheet",
    index,
    sheet.name,
    width,
    height,
    `<rect width="${width}" height="${height}" fill="${theme.backgroundColor}"/>
     <text x="54" y="52" font-size="28" font-weight="700" fill="#172033">${escapeXml(sheet.name)}</text>
     <text x="54" y="78" font-size="14" fill="#64748B">${sheet.rows.length} 行 · ${columns} 列</text>
     ${cells}`,
    includeModelImage,
  );
}

function slideSurface(
  slide: Extract<OfficeArtifactSpec, { format: "pptx" }>["slides"][number],
  index: number,
  theme: { accentColor: string; backgroundColor: string },
  includeModelImage = true,
): RenderedSurface {
  const titleLines = wrapText(slide.title, 30);
  const bodyLines = [
    ...(slide.subtitle ? wrapText(slide.subtitle, 58) : []),
    ...(slide.body ? wrapText(slide.body, 62) : []),
    ...slide.bullets.flatMap((bullet) =>
      wrapText(bullet, 54).map((line, lineIndex) => `${lineIndex === 0 ? "• " : "  "}${line}`),
    ),
  ];
  if (titleLines.length > 3 || bodyLines.length > 14) {
    throw new Error(`OFFICE_SLIDE_OVERFLOW:${index}`);
  }
  const title = titleLines
    .map(
      (line, lineIndex) =>
        `<text x="78" y="${150 + lineIndex * 58}" font-size="48" font-weight="700" fill="#172033">${escapeXml(line)}</text>`,
    )
    .join("");
  const bodyStart = 350;
  const body = bodyLines
    .map(
      (line, lineIndex) =>
        `<text x="82" y="${bodyStart + lineIndex * 34}" font-size="24" fill="#475569">${escapeXml(line)}</text>`,
    )
    .join("");
  return svgSurface(
    "slide",
    index,
    `幻灯片 ${index}`,
    1280,
    720,
    `<rect width="1280" height="720" fill="${theme.backgroundColor}"/>
     <rect x="0" y="0" width="1280" height="18" fill="${theme.accentColor}"/>
     <text x="78" y="76" font-size="16" font-weight="700" fill="${theme.accentColor}">OPENERX PRESENTATION</text>
     ${title}
     <rect x="82" y="305" width="128" height="6" fill="${theme.accentColor}"/>
     ${body}
     <text x="1190" y="665" text-anchor="end" font-size="16" font-weight="700" fill="#94A3B8">${String(index).padStart(2, "0")}</text>`,
    includeModelImage,
  );
}

function svgSurface(
  kind: RenderedSurface["kind"],
  index: number,
  label: string,
  width: number,
  height: number,
  content: string,
  includeModelImage: boolean,
): RenderedSurface {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>text{font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}</style>${content}</svg>`;
  if (!includeModelImage) {
    return {
      kind,
      index,
      label,
      imageDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
    };
  }
  const modelPng = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.min(width, 1_600) },
    font: { defaultFontFamily: officeCjkFont, loadSystemFonts: true },
  })
    .render()
    .asPng();
  return {
    kind,
    index,
    label,
    imageDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
    modelImageDataUrl: `data:image/png;base64,${Buffer.from(modelPng).toString("base64")}`,
  };
}

function compileDocx(spec: Extract<OfficeArtifactSpec, { format: "docx" }>): Buffer {
  const body = spec.pages
    .map((page, index) => {
      const pageBreak = index === 0 ? "" : '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      const heading = page.heading ? wordParagraph(page.heading, "Heading1") : "";
      const paragraphs = page.paragraphs.map((text) => wordParagraph(text)).join("");
      const bullets = page.bullets
        .map((text) => wordParagraph(`• ${text}`, "ListParagraph"))
        .join("");
      const footer = page.footer ? wordParagraph(page.footer, "Footer") : "";
      return `${pageBreak}${heading}${paragraphs}${bullets}${footer}`;
    })
    .join("");
  const accent = spec.theme.accentColor.slice(1).toUpperCase();
  return zipXml({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
        <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
        <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
      </Types>`,
    "_rels/.rels": packageRelationships("word/document.xml"),
    "docProps/app.xml": appProperties("Microsoft Office Word"),
    "docProps/core.xml": coreProperties(spec.title),
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <!-- openerx-spec:${encodedSpec(spec)} -->
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>${wordParagraph(spec.title, "Title")}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
      </w:document>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="${officeCjkFont}" w:hAnsi="${officeCjkFont}" w:eastAsia="${officeCjkFont}"/><w:sz w:val="22"/></w:rPr></w:style>
        <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="40"/></w:rPr></w:style>
        <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="30"/></w:rPr></w:style>
        <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/></w:pPr></w:style>
        <w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="Footer"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="64748B"/><w:sz w:val="18"/></w:rPr></w:style>
      </w:styles>`,
  });
}

function wordParagraph(text: string, style?: string): string {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function compileXlsx(spec: Extract<OfficeArtifactSpec, { format: "xlsx" }>): Buffer {
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
    "docProps/core.xml": coreProperties(spec.title),
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
      <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  spec.sheets.forEach((sheet, sheetIndex) => {
    const columns = Math.max(1, ...sheet.rows.map((row) => row.length));
    const columnXml = Array.from({ length: columns }, (_, index) => {
      const max = Math.max(
        4,
        ...sheet.rows.map((row) => displayWidth(cellDisplayValue(row[index] ?? null))),
      );
      return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(40, Math.max(10, max + 2))}" customWidth="1"/>`;
    }).join("");
    const rows = sheet.rows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}" ht="24" customHeight="1">${row.map((cell, columnIndex) => xlsxCell(cell, columnIndex, rowIndex, rowIndex < sheet.headerRows)).join("")}</row>`,
      )
      .join("");
    entries[`xl/worksheets/sheet${sheetIndex + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.headerRows}" topLeftCell="A${sheet.headerRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columnXml}</cols><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zipXml(entries);
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

function compilePptx(spec: Extract<OfficeArtifactSpec, { format: "pptx" }>): Buffer {
  const entries: Record<string, string> = {
    "[Content_Types].xml": pptxContentTypes(spec.slides.length),
    "_rels/.rels": packageRelationships("ppt/presentation.xml"),
    "docProps/app.xml": appProperties("Microsoft PowerPoint", spec.slides.length),
    "docProps/core.xml": coreProperties(spec.title),
    "ppt/_rels/presentation.xml.rels": pptxPresentationRelationships(spec.slides.length),
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <!-- openerx-spec:${encodedSpec(spec)} -->
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${spec.slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/presProps.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    "ppt/viewProps.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    "ppt/tableStyles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    "ppt/slideLayouts/slideLayout1.xml": pptxSlideLayout(),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    "ppt/slideMasters/slideMaster1.xml": pptxSlideMaster(),
    "ppt/theme/theme1.xml": pptxTheme(spec.theme.accentColor.slice(1).toUpperCase()),
  };
  spec.slides.forEach((slide, index) => {
    entries[`ppt/slides/_rels/slide${index + 1}.xml.rels`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
    entries[`ppt/slides/slide${index + 1}.xml`] = pptxSlide(
      slide,
      index + 1,
      spec.theme.accentColor.slice(1).toUpperCase(),
      spec.theme.backgroundColor.slice(1).toUpperCase(),
    );
  });
  return zipXml(entries);
}

function pptxSlide(
  slide: Extract<OfficeArtifactSpec, { format: "pptx" }>["slides"][number],
  index: number,
  accent: string,
  background: string,
): string {
  const body = [slide.subtitle, slide.body, ...slide.bullets.map((value) => `• ${value}`)]
    .filter(Boolean)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${pptxTextShape(2, "Title", slide.title, 742950, 1143000, 9753600, 1600200, 3000, "172033", true)}${pptxTextShape(3, "Body", body, 781050, 3162300, 8915400, 2286000, 1800, "475569", false)}${pptxTextShape(4, "Slide number", String(index).padStart(2, "0"), 10744200, 6172200, 762000, 304800, 1200, accent, true)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function pptxTextShape(
  id: number,
  name: string,
  text: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  size: number,
  color: string,
  bold: boolean,
): string {
  const paragraphs = text
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="zh-CN" sz="${size}"${bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="${officeCjkFont}"/></a:rPr><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${size}"/></a:p>`,
    );
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs.join("")}</p:txBody></p:sp>`;
}

function compilePdf(spec: Extract<OfficeArtifactSpec, { format: "pdf" }>): Buffer {
  const objects: string[] = [];
  const add = (content: string): number => {
    objects.push(content);
    return objects.length;
  };
  const catalog = add("placeholder");
  const pagesObject = add("placeholder");
  const cjkFont = add("placeholder");
  const descendantFont = add("placeholder");
  const latinFont = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const [index, page] of spec.pages.entries()) {
    const lines = pdfPageLines(page, index + 1, spec.title);
    const [red, green, blue] = hexRgb(spec.theme.accentColor);
    const commands = [
      `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)} rg`,
      pdfTextCommand(spec.title, 48, 800, 12),
      "0.09 0.13 0.20 rg",
      ...lines.map(
        ({ text, y, size, accent }) =>
          `${accent ? `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)}` : "0.09 0.13 0.20"} rg ${pdfTextCommand(text, 48, y, size)}`,
      ),
      `0.4 0.45 0.55 rg ${pdfTextCommand(String(index + 1), 530, 28, 10)}`,
    ].join("\n");
    const contentId = add(
      `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
    );
    const pageId = add(
      `<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${cjkFont} 0 R /F2 ${latinFont} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`;
  objects[pagesObject - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[cjkFont - 1] =
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${descendantFont} 0 R] >>`;
  objects[descendantFont - 1] =
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 >>";
  let output = `%PDF-1.7\n%openerx-spec:${encodedSpec(spec)}\n`;
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "utf8");
}

function pdfPageLines(
  page: Extract<OfficeArtifactSpec, { format: "pdf" }>["pages"][number],
  index: number,
  title: string,
): Array<{ text: string; y: number; size: number; accent: boolean }> {
  const rendered = pageSurface(page, index, title, {
    accentColor: "#2563EB",
    backgroundColor: "#FFFFFF",
  });
  void rendered;
  const lines: Array<{ text: string; y: number; size: number; accent: boolean }> = [];
  let y = 744;
  if (page.heading) {
    for (const text of wrapText(page.heading, 32)) {
      lines.push({ text, y, size: 20, accent: true });
      y -= 30;
    }
  }
  for (const paragraph of page.paragraphs) {
    for (const text of wrapText(paragraph, 58)) {
      lines.push({ text, y, size: 12, accent: false });
      y -= 20;
    }
    y -= 8;
  }
  for (const bullet of page.bullets) {
    for (const [lineIndex, text] of wrapText(bullet, 52).entries()) {
      lines.push({ text: `${lineIndex === 0 ? "- " : "  "}${text}`, y, size: 12, accent: false });
      y -= 20;
    }
  }
  if (page.footer) lines.push({ text: page.footer, y: 42, size: 9, accent: false });
  return lines;
}

function zipXml(entries: Record<string, string>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])),
      { level: 6 },
    ),
  );
}

function packageRelationships(documentTarget: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${documentTarget}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function coreProperties(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(desktopBrand.productName)}</dc:creator><cp:lastModifiedBy>${escapeXml(desktopBrand.productName)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function appProperties(application: string, slides = 0): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>${application}</Application>${slides ? `<Slides>${slides}</Slides>` : ""}<AppVersion>16.0000</AppVersion></Properties>`;
}

function pptxContentTypes(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>${Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function pptxPresentationRelationships(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}<Relationship Id="rId${slideCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/><Relationship Id="rId${slideCount + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/><Relationship Id="rId${slideCount + 4}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/></Relationships>`;
}

function pptxSlideLayout(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function pptxSlideMaster(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="${escapeXml(desktopBrand.productName)}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3000" b="1"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-285750"><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`;
}

function pptxTheme(accent: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${escapeXml(desktopBrand.productName)}"><a:themeElements><a:clrScheme name="${escapeXml(desktopBrand.productName)}"><a:dk1><a:srgbClr val="172033"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="475569"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="${accent}"/></a:accent1><a:accent2><a:srgbClr val="14B8A6"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="8B5CF6"/></a:accent4><a:accent5><a:srgbClr val="EC4899"/></a:accent5><a:accent6><a:srgbClr val="64748B"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="${escapeXml(desktopBrand.productName)}"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="${officeCjkFont}"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="${officeCjkFont}"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="${escapeXml(desktopBrand.productName)}"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function cellDisplayValue(cell: OfficeCell): string {
  if (cell !== null && typeof cell === "object" && !Array.isArray(cell)) {
    const value = cell.value === null ? "" : String(cell.value);
    return cell.formula
      ? `${cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`} → ${value}`
      : value;
  }
  return cell === null ? "" : String(cell);
}

function columnName(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function wrapText(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const sourceLine of value.split(/\r?\n/)) {
    const words = sourceLine.includes(" ") ? sourceLine.split(/\s+/) : [...sourceLine];
    let line = "";
    for (const word of words) {
      const separator = sourceLine.includes(" ") && line ? " " : "";
      if (displayWidth(`${line}${separator}${word}`) <= width) {
        line += `${separator}${word}`;
        continue;
      }
      if (line) lines.push(line);
      line = word;
    }
    lines.push(line);
  }
  return lines.filter((line, index, all) => line || index === all.length - 1);
}

function displayWidth(value: string): number {
  return [...value].reduce(
    (sum, character) => sum + ((character.codePointAt(0) ?? 0) <= 0xff ? 1 : 2),
    0,
  );
}

function truncateText(value: string, pixelWidth: number): string {
  const max = Math.max(4, Math.floor((pixelWidth - 20) / 8));
  if (displayWidth(value) <= max) return value;
  let result = "";
  for (const character of value) {
    if (displayWidth(`${result}${character}…`) > max) break;
    result += character;
  }
  return `${result}…`;
}

function pdfTextCommand(text: string, x: number, y: number, size: number): string {
  const runs: Array<{ latin: boolean; text: string }> = [];
  for (const character of text) {
    const latin = (character.codePointAt(0) ?? 0) <= 0x7f;
    const previous = runs.at(-1);
    if (previous?.latin === latin) previous.text += character;
    else runs.push({ latin, text: character });
  }
  return `BT ${x} ${y} Td ${runs
    .map((run) =>
      run.latin
        ? `/F2 ${size} Tf (${escapePdfLiteral(run.text)}) Tj`
        : `/F1 ${size} Tf <${pdfUnicodeHex(run.text)}> Tj`,
    )
    .join(" ")} ET`;
}

function escapePdfLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function pdfUnicodeHex(value: string): string {
  const littleEndian = Buffer.from(value, "utf16le");
  const bigEndian = Buffer.allocUnsafe(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1] ?? 0;
    bigEndian[index + 1] = littleEndian[index] ?? 0;
  }
  return bigEndian.toString("hex").toUpperCase();
}

function hexRgb(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  ];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
