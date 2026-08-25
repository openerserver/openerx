# GT-FILE-05 local implementation

- Inputs: unsupported, corrupt, encrypted and oversized cases.
- Proof: failures map to typed `FILE_*` codes; no raw parser exception becomes a desktop capability, and
  the independent plain-text conversation path remains usable.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-05`; File Service parser tests.
- Result: PASS for the M4 local checkpoint.
