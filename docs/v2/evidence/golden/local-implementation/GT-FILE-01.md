# GT-FILE-01 local implementation

- Fixture: `file.cited-pdf.v1.pdf` (two real PDF pages).
- Proof: the parser returns the `09:30` launch fact with `{ kind: "page", page: 2 }` and preserves the
  controlled source bytes for reopening.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-01`.
- Result: PASS for the M4 local checkpoint; native release-app open behavior remains a platform gate.
