# ADR-V2-002: Electron build, packaging, signing and update

- Status: Accepted
- Date: 2026-08-25
- Owners: Desktop Foundation and Observability & Release

## Decision

1. Pin Electron `44.0.0`, Electron Forge `7.11.2`, Vite `6.4.3`, React `19.2.8` and all build
   plugins exactly in `apps/desktop/package.json`.
2. Forge owns development, packaging and makers. Its Vite plugin builds separate Main, Preload and
   Renderer targets; Main and Preload have fixed `main.js` and `preload.js` output names.
3. Release targets are Windows x64 Squirrel and macOS arm64/x64 DMG plus ZIP. CI packages all three
   architectures; it does not publish.
4. M0 packages are explicitly unsigned development artifacts. Beta/production release is blocked
   until Windows signing and macOS Developer ID signing/notarization credentials are configured.
5. Update checks run only in Electron Main. Each platform, architecture and release channel has a
   signed manifest. Renderer receives typed status events but never a feed URL or signing secret.
6. Publishing and automatic update activation are deferred to M9, but release metadata and rollback
   must preserve an installable previous signed version.
7. The Forge Vite plugin is documented as experimental, so exact pins and a package smoke test are
   mandatory on every dependency update. Vite stays on the latest compatible 6.x baseline because
   Forge 7.11.2 still emits a bundler option deprecated by newer Vite; upgrading requires the
   warning-free three-target package matrix.

Electron's [release schedule](https://releases.electronjs.org/schedule) and Forge's
[Vite plugin reference](https://js.electronforge.io/modules/_electron_forge_plugin_vite.html) are the
upstream version and compatibility sources.

## Consequences

- The three supported artifacts have one configuration and deterministic entry points.
- Build dependency upgrades require a dedicated change with all three package jobs passing.
- Unsigned M0 output proves packaging only and must not be presented as a distributable release.
