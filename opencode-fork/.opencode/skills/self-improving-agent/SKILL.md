---
name: self-improving-agent
description: Captures learnings, errors, and corrections to enable continuous improvement
source: https://clawhub.ai/pskoett/self-improving-agent
downloads: 218k
stars: 2k
license: MIT-0
security: VirusTotal Benign, OpenClaw Benign (HIGH CONFIDENCE)
version: v3.0.2
---

# Self-Improvement Skill

Log learnings and errors to markdown files for continuous improvement. Coding
agents can later process these into fixes, and important learnings get promoted to
project memory.

## Quick Reference

| Trigger | Action |
|---------|--------|
| Command/operation fails | Log to .learnings/ERRORS.md |
| User corrects you | Log to .learnings/LEARNINGS.md with category correction |
| User wants missing feature | Log to .learnings/FEATURE_REQUESTS.md |
| API/external tool fails | Log to .learnings/ERRORS.md with integration details |
| Knowledge was outdated | Log to .learnings/LEARNINGS.md with category knowledge_gap |
| Found better approach | Log to .learnings/LEARNINGS.md with category best_practice |
| Simplify/Harden recurring patterns | Log/update .learnings/LEARNINGS.md with Source: simplify-and-harden and a stable Pattern-Key |
| Similar to existing entry | Link with **See Also**, consider priority bump |
| Broadly applicable learning | Promote to CLAUDE.md, AGENTS.md, and/or .github/copilot-instructions.md |
| Workflow improvements | Promote to AGENTS.md |
| Tool gotchas | Promote to TOOLS.md |
| Behavioral patterns | Promote to SOUL.md |

## Setup

```bash
# Create learning files
mkdir -p .learnings
```

Then create the log files:
- `LEARNINGS.md` — corrections, knowledge gaps, best practices
- `ERRORS.md` — command failures, exceptions
- `FEATURE_REQUESTS.md` — user-requested capabilities

## Workspace Structure

```
.learnings/
├── LEARNINGS.md
├── ERRORS.md
└── FEATURE_REQUESTS.md
```

## Logging Format

### Learning Entry

Append to `.learnings/LEARNINGS.md`:

```
## [LRN-YYYYMMDD-XXX] category

**Logged**: ISO-8601 timestamp
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Summary
One-line description of what was learned

### Details
Full context: what happened, what was wrong, what's correct

### Suggested Action
Specific fix or improvement to make

### Metadata
- Source: conversation | error | user_feedback
- Related Files: path/to/file.ext
- Tags: tag1, tag2
- See Also: LRN-20250110-001 (if related to existing entry)
- Pattern-Key: simplify.dead_code | harden.input_validation (optional)
- Recurrence-Count: 1 (optional)
- First-Seen: 2025-01-15 (optional)
- Last-Seen: 2025-01-15 (optional)

---
```

### Error Entry

Append to `.learnings/ERRORS.md`:

```
## [ERR-YYYYMMDD-XXX] skill_or_command_name

**Logged**: ISO-8601 timestamp
**Priority**: high
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Summary
Brief description of what failed

### Error
Actual error message or output

### Context
- Command/operation attempted
- Input or parameters used
- Environment details if relevant

### Suggested Fix
If identifiable, what might resolve this

### Metadata
- Reproducible: yes | no | unknown
- Related Files: path/to/file.ext
- See Also: ERR-20250110-001 (if recurring)

---
```

### Feature Request Entry

Append to `.learnings/FEATURE_REQUESTS.md`:

```
## [FEAT-YYYYMMDD-XXX] capability_name

**Logged**: ISO-8601 timestamp
**Priority**: medium
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Requested Capability
What the user wanted to do

### User Context
Why they needed it, what problem they're solving

### Complexity Estimate
simple | medium | complex

### Suggested Implementation
How this could be built, what it might extend

### Metadata
- Frequency: first_time | recurring
- Related Features: existing_feature_name

---
```

## ID Generation

Format: `TYPE-YYYYMMDD-XXX`

