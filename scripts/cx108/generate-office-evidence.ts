import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OfficeArtifactSpec } from "@openerx/contracts";
import { compileOfficeArtifact, MultiFormatParser } from "@openerx/file-service";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const outputDirectory = process.env.OPENERX_CX108_OUTPUT
  ? path.resolve(process.env.OPENERX_CX108_OUTPUT)
  : path.join(repositoryRoot, "tmp/cx108-office-workflow");
mkdirSync(outputDirectory, { recursive: true });

const specs: OfficeArtifactSpec[] = [
  {
    format: "docx",
    title: "OpenERX CX-108 决策报告",
    pages: [
      {
        heading: "执行摘要",
        paragraphs: ["该成果由受控 Office 工具从结构化 Agent 请求生成。"],
        bullets: ["真实 DOCX 二进制", "不可变 ArtifactVersion", "逐页视觉检查"],
      },
      {
        heading: "验收结论",
        paragraphs: ["每一页均有与成果绑定的视觉审阅画布。"],
        bullets: ["解析成功", "页数一致", "可由原生 Office 引擎打开"],
        footer: "CX-108 local evidence",
      },
    ],
    theme: { accentColor: "#2563EB", backgroundColor: "#FFFFFF" },
  },
  {
    format: "xlsx",
    title: "OpenERX CX-108 验收工作簿",
    sheets: [
      {
        name: "能力明细",
        rows: [
          ["格式", "状态", "画布数"],
          ["DOCX", "PASS", 2],
          ["XLSX", "PASS", 2],
          ["PPTX", "PASS", 2],
          ["PDF", "PASS", 2],
        ],
        headerRows: 1,
      },
      {
        name: "汇总",
        rows: [
          ["指标", "结果"],
          ["通过格式", { formula: '=COUNTIF(能力明细!B2:B5,"PASS")', value: 4 }],
          ["总画布", { formula: "=SUM(能力明细!C2:C5)", value: 8 }],
        ],
        headerRows: 1,
      },
    ],
    theme: { accentColor: "#0F766E", backgroundColor: "#FFFFFF" },
  },
  {
    format: "pptx",
    title: "OpenERX CX-108 生产链",
    slides: [
      {
        title: "从 Agent Turn 到真实成果",
        subtitle: "自然语言请求 → Skill → 类型化工具 → ArtifactVersion",
        bullets: [],
      },
      {
        title: "视觉检查是完成条件",
        body: "每页、每张工作表和每页幻灯片都返回独立审阅画布。",
        bullets: ["溢出会被拒绝", "修改追加新版本", "客户端逐画布展示"],
      },
    ],
    theme: { accentColor: "#7C3AED", backgroundColor: "#FFFFFF" },
  },
  {
    format: "pdf",
    title: "OpenERX CX-108 验收记录",
    pages: [
      {
        heading: "验收范围",
        paragraphs: ["PDF 由同一受控 Office 生产链生成。"],
        bullets: ["真实 PDF 1.7", "逐页预览", "稳定版本"],
      },
      {
        heading: "结果",
        paragraphs: ["解析器能够重新打开生成的文件并识别两页内容。"],
        bullets: ["页面 1 已检查", "页面 2 已检查"],
        footer: "CX-108 local evidence",
      },
    ],
    theme: { accentColor: "#B45309", backgroundColor: "#FFFFFF" },
  },
];

const parser = new MultiFormatParser();
const manifest: Array<{
  format: string;
  file: string;
  sizeBytes: number;
  checksumSha256: string;
  parsedCharacters: number;
  citations: number;
  surfaces: Array<{
    kind: string;
    index: number;
    label: string;
    file: string;
    modelFile: string;
  }>;
}> = [];

for (const spec of specs) {
  const compiled = compileOfficeArtifact(spec);
  const fileName = `agent-output.${compiled.format}`;
  const filePath = path.join(outputDirectory, fileName);
  writeFileSync(filePath, compiled.bytes);
  const parsed = await parser.parse(filePath, compiled.format);
  const surfaces = compiled.renderedSurfaces.map((surface) => {
    const surfaceFile = `${compiled.format}-${surface.kind}-${String(surface.index).padStart(2, "0")}.svg`;
    const encoded = surface.imageDataUrl.split(",", 2)[1];
    const modelEncoded = surface.modelImageDataUrl.split(",", 2)[1];
    if (!encoded || !modelEncoded) throw new Error("OFFICE_SURFACE_DATA_MISSING");
    writeFileSync(path.join(outputDirectory, surfaceFile), Buffer.from(encoded, "base64"));
    const modelFile = `${compiled.format}-${surface.kind}-${String(surface.index).padStart(2, "0")}.model.png`;
    writeFileSync(path.join(outputDirectory, modelFile), Buffer.from(modelEncoded, "base64"));
    return {
      kind: surface.kind,
      index: surface.index,
      label: surface.label,
      file: surfaceFile,
      modelFile,
    };
  });
  manifest.push({
    format: compiled.format,
    file: fileName,
    sizeBytes: compiled.bytes.byteLength,
    checksumSha256: createHash("sha256").update(compiled.bytes).digest("hex"),
    parsedCharacters: parsed.text.length,
    citations: parsed.citations.length,
    surfaces,
  });
}

writeFileSync(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), artifacts: manifest }, null, 2)}\n`,
);
process.stdout.write(`${outputDirectory}\n`);
