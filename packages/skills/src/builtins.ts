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
3. Use normal OpenerX file and artifact tools for user data and final deliverables.
`,
    "agents/openai.yaml": `version: 1.0.0
display_name: Structured report
publisher: OpenerX
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
