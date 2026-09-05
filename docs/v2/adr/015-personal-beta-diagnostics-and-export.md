# ADR-V2-015: Personal Beta diagnostics, performance and data export

- Status: Accepted and M8 local slice implemented
- Date: 2026-08-26

## Context

Personal Beta needs actionable startup, recovery and runtime evidence without turning support bundles
into a second copy of user conversations. It also needs a user-owned data export, while Token, quote,
price, charge, balance and statement truth remains server-owned.

## Decision

1. `packages/observability` owns bounded structured lifecycle logs, diagnostic redaction, provisional
   local performance budgets and local profile export.
2. Diagnostics use an allowlist of lifecycle events. Sensitive keys, credential patterns and absolute
   local paths are redacted before persistence. Prompt, answer, Message content, file bytes, Diff,
   terminal output and screenshots are excluded by design.
3. Renderer receives only typed preview counts, include/exclude labels, budget results and save results.
   Electron Main owns profile resolution, native save dialogs and writes.
4. Diagnostics and personal data are separate exports. A personal data ZIP contains Conversation,
   Message, parsed file content and available controlled file/Artifact object bytes because the user
   explicitly requested it; the same content cannot be copied into diagnostics.
5. Token, quote, price, UsageRecord, ChargeRecord, balance, ledger and statement are not reconstructed or
   exported from local storage. The client continues to display the final server billing snapshot.
6. The M8 local budgets are 5,000 ms to desktop interactive, 5,000 ms to App Service ready and 512 MiB
   current Main-process RSS. They are provisional local guardrails, not approved V1 benchmark budgets.
7. Local deterministic Golden evidence is tracked separately from native platform, real-provider,
   payment, Remote device and 5–20 target-user evidence. A local pass cannot promote an external gate.

## Consequences

- Support can inspect exactly what will be exported before a file is created.
- A diagnostic leak test can assert that known Prompt, credential and profile-path canaries are absent.
- Personal data export remains useful without moving financial truth into the client.
- M9 must replace provisional budgets with approved benchmark-machine budgets and collect signed native
  package, long-session memory and real-user evidence.
