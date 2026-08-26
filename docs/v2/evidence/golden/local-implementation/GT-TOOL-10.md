# GT-TOOL-10 local implementation

- Fixture: `tool.long-task-crash.v1`, M5 non-Skill slice.
- Proof: WorkItem/Run/Step/ToolCall progress is durable, App Service recovery terminates interrupted runs and temporary grants, cancellation stops children, and normal chat remains independent.
- Automated gate: Tool Repository recovery, App Service tool projection, Shell stop and Electron chat-crash E2E tests.
- Result: PASS across the M5 local checkpoint non-Skill slice and the M7 Skill damage/failure-isolation slice; native release fault matrices remain.
