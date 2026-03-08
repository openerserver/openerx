---
description: "Generate a structured handoff document for task transitions between agents or humans"
---

# /handoff — Task Handoff Generator

## Trigger
User types `/handoff` or the system generates a handoff at task completion.

## Behavior

### Step 1 — Gather Task State
1. Query active task graph via `task_graph_list`
2. For each completed/in-progress node, collect:
   - Status and completion percentage
   - Files modified (from git diff)
   - Test results
   - Outstanding issues

### Step 2 — Generate Handoff Document
Produce a structured document with these sections:

```markdown
## Handoff Report

### Task Summary
- **Task**: [description]
- **Status**: [completed | partially_complete | blocked]
- **Started**: [timestamp]
- **Handed off**: [timestamp]

### What Was Done
- [Numbered list of completed items with evidence]

### What Remains
- [Numbered list of pending items]

### Key Decisions Made
- [Decision + rationale for each non-obvious choice]

### Files Changed
- [File path]: [summary of changes]

### Test Status
- [pass/fail count, coverage delta]

### Risks & Blockers
- [Any known issues or risks for the next developer]

### How to Continue
- [Step-by-step instructions for picking up the work]
```

### Step 3 — Quality Checks
1. Verify all mentioned files exist
2. Verify test results are current
3. Verify no uncommitted changes are orphaned

### Step 4 — Delivery
1. Output the handoff report to the chat
2. Optionally save to `.opencode/state/handoffs/[task-id].md`

## Tools Used
- `task_graph_list`, `task_graph_query`
- `git_history_search`
- `run_tests`
- `check_pr_readiness`

## Example
```
User: /handoff
→ Generates handoff for the current active task
```
