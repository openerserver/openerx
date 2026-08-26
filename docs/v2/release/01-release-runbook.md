# OpenerX V1 release and rollback runbook

> Local automation status: `READY`
>
> Production release status: `BLOCKED_PENDING_EXTERNAL_EVIDENCE_AND_USER_APPROVAL`

## 1. Roles and authority

| Role | Responsibility | May approve stable release |
| --- | --- | --- |
| Release operator | Freeze commit, run workflows, collect hashes and logs | No |
| Security/privacy/commerce reviewers | Sign their review sections | No |
| Platform owners | Verify Windows, macOS, iOS, Android and push evidence | No |
| User/product owner | Give explicit final release approval after all gates | Yes |

No one may bypass `production-release` environment protection or manually change the machine-readable
ledger to simulate missing evidence.

## 2. Candidate preparation

1. Start from a clean, reviewed commit and record its full SHA.
2. Replace `2.0.0-alpha.0` with the intended release version in root, desktop and mobile application
   metadata; increment iOS/Android build numbers through EAS.
3. Complete every item in `02-security-privacy-commerce-checklist.md` and every external evidence group
   in `tests/v2/golden/m9-gate-status.json`.
4. Record explicit user approval, then change the ledger only to match evidence already stored.
5. Run `npm ci`, `npm run check:v2`, `npm run test:e2e:v2` and `npm run audit:prod:v2` on the frozen SHA.
6. Dispatch `V2 signed release candidate` first with `preview`; this requires protected-environment
   approval but only the local foundation gate. Stable remains blocked until the publish gate reports
   `PUBLISH OK`.

## 3. Desktop build and verification

The protected workflow builds Windows x64, macOS arm64 and macOS x64 separately. It materializes
short-lived credentials only inside the runner, then executes Forge `make` and these checks:

```bash
npm run verify:fuses --workspace @openerx/desktop
npm run verify:release-artifacts --workspace @openerx/desktop
npm run verify:native-signature --workspace @openerx/desktop
```

Required evidence per target:

- immutable artifact name, SHA-256, byte size, commit and workflow run;
- Windows Authenticode status `Valid`, or macOS Developer ID identity plus valid stapled notarization;
- clean install, application launch, sign-in, one server-billed model request and uninstall;
- upgrade from the previous stable version without Conversation, file, Artifact, credential or ledger
  projection loss;
- interrupted download/restart recovery and last-known-good roll-forward drill.

Generate an unsigned manifest inventory from `release-manifest.example.json`, fill exact artifact facts,
then sign it only in the protected environment:

```bash
OPENERX_UPDATE_MANIFEST_PRIVATE_KEY_BASE64=... npm run release:manifest:v2 -- sign \
  docs/v2/release/release-manifest.example.json signed-release-manifest.json
OPENERX_UPDATE_KEY_ID=openerx-release-2026-01 \
OPENERX_UPDATE_PUBLIC_KEY_BASE64=... npm run release:manifest:v2 -- verify \
  signed-release-manifest.json
```

Publish artifacts before the manifest. Publish the signed manifest last and retain both it and the
previous stable manifest immutably.

## 4. Mobile build and verification

1. Configure EAS project ID, remote iOS/Android credentials, APNs and FCM production credentials.
2. Run the protected workflow with `preview`; install both builds on physical devices and execute the
   Remote matrix against Windows and both macOS architectures.
3. Confirm store privacy answers exactly match the committed privacy manifest and actual server logs.
4. Confirm push payloads contain no Prompt, file content, terminal output or credential material.
5. Validate channel/runtime compatibility, offline launch, update, revoked-device behavior and emergency
   withdrawal before promoting the same reviewed source to production store tracks.

## 5. Promotion sequence

1. Preview desktop cohort and internal mobile distribution.
2. Verify telemetry/diagnostics contain no personal content and compare Provider usage to server Charge.
3. Stable desktop rollout: 1% → 10% → 50% → 100%, with a recorded observation window at every step.
4. Mobile staged store rollout follows platform controls; production EAS updates use the production
   channel and the same application runtime version.
5. Record final URLs, hashes, store version IDs, rollout percentages and operator/reviewer approvals.

## 6. Stop and rollback

Stop promotion immediately for signature/notarization failure, data loss, cross-account exposure,
duplicate Charge, credential exposure, Remote duplicate execution, severe crash or approval bypass.

1. Set the affected desktop manifest rollout to `0`, preserve the bad manifest for audit and stop new
   store rollout/update publication.
2. Revoke affected remote sessions or manifest key when compromise is suspected; do not delete ledgers,
   UsageRecords, ChargeRecords or diagnostic audit history.
3. Rebuild the last known-good source as a higher patch version, sign it normally and repeat preview
   verification. Do not weaken version checks or distribute unsigned downgrades.
4. If startup is impossible, provide the retained previous signed installer as supervised recovery and
   preserve the user profile directory. Verify schema compatibility before launch.
5. For iOS/Android, halt staged rollout, withdraw the update/build using store controls and publish a
   compatible higher build/runtime when required.
6. Attach incident timeline, affected versions/cohorts, data-integrity checks and final resolution to the
   release evidence. Reopening rollout requires fresh approval.

## 7. Data invariants during upgrade or rollback

- Never rewrite or truncate server Usage, Charge, ledger, payment or statement records.
- Never derive price, Token usage or final cost on a client; clients only reload final Billing state.
- Preserve Conversation/Message truth independently from Pi Session files.
- Preserve account/device boundaries, outbox operations, tombstones and cloud-object checksums.
- Schema migration must be forward compatible with the retained previous stable package or explicitly
  declare manual recovery before publication.
