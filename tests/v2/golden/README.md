# V2 Golden Task Fixtures

`catalog.json` is the immutable M0 catalog for the 50 V1 golden tasks. Every task fixes:

- a versioned fixture identifier and an exact starting prompt;
- a deterministic expectation list;
- the release gate (`hard` or `quality`);
- the evidence destination `docs/v2/evidence/golden/<platform>/<task-id>/`.

Binary fixtures, account states, payment-sandbox states, and tool sandboxes are materialized by the
milestone that first executes the task. Their fixture IDs must remain stable; incompatible changes
create a new catalog version instead of silently replacing an input.

Milestone-local implementation evidence is recorded separately from release-platform evidence. M2
account entries are under `docs/v2/evidence/golden/local-implementation/`; they do not replace the
catalog's Windows/macOS release evidence destinations or claim M4/M5 file/tool slices.

M3 Billing entries are in the same local-implementation directory and are driven by
`billing-m3.test.ts`. GT-BILLING-02 follows the later server-only pricing decision in ADR-V2-010:
the historical catalog prompt remains immutable, but the client no longer creates or submits a quote.
