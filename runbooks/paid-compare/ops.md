# Runbook — Paid Parallel Compare

Purpose
- Operational steps for handling DLQ, payment compensations, key rotation incidents, and emergency rollback.

DLQ handling
1. Inspect DLQ messages for operation_id and shard_id.
2. Query operation_record and logs to understand failure reason.
3. If transient fix available, requeue message to worker queue with caution and increased logging.
4. If permanent failure, mark operation `partial_failed` and trigger payment void if authorization is present.
5. Append audit entry describing manual action.

Payment compensation
1. For operations with `auth` but not `capture`, call Payment Service `void` with `payment_operation_id`.
2. If gateway reports mismatch or failure, escalate to Payments team with full audit log and request reconciliation.
3. Record compensation in audit store and notify Product/Security as needed.

Key compromise / rotation
1. On suspected compromise, rotate keys in KMS and rotate service tokens.
2. Revoke affected service accounts and issue short-lived emergency creds.
3. Follow forensic checklist: snapshot logs, save audit trail, notify security.

Emergency rollback
1. If systemic issue causing incorrect captures, temporarily disable capture path via feature flag and run compensations for recent window.
2. Notify stakeholders and follow post-mortem process.

Contacts & Escalation
- Payments team: payments@example.com
- SRE on-call: oncall-sre@example.com
- Security team: secops@example.com
