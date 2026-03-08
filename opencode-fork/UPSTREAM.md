# Upstream Version Management

## Locked Baseline

- **OpenCode Version**: v1.2.21
- **Lock Date**: 2026-03-08
- **SDK Package**: @opencode-ai/sdk

## Upgrade Policy

1. **Monthly evaluation**: Check upstream CHANGELOG on the 1st of each month.
2. **Compatibility check**: Run enterprise plugin test suite against new version.
3. **Breaking changes**: Document in this file with migration notes.
4. **Rollback window**: 72 hours after upgrade, instant rollback via deployment script.

## Upgrade Checklist

- [ ] Read upstream CHANGELOG for breaking changes
- [ ] Run plugin compatibility tests
- [ ] Verify REST API contract unchanged (OpenAPI diff)
- [ ] Verify SSE event types unchanged
- [ ] Verify SDK client methods unchanged
- [ ] Test all 9 enterprise agents
- [ ] Test Hashline edit mechanism
- [ ] Test Task Graph persistence
- [ ] Update this file with new version

## Version History

| Date | Version | Notes |
|------|---------|-------|
| 2026-03-08 | v1.2.21 | Initial baseline |
