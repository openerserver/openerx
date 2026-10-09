import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { compileOfficeArtifact, MultiFormatParser } from "../src";

test("ordinary CSV parsing remains available beyond the retired enterprise snapshot limit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openerx-common-table-"));
  try {
    const file = path.join(directory, "rows.csv");
    await writeFile(
      file,
      ["item,amount", ...Array.from({ length: 250 }, (_, n) => `item-${n},${n}`)].join("\n"),
    );
    const result = await new MultiFormatParser().parse(file, "csv");
    expect(result.text).toContain("item-249,249");
    expect(result.citations.length).toBeGreaterThan(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Office generation and ordinary Excel parsing preserve worksheets and literal text", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openerx-common-office-"));
  try {
    const artifact = compileOfficeArtifact(
      {
        format: "xlsx",
        title: "普通表格",
        theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
        sheets: [
          {
            name: "销售",
            headerRows: 1,
            rows: [
              ["项目", "金额"],
              ["=SUM(B2:B3)", "0.10"],
            ],
          },
          {
            name: "备注",
            headerRows: 1,
            rows: [["说明"], ["普通 Office 内容"]],
          },
        ],
      },
      { includeModelImages: false },
    );
    const file = path.join(directory, "ordinary.xlsx");
    await writeFile(file, artifact.bytes);
    const parsed = await new MultiFormatParser().parse(file, "xlsx");
    expect(parsed.text).toContain("=SUM(B2:B3)");
    expect(parsed.text).toContain("0.10");
    expect(parsed.text).toContain("普通 Office 内容");
    expect(parsed.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: expect.objectContaining({ sheet: "销售" }),
        }),
        expect.objectContaining({
          locator: expect.objectContaining({ sheet: "备注" }),
        }),
      ]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
