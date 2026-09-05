# Third-party notices

OpenERX's Apache-2.0 license covers original project code, not all dependencies.

The complete pinned npm dependency inventory, including development/build and optional platform packages, is in [third-party/notices.json](third-party/notices.json). It records versions, SPDX declarations, package archive URLs and integrity, upstream sources, and hashes of retained license/notice texts. [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) is the readable distribution copy. Including development packages intentionally over-approximates the desktop bundle.

Run `npm ci` then `npm run notices:update` after dependency changes. The generator reads distributed legal files and, when absent, retrieves license text from the package's published upstream Git commit or version tag. Optional native packages may use the legal files from their exact-version wrapper. Where publishers omit release-specific legal files, the inventory explicitly marks retained upstream-license or declared-SPDX evidence as **review-required**, with provenance and available author metadata. Standard SPDX terms do not invent missing copyright ownership. Review these exceptions and publication rights before distributing binaries.

Generation fails if no text can be collected; `npm run notices:check` verifies inventory/text consistency against the complete lockfile without network access, not legal clearance. Review new license expressions, original attribution and upstream notices before merging. This inventory is not a legal opinion.

## Distribution

The desktop packager includes the project LICENSE, NOTICE, this guide and the full third-party text under `app.asar/legal/`. Keep Electron's own `LICENSE` and `LICENSES.chromium.html` in the application distribution: they contain the runtime's separate Chromium and other bundled component notices and must not be overwritten with the project license.

`@resvg/resvg-js` and its native libraries use MPL-2.0, not Apache-2.0. The exact version and source package are recorded in the inventory; corresponding source is available from [resvg-js](https://github.com/yisibl/resvg-js) and its version tags. Preserve MPL notices and source availability when distributing binaries; modifications to covered files require the corresponding source under MPL. Other dependencies, including tooling, retain their recorded licenses. See the [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

Remote model APIs, externally installed sandboxes, user-installed Skills/MCP packages and enterprise assets are not distributed by this repository and have separate terms. This inventory does not grant rights to them or to third-party trademarks.
