import type { SkillInstallation } from "@openerx/contracts";

const builtInSummaries: Record<string, { name: string; description: string }> = {
  documents: { name: "文档", description: "创建、编辑 DOCX 文档，并预览版式。" },
  pdf: { name: "PDF", description: "创建、编辑 PDF 文件，并预览页面。" },
  presentations: { name: "演示文稿", description: "创建、编辑 PPTX 演示文稿，并预览幻灯片。" },
  spreadsheets: { name: "电子表格", description: "创建、编辑 XLSX 表格，核对数据与公式。" },
  "structured-report": { name: "结构化报告", description: "整理摘要、发现、证据和下一步行动。" },
};

export function skillSummary(
  skill: Pick<SkillInstallation, "name" | "scope" | "displayName" | "description">,
): { name: string; description: string } {
  return (
    (skill.scope === "builtin" && Object.hasOwn(builtInSummaries, skill.name)
      ? builtInSummaries[skill.name]
      : undefined) ?? {
      name: skill.displayName,
      description: skill.description,
    }
  );
}
