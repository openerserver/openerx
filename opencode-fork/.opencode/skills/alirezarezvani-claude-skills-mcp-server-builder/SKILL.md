# MCP Server Builder

**Tier:** POWERFUL  
**Category:** Engineering  
**Domain:** AI / API Integration

## Overview

Use this skill to design and ship production-ready MCP servers from API contracts instead of hand-written one-off tool wrappers. It focuses on fast scaffolding, schema quality, validation, and safe evolution.

The workflow supports both Python and TypeScript MCP implementations and treats OpenAPI as the source of truth.

## Core Capabilities

- Convert OpenAPI paths/operations into MCP tool definitions
- Generate starter server scaffolds (Python or TypeScript)
- Enforce naming, descriptions, and schema consistency
- Validate MCP tool manifests for common production failures
- Apply versioning and backward-compatibility checks
- Separate transport/runtime decisions from tool contract design

## When to Use

- You need to expose an internal/external REST API to an LLM agent
- You are replacing brittle browser automation with typed tools
- You want one MCP server shared across teams and assistants
- You need repeatable quality checks before publishing MCP tools
- You want to bootstrap an MCP server from existing OpenAPI specs

## Key Workflows

### 1. OpenAPI to MCP Scaffold

1. Start from a valid OpenAPI spec.
2. Generate tool manifest + starter server code.
3. Review naming and auth strategy.
4. Add endpoint-specific runtime logic.

```bash
python3 scripts/openapi_to_mcp.py \
  --input openapi.json \
  --server-name billing-mcp \
  --language python \
  --output-dir ./out \
  --format text
```

Supports stdin as well:

```bash
cat openapi.json | python3 scripts/openapi_to_mcp.py --server-name billing-mcp --language typescript
```

### 2. Validate MCP Tool Definitions

Run validator before integration tests:

```bash
python3 scripts/mcp_validator.py --input out/tool_manifest.json --strict --format text
```

Checks include duplicate names, invalid schema shape, missing descriptions, empty required fields, and naming hygiene.

### 3. Runtime Selection

- Choose **Python** for fast iteration and data-heavy backends.
- Choose **TypeScript** for unified JS stacks and tighter frontend/backend contract reuse.
- Keep tool contracts stable even if transport/runtime changes.

### 4. Auth & Safety Design

- Keep secrets in env, not in tool schemas.
- Prefer explicit allowlists for outbound hosts.
- Return structured errors (`code`, `message`, `details`) for agent recovery.
- Avoid destructive operations without explicit confirmation inputs.

### 5. Versioning Strategy

- Additive fields only for non-breaking updates.
- Never rename tool names in-place.
- Introduce new tool IDs for breaking behavior changes.
- Maintain changelog of tool contracts per release.

## Script Interfaces

- `python3 scripts/openapi_to_mcp.py --help`
  - Reads OpenAPI from stdin or `--input`
  - Produces manifest + server scaffold
  - Emits JSON summary or text report
- `python3 scripts/mcp_validator.py --help`
  - Validates manifests and optional runtime config
  - Returns non-zero exit in strict mode when errors exist

## Common Pitfalls

1. Tool names derived directly from raw paths (`get__v1__users___id`)
2. Missing operation descriptions (agents choose tools poorly)
3. Ambiguous parameter schemas with no required fields
4. Mixing transport errors and domain errors in one opaque message
5. Building tool contracts that expose secret values
6. Breaking clients by changing schema keys without versioning

## Best Practices

1. Use `operationId` as canonical tool name when available.
2. Keep one task intent per tool; avoid mega-tools.
3. Add concise descriptions with action verbs.
4. Validate contracts in CI using strict mode.
5. Keep generated scaffold committed, then customize incrementally.
6. Pair contract changes with changelog entries.

## Reference Material

- [references/openapi-extraction-guide.md](references/openapi-extraction-guide.md)
- [references/python-server-template.md](references/python-server-template.md)
- [references/typescript-server-template.md](references/typescript-server-template.md)
- [references/validation-checklist.md](references/validation-checklist.md)
- [README.md](README.md)

## Architecture Decisions

Choose the server approach per constraint:

- Python runtime: faster iteration, data pipelines, backend-heavy teams
- TypeScript runtime: shared types with JS stack, frontend-heavy teams
- Single MCP server: easiest operations, broader blast radius
- Split domain servers: cleaner ownership and safer change boundaries

## Contract Quality Gates

Before publishing a manifest:

