# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]


## [1.3.0] - 2026-05-19

### Added

- **docs/SECURITY.md** — trust model, XSS, CSP, safe URLs and templates.
- **`npm run release`** — `scripts/release.mjs` bumps version, finalizes changelog, builds, tags.

### Changed

- **KOMPONENTOR-AI-REFERENCE.md** — aligned with current API (`find` → jQuery, removed `findAll`, `unmount`, history router, mount options).
- README and demo footer: Logimaxx Systems and author LinkedIn links.
- README, HOW-TO-GUIDE, komponentor.md, ksimpleviews.md, and AI reference link to security documentation.
- **RELEASE.md** — simplified one-command release flow.
- **Removed mount option `replace`** — mounting always destroys an existing komponent on the same host. Use **`replaceHost`** only when the host DOM node should be swapped for the component root (not to be confused with `navigate(..., { replace: true })` for history).

## [1.2.0] - 2026-05-17

First npm release. Earlier git tags `1.0.0` and `1.1.0` were informal milestones and do not match packages published to npm.

### Added

- **Komponentor** (`komponentor.js`) — mount HTML components by URL, component tree, `data-komponent` scan, hash router, intents.
- **KSimpleViews** (`ksimpleviews.js`) — `KModel` / `KView` with Handlebars or built-in `{{key}}` templates.
- Build pipeline (esbuild): dev + minified bundles with source maps in `dist/`.
- Documentation: API reference, how-to guide, mini demo in `docs/demo/`.
- Release metadata: `CHANGELOG.md`, `RELEASE.md`, npm `files` / `peerDependencies`.

### Changed

- Replaced legacy `docs/examples/` with `docs/demo/`.
- Updated `README.md` install instructions and demo workflow.

[1.2.0]: https://github.com/vsergione/komponentor.js/releases/tag/1.2.0

[1.3.0]: https://github.com/vsergione/komponentor.js/releases/tag/1.3.0
