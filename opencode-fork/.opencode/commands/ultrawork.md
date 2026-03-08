---
description: "Ultra-deep work mode: lock in on a complex task with full Ralph Loop, extended context, and no interruptions"
---

# /ultrawork — Deep Focus Execution Mode

## Trigger
User types `/ultrawork <description>` in the chat.

## Behavior

### Setup
1. Call `classify_intent` — must be `implement_feature` or `refactor`
2. Set primary model chain (Anthropic Claude → OpenAI GPT-4.1 fallback)
3. Activate Ralph Loop with max rounds = 20

### Planning
1. Start with **prometheus-enterprise** planning as in `/start-work`
2. **Metis** and **Momus** validation required before execution
3. Plan must be granular: each step ≤ 30 minutes of work

### Execution — Ralph Loop
For each task graph node:
1. **Ralph Loop Start**: Call `ralph_loop_start` with node details
2. **Iterate**:
   - Dispatch to **hephaestus-enterprise** for execution
   - Run tests after each change (`run_tests`)
   - Run lint (`run_lint`)
   - If tests/lint fail → auto-fix iteration
   - Call `ralph_loop_advance` with progress assessment
   - Continue until node DoD is met or stall detected
3. **Stall Detection**: If 3 rounds with no progress:
   - Pause and request human guidance
   - Or dispatch to **oracle-enterprise** for analysis
4. **Node Completion**: Mark node completed, advance to next

### Context Management
- Use `hashline_read` for all file reads (content-verified)
- Use `context_for_agent` to inject relevant rules per agent
- Prune context every 5 rounds to stay within token limits

### Completion
1. Full quality gate: `check_pr_readiness`
2. Generate comprehensive handoff document
3. Report: total rounds, files changed, tests run, time per node

## Tools Used
- All orchestration tools
- `ralph_loop_start`, `ralph_loop_advance`
- `hashline_read`, `hashline_edit`
- `run_tests`, `run_lint`, `check_pr_readiness`
- `task_graph_create`, `task_graph_update_node`

## Example
```
User: /ultrawork Refactor the authentication module to support multi-tenancy with org-level permissions
```
