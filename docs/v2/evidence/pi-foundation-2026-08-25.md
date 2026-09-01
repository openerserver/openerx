# Pi Foundation evidence

> Status: `PASS`
>
> Checkpoint date: 2026-08-25 (Asia/Shanghai)
>
> Scope: Pi-owned harness foundation, desktop process integration, chat regression and production package boundary

## Architecture result

- `@earendil-works/pi-coding-agent@0.84.3` is the sole production agent harness.
- `packages/pi-host` composes Pi `AgentSession`, `SessionManager`, `DefaultResourceLoader` and `ModelRuntime` directly.
- Pi owns the agent loop, model turns, context, compaction, internal retry and tool-call lifecycle.
- UWA owns the isolated Pi Host process, product history, event projection and capability/permission boundary.
- The generic Runtime SDK, `RuntimeAdapter`, Runtime Host and production fake harness were removed.
- Deterministic answers use Pi's faux Model Provider only in test files and the development-only E2E host.
- Production has no local credential or canned-model fallback. Until M2 supplies the Platform Model Gateway Provider, a prompt terminates with `PI_MODEL_NOT_CONFIGURED`.

The normative boundary is [ADR-V2-007](../adr/007-pi-harness-boundary.md).

## Production request path

```text
React Renderer
  -> typed Preload Bridge
  -> Electron Main
  -> supervised App Service utility process
  -> private Pi Host MessagePort
  -> Pi AgentSession
  -> Pi native events
  -> persisted product-event projection
```

## Reproducible checks

Run from the repository root:

```bash
npm run check:v2
npm run test:e2e:v2
npm run audit:prod:v2
node_modules/.bin/asar list apps/desktop/out/UWA-darwin-arm64/UWA.app/Contents/Resources/app.asar | rg 'pi-host|runtime-host|runtime-sdk|faux'
git diff --check
```

Observed results:

- boundary checker passed across 47 source files;
- Biome passed across 71 checked files;
- all six implemented workspaces passed strict TypeScript checks;
- Vitest passed 34 tests, including a real Pi `AgentSession` driven by Pi's test Model Provider and the production no-model failure gate;
- Electron E2E passed `new-stream-context-stop-crash-branch-restart-markdown-search`;
- the current macOS arm64 package was rebuilt and Electron fuse checks passed for the available macOS arm64/x64 and Windows x64 packages;
- production dependency audit reported 0 vulnerabilities;
- the current macOS arm64 ASAR matched only production `pi-host` files and contained no test host, faux Provider, Runtime Host or Runtime SDK;
- `git diff --check` passed.

## M2 boundary

M2 adds account/sync, the Platform Model Gateway as a Pi-native Provider/`ModelRuntime`, and authoritative usage records. It does not add another harness, model adapter layer or execution loop.
