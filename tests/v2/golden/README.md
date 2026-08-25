# V2 Golden Task Fixtures

`catalog.json` is the immutable M0 catalog for the 50 V1 golden tasks. Every task fixes:

- a versioned fixture identifier and an exact starting prompt;
- a deterministic expectation list;
- the release gate (`hard` or `quality`);
- the evidence destination `docs/v2/evidence/golden/<platform>/<task-id>/`.

Binary fixtures, account states, payment-sandbox states, and tool sandboxes are materialized by the
milestone that first executes the task. Their fixture IDs must remain stable; incompatible changes
create a new catalog version instead of silently replacing an input.
