---
description: "Orchestrated multi-file refactoring with LSP safety, hashline verification, and full test coverage"
---

# /refactor — Safe Multi-File Refactoring

## Trigger
User types `/refactor <description>` in the chat.

## Behavior

### Phase 1 — Scope Analysis
1. Call `classify_intent` — expected: `refactor` category
2. Use **librarian-enterprise** to identify affected files:
   - `code_map` for structural dependencies
   - `lsp_references` for all symbol usages
3. Build an impact map: which files and symbols are affected

### Phase 2 — Refactoring Plan
1. Dispatch to **prometheus-enterprise** for planning
2. Plan must specify:
   - Exact transformations per file (rename, extract, move, inline)
   - Order of operations (dependency-aware)
   - Verification criteria per step
3. Run through **metis** + **momus** validation

### Phase 3 — Safe Execution
For each transformation step:

1. **Pre-flight**: Read target files with `hashline_read` (get content hashes)
2. **LSP-First Strategy**:
   - Renames → use `lsp_rename` (atomic cross-file rename)
   - Move → create new location, update imports, remove old
   - Extract → identify extraction boundary, create new unit, update callers
3. **Hashline-Verified Writes**: Use `hashline_edit` for all modifications
4. **Test After Each Step**: Run `run_tests` — rollback if tests fail
5. **Lint After Each Step**: Run `run_lint --fix` to maintain style

### Phase 4 — Verification
1. Full test suite pass
2. No new lint errors
3. No dead code introduced (check imports/exports)
4. Type check passes
5. `check_pr_readiness` for final gate

### Tool Priority (Higher = Preferred)
1. `lsp_rename` — for symbol renames (safest)
2. `ast_batch_replace` — for structural pattern changes
3. `hashline_edit` — for targeted line edits with verification
4. `edit_file` — last resort (no verification)

### Rollback Strategy
- Git stash before starting
- If any step fails verification → `git stash pop` to restore
- Never leave partial refactoring committed

## Tools Used
- `classify_intent`
- `code_map`, `lsp_references`, `lsp_rename`
- `ast_batch_replace`, `hashline_read`, `hashline_edit`
- `task_graph_create`, `task_graph_update_node`
- `run_tests`, `run_lint`, `check_pr_readiness`
- `create_sub_session`, `dispatch_to_agent`

## Example
```
User: /refactor Extract the validation logic from UserController into a dedicated ValidationService
```
