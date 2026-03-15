---
name: oracle
description: Second-model review via CLI — debugging, refactors, design checks, cross-validation
source: https://clawhub.ai/steipete/oracle
downloads: 9.8k
stars: 10
license: MIT-0
security: VirusTotal Suspicious (MEDIUM CONFIDENCE — uploads local files to external model)
version: v1.0.1
---

# Oracle (CLI) — best use

Oracle bundles your prompt + selected files into one "one-shot" request so
another model can answer with real repo context (API or browser automation).
Treat outputs as advisory: verify against the codebase + tests.

## Main use case (browser, GPT-5.2 Pro)

Default workflow: `--engine browser` with GPT-5.2 Pro in ChatGPT.
This is the "human in the loop" path.

## Golden path

1. Pick a tight file set (fewest files that still contain the truth)
2. Preview what you're about to send (`--dry-run` + `--files-report`)
3. Run in browser mode for GPT-5.2 Pro; use API only when you need Claude/Grok/Codex
4. If the run detaches/timeouts: reattach (don't re-run)

## Commands

```bash
# Show help
npx -y @steipete/oracle --help

# Preview (no tokens spent)
npx -y @steipete/oracle --dry-run summary -p "<task>" --file "src/**" --file "!**/*.test.*"

# Token/cost sanity check
npx -y @steipete/oracle --dry-run summary --files-report -p "<task>" --file "src/**"

# Browser run (main path)
npx -y @steipete/oracle --engine browser --model gpt-5.2-pro -p "<task>" --file "src/**"

# Manual paste fallback (clipboard)
npx -y @steipete/oracle --render --copy -p "<task>" --file "src/**"
```

## Attaching files (`--file`)

- `--file "src/**"` (directory glob)
- `--file src/index.ts` (literal file)
- Exclude: `--file "src/**" --file "!src/**/*.test.ts"`
- Default-ignored: `node_modules`, `dist`, `.git`, `build`, `tmp`
- Hard cap: files > 1 MB are rejected

## Budget + observability

- Target: keep total input under ~196k tokens
- Use `--files-report` to spot token hogs before spending

## Engines

- Auto-pick: uses `api` when `OPENAI_API_KEY` is set, otherwise `browser`
- Browser: supports GPT + Gemini only
- API: use for Claude/Grok/Codex

## Sessions

- Stored under `~/.oracle/sessions`
- Runs may detach or take a long time
- List: `oracle status --hours 72`
- Attach: `oracle session <id> --render`
- Use `--slug "<3-5 words>"` for readable session IDs

## Prompt Template

Oracle starts with zero project knowledge. Include:
1. Project briefing (stack + build/test commands + platform constraints)
2. "Where things live" (key directories, entrypoints, config files)
3. Exact question + what you tried + the error text
4. Constraints ("don't change X", "must keep public API", "perf budget")
5. Desired output ("return patch plan + tests", "list risky assumptions")

## Safety

- Don't attach secrets by default (.env, key files, auth tokens)
- Redact aggressively; share only what's required
- Prefer "just enough context": fewer files + better prompt beats whole-repo dumps
