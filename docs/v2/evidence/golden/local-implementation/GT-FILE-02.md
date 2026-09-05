# GT-FILE-02 local implementation

- Fixture: `file.docx-pair.v1.docx` plus an approved OOXML edit.
- Proof: the source checksum remains unchanged and the approved edit becomes Artifact v2 with a distinct
  checksum; neither input is silently overwritten.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-02`.
- Result: PASS for the M4 local checkpoint.