- TYPE: `LRN` (learning), `ERR` (error), `FEAT` (feature)
- YYYYMMDD: Current date
- XXX: Sequential number or random 3 chars (e.g., `001`, `A7B`)

## Resolving Entries

When an issue is fixed, update the entry:

- Change `**Status**: pending` → `**Status**: resolved`
- Add resolution block after Metadata:

```
### Resolution
- **Resolved**: 2025-01-16T09:00:00Z
- **Commit/PR**: abc123 or #42
- **Notes**: Brief description of what was done
```

Other status values:
- `in_progress` - Actively being worked on
- `wont_fix` - Decided not to address
- `promoted` - Elevated to CLAUDE.md, AGENTS.md, or .github/copilot-instructions.md

## Promoting to Project Memory

### When to Promote

- Learning applies across multiple files/features
- Knowledge any contributor (human or AI) should know
- Prevents recurring mistakes
- Documents project-specific conventions

### Promotion Targets

| Target | Content | Example |
|--------|---------|---------|
| CLAUDE.md | Project facts, conventions, gotchas | Build commands, package manager |
| AGENTS.md | Agent-specific workflows, tool usage patterns | After API Changes workflow |
| .github/copilot-instructions.md | Project context for GitHub Copilot | Conventions, gotchas |

### How to Promote

1. Distill the learning into a concise rule or fact
2. Add to appropriate section in target file (create file if needed)
3. Update original entry: Change status to `promoted`

## Recurring Pattern Detection

If logging something similar to an existing entry:

1. Search first: `grep -r "keyword" .learnings/`
2. Link entries: Add `**See Also**: ERR-20250110-001` in Metadata
3. Bump priority if issue keeps recurring
4. Consider systemic fix: Recurring issues often indicate:
   - Missing documentation (→ promote to CLAUDE.md)
   - Missing automation (→ add to AGENTS.md)
   - Architectural problem (→ create tech debt ticket)

## Simplify & Harden Feed

### Promotion Rule (System Prompt Feedback)

Promote recurring patterns into agent context/system prompt files when all are true:

- `Recurrence-Count >= 3`
- Seen across at least 2 distinct tasks
- Occurred within a 30-day window

Write promoted rules as short prevention rules (what to do before/while coding),
not long incident write-ups.

## Detection Triggers

Automatically log when you notice:

- **Corrections**: "No, that's not right...", "Actually, it should be...", "You're wrong about..."
- **Feature Requests**: "Can you also...", "I wish you could...", "Is there a way to..."
- **Knowledge Gaps**: User provides information you didn't know, documentation is outdated
- **Errors**: Command returns non-zero exit code, exception or stack trace

## Priority Guidelines

| Priority | When |
|----------|------|
| critical | Blocks core functionality, data loss risk, security issue |
| high | Significant impact, affects common workflows, recurring issue |
| medium | Moderate impact, workaround exists |
| low | Minor inconvenience, edge case |

## Area Tags

| Tag | Scope |
|-----|-------|
| frontend | UI, components, client-side code |
| backend | API, services, server-side code |
| infra | CI/CD, deployment, Docker, cloud |
| tests | Test files, testing utilities, coverage |
| docs | Documentation, comments, READMEs |
| config | Configuration files, environment, settings |

## Best Practices

- Log immediately - context is freshest right after the issue
- Be specific - future agents need to understand quickly
- Include reproduction steps - especially for errors
- Link related files - makes fixes easier
- Suggest concrete fixes - not just "investigate"
- Use consistent categories - enables filtering
- Promote aggressively - if in doubt, add to CLAUDE.md
- Review regularly - stale learnings lose value

## Periodic Review

Review `.learnings/` at natural breakpoints:

- Before starting a new major task
- After completing a feature
- When working in an area with past learnings
- Weekly during active development

### Quick Status Check

```bash
# Count pending items
grep -h "Status\*\*: pending" .learnings/*.md | wc -l

# List pending high-priority items
grep -B5 "Priority\*\*: high" .learnings/*.md | grep "^## \["

# Find learnings for a specific area
grep -l "Area\*\*: backend" .learnings/*.md
```
