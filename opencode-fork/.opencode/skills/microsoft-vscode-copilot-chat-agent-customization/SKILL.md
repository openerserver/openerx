---
name: agent-customization
description: '**WORKFLOW SKILL** — Create, update, review, fix, or debug VS Code agent customization files (.instructions.md, .prompt.md, .agent.md, SKILL.md, copilot-instructions.md, AGENTS.md). USE FOR: saving coding preferences; troubleshooting why instructions/skills/agents are ignored or not invoked; configuring applyTo patterns; defining tool restrictions; creating custom agent modes or specialized workflows; packaging domain knowledge; fixing YAML frontmatter syntax. DO NOT USE FOR: general coding questions (use default agent); runtime debugging or error diagnosis; MCP server configuration (use MCP docs directly); VS Code extension development. INVOKES: file system tools (read/write customization files), ask-questions tool (interview user for requirements), subagents for codebase exploration. FOR SINGLE OPERATIONS: For quick YAML frontmatter fixes or creating a single file from a known pattern, edit the file directly — no skill needed.'
---

# Agent Customization

## Decision Flow

| Primitive | When to Use |
|-----------|-------------|
| Workspace Instructions | Always-on, applies everywhere in the project |
| File Instructions | Explicit via `applyTo` patterns, or on-demand via `description` |
| MCP | Integrates external systems, APIs, or data |
| Hooks | Deterministic shell commands at agent lifecycle points (block tools, auto-format, inject context) |
| Custom Agents | Subagents for context isolation, or multi-stage workflows with tool restrictions |
| Prompts | Single focused task with parameterized inputs |
| Skills | On-demand workflow with bundled assets (scripts/templates) |

## Quick Reference

Consult the reference docs for templates, domain examples, advanced frontmatter options, asset organization, anti-patterns, and creation checklists. If the references are not enough, load the official documentation links for each primitive.

| Type | File | Location | Reference |
|------|------|----------|-----------|
| Workspace Instructions | `copilot-instructions.md`, `AGENTS.md` | `.github/` or root | [Link](./references/workspace-instructions.md) |
| File Instructions | `*.instructions.md` | `.github/instructions/` | [Link](./references/instructions.md) |
| Prompts | `*.prompt.md` | `.github/prompts/` | [Link](./references/prompts.md) |
| Hooks | `*.json` | `.github/hooks/` | [Link](./references/hooks.md) |
| Custom Agents | `*.agent.md` | `.github/agents/` | [Link](./references/agents.md) |
| Skills | `SKILL.md` | `.github/skills/<name>/`, `.agents/skills/<name>/`, `.claude/skills/<name>/` | [Link](./references/skills.md) |

**User-level**: `{{USER_PROMPTS_FOLDER}}/` (*.prompt.md, *.instructions.md, *.agent.md; not skills)
Customizations roam with user's settings sync

## Creation Process

If you need to explore or validate patterns in the codebase, use a read-only subagent. If the ask-questions tool is available, use it to interview the user and clarify requirements.

Follow these steps when creating any customization file.

### 1. Determine Scope

Ask the user where they want the customization:
- **Workspace**: For project-specific, team-shared customizations → `.github/` folder
- **User profile**: For personal, cross-workspace customizations → `{{USER_PROMPTS_FOLDER}}/`

### 2. Choose the Right Primitive

Use the Decision Flow above to select the appropriate file type based on the user's need.

### 3. Create the File

Create the file directly at the appropriate path:
- Use the location tables in each reference file
- Include required frontmatter as needed
- Add the body content following the templates

### 4. Validate

After creating:
- Confirm the file is in the correct location
- Verify frontmatter syntax (YAML between `---` markers)
- Check that `description` is present and meaningful

## Edge Cases

**Instructions vs Skill?** Does this apply to *most* work, or *specific* tasks? Most → Instructions. Specific → Skill.

**Skill vs Prompt?** Both appear as slash commands in chat (type `/`). Multi-step workflow with bundled assets → Skill. Single focused task with inputs → Prompt.

**Skill vs Custom Agent?** Same capabilities for all steps → Skill. Need context isolation (subagent returns single output) or different tool restrictions per stage → Custom Agent.

