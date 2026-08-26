# V1 security, privacy, commerce and retention release checklist

> Template status: `READY`
>
> Review status: `PENDING_EXTERNAL`

Every row needs an evidence link, reviewer identity and review time. `Local complete` means an automated
control exists; it does not replace legal, merchant, store or native-device approval.

| Area | Required release evidence | Local control | Release status |
| --- | --- | --- | --- |
| Desktop trust | Authenticode; Developer ID; notarization ticket; exact hashes | Protected signing workflow and native verifier | Pending external |
| Update trust | HTTPS, Ed25519 manifest, native signature, channel/arch/version/rollout | Manifest package and negative tests | Local complete; live source pending |
| Supply chain | Lockfile audit, only Pi harness, no Legacy/test providers/second queue | Boundary, production audit and release-graph checks | Local complete; review pending |
| Secrets | No credentials in source, artifacts, diagnostics or Renderer | `.gitignore`, artifact scan, typed Main-only config | Local complete; secret-store review pending |
| Account/privacy | Cross-account isolation, deletion/export semantics, privacy notice | M2/M8 tests and separate exports | Pending external review |
| Apple privacy | Collected-data and required-reason API declarations match behavior | Committed Expo privacy manifest | Store validation pending |
| Android data safety | Store declaration matches account, device, content and diagnostics flow | Runbook inventory | Store validation pending |
| Remote security | E2EE, expiry, signature, replay protection, revoke and push minimization | M6 protocol tests | Native/push matrix pending |
| Model data | Provider list, retention/training terms, deletion and incident contacts | Server-only provider boundary | Contract review pending |
| Token and billing | Provider Usage → server Quote/Reservation/Charge; client read-only | M3 and DeepSeek server tests | Invoice reconciliation pending |
| Payments | Alipay/WeChat merchant identity, callback keys, refund and reconciliation | Signed webhook/idempotency tests | Production merchant review pending |
| Tax/receipts | Seller entity, currency, tax treatment, invoices/receipts and refund terms | Integer CNY ledger/statement model | Finance/legal review pending |
| Retention | Retention periods for account data, objects, diagnostics, payments and backups | Export/delete and bounded diagnostics | Policy approval pending |
| Incident response | Key/session revocation, rollout stop, notification and evidence preservation | Rollback runbook | Drill pending |
| Accessibility/support | Keyboard, screen reader, contrast, support and recovery instructions | UI automated coverage | Native review pending |

## Required sign-off record

```text
release_version:
commit_sha:
candidate_workflow_url:
security_reviewer / reviewed_at / evidence:
privacy_reviewer / reviewed_at / evidence:
commerce_tax_reviewer / reviewed_at / evidence:
platform_reviewer / reviewed_at / evidence:
rollback_drill_owner / completed_at / evidence:
explicit_user_approval / approved_at / evidence:
```

Empty fields mean blocked. Do not use a release workflow run itself as approval evidence.
