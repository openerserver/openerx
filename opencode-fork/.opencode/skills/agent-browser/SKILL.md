---
name: agent-browser-clawdbot
description: Headless browser automation CLI optimized for AI agents with accessibility tree snapshots
source: https://clawhub.ai/MaTriXy/agent-browser-clawdbot
downloads: 22.6k
stars: 55
license: MIT-0
security: VirusTotal Benign, OpenClaw Benign (HIGH CONFIDENCE)
version: v0.1.0
---

# Agent Browser Skill

Fast browser automation using accessibility tree snapshots with refs for
deterministic element selection.

## Why Use This Over Built-in Browser Tool

Use agent-browser when:
- Automating multi-step workflows
- Need deterministic element selection
- Performance is critical
- Working with complex SPAs
- Need session isolation

Use built-in browser tool when:
- Need screenshots/PDFs for analysis
- Visual inspection required
- Browser extension integration needed

## Installation

```bash
npm install -g agent-browser
agent-browser install                     # Download Chromium
agent-browser install --with-deps         # Linux: + system deps
```

## Core Workflow

```bash
# 1. Navigate and snapshot
agent-browser open https://example.com
agent-browser snapshot -i --json

# 2. Parse refs from JSON, then interact
agent-browser click @e2
agent-browser fill @e3 "text"

# 3. Re-snapshot after page changes
agent-browser snapshot -i --json
```

## Key Commands

### Navigation
```bash
agent-browser open <url>
agent-browser back | forward | reload | close
```

### Snapshot (Always use -i --json)
```bash
agent-browser snapshot -i --json          # Interactive elements, JSON output
agent-browser snapshot -i -c -d 5 --json  # + compact, depth limit
agent-browser snapshot -s "#main" -i      # Scope to selector
```

### Interactions (Ref-based)
```bash
agent-browser click @e2
agent-browser fill @e3 "text"
agent-browser type @e3 "text"
agent-browser hover @e4
agent-browser check @e5 | uncheck @e5
agent-browser select @e6 "value"
agent-browser press "Enter"
agent-browser scroll down 500
agent-browser drag @e7 @e8
```

### Get Information
```bash
agent-browser get text @e1 --json
agent-browser get html @e2 --json
agent-browser get value @e3 --json
agent-browser get attr @e4 "href" --json
agent-browser get title --json
agent-browser get url --json
agent-browser get count ".item" --json
```

### Wait
```bash
agent-browser wait @e2                    # Wait for element
agent-browser wait 1000                   # Wait ms
agent-browser wait --text "Welcome"       # Wait for text
agent-browser wait --url "**/dashboard"   # Wait for URL
agent-browser wait --load networkidle     # Wait for network
```

### Sessions (Isolated Browsers)
```bash
agent-browser --session admin open site.com
agent-browser --session user open site.com
agent-browser session list
```

### State Persistence
```bash
agent-browser state save auth.json        # Save cookies/storage
agent-browser state load auth.json        # Load (skip login)
```

### Network Control
```bash
agent-browser network route "**/ads/*" --abort           # Block
agent-browser network route "**/api/*" --body '{"x":1}'  # Mock
agent-browser network requests --filter api              # View
```

## Snapshot Output Format

```json
{
  "success": true,
  "data": {
    "snapshot": "...",
    "refs": {
      "e1": {"role": "heading", "name": "Example Domain"},
      "e2": {"role": "button", "name": "Submit"},
      "e3": {"role": "textbox", "name": "Email"}
    }
  }
}
```

## Best Practices

- Always use `-i` flag - Focus on interactive elements
- Always use `--json` - Easier to parse
- Wait for stability - `agent-browser wait --load networkidle`
- Save auth state - Skip login flows with `state save/load`
- Use sessions - Isolate different browser contexts
- Use `--headed` for debugging