**Hooks vs Instructions?** Instructions *guide* agent behavior (non-deterministic). Hooks *enforce* behavior via shell commands at lifecycle events like `PreToolUse` or `PostToolUse` — they can block operations, require approval, or run formatters deterministically. See [hooks reference](./references/hooks.md).

## Common Pitfalls

**Description is the discovery surface.** The `description` field is how the agent decides whether to load a skill, instruction, or agent. If trigger phrases aren't IN the description, the agent won't find it. Use the "Use when..." pattern with specific keywords.

**YAML frontmatter silent failures.** Unescaped colons in values, tabs instead of spaces, `name` that doesn't match folder name — all cause silent failures with no error message. Always quote descriptions that contain colons: `description: "Use when: doing X"`.

**`applyTo: "**"` burns context.** This means "always included for every file request" — it loads the instruction into the context window on every interaction, even when irrelevant. Use specific globs (`**/*.py`, `src/api/**`) unless the instruction truly applies to all files.


---

## Referenced Files

> The following files are referenced in this skill and included for context.

### references/workspace-instructions.md

```markdown
# [Workspace Instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)

Guidelines that automatically apply to all chat requests across your entire workspace.

## File Types (Choose One)

| File | Location | Purpose |
|------|----------|---------|
| `copilot-instructions.md` | `.github/` | Project-wide standards (recommended, cross-editor) |
| `AGENTS.md` | Root or subfolders | Open standard, monorepo hierarchy support |

Use **only one**—not both.

## AGENTS.md Hierarchy

For monorepos, the closest file in the directory tree takes precedence:

```
/AGENTS.md              # Root defaults
/frontend/AGENTS.md     # Frontend-specific (overrides root)
/backend/AGENTS.md      # Backend-specific (overrides root)
```

Use nested `AGENTS.md` files for monorepos when different areas need different defaults.

## Template

Only include sections the workspace benefits from:

```markdown
# Project Guidelines

## Code Style
{Language and formatting preferences—reference key files that exemplify patterns}

## Architecture
{Major components, service boundaries, the "why" behind structural decisions}

## Build and Test
{Commands to install, build, test—agents will attempt to run these}

## Conventions
{Patterns that differ from common practices—include specific examples}
```

For large repos, link to detailed docs instead of embedding: `See docs/TESTING.md for test conventions.`

## When to Use

- General coding standards that apply everywhere
- Team preferences shared through version control
- Project-wide requirements (testing, documentation)

## Core Principles

1. **Minimal by default**: Only what's relevant to *every* task
2. **Concise and actionable**: Every line should guide behavior
3. **Link, don't embed**: Reference docs instead of copying
4. **Keep current**: Update when practices change

## Anti-patterns

- **Using both file types**: Having both `copilot-instructions.md` and `AGENTS.md`
- **Kitchen sink**: Everything instead of what matters most
- **Duplicating docs**: Copying README instead of linking
- **Obvious instructions**: Conventions already enforced by linters

```

### references/instructions.md

```markdown
# [File-Specific Instructions (.instructions.md)](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)

Guidelines loaded on-demand when relevant to the current task, or explicitly when files match a pattern.

## Locations

| Path | Scope |
|------|-------|
| `.github/instructions/*.instructions.md` | Workspace |
| `<profile>/instructions/*.instructions.md` | User profile |

## Frontmatter

```yaml
---
description: "<required>"    # For on-demand discovery—keyword-rich
name: "Instruction Name"     # Optional, defaults to filename
applyTo: "**/*.ts"           # Optional, auto-attach for matching files
---
```

## Discovery Modes

| Mode | Trigger | Use Case |
|------|---------|----------|
| **On-demand** (`description`) | Agent detects task relevance | Task-based: migrations, refactoring, API work |
| **Explicit** (`applyTo`) | Files matching glob in context | File-based: language standards, framework rules |
| **Manual** | `Add Context` → `Instructions` | Ad-hoc attachment |

## Template

```markdown
---
description: "Use when writing database migrations, schema changes, or data transformations. Covers safety checks and rollback patterns."
---
# Migration Guidelines

