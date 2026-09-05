# GT-FILE-03 local implementation

- Fixtures: `file.generated-xlsx.v1.xlsx` and `file.xlsx-csv-merge.v1.csv`.
- Proof: Data/Summary sheets, formulas, CSV field mapping, totals and the exact anomaly set are checked
  against real OOXML and parser output.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-03`.
- Result: PASS for the M4 local checkpoint.
