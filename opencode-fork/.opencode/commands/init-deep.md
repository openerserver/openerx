---
description: "Deep exploration and analysis of a topic, codebase area, or architecture decision"
---

# /init-deep — Deep Dive Analysis

## Trigger
User types `/init-deep <topic or question>` in the chat.

## Behavior

### Phase 1 — Context Gathering
1. Call `classify_intent` — expected: `explore` category
2. Use **librarian-enterprise** to gather relevant code and documentation:
   - `lsp_references` for key symbols
   - `code_map` for structural overview
   - `context_get_rules` for applicable rules
3. Use **explore-enterprise** for quick surface scan

### Phase 2 — Deep Analysis
1. Dispatch to **oracle-enterprise** with full gathered context
2. Oracle produces a structured analysis report:
   - **Evidence**: Code snippets, metrics, patterns found
   - **Findings**: Themes, issues, opportunities
   - **Risk Score**: 1-10 severity rating
   - **Action Items**: Prioritized recommendations

### Phase 3 — Architecture Review (if applicable)
If the topic involves architecture:
1. Identify affected components and their boundaries
2. Map data flows and dependencies
3. Evaluate coupling, cohesion, and scalability
4. Compare against SOLID and 12-factor principles

### Phase 4 — Output
Generate a comprehensive report with:
- Executive summary (3-5 sentences)
- Detailed findings with evidence
- Dependency diagram (text-based)
- Risk assessment with mitigation strategies
- Recommended action plan with priority ordering

## Tools Used
- `classify_intent`
- `code_map`, `lsp_references`, `lsp_diagnostics`
- `context_get_rules`
- `create_sub_session`, `dispatch_to_agent`

## Example
```
User: /init-deep How does the payment processing pipeline handle failures and retries?
```
