---
name: self-improving
description: Self-reflection + Self-criticism + Self-learning + Self-organizing memory
source: https://clawhub.ai/ivangdavila/self-improving
downloads: 69.4k
stars: 343
license: MIT-0
security: VirusTotal Benign, OpenClaw Benign (HIGH CONFIDENCE)
version: v1.2.16
---

# Self-Improving + Proactive Agent

Agent evaluates its own work, catches mistakes, and improves permanently.

## When to Use

- User corrects you or points out mistakes
- You complete significant work and want to evaluate the outcome
- You notice something in your own output that could be better
- Knowledge should compound over time without manual maintenance

## Architecture

Memory lives in `~/self-improving/` with tiered structure.

```
~/self-improving/
├── memory.md          # HOT: ≤100 lines, always loaded
├── index.md           # Topic index with line counts
├── heartbeat-state.md # Heartbeat state: last run, reviewed change, action notes
├── projects/          # Per-project learnings
├── domains/           # Domain-specific (code, writing, comms)
├── archive/           # COLD: decayed patterns
└── corrections.md     # Last 50 corrections log
```

## Core Rules

### 1. Learn from Corrections and Self-Reflection

- Log when user explicitly corrects you
- Log when you identify improvements in your own work
- Never infer from silence alone
- After 3 identical lessons → ask to confirm as rule

### 2. Tiered Storage

| Tier | File | Limit | Loading |
|------|------|-------|---------|
| HOT | memory.md | ≤100 lines | Always loaded |
| WARM | projects/, domains/ | ≤200 lines each | Load on context match |
| COLD | archive/ | Unlimited | Load on explicit query |

### 3. Automatic Promotion/Demotion

- Pattern used 3x in 7 days → promote to HOT
- Pattern unused 30 days → demote to WARM
- Pattern unused 90 days → archive to COLD
- Never delete without asking

### 4. Namespace Isolation

- Project patterns stay in `projects/{name}.md`
- Global preferences in HOT tier (memory.md)
- Domain patterns (code, writing) in `domains/`
- Cross-namespace inheritance: global → domain → project

### 5. Conflict Resolution

- Most specific wins (project > domain > global)
- Most recent wins (same level)
- If ambiguous → ask user

### 6. Compaction

When file exceeds limit:
- Merge similar corrections into single rule
- Archive unused patterns
- Summarize verbose entries
- Never lose confirmed preferences

### 7. Transparency

- Every action from memory → cite source: "Using X (from projects/foo.md:12)"
- Weekly digest available: patterns learned, demoted, archived
- Full export on demand

### 8. Security Boundaries

Never store credentials, health data, third-party info.

### 9. Graceful Degradation

If context limit hit:
- Load only memory.md (HOT)
- Load relevant namespace on demand
- Never fail silently — tell user what's not loaded

## Learning Signals

Log automatically when you notice these patterns:

**Corrections** → add to corrections.md, evaluate for memory.md:
- "No, that's not right..."
- "Actually, it should be..."
- "I prefer X, not Y"
- "Remember that I always..."

**Preference signals** → add to memory.md if explicit:
- "I like when you..."
- "Always do X for me"
- "Never do Y"

**Pattern candidates** → track, promote after 3x:
- Same instruction repeated 3+ times
- Workflow that works well repeatedly

**Ignore** (don't log):
- One-time instructions ("do X now")
- Context-specific ("in this file...")
- Hypotheticals ("what if...")

## Self-Reflection

After completing significant work, pause and evaluate:

- Did it meet expectations? — Compare outcome vs intent
- What could be better? — Identify improvements for next time
- Is this a pattern? — If yes, log to corrections.md

Log format:
```
CONTEXT: [type of task]
REFLECTION: [what I noticed]
LESSON: [what to do differently]
```

## Common Traps

| Trap | Risk | Fix |
|------|------|-----|
| Learning from silence | Creates false rules | Wait for explicit correction or repeated evidence |
| Promoting too fast | Pollutes HOT memory | Keep new lessons tentative until repeated |
| Reading every namespace | Wastes context | Load only HOT plus the smallest matching files |
| Compaction by deletion | Loses trust and history | Merge, summarize, or demote instead |

## Scope

This skill ONLY:
- Learns from user corrections and self-reflection
- Stores preferences in local files (`~/self-improving/`)
- Reads its own memory files on activation

This skill NEVER:
- Accesses calendar, email, or contacts
- Makes network requests
- Reads files outside `~/self-improving/`
- Infers preferences from silence or observation
- Modifies its own SKILL.md
