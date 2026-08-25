import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const fixtureDirectory = path.join(repositoryRoot, "tests/v2/fixtures/m4");
const renderDirectory = path.join(repositoryRoot, "tmp/m4-artifact-render");
const artifactToolEntry = process.env.OPENERX_ARTIFACT_TOOL_ENTRY;
if (!artifactToolEntry) throw new Error("OPENERX_ARTIFACT_TOOL_ENTRY is required");
const { Presentation, PresentationFile, SpreadsheetFile, Workbook } = await import(
  pathToFileURL(artifactToolEntry).href
);

await fs.mkdir(fixtureDirectory, { recursive: true });
await fs.mkdir(renderDirectory, { recursive: true });

async function writeBlob(outputPath, blob) {
  await fs.writeFile(outputPath, new Uint8Array(await blob.arrayBuffer()));
}

async function removeInspectionSidecar(outputPath) {
  await fs.rm(`${outputPath}.inspect.ndjson`, { force: true });
}

async function createWorkbook() {
  const workbook = Workbook.create();
  const data = workbook.worksheets.add("Data");
  const summary = workbook.worksheets.add("Summary");
  data.showGridLines = false;
  summary.showGridLines = false;
  data.getRange("A1:E5").values = [
    ["SKU", "Quantity", "Unit price", "Line total", "Anomaly"],
    ["A-100", 3, 120, null, null],
    ["B-200", 2, 310, null, null],
    ["C-300", 5, 80, null, null],
    ["D-400", 1, 950, null, null],
  ];
  data.getRange("D2").formulas = [["=B2*C2"]];
  data.getRange("D2:D5").fillDown();
  data.getRange("E2").formulas = [['=IF(D2>500,"YES","NO")']];
  data.getRange("E2:E5").fillDown();
  data.getRange("A1:E1").format = {
    fill: "#14372B",
    font: { bold: true, color: "#FFFFFF" },
    borders: { preset: "outside", style: "thin", color: "#14372B" },
  };
  data.getRange("A2:E5").format.borders = {
    insideHorizontal: { style: "thin", color: "#DCE5DF" },
    bottom: { style: "thin", color: "#9FB7AA" },
  };
  data.getRange("B2:B5").format.numberFormat = "0";
  data.getRange("C2:D5").format.numberFormat = "$#,##0.00";
  data.getRange("E2:E5").format = {
    horizontalAlignment: "center",
    borders: { left: { style: "thin", color: "#DCE5DF" } },
  };
  data.getRange("A1:E5").format.rowHeight = 22;
  data.getRange("A1:A5").format.columnWidth = 16;
  data.getRange("B1:B5").format.columnWidth = 12;
  data.getRange("C1:C5").format.columnWidth = 15;
  data.getRange("D1:D5").format.columnWidth = 18;
  data.getRange("E1:E5").format.columnWidth = 15;
  data.freezePanes.freezeRows(1);

  summary.getRange("A1:D1").merge();
  summary.getRange("A1:D1").values = [["M4 Workbook Fixture"]];
  summary.getRange("A1:D1").format = {
    fill: "#14372B",
    font: { bold: true, color: "#FFFFFF", size: 18 },
    rowHeight: 32,
  };
  summary.getRange("A3:B5").values = [
    ["Metric", "Value"],
    ["Gross total", null],
    ["Anomaly count", null],
  ];
  summary.getRange("B4").formulas = [["=SUM(Data!D2:D5)"]];
  summary.getRange("B5").formulas = [['=COUNTIF(Data!E2:E5,"YES")']];
  summary.getRange("A3:B3").format = {
    fill: "#DCEBE3",
    font: { bold: true, color: "#14372B" },
  };
  summary.getRange("A4:B5").format.borders = {
    insideHorizontal: { style: "thin", color: "#DCE5DF" },
    bottom: { style: "thin", color: "#9FB7AA" },
  };
  summary.getRange("B4").format.numberFormat = "$#,##0.00";
  summary.getRange("B5").format.numberFormat = "0";
  summary.getRange("A1:A5").format.columnWidth = 22;
  summary.getRange("B1:B5").format.columnWidth = 18;

  const inspected = await workbook.inspect({
    kind: "sheet,formula",
    maxChars: 6_000,
    tableMaxRows: 8,
    tableMaxCols: 8,
  });
  await fs.writeFile(path.join(renderDirectory, "xlsx-inspect.ndjson"), inspected.ndjson);
  for (const sheetName of ["Data", "Summary"]) {
    const preview = await workbook.render({
      sheetName,
      autoCrop: "all",
      scale: 1.5,
      format: "png",
    });
    await writeBlob(path.join(renderDirectory, `xlsx-${sheetName.toLowerCase()}.png`), preview);
  }
  const output = await SpreadsheetFile.exportXlsx(workbook);
  const outputPath = path.join(fixtureDirectory, "file.generated-xlsx.v1.xlsx");
  await output.save(outputPath);
  await removeInspectionSidecar(outputPath);
}

