# GT-TOOL-04 local implementation

- Fixture: `tool.shell-long-process.v1`.
- Proof: argv-only execution is confined to canonical approved roots, denies network by default, caps output, reports exit state and reclaims process groups after stop or host shutdown.
- Automated gate: `packages/tool-sdk/tests/shell-adapter.test.ts`.
- Result: PASS for the M5 local checkpoint; native Windows sandbox behavior remains a release gate.
