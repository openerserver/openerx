# GT-FILE-06 local implementation

- Fixtures: styled two-page DOCX and two-page A4 PDF generated from versioned scripts.
- Proof: both files parse and open; DOCX and PDF render pages were visually inspected without clipping,
  and the fixed verification text remains present.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-06` plus render QA.
- Result: PASS for the M4 local checkpoint.