- Always create reversible migrations
- Test rollback before merging
- Never drop columns in the same release as code removal
```

Note the "Use when..." pattern in the description—this helps on-demand discovery.

## Explicit File Matching (optional)

Use `applyTo` when the instruction applies to specific file types or folders:

```yaml
applyTo: "**"                           # ALWAYS included, no matter the file or description (use with caution)
applyTo: "**/*.py"                      # All Python files
applyTo: ["src/**", "lib/**"]           # Multiple patterns (OR)
applyTo: src/**, lib/**                 # Multiple patterns without array syntax (OR)
applyTo: "src/api/**/*.ts"              # Specific folder + extension
```

Applied when creating or modifying matching files, not for read-only operations.

## Core Principles

1. **Keyword-rich descriptions**: Include trigger words for on-demand discovery
2. **One concern per file**: Separate files for testing, styling, documentation
3. **Concise and actionable**: Share context window—keep focused
4. **Show, don't tell**: Brief code examples over lengthy explanations

## Anti-patterns

- **Vague descriptions**: "Helpful coding tips" doesn't enable discovery
- **Overly broad applyTo**: `"**"` with content only relevant to specific files
- **Duplicating docs**: Copy README instead of linking
- **Mixing concerns**: Testing + API design + styling in one file

```

### references/prompts.md

