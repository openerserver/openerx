# GT-FILE-04 local implementation

- Fixture: `file.ocr-image.v1.png`, with an intentionally uncertain final character.
- Proof: OCR output is grounded to an image-region locator and exposes confidence `0.61` instead of
  presenting uncertainty as a verified fact.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-04`.
- Result: PASS for the deterministic M4 OCR adapter; broad production OCR quality remains a release gate.
