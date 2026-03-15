---
name: web-search-exa
description: Neural web search, content extraction, company and people research, code search, and deep research via Exa MCP server
source: https://clawhub.ai/theishangoswami/web-search-exa
downloads: 19.4k
stars: 19
license: MIT-0
security: VirusTotal Benign, OpenClaw Benign (MEDIUM CONFIDENCE)
version: v2.0.0
---

# Exa — Neural Web Search & Research

Exa is a neural search engine. Unlike keyword-based search, it understands
meaning — you describe the page you're looking for and it finds it. Returns clean,
LLM-ready content with no scraping needed.

- MCP server: `https://mcp.exa.ai/mcp`
- Free tier: generous rate limits, no key needed for basic tools
- API key: dashboard.exa.ai/api-keys — unlocks higher limits + all tools

## Setup

```json
{
  "mcpServers": {
    "exa": {
      "url": "https://mcp.exa.ai/mcp"
    }
  }
}
```

To unlock all tools: `https://mcp.exa.ai/mcp?exaApiKey=YOUR_EXA_KEY`

## Tool Reference

### Default tools (available without API key)

| Tool | Purpose |
|------|---------|
| web_search_exa | General-purpose web search — clean content, fast |
| get_code_context_exa | Code examples + docs from GitHub, Stack Overflow, official docs |
| company_research_exa | Company overview, news, funding, competitors |

### Optional tools (need API key)

| Tool | Purpose |
|------|---------|
| web_search_advanced_exa | Full-control search: domain filters, date ranges, categories |
| crawling_exa | Extract full page content from a known URL |
| people_search_exa | Find LinkedIn profiles, professional backgrounds |
| deep_researcher_start | Kick off async multi-step research agent |
| deep_researcher_check | Poll/retrieve results from deep research |
| deep_search_exa | Single-call deep search with synthesized answer + citations |

## web_search_exa

Fast general search. Describe what you're looking for in natural language.

Parameters:
- `query` (string, required)
- `numResults` (int) — default 10
- `type` — `auto`, `fast`, `deep`
- `livecrawl` — `fallback` (default) or `preferred`

```json
{ "query": "blog posts about using vector databases for recommendation systems", "numResults": 8 }
```

## web_search_advanced_exa

Extra parameters: `includeDomains`, `excludeDomains`, `category`, `startPublishedDate`, `endPublishedDate`, `maxAgeHours`, `contents.highlights`, `contents.text`, `contents.summary`

Categories: `company`, `people`, `research paper`, `news`, `tweet`, `personal site`, `financial report`

## When to Reach for Which Tool

| Need | Tool |
|------|------|
| Quick web lookup | web_search_exa |
| Research papers | web_search_advanced_exa + category: "research paper" |
| Company intel | company_research_exa |
| Find people/experts | people_search_exa |
| Code examples | get_code_context_exa |
| Read a specific URL | crawling_exa |
| Recent news/tweets | Advanced + category: "news" + maxAgeHours |
| Detailed research report | deep_researcher_start → deep_researcher_check |
| Quick answer with citations | deep_search_exa |

## Query Craft

Exa is neural — write queries like you'd describe the ideal page to a colleague.

- Do: "blog post about using embeddings for product recommendations at scale"
- Don't: "embeddings product recommendations"
- Use `category` when you know the content type
- For broader coverage, run 2-3 query variations in parallel and deduplicate
- For agentic workflows, use `highlights` instead of full `text` — 10x more token-efficient

## Token Efficiency

| Mode | Best For |
|------|----------|
| highlights | Agent workflows, factual lookups — most token-efficient |
| text | Deep analysis, full page context |
| summary | Quick overviews, structured extraction with JSON schema |
