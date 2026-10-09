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
3. Use normal openerx file and artifact tools for user data and final deliverables.
`,
    "agents/openai.yaml": `version: 1.0.2
display_name: Structured report
publisher: openerx
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

const officeReviewGuidance = `
Review the returned parsed text against the requested content and check page, sheet, or slide counts and structure. For spreadsheets, independently check totals and formula logic; cached values alone do not prove recalculation.

If the tool supplies images that the selected model can receive, inspect every supplied image and correct clipping, crowding, or unclear hierarchy by creating another version. If the model accepts only text or no images are supplied, use parsed text and structural checks and explicitly report that visual review was not performed. The user can inspect the rendered previews in the app. Never claim that preview images were inspected without receiving and inspecting them.

For image-only or scanned source material with no extracted text, request a searchable document or a text transcription. Do not infer image content or claim OCR was performed.
`;

function officeManifest(displayName: string): string {
  return `version: 1.0.3
display_name: ${displayName}
publisher: openerx
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
description: Create or edit a real versioned DOCX document with text and structure checks and rendered previews.
---

# Documents

Use \`openerx_office_artifact\` with \`format: docx\`.

1. Structure the requested deliverable into deliberately bounded pages.
2. For edits, pass the existing Artifact id and a complete replacement specification; this appends an immutable version.
3. Check the generated text, page structure, and completeness using the review guidance below.
4. Report the Artifact id, version, filename, page count, and checks performed.

${officeReviewGuidance}
`,
    "agents/openai.yaml": officeManifest("Documents"),
  },
} as const;

export const builtInSpreadsheetSkill = {
  installationId: "00000000-0000-4000-8000-000000000703",
  files: {
    "SKILL.md": `---
name: spreadsheets
description: Create or edit a real XLSX workbook with formulas, immutable versions, data checks, and rendered previews.
---

# Spreadsheets

Use \`openerx_office_artifact\` with \`format: xlsx\`.

1. Give every worksheet a unique, meaningful name and use a header row unless the data has no header.
2. Formula cells must include both \`formula\` and the expected cached \`value\` so the preview and unopened workbook remain auditable.
3. For edits, pass the existing Artifact id and a complete workbook specification.
4. Check worksheet names, headers, row counts, values, and formula logic using the review guidance below. Report the Artifact id, version, filename, sheet count, and checks performed.

${officeReviewGuidance}
`,
    "agents/openai.yaml": officeManifest("Spreadsheets"),
  },
} as const;

export const builtInPresentationSkill = {
  installationId: "00000000-0000-4000-8000-000000000704",
  files: {
    "SKILL.md": `---
name: presentations
description: Create or edit a real PPTX presentation with immutable versions, text and slide structure checks, and rendered previews.
---

# Presentations

Use \`openerx_office_artifact\` with \`format: pptx\`.

1. Keep one argument per slide and prefer concise titles with a short body or bullets.
2. For edits, pass the existing Artifact id and the full revised slide deck.
3. Check the generated text, slide sequence, and completeness using the review guidance below.
4. Report the Artifact id, version, filename, slide count, and checks performed.

${officeReviewGuidance}
`,
    "agents/openai.yaml": officeManifest("Presentations"),
  },
} as const;

export const builtInPdfSkill = {
  installationId: "00000000-0000-4000-8000-000000000705",
  files: {
    "SKILL.md": `---
name: pdf
description: Create or edit a real PDF deliverable with immutable versions, text and page structure checks, and rendered previews.
---

# PDF

Use \`openerx_office_artifact\` with \`format: pdf\`.

1. Structure content into bounded pages and keep footers short.
2. For edits, pass the existing Artifact id and a complete replacement specification.
3. Check the generated text, page structure, and completeness using the review guidance below.
4. Report the Artifact id, version, filename, page count, and checks performed.

${officeReviewGuidance}
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
