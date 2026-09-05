# Personal Projects — public desktop validation

Projects organize conversations, instructions and optional directories. Creating, archiving or restoring a project does not delete user files. Each device reconnects its own directory paths and grants; ordinary conversations do not inherit project permissions.

Public regression coverage and reproducible commands are recorded in [testing](../../TESTING.md). Native release validation remains pending until signed Windows/macOS packages demonstrate directory selection, read/write scope, disconnection/reconnection, crash recovery and upgrade preservation.

Keep Project, ProjectDirectory, Conversation.projectId and device Binding/Grant associations across upgrades. Stop rollout for unintended permission inheritance, path disclosure or data loss. Update `personal-projects-gate-status.json` only with actual evidence and approval. Enterprise controller and cross-device deployment acceptance are recorded separately in the private repository.
