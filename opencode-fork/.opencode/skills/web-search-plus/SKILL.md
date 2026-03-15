---
name: web-search-plus
description: Unified search skill with Intelligent Auto-Routing across 7 providers
source: https://clawhub.ai/robbyczgw-cla/web-search-plus
downloads: 13.6k
stars: 65
license: MIT-0
security: VirusTotal Benign, OpenClaw Benign (HIGH CONFIDENCE)
version: v2.9.0
runtime: python3, bash
---

# Web Search Plus

Stop choosing search providers. Let the skill do it for you.

Connects to 7 search providers (Serper, Tavily, Querit, Exa, Perplexity, You.com, SearXNG)
and automatically picks the best one for each query.

## Quick Start

```bash
# Interactive setup (recommended for first run)
python3 scripts/setup.py

# Or manual: copy config and add your keys
cp config.example.json config.json
```

## API Keys

You only need ONE key to get started.

| Provider | Free Tier | Best For | Site |
|----------|-----------|----------|------|
| Serper | 2,500/mo | Shopping, prices, local, news | serper.dev |
| Tavily | 1,000/mo | Research, explanations, academic | tavily.com |
| Querit | Varies | Multilingual AI search, international | querit.ai |
| Exa | 1,000/mo | "Similar to X", startups, papers | exa.ai |
| Perplexity | Via Kilo | Direct answers with citations | kilo.ai |
| You.com | Limited | Real-time info, AI/RAG context | api.you.com |
| SearXNG | FREE | Privacy, multi-source, $0 cost | Self-hosted |

## Auto-Routing

The skill analyzes your query and picks the best provider:

```
"iPhone 16 price"                 → Serper (shopping keywords)
"how does quantum computing work" → Tavily (research question)
"latest AI policy updates in DE"  → Querit (multilingual + recency)
"companies like stripe.com"       → Exa (URL detected, similarity)
"events in Graz this weekend"     → Perplexity (local + direct answer)
"latest news on AI"               → You.com (real-time intent)
"search privately"                → SearXNG (privacy keywords)
```

Override: `python3 scripts/search.py -p tavily -q "your query"`
Debug routing: `python3 scripts/search.py --explain-routing -q "your query"`

## Usage Examples

```bash
# Let auto-routing choose
python3 scripts/search.py -q "Tesla Model 3 price"
python3 scripts/search.py -q "explain machine learning"

# Force specific provider
python3 scripts/search.py -p serper -q "weather Berlin"
python3 scripts/search.py -p tavily -q "quantum computing" --depth advanced
python3 scripts/search.py -p exa --similar-url "https://stripe.com" --category company
```

## Output Format

```json
{
  "provider": "serper",
  "query": "iPhone 16 price",
  "results": [{"title": "...", "url": "...", "snippet": "...", "score": 0.95}],
  "routing": {
    "auto_routed": true,
    "provider": "serper",
    "confidence": 0.78,
    "confidence_level": "high"
  }
}
```

## Automatic Fallback

If one provider fails (rate limit, timeout, error), the skill automatically
tries the next provider. `routing.fallback_used: true` in the response when this happens.

## Security

SearXNG SSRF Protection:
- Enforces `http`/`https` schemes only
- Blocks cloud metadata endpoints (169.254.169.254, metadata.google.internal)
- Resolves hostnames and blocks private/internal IPs
- Operators self-hosting on private networks can set `SEARXNG_ALLOW_PRIVATE=1`
