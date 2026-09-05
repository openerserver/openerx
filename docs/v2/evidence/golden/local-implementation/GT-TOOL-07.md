# GT-TOOL-07 local implementation

- Fixture: `tool.skill-explicit.v1` using a local directory package with `SKILL.md`, manifest, reference and deterministic script.
- Proof: the Skill page shows source, version, publisher, checksum, tools, permissions and platforms; the composer selects the installed package; Pi expands `/skill:e2e-report`, reads the reference progressively and requests the script through the V2 Capability Broker.
- Automated gate: Skill package/Pi/App Service tests plus Electron `E2E_SKILLS_OK` install-to-audit flow.
- Result: PASS for the M7 local checkpoint; signed catalog distribution and cross-platform release packages remain release-environment gates.
