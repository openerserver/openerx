Verification Matrix — Paid Parallel Compare

Test categories
- Unit tests: logic for idempotency, operation state transitions, payment request formation.
- Integration tests: end-to-end flow with mock payment gateway and worker simulation.
- Load tests: simulate target throughput and observe latency, DLQ rate, and payment timeouts.
- Security tests: static analysis, dependency scanning, KMS access tests, auth tests.
- Chaos tests: inject worker failures, network partitions, KMS delays.

Key test cases
1. Idempotency: same `idempotency_key` submitted 10x -> only 1 authorize and 1 capture executed; subsequent calls return cached response.
2. Retry/backoff: worker transient failure -> automatic retry with exponential backoff; success within max_attempts processed normally.
3. DLQ behavior: worker throws permanent error -> message moved to DLQ; operation marked `partial_failed`; auth void triggered.
4. Payment flow correctness: authorize succeeds, compare verified, capture succeeds; if compare fails, void called.
5. Payment double-capture prevention: simulate duplicate capture requests -> payment service dedup prevents duplicate capture.
6. KMS rotation: rotate keys in staging -> services re-fetch secrets and continue without failure.
7. Rate limiting: exceed per-account rate limit -> API returns 429 with Retry-After header.

CI pipeline suggestions
- Step 1: run unit tests
- Step 2: run integration tests with mocked payment gateway
- Step 3: run idempotency regression tests (scripted)
- Step 4: run load test suite nightly against a staging cluster
- Step 5: run security scans and static analysis

Acceptance criteria
- All unit/integration tests pass
- No duplicate captures observed in integration tests
- DLQ processing path exercised with alerts triggered
- KMS rotation test passes
- Performance within SLOs for target throughput (TBD)
