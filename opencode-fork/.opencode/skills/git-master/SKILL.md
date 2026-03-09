---
name: git-master
description: Advanced Git operations — atomic commits, interactive rebase, conflict resolution
metadata:
  permissions:
    allowedTools: [run_lint, run_tests, git_commit_style, git_history_search]
    deniedTools: [tmux_kill_session]
    filePatterns: ["**/*"]
    maxConcurrency: 1
---

# Git Master — Advanced Git Skill

Provides structured guidance for precise Git operations: atomic commits, surgical rebases, conflict resolution, and branch management.

## Instructions

When this skill is active, follow these patterns for Git operations:

### Commit Discipline
- One logical change per commit — NEVER combine unrelated changes
- Use Conventional Commits: `type(scope): description`
  - `feat:` new feature
  - `fix:` bug fix
  - `refactor:` code restructuring (no behavior change)
  - `chore:` build/tooling/config
  - `docs:` documentation only
  - `test:` adding/fixing tests
- Subject line: imperative mood, ≤72 chars, no period
- Body: explain WHY, not WHAT (the diff shows what)

### Branch Strategy
- `main` — production-ready, protected
- `dev` — integration branch
- `feat/<ticket>-<short-desc>` — feature branches
- `fix/<ticket>-<short-desc>` — bugfix branches
- `release/<version>` — release prep

### Rebase Surgery
- Always `git stash` before rebase
- Interactive rebase: `git rebase -i HEAD~N`
  - `pick` — keep commit
  - `squash` — merge into previous
  - `fixup` — merge without message
  - `reword` — edit commit message
  - `drop` — remove commit
- NEVER rebase published commits (already pushed to shared branch)

### Conflict Resolution
1. `git status` — identify conflicting files
2. Open each file, find `<<<<<<<` markers
3. Resolve by choosing/merging content
4. `git add <resolved-file>`
5. `git rebase --continue` or `git merge --continue`
6. Run tests after resolution

### Pre-Push Checklist
- [ ] All tests pass
- [ ] Lint clean
- [ ] Commits follow conventional format
- [ ] No WIP or debug code
- [ ] Branch is rebased on latest target

### Anti-Patterns
- NEVER `git push --force` on shared branches
- NEVER commit secrets, `.env`, or credentials
- NEVER create merge commits on feature branches (rebase instead)
- NEVER amend published commits
