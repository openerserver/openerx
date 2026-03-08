---
description: "Start a new work task with full orchestration pipeline: planning → audit → validation → execution"
---

# /start-work — Enterprise Task Kickoff

## Trigger
User types `/start-work <description>` in the chat.

## Behavior

### Phase 1 — Intent Classification
1. Call `classify_intent` with the user's description
2. Determine the `TaskCategory` (implement_feature, fix_bug, refactor, explore, ops_task)

### Phase 2 — Planning (Prometheus)
1. Create a sub-session for **prometheus-enterprise** agent
2. Inject the user's task description + relevant context (via `context_get_rules`)
3. Wait for Prometheus to return a structured plan with:
   - Goal, assumptions, numbered steps with DoD, risks, out-of-scope items

### Phase 3 — Pre-Plan Audit (Metis)
1. Create a sub-session for **metis-enterprise** agent
2. Feed the Prometheus plan for gap analysis
3. If Metis finds issues → send back to Prometheus for revision
4. Loop until Metis verdict = `proceed` (max 2 revisions)

### Phase 4 — Plan Validation (Momus)
1. Create a sub-session for **momus-enterprise** agent
2. Momus scores: clarity, completeness, verifiability, feasibility (1-5 each)
3. All scores must be ≥ 3 to proceed
4. If any score < 3 → revise and re-score (max 2 attempts)

### Phase 5 — Task Graph Creation
1. Call `task_graph_create` with plan steps as nodes
2. Set up dependency edges between steps
3. Each node gets clear DoD from the plan

### Phase 6 — Execution Dispatch
1. Dispatch to **hephaestus-enterprise** for code tasks
2. Dispatch to **oracle-enterprise** for analysis tasks
3. Track progress via task graph updates
4. Run quality checks after each substep

### Phase 7 — Completion
1. Run `check_pr_readiness` for final quality gate
2. Generate a `/handoff` summary
3. Mark all task graph nodes as completed

## Tools Used
- `classify_intent`, `select_model`
- `create_sub_session`, `dispatch_to_agent`
- `context_get_rules`, `context_for_agent`
- `task_graph_create`, `task_graph_update_node`
- `check_pr_readiness`

## Example
```
User: /start-work Add JWT token refresh endpoint to the auth service
```
