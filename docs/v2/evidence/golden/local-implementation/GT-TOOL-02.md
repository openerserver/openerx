# GT-TOOL-02 local implementation

- Fixture: `tool.isolated-browser.v1` plus the local HTTP page in `apps/desktop/scripts/e2e-tools.mjs`.
- Proof: a separate Electron partition opens, types, captures, uploads, downloads and closes; the main Renderer and daily browser profile receive no session authority.
- Automated gate: `npm run test:e2e:v2` → `E2E_TOOLS_OK`.
- Result: PASS for the M5 local checkpoint on macOS; native Windows evidence remains a release gate.
