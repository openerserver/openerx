# GT-TOOL-09 local implementation

- Fixture: `tool.skill-cross-device.v1` using two device repositories and the account sync outbox/pull boundary.
- Proof: only installation metadata and non-sensitive settings cross devices; absolute package paths and approval digests do not. The receiving device restores the record as `missing`, disabled and unapproved until its local dependency is installed and approved.
- Automated gate: `packages/storage/tests/skill-repository.test.ts` and strict sync payload schemas.
- Result: PASS for the M7 local checkpoint; native Windows/macOS two-device restoration remains a release-environment gate.