1. Every tool has clear verb-first name.
2. Every tool description explains intent and expected result.
3. Every required field is explicitly typed.
4. Destructive actions include confirmation parameters.
5. Error payload format is consistent across all tools.
6. Validator returns zero errors in strict mode.

## Testing Strategy

- Unit: validate transformation from OpenAPI operation to MCP tool schema.
- Contract: snapshot `tool_manifest.json` and review diffs in PR.
- Integration: call generated tool handlers against staging API.
- Resilience: simulate 4xx/5xx upstream errors and verify structured responses.

## Deployment Practices

- Pin MCP runtime dependencies per environment.
- Roll out server updates behind versioned endpoint/process.
- Keep backward compatibility for one release window minimum.
- Add changelog notes for new/removed/changed tool contracts.

## Security Controls

- Keep outbound host allowlist explicit.
- Do not proxy arbitrary URLs from user-provided input.
- Redact secrets and auth headers from logs.
- Rate-limit high-cost tools and add request timeouts.


---

## Referenced Files

> The following files are referenced in this skill and included for context.

### references/openapi-extraction-guide.md

```markdown
# OpenAPI Extraction Guide

## Goal

Turn stable API operations into stable MCP tools with clear names and reliable schemas.

## Extraction Rules

1. Prefer `operationId` as tool name.
2. Fallback naming: `<method>_<path>` sanitized to snake_case.
3. Pull `summary` for tool description; fallback to `description`.
4. Merge path/query parameters into `inputSchema.properties`.
5. Merge `application/json` request-body object properties when available.
6. Preserve required fields from both parameters and request body.

## Naming Guidance

Good names:

- `list_customers`
- `create_invoice`
- `archive_project`

Avoid:

- `tool1`
- `run`
- `get__v1__customer___id`

## Schema Guidance

- `inputSchema.type` must be `object`.
- Every `required` key must exist in `properties`.
- Include concise descriptions on high-risk fields (IDs, dates, money, destructive flags).

```

### references/python-server-template.md

```markdown
# Python MCP Server Template

```python
from fastmcp import FastMCP
import httpx
import os

mcp = FastMCP(name="my-server")
API_BASE = os.environ["API_BASE"]
API_TOKEN = os.environ["API_TOKEN"]

@mcp.tool()
def list_items(input: dict) -> dict:
    with httpx.Client(base_url=API_BASE, headers={"Authorization": f"Bearer {API_TOKEN}"}) as client:
        resp = client.get("/items", params=input)
        if resp.status_code >= 400:
            return {"error": {"code": "upstream_error", "message": "List failed", "details": resp.text}}
        return resp.json()

if __name__ == "__main__":
    mcp.run()
```

```

### references/typescript-server-template.md

```markdown
# TypeScript MCP Server Template

```ts
import { FastMCP } from "fastmcp";

const server = new FastMCP({ name: "my-server" });

server.tool(
  "list_items",
  "List items from upstream service",
  async (input) => {
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "todo", input }) }],
    };
  }
);

server.run();
```

```

### references/validation-checklist.md

```markdown
# MCP Validation Checklist

## Structural Integrity
- [ ] Tool names are unique across the manifest
- [ ] Tool names use lowercase snake_case (3-64 chars, `[a-z0-9_]`)
- [ ] `inputSchema.type` is always `"object"`
- [ ] Every `required` field exists in `properties`
- [ ] No empty `properties` objects (warn if inputs truly optional)

## Descriptive Quality
- [ ] All tools include actionable descriptions (≥10 chars)
- [ ] Descriptions start with a verb ("Create…", "Retrieve…", "Delete…")
- [ ] Parameter descriptions explain expected values, not just types

## Security & Safety
- [ ] Auth tokens and secrets are NOT exposed in tool schemas
- [ ] Destructive tools require explicit confirmation input parameters
- [ ] No tool accepts arbitrary URLs or file paths without validation
- [ ] Outbound host allowlists are explicit where applicable

## Versioning & Compatibility
- [ ] Breaking tool changes use new tool IDs (never rename in-place)
- [ ] Additive-only changes for non-breaking updates
- [ ] Contract changelog is maintained per release
- [ ] Deprecated tools include sunset timeline in description

## Runtime & Error Handling
- [ ] Error responses use consistent structure (`code`, `message`, `details`)
- [ ] Timeout and rate-limit behaviors are documented
- [ ] Large response payloads are paginated or truncated

```

### README.md