```markdown
# [Prompts (.prompt.md)](https://code.visualstudio.com/docs/copilot/customization/prompt-files)

Reusable task templates triggered on-demand in chat. Single focused task with parameterized inputs.

## Locations

| Path | Scope |
|------|-------|
| `.github/prompts/*.prompt.md` | Workspace |
| `<profile>/prompts/*.prompt.md` | User profile |

## Frontmatter

```yaml
---
description: "<recommended>" # Optional, but improves discoverability
name: "Prompt Name"          # Optional, defaults to filename
argument-hint: "Task..."     # Optional: hint shown in chat input
agent: "agent"               # Optional: ask, agent, plan, or custom agent
model: "GPT-5 (copilot)"     # Optional: selected model, or fallback array
tools: [search, web]    # Optional: built-in, tool sets, MCP (<server>/*), extension
---
```

Model fallback is supported:

```yaml
model: ['GPT-5 (copilot)', 'Claude Sonnet 4.5 (copilot)']
```

## Template

```markdown
---
description: "Generate test cases for selected code"
agent: "agent"
---
Generate comprehensive test cases for the provided code:
- Include edge cases and error scenarios
- Follow existing test patterns in the codebase
- Use descriptive test names
```

**Context references**: Use Markdown links for files (`[config](./config.json)`) and `#tool:<name>` for tools.

## Invocation

- **Chat**: Type `/` → select from prompts and skills
- **Command**: `Chat: Run Prompt...`
- **Editor**: Open prompt file → play button

> Both prompts and skills appear as slash commands in chat. Skills provide multi-step workflows with bundled assets; prompts are single focused tasks.

**Tip**: Use `chat.promptFilesRecommendations` to show prompts as actions when starting a new chat.

## Tool Priority

When both prompt and custom agent define tools:
1. Tools from prompt file
2. Tools from referenced custom agent
3. Default tools for selected agent

## When to Use

- Generate test cases for specific code
- Create READMEs from specs
- Summarize metrics with custom parameters
- One-off generation tasks

## Core Principles

1. **Single task focus**: One prompt = one well-defined task
2. **Output examples**: Show expected format when quality depends on structure
3. **Reuse over duplication**: Reference instruction files instead of copying

## Anti-patterns

- **Multi-task prompts**: "create and test and deploy" in one prompt
- **Vague descriptions**: Descriptions that don't help users understand when to use
- **Over-tooling**: Many tools when the task only needs search or file access
```

### references/hooks.md

```markdown
# [Hooks (.json)](https://code.visualstudio.com/docs/copilot/customization/hooks)

Deterministic lifecycle automation for agent sessions. Use hooks to enforce policy, automate validation, and inject runtime context.

## Locations

| Path | Scope |
|------|-------|
| `.github/hooks/*.json` | Workspace (team-shared) |
| `.claude/settings.local.json` | Workspace local (not committed) |
| `.claude/settings.json` | Workspace |
| `~/.claude/settings.json` | User profile |

Hooks from all configured locations are collected and executed; workspace and user hooks do not override each other.

## Hook Events

| Event | Trigger |
|------|-------|
| `SessionStart` | First prompt of a new agent session |
| `UserPromptSubmit` | User submits a prompt |
| `PreToolUse` | Before tool invocation |
| `PostToolUse` | After successful tool invocation |
| `PreCompact` | Before context compaction |
| `SubagentStart` | Subagent starts |
| `SubagentStop` | Subagent ends |
| `Stop` | Agent session ends |

## Configuration Format

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "command",
        "command": "./scripts/validate-tool.sh",
        "timeout": 15
      }
    ]
  }
}
```

Each hook command supports:
- `type` (must be `command`)
- `command` (default)
- `windows`, `linux`, `osx` (platform overrides)
- `cwd`, `env`, `timeout`

## Input / Output Contract

Hooks receive JSON on stdin and can return JSON on stdout.

- Common output: `continue`, `stopReason`, `systemMessage`
- `PreToolUse` permissions are read from `hookSpecificOutput.permissionDecision` (`allow` | `ask` | `deny`)
- `PostToolUse` output can block further processing with `decision: block`

`PreToolUse` example output:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "Needs user confirmation"
  }
}
```

Exit codes:
- `0` success
- `2` blocking error
- Other values produce non-blocking warnings

## Hooks vs Other Customizations

| Primitive | Behavior |
|------|-------|
| Instructions / Prompts / Skills / Agents | Guidance (non-deterministic) |
| Hooks | Runtime enforcement and deterministic automation |

Use hooks when behavior must be guaranteed (for example: block dangerous commands, force validation, auto-inject context).

## Core Principles

1. Keep hooks small and auditable
2. Validate and sanitize hook inputs
3. Avoid hardcoded secrets in scripts
4. Prefer workspace hooks for team policy, user hooks for personal automation

## Anti-patterns

- Running long hooks that block normal flow
- Using hooks where plain instructions are sufficient
- Letting agents edit hook scripts without approval controls

```

### references/agents.md

```markdown
# [Custom Agents (.agent.md)](https://code.visualstudio.com/docs/copilot/customization/custom-agents)

Custom personas with specific tools, instructions, and behaviors. Use for orchestrated workflows with role-based tool restrictions.

## Locations

| Path | Scope |
|------|-------|
| `.github/agents/*.agent.md` | Workspace |
| `<profile>/agents/*.agent.md` | User profile |

## Frontmatter

```yaml
---
description: "<required>"    # For agent picker and subagent discovery
name: "Agent Name"           # Optional, defaults to filename
tools: [search, web]         # Optional: aliases, MCP (<server>/*), extension tools
model: "Claude Sonnet 4"     # Optional, uses picker default; supports array for fallback
argument-hint: "Task..."     # Optional, input guidance
agents: [agent1, agent2]     # Optional, restrict allowed subagents by name (omit = all, [] = none)
user-invocable: true         # Optional, show in agent picker (default: true)
disable-model-invocation: false  # Optional, prevent subagent invocation (default: false)
handoffs: [...]              # Optional, transitions to other agents
---
```

### Invocation Control

| Attribute | Default | Effect |
|-----------|---------|--------|
| `user-invocable: false` | `true` | Hide from agent picker, only accessible as subagent |
| `disable-model-invocation: true` | `false` | Prevent other agents from invoking as subagent |

### Model Fallback

```yaml
model: ['Claude Sonnet 4.5 (copilot)', 'GPT-5 (copilot)']  # First available model is used
```

## Tools

Sources: built-in aliases, specific tools, MCP servers (`<server>/*`), extension tools.

**Special**: `[]` = no tools, omit = defaults. Body reference: `#tool:<name>`

### Tool Aliases

| Alias | Purpose |
|-------|---------|
| `execute` | Run shell commands |
| `read` | Read file contents |
| `edit` | Edit files |
| `search` | Search files or text |
| `agent` | Invoke custom agents as subagents |
| `web` | Fetch URLs and web search |
| `todo` | Manage task lists |

### Common Patterns

```yaml
tools: [read, search]             # Read-only research
tools: [myserver/*]               # MCP server only
tools: [read, edit, search]       # No terminal access
tools: []                         # Conversational only
```

To discover available tools, check your current tool list or use `#tool:` syntax in the body to reference specific tools.

## Template

```markdown
---
description: "{Use when... trigger phrases for subagent discovery}"
tools: [{minimal set of tool aliases}]
user-invocable: false
---
You are a specialist at {specific task}. Your job is to {clear purpose}.

## Constraints
- DO NOT {thing this agent should never do}
- DO NOT {another restriction}
- ONLY {the one thing this agent does}

## Approach
1. {Step one of how this agent works}
2. {Step two}
3. {Step three}

## Output Format
{Exactly what this agent should return}
```

## Invocation

- **Manual**: Agent selector in chat
- **Subagent**: Parent agent delegates based on `description` match (when `infer` allows)

## Core Principles

1. **Single role**: One persona with focused responsibilities per agent
2. **Minimal tools**: Only include what the role needs—excess tools dilute focus
3. **Clear boundaries**: Define what the agent should NOT do
4. **Keyword-rich description**: Include trigger words so parent agents know when to delegate

## Anti-patterns

- **Swiss-army agents**: Too many tools, tries to do everything
- **Vague descriptions**: "A helpful agent" doesn't guide delegation—be specific
- **Role confusion**: Description doesn't match body persona
- **Circular handoffs**: A → B → A without progress criteria
```

### references/skills.md

```markdown
# [Agent Skills (SKILL.md)](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

Folders of instructions, scripts, and resources that agents load on-demand for specialized tasks.

## Structure

```
.github/skills/<skill-name>/
├── SKILL.md           # Required (name must match folder)
├── scripts/           # Executable code
├── references/        # Docs loaded as needed
└── assets/            # Templates, boilerplate
```

## Locations

| Path | Scope |
|------|-------|
| `.github/skills/<name>/` | Project |
| `.agents/skills/<name>/` | Project |
| `.claude/skills/<name>/` | Project |
| `~/.copilot/skills/<name>/` | Personal |
| `~/.agents/skills/<name>/` | Personal |
| `~/.claude/skills/<name>/` | Personal |

## SKILL.md Format

```yaml
---
name: skill-name              # Required: 1-64 chars, lowercase alphanumeric + hyphens, must match folder
description: 'What and when to use. Max 1024 chars.'
argument-hint: 'Optional hint shown for slash invocation'
user-invocable: true          # Optional: show as slash command (default: true)
disable-model-invocation: false # Optional: disable automatic model-triggered loading
---
```

### Body

- What the skill accomplishes
- When to use (triggers and use cases)
- Step-by-step procedures
- References to resources: `[script](./scripts/test.js)`

## Template

```markdown
---
name: webapp-testing
description: 'Test web applications using Playwright. Use for verifying frontend, debugging UI, capturing screenshots.'
---

# Web Application Testing

## When to Use
- Verify frontend functionality
- Debug UI behavior

## Procedure
1. Start the web server
2. Run [test script](./scripts/test.js)
3. Review screenshots in `./screenshots/`
```

## Progressive Loading

1. **Discovery** (~100 tokens): Agent reads `name` and `description`
2. **Instructions** (<5000 tokens): Loads `SKILL.md` body when relevant
3. **Resources**: Additional files load only when referenced

Keep file references one level deep from `SKILL.md`.

## Slash Command Behavior

Skills and prompt files both appear after typing `/` in chat.

| Configuration | Slash command | Auto-loaded |
|---|---|---|
| Default (both omitted) | Yes | Yes |
| `user-invocable: false` | No | Yes |
| `disable-model-invocation: true` | Yes | No |
| Both set | No | No |

## When to Use

Repeatable, on-demand workflows with bundled assets (scripts, templates, reference docs).

## Core Principles

1. **Keyword-rich descriptions**: Include trigger words for discovery
2. **Progressive loading**: Keep SKILL.md under 500 lines; use reference files
3. **Relative paths**: Always use `./` for skill resources
4. **Self-contained**: Include all procedural knowledge to complete the task

## Anti-patterns

- **Vague descriptions**: "A helpful skill" doesn't enable discovery
- **Monolithic SKILL.md**: Everything in one file instead of references
- **Name mismatch**: Folder name doesn't match `name` field
- **Missing procedures**: Descriptions without step-by-step guidance
```

