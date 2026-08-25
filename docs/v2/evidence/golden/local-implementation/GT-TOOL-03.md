# GT-TOOL-03 local implementation

- Fixture: `tool.desktop-confirm.v1`.
- Proof: capture and interaction use the Main capability host; submit, send, purchase and delete are L5 and force an exact-payload, per-call confirmation.
- Automated gate: policy, App Service projection and Desktop capability-host tests plus `tests/v2/golden/tools-m5.test.ts`.
- Result: PASS for the M5 local checkpoint policy slice; the native desktop-app matrix remains a release gate.
