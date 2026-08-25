# GT-FILE-10 local implementation

- Inputs: an authorized folder, an outside file, a controlled artifact and two account device replicas.
- Proof: lexical/symlink escape is rejected, the source is unchanged, PDF Attachment and both Artifact
  versions restore on device two, and the restored PersonalFile has no source Grant.
- Sync proof: cloud payload contains no source scope, local object reference or original fixture path.
- Automated gate: `tests/v2/golden/files-m4.test.ts` → `GT-FILE-10` and `FILE-08`.
- Result: PASS for the M4 local checkpoint; native cross-platform release evidence remains.
