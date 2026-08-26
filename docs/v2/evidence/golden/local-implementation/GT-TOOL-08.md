# GT-TOOL-08 local implementation

- Fixture: `tool.skill-lifecycle.v1` covering automatic metadata matching, immutable version update, expanded permission digest, approval reset, rollback, disable and recoverable uninstall.
- Proof: Pi receives only enabled auto-invocation metadata until it reads `SKILL.md`; update-added permissions disable execution until reapproved; damaged packages are isolated and a lower-scope package can continue.
- Automated gate: `packages/skills/tests/package-service.test.ts`, Pi native loading tests, App Service isolation test and Electron explicit/automatic flow.
- Result: PASS for the M7 local checkpoint; arbitrary third-party runtime compatibility and signed publisher verification remain release-environment gates.