```markdown
# MCP Server Builder

Generate and validate MCP servers from OpenAPI contracts with production-focused tooling. This skill helps teams bootstrap fast and enforce schema quality before shipping.

## Quick Start

```bash
# Generate scaffold from OpenAPI
python3 scripts/openapi_to_mcp.py \
  --input openapi.json \
  --server-name my-mcp \
  --language python \
  --output-dir ./generated \
  --format text

# Validate generated manifest
python3 scripts/mcp_validator.py --input generated/tool_manifest.json --strict --format text
```

## Included Tools

- `scripts/openapi_to_mcp.py`: OpenAPI -> `tool_manifest.json` + starter server scaffold
- `scripts/mcp_validator.py`: structural and quality validation for MCP tool definitions

## References

- `references/openapi-extraction-guide.md`
- `references/python-server-template.md`
- `references/typescript-server-template.md`
- `references/validation-checklist.md`

## Installation

### Claude Code

```bash
cp -R engineering/mcp-server-builder ~/.claude/skills/mcp-server-builder
```

### OpenAI Codex

```bash
cp -R engineering/mcp-server-builder ~/.codex/skills/mcp-server-builder
```

### OpenClaw

```bash
cp -R engineering/mcp-server-builder ~/.openclaw/skills/mcp-server-builder
```

```

### scripts/openapi_to_mcp.py

