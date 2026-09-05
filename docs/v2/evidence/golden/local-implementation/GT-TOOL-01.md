# GT-TOOL-01 local implementation

- Fixture: `tool.web-recency.v1`.
- Proof: first-party Web search requires the account access token, preserves source URL, publication and retrieval timestamps, and projects the search activity through Pi.
- Automated gate: `packages/tool-sdk/tests/broker.test.ts` and `tests/v2/golden/tools-m5.test.ts`.
- Result: PASS for the M5 local checkpoint; live-source relevance remains a release-environment gate.