function addText(slide, name, text, position, style) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name,
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = style;
  return shape;
}

function addSlideNumber(slide, number) {
  addText(
    slide,
    `slide-number-${number}`,
    String(number).padStart(2, "0"),
    { left: 1140, top: 650, width: 70, height: 28 },
    { fontSize: 15, bold: true, color: "slate-400", alignment: "right" },
  );
}

async function createPresentation() {
  const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
  const slides = [
    [
      "M4 makes files safe to use",
      "A six-slide fixture for parsing, rendering and download evidence.",
    ],
    [
      "Original access and working copies are separate",
      "A revoked path grant never invalidates the controlled copy.",
    ],
    [
      "Citations stay attached to source locations",
      "Pages, sheet ranges, slides and text lines remain addressable.",
    ],
    [
      "Artifacts grow through immutable versions",
      "Approved changes append v2, v3 and beyond instead of replacing v1.",
    ],
    [
      "Cloud sync moves objects, never device grants",
      "A second device downloads account-scoped bytes and requests its own local access.",
    ],
    [
      "The M4 gate closes on reproducible evidence",
      "Ten Golden tasks and eight capability gates must pass together.",
    ],
  ];
  slides.forEach(([title, body], index) => {
    const slide = presentation.slides.add();
    slide.background.fill = index === 0 || index === 5 ? "#14372B" : "#F3F6F2";
    const dark = index === 0 || index === 5;
    addText(
      slide,
      `eyebrow-${index + 1}`,
      index === 0 ? "OPENERX 2.0 · FILE & ARTIFACT ALPHA" : `M4 EVIDENCE · ${index + 1}`,
      { left: 78, top: 66, width: 760, height: 30 },
      { fontSize: 16, bold: true, color: dark ? "#9FE0B6" : "#4E8068" },
    );
    addText(
      slide,
      `title-${index + 1}`,
      title,
      { left: 78, top: index === 0 ? 180 : 145, width: 950, height: 150 },
      { fontSize: index === 0 ? 60 : 46, bold: true, color: dark ? "#FFFFFF" : "#14372B" },
    );
    addText(
      slide,
      `body-${index + 1}`,
      body,
      { left: 82, top: index === 0 ? 370 : 350, width: 760, height: 100 },
      { fontSize: 24, color: dark ? "#DCEBE3" : "#52645B" },
    );
    const rule = slide.shapes.add({
      geometry: "rect",
      name: `rule-${index + 1}`,
      position: { left: 82, top: 318, width: index === 0 ? 180 : 120, height: 5 },
      fill: "#68C88A",
      line: { style: "solid", fill: "none", width: 0 },
    });
    void rule;
    if (index > 0 && index < 5) {
      addText(
        slide,
        `proof-${index + 1}`,
        ["SOURCE", "REFERENCE", "VERSION", "ACCOUNT"][index - 1],
        { left: 920, top: 500, width: 240, height: 48 },
        { fontSize: 24, bold: true, color: "#68A57E", alignment: "right" },
      );
    }
    addSlideNumber(slide, index + 1);
  });

  const inspected = await presentation.inspect({
    kind: "slide,textbox,shape,layout",
    maxChars: 12_000,
  });
  await fs.writeFile(path.join(renderDirectory, "pptx-inspect.ndjson"), inspected.ndjson);
  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `pptx-slide-${String(index + 1).padStart(2, "0")}`;
    await writeBlob(
      path.join(renderDirectory, `${stem}.png`),
      await presentation.export({ slide, format: "png", scale: 1 }),
    );
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(renderDirectory, `${stem}.layout.json`), await layout.text());
  }
  await writeBlob(
    path.join(renderDirectory, "pptx-montage.webp"),
    await presentation.export({ format: "webp", montage: true, scale: 1 }),
  );
  const output = await PresentationFile.exportPptx(presentation);
  const outputPath = path.join(fixtureDirectory, "file.six-slide-pptx.v1.pptx");
  await output.save(outputPath);
  await removeInspectionSidecar(outputPath);
}

await createWorkbook();
await createPresentation();
