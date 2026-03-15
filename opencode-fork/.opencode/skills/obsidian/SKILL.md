---
name: obsidian
description: Work with Obsidian vaults (plain Markdown notes) and automate via obsidian-cli
source: https://clawhub.ai/steipete/obsidian
downloads: 50.9k
stars: 199
license: MIT-0
security: VirusTotal Suspicious (MEDIUM CONFIDENCE — reads user config file)
version: v1.0.0
runtime: obsidian-cli (brew install yakitrak/yakitrak/obsidian-cli)
---

# Obsidian

Obsidian vault = a normal folder on disk.

## Vault structure (typical)

- Notes: `*.md` (plain text Markdown; edit with any editor)
- Config: `.obsidian/` (workspace + plugin settings; usually don't touch from scripts)
- Canvases: `*.canvas` (JSON)
- Attachments: whatever folder you chose in Obsidian settings

## Find the active vault(s)

Obsidian desktop tracks vaults here (source of truth):

`~/Library/Application Support/obsidian/obsidian.json`

`obsidian-cli` resolves vaults from that file.

- If you've already set a default: `obsidian-cli print-default --path-only`
- Otherwise, read the config and use the vault entry with `"open": true`

Notes:
- Multiple vaults common (iCloud vs ~/Documents, work/personal)
- Don't guess; read config
- Avoid hardcoded vault paths in scripts

## obsidian-cli quick start

### Set default vault
```bash
obsidian-cli set-default "<vault-folder-name>"
obsidian-cli print-default
obsidian-cli print-default --path-only
```

### Search
```bash
obsidian-cli search "query"          # note names
obsidian-cli search-content "query"  # inside notes; shows snippets + lines
```

### Create
```bash
obsidian-cli create "Folder/New note" --content "..." --open
```
Requires Obsidian URI handler (`obsidian://…`) working.

### Move/rename (safe refactor)
```bash
obsidian-cli move "old/path/note" "new/path/note"
```
Updates `[[wikilinks]]` and common Markdown links across the vault.

### Delete
```bash
obsidian-cli delete "path/note"
```

Prefer direct edits when appropriate: open the `.md` file and change it;
Obsidian will pick it up.
