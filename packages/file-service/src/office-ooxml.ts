import type { OfficeArtifactSpec, OfficeCell } from "@openerx/contracts";
import { strToU8, zipSync } from "fflate";

export function encodedSpec(spec: OfficeArtifactSpec): string {
  return Buffer.from(JSON.stringify(spec), "utf8").toString("base64");
}

export function zipXml(entries: Record<string, string>, deterministic = false): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])),
      { level: 6, ...(deterministic ? { mtime: new Date(1980, 0, 1) } : {}) },
    ),
  );
}

export function packageRelationships(documentTarget: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${documentTarget}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

export function coreProperties(title: string, createdAt?: string, creator = "openerx"): string {
  const now = createdAt ?? new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(creator)}</dc:creator><cp:lastModifiedBy>${escapeXml(creator)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export function appProperties(application: string, slides = 0): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>${application}</Application>${slides ? `<Slides>${slides}</Slides>` : ""}<AppVersion>16.0000</AppVersion></Properties>`;
}

export function cellDisplayValue(cell: OfficeCell): string {
  if (cell !== null && typeof cell === "object" && !Array.isArray(cell)) {
    const value = cell.value === null ? "" : String(cell.value);
    return cell.formula
      ? `${cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`} → ${value}`
      : value;
  }
  return cell === null ? "" : String(cell);
}

export function columnName(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function displayWidth(value: string): number {
  return [...value].reduce(
    (sum, character) => sum + ((character.codePointAt(0) ?? 0) <= 0xff ? 1 : 2),
    0,
  );
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
