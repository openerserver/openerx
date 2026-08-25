# ADR-V2-003: React routing, asynchronous state and UI foundation

- Status: Accepted
- Date: 2026-08-25
- Owners: Desktop Foundation

## Decision

1. Use React 19 with TypeScript strict mode and React Router 7 `HashRouter`. Hash routing keeps
   navigation deterministic when the packaged Renderer is served from the privileged `openerx://`
   application protocol.
2. Renderer state is split by ownership:
   - component-local interaction state uses React state/reducer;
   - URL-addressable navigation uses the router;
   - persisted business state belongs to App Service and is consumed through typed query/command
     hooks;
   - streaming events are applied to an external-store adapter with monotonic sequence checks.
3. TanStack Query is the selected cache for App Service queries when the first asynchronous screen
   lands in M1. It is not a second source of truth and all mutations still go through commands.
4. Shared UI starts with CSS custom-property tokens and accessible React primitives in
   `packages/ui-react`. No full visual component framework is adopted in M0.
5. Keyboard access, visible focus, reduced-motion support, semantic landmarks and WCAG AA contrast
   are release requirements. The M0 shell establishes these patterns.

## Consequences

- Refresh/deep-link behavior works identically in dev server and packaged app.
- Pi Session state cannot silently become conversation history in Renderer memory.
- A larger UI system can be added only after its bundle, accessibility and design-token impact are
  measured against this boundary.
