# GT-FILE-09 local implementation

- Fixture: `file.html-preview.v1.html`, which probes desktop bridge and Node visibility.
- Proof: source and rendered modes are separate; the iframe has `sandbox="allow-scripts"` and no
  `allow-same-origin`, Node integration or Preload Bridge.
- Automated gate: M4 Golden test plus `apps/desktop/tests/chat-ui.test.tsx`.
- Result: PASS for the M4 local checkpoint.