```python
#!/usr/bin/env python3
"""Generate MCP scaffold files from an OpenAPI specification.

Input sources:
- --input <file>
- stdin (JSON or YAML when PyYAML is available)

Output:
- tool_manifest.json
- server.py or server.ts scaffold
- summary in text/json
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional


HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


class CLIError(Exception):
    """Raised for expected CLI failures."""


@dataclass
class GenerationSummary:
    server_name: str
    language: str
    operations_total: int
    tools_generated: int
    output_dir: str
    manifest_path: str
    scaffold_path: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate MCP server scaffold from OpenAPI.")
    parser.add_argument("--input", help="OpenAPI file path (JSON or YAML). If omitted, reads from stdin.")
    parser.add_argument("--server-name", required=True, help="MCP server name.")
    parser.add_argument("--language", choices=["python", "typescript"], default="python", help="Scaffold language.")
    parser.add_argument("--output-dir", default=".", help="Directory to write generated files.")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Output format.")
    return parser.parse_args()


def load_raw_input(input_path: Optional[str]) -> str:
    if input_path:
        try:
            return Path(input_path).read_text(encoding="utf-8")
        except Exception as exc:
            raise CLIError(f"Failed to read --input file: {exc}") from exc

    if sys.stdin.isatty():
        raise CLIError("No input provided. Use --input <spec-file> or pipe OpenAPI via stdin.")

    data = sys.stdin.read().strip()
    if not data:
        raise CLIError("Stdin was provided but empty.")
    return data


def parse_openapi(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        try:
            import yaml  # type: ignore

            parsed = yaml.safe_load(raw)
            if not isinstance(parsed, dict):
                raise CLIError("YAML OpenAPI did not parse into an object.")
            return parsed
        except ImportError as exc:
            raise CLIError("Input is not valid JSON and PyYAML is unavailable for YAML parsing.") from exc
        except Exception as exc:
            raise CLIError(f"Failed to parse OpenAPI input: {exc}") from exc


def sanitize_tool_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_")
    cleaned = re.sub(r"_+", "_", cleaned)
    return cleaned.lower() or "unnamed_tool"


def schema_from_parameter(param: Dict[str, Any]) -> Dict[str, Any]:
    schema = param.get("schema", {})
    if not isinstance(schema, dict):
        schema = {}
    out = {
        "type": schema.get("type", "string"),
        "description": param.get("description", ""),
    }
    if "enum" in schema:
        out["enum"] = schema["enum"]
    return out


def extract_tools(spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    paths = spec.get("paths", {})
    if not isinstance(paths, dict):
        raise CLIError("OpenAPI spec missing valid 'paths' object.")

    tools = []
    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, operation in methods.items():
            method_l = str(method).lower()
            if method_l not in HTTP_METHODS or not isinstance(operation, dict):
                continue

            op_id = operation.get("operationId")
            if op_id:
                name = sanitize_tool_name(str(op_id))
            else:
                name = sanitize_tool_name(f"{method_l}_{path}")

            description = str(operation.get("summary") or operation.get("description") or f"{method_l.upper()} {path}")
            properties: Dict[str, Any] = {}
            required: List[str] = []

            for param in operation.get("parameters", []):
                if not isinstance(param, dict):
                    continue
                pname = str(param.get("name", "")).strip()
                if not pname:
                    continue
                properties[pname] = schema_from_parameter(param)
                if bool(param.get("required")):
                    required.append(pname)

            request_body = operation.get("requestBody", {})
            if isinstance(request_body, dict):
                content = request_body.get("content", {})
                if isinstance(content, dict):
                    app_json = content.get("application/json", {})
                    if isinstance(app_json, dict):
                        schema = app_json.get("schema", {})
                        if isinstance(schema, dict) and schema.get("type") == "object":
                            rb_props = schema.get("properties", {})
                            if isinstance(rb_props, dict):
                                for key, val in rb_props.items():
                                    if isinstance(val, dict):
                                        properties[key] = val
                            rb_required = schema.get("required", [])
                            if isinstance(rb_required, list):
                                required.extend([str(x) for x in rb_required])

            tool = {
                "name": name,
                "description": description,
                "inputSchema": {
                    "type": "object",
                    "properties": properties,
                    "required": sorted(set(required)),
                },
                "x-openapi": {"path": path, "method": method_l},
            }
            tools.append(tool)

    return tools


def python_scaffold(server_name: str, tools: List[Dict[str, Any]]) -> str:
    handlers = []
    for tool in tools:
        fname = sanitize_tool_name(tool["name"])
        handlers.append(
            f"@mcp.tool()\ndef {fname}(input: dict) -> dict:\n"
            f"    \"\"\"{tool['description']}\"\"\"\n"
            f"    return {{\"tool\": \"{tool['name']}\", \"status\": \"todo\", \"input\": input}}\n"
        )

    return "\n".join(
        [
            "#!/usr/bin/env python3",
            '"""Generated MCP server scaffold."""',
            "",
            "from fastmcp import FastMCP",
            "",
            f"mcp = FastMCP(name={server_name!r})",
            "",
            *handlers,
            "",
            "if __name__ == '__main__':",
            "    mcp.run()",
            "",
        ]
    )


def typescript_scaffold(server_name: str, tools: List[Dict[str, Any]]) -> str:
    registrations = []
    for tool in tools:
        const_name = sanitize_tool_name(tool["name"])
        registrations.append(
            "server.tool(\n"
            f"  '{tool['name']}',\n"
            f"  '{tool['description']}',\n"
            "  async (input) => ({\n"
            f"    content: [{{ type: 'text', text: JSON.stringify({{ tool: '{const_name}', status: 'todo', input }}) }}],\n"
            "  })\n"
            ");"
        )

    return "\n".join(
        [
            "// Generated MCP server scaffold",
            "import { FastMCP } from 'fastmcp';",
            "",
            f"const server = new FastMCP({{ name: '{server_name}' }});",
            "",
            *registrations,
            "",
            "server.run();",
            "",
        ]
    )


def write_outputs(server_name: str, language: str, output_dir: Path, tools: List[Dict[str, Any]]) -> GenerationSummary:
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = output_dir / "tool_manifest.json"
    manifest = {"server": server_name, "tools": tools}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    if language == "python":
        scaffold_path = output_dir / "server.py"
        scaffold_path.write_text(python_scaffold(server_name, tools), encoding="utf-8")
    else:
        scaffold_path = output_dir / "server.ts"
        scaffold_path.write_text(typescript_scaffold(server_name, tools), encoding="utf-8")

    return GenerationSummary(
        server_name=server_name,
        language=language,
        operations_total=len(tools),
        tools_generated=len(tools),
        output_dir=str(output_dir.resolve()),
        manifest_path=str(manifest_path.resolve()),
        scaffold_path=str(scaffold_path.resolve()),
    )


def main() -> int:
    args = parse_args()
    raw = load_raw_input(args.input)
    spec = parse_openapi(raw)
    tools = extract_tools(spec)
    if not tools:
        raise CLIError("No operations discovered in OpenAPI paths.")

    summary = write_outputs(
        server_name=args.server_name,
        language=args.language,
        output_dir=Path(args.output_dir),
        tools=tools,
    )

    if args.format == "json":
        print(json.dumps(asdict(summary), indent=2))
    else:
        print("MCP scaffold generated")
        print(f"- server: {summary.server_name}")
        print(f"- language: {summary.language}")
        print(f"- tools: {summary.tools_generated}")
        print(f"- manifest: {summary.manifest_path}")
        print(f"- scaffold: {summary.scaffold_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CLIError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)

```

### scripts/mcp_validator.py

