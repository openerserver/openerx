import { desktopBrand } from "../../branding/src/index";

// Bundled Skill contents include brand-specific metadata. Keep the release version
// distinct per brand so open-source and enterprise builds can safely use an
// existing profile without violating immutable Skill version checks.
const builtInSkillVersion = `1.0.2-${desktopBrand.id}`;

export const builtInStructuredReportSkill = {
  installationId: "00000000-0000-4000-8000-000000000701",
  files: {
    "SKILL.md": `---
name: structured-report
description: Create a concise structured report with an executive summary, findings, evidence, and next actions.
---

# Structured report

Use this skill when the user asks for a structured decision report.

1. Read \`references/template.md\` for the required section order.
2. Use \`openerx_skill_script\` with \`scripts/render.mjs\` only when a deterministic heading outline is useful.
3. Use normal ${desktopBrand.productName} file and artifact tools for user data and final deliverables.
`,
    "agents/openai.yaml": `version: ${builtInSkillVersion}
display_name: Structured report
publisher: ${desktopBrand.publisher}
tools:
  - openerx_structured_data
  - openerx_skill_script
permissions:
  - capability: shell
    actions: [execute]
    targets: [scripts/render.mjs]
    reason: Run the bundled deterministic report outline script.
platforms: [darwin, win32]
scripts:
  - scripts/render.mjs
`,
    "references/template.md": `# Required sections

1. Executive summary
2. Findings and evidence
3. Risks and unknowns
4. Recommended next actions
`,
    "scripts/render.mjs": `const title = process.argv[2] ?? "Report";
process.stdout.write(JSON.stringify({ title, sections: ["Executive summary", "Findings and evidence", "Risks and unknowns", "Recommended next actions"] }));
`,
  },
} as const;

function officeManifest(displayName: string): string {
  return `version: ${builtInSkillVersion}
display_name: ${displayName}
publisher: ${desktopBrand.publisher}
tools:
  - openerx_office_artifact
permissions: []
platforms: [darwin, win32]
scripts: []
`;
}

export const builtInDocumentSkill = {
  installationId: "00000000-0000-4000-8000-000000000702",
  files: {
    "SKILL.md": `---
name: documents
description: Create or edit a polished DOCX document as a real versioned binary with page-by-page visual review.
---

# Documents

Use \`openerx_office_artifact\` with \`format: docx\`.

1. Structure the requested deliverable into deliberately bounded pages.
2. For edits, pass the existing Artifact id and a complete replacement specification; this appends an immutable version.
3. Inspect every returned page image. If any page is crowded, clipped, or visually unbalanced, shorten or split it and create another version.
4. Report the Artifact id, version, filename, and number of pages only after visual review.
`,
    "agents/openai.yaml": officeManifest("Documents"),
  },
} as const;

export const builtInSpreadsheetSkill = {
  installationId: "00000000-0000-4000-8000-000000000703",
  files: {
    "SKILL.md": `---
name: spreadsheets
description: Create or edit a real XLSX workbook with formulas, immutable versions, and visual review of every worksheet.
---

# Spreadsheets

Use \`openerx_office_artifact\` with \`format: xlsx\`.

1. Give every worksheet a unique, meaningful name and use a header row unless the data has no header.
2. Formula cells must include both \`formula\` and the expected cached \`value\` so the preview and unopened workbook remain auditable.
3. For edits, pass the existing Artifact id and a complete workbook specification.
4. Inspect every returned worksheet image and correct truncation, accidental empty rows, or unclear headings before reporting completion.
`,
    "agents/openai.yaml": officeManifest("Spreadsheets"),
  },
} as const;

export const builtInPresentationSkill = {
  installationId: "00000000-0000-4000-8000-000000000704",
  files: {
    "SKILL.md": `---
name: presentations
description: Create or edit a real PPTX presentation with slide-by-slide visual review and immutable versions.
---

# Presentations

Use \`openerx_office_artifact\` with \`format: pptx\`.

1. Keep one argument per slide and prefer concise titles with a short body or bullets.
2. For edits, pass the existing Artifact id and the full revised slide deck.
3. Inspect every returned slide image in sequence. Split crowded slides and fix hierarchy before reporting completion.
4. Report the Artifact id, version, filename, and slide count after visual review.
`,
    "agents/openai.yaml": officeManifest("Presentations"),
  },
} as const;

export const builtInPdfSkill = {
  installationId: "00000000-0000-4000-8000-000000000705",
  files: {
    "SKILL.md": `---
name: pdf
description: Create or edit a real PDF deliverable with immutable versions and page-by-page visual review.
---

# PDF

Use \`openerx_office_artifact\` with \`format: pdf\`.

1. Structure content into bounded pages and keep footers short.
2. For edits, pass the existing Artifact id and a complete replacement specification.
3. Inspect every returned page image and retry if content is clipped, crowded, or incorrectly split.
4. Report the Artifact id, version, filename, and page count only after visual review.
`,
    "agents/openai.yaml": officeManifest("PDF"),
  },
} as const;

export const builtInSkills = [
  builtInStructuredReportSkill,
  builtInDocumentSkill,
  builtInSpreadsheetSkill,
  builtInPresentationSkill,
  builtInPdfSkill,
] as const;
