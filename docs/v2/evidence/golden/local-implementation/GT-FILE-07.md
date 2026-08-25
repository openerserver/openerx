# GT-FILE-07 local implementation

- Fixture: generated two-sheet XLSX with line-total, anomaly, total and count formulas.
- Proof: formulas contain no OOXML error cells; both Data and Summary sheets render with reviewed widths,
  numeric formats and hierarchy.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-07` plus spreadsheet render QA.
- Result: PASS for the M4 local checkpoint.
