# Security Baseline

## Command Classification

| Level | Policy | Examples |
|-------|--------|----------|
| 0 - Free | Execute without restriction | `read_file`, `find`, `grep`, `ls`, `cat`, `git status`, `git log`, `git diff` |
| 1 - Audit | Execute + log to audit trail | `write_file`, `edit_file`, `mkdir`, `git add`, `git commit` |
| 2 - Confirm | Require agent self-confirmation before execute | `shell(rm/mv/chmod)`, `git push`, `npm publish` |
| 3 - Approve | Require human approval via Web UI | Production writes, DB migrations, infra changes, `git push --force` |

## Directory Access Control

### Allowed (Read + Write)
- Project working directory and subdirectories
- `/tmp/openerx-*` (temporary workspace)

### Read-Only
- `/etc/` (configuration reference)
- `node_modules/`, `vendor/` (dependency inspection)

### Forbidden
- `~/.ssh/`, `~/.aws/`, `~/.gnupg/`
- `~/.config/` (except `~/.config/opencode/`)
- `/var/`, `/usr/`, `/sys/`, `/proc/`
- Any path outside project scope not explicitly whitelisted

## Network Egress Policy

### Allowed
- Model API endpoints (Anthropic, OpenAI, configured providers)
- Internal Git server
- Internal package registry
- Configured MCP server endpoints

### Audited
- All outbound HTTP/HTTPS requests: log URL + status code + response size

### Blocked
- Any undeclared external API endpoint
- Raw socket connections
- DNS-over-HTTPS to non-standard resolvers

## Tool Permission Defaults

- **Default policy**: DENY ALL
- Tools must be explicitly whitelisted in project policy
- New tool activation requires project_admin approval
- MCP tools follow the same policy

## Sensitive Data Protection

- API keys referenced via `env:VARIABLE_NAME`, never stored in config files
- Log output is sanitized: regex patterns strip common secret formats
- Agent output is scanned for high-entropy strings before display