```python
#!/usr/bin/env python3
"""Validate MCP tool manifest files for common contract issues.

Input sources:
- --input <manifest.json>
- stdin JSON

Validation domains:
- structural correctness
- naming hygiene
- schema consistency
- descriptive completeness
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


TOOL_NAME_RE = re.compile(r"^[a-z0-9_]{3,64}$")


class CLIError(Exception):
    """Raised for expected CLI failures."""


@dataclass
class ValidationResult:
    errors: List[str]
    warnings: List[str]
    tool_count: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate MCP tool definitions.")
    parser.add_argument("--input", help="Path to manifest JSON file. If omitted, reads from stdin.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when errors are found.")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Output format.")
    return parser.parse_args()


def load_manifest(input_path: Optional[str]) -> Dict[str, Any]:
    if input_path:
        try:
            data = Path(input_path).read_text(encoding="utf-8")
        except Exception as exc:
            raise CLIError(f"Failed reading --input: {exc}") from exc
    else:
        if sys.stdin.isatty():
            raise CLIError("No input provided. Use --input or pipe manifest JSON via stdin.")
        data = sys.stdin.read().strip()
        if not data:
            raise CLIError("Empty stdin.")

    try:
        payload = json.loads(data)
    except json.JSONDecodeError as exc:
        raise CLIError(f"Invalid JSON input: {exc}") from exc

    if not isinstance(payload, dict):
        raise CLIError("Manifest root must be a JSON object.")
    return payload


def validate_schema(tool_name: str, schema: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    if schema.get("type") != "object":
        errors.append(f"{tool_name}: inputSchema.type must be 'object'.")

    props = schema.get("properties", {})
    if not isinstance(props, dict):
        errors.append(f"{tool_name}: inputSchema.properties must be an object.")
        props = {}

    required = schema.get("required", [])
    if not isinstance(required, list):
        errors.append(f"{tool_name}: inputSchema.required must be an array.")
        required = []

    prop_keys = set(props.keys())
    for req in required:
        if req not in prop_keys:
            errors.append(f"{tool_name}: required field '{req}' is not defined in properties.")

    if not props:
        warnings.append(f"{tool_name}: no input properties declared.")

    for pname, pdef in props.items():
        if not isinstance(pdef, dict):
            errors.append(f"{tool_name}: property '{pname}' must be an object.")
            continue
        ptype = pdef.get("type")
        if not ptype:
            warnings.append(f"{tool_name}: property '{pname}' has no explicit type.")

    return errors, warnings


def validate_manifest(payload: Dict[str, Any]) -> ValidationResult:
    errors: List[str] = []
    warnings: List[str] = []

    tools = payload.get("tools")
    if not isinstance(tools, list):
        raise CLIError("Manifest must include a 'tools' array.")

    seen_names = set()
    for idx, tool in enumerate(tools):
        if not isinstance(tool, dict):
            errors.append(f"tool[{idx}] is not an object.")
            continue

        name = str(tool.get("name", "")).strip()
        desc = str(tool.get("description", "")).strip()
        schema = tool.get("inputSchema")

        if not name:
            errors.append(f"tool[{idx}] missing name.")
            continue

        if name in seen_names:
            errors.append(f"duplicate tool name: {name}")
        seen_names.add(name)

        if not TOOL_NAME_RE.match(name):
            warnings.append(
                f"{name}: non-standard naming; prefer lowercase snake_case (3-64 chars, [a-z0-9_])."
            )

        if len(desc) < 10:
            warnings.append(f"{name}: description too short; provide actionable purpose.")

        if not isinstance(schema, dict):
            errors.append(f"{name}: missing or invalid inputSchema object.")
            continue

        schema_errors, schema_warnings = validate_schema(name, schema)
        errors.extend(schema_errors)
        warnings.extend(schema_warnings)

    return ValidationResult(errors=errors, warnings=warnings, tool_count=len(tools))


def to_text(result: ValidationResult) -> str:
    lines = [
        "MCP manifest validation",
        f"- tools: {result.tool_count}",
        f"- errors: {len(result.errors)}",
        f"- warnings: {len(result.warnings)}",
    ]
    if result.errors:
        lines.append("Errors:")
        lines.extend([f"- {item}" for item in result.errors])
    if result.warnings:
        lines.append("Warnings:")
        lines.extend([f"- {item}" for item in result.warnings])
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    payload = load_manifest(args.input)
    result = validate_manifest(payload)

    if args.format == "json":
        print(json.dumps(asdict(result), indent=2))
    else:
        print(to_text(result))

    if args.strict and result.errors:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CLIError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)

```

