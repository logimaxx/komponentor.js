# Release checklist

Use this before tagging and publishing **komponentor** on npm/GitHub.

## 1. Version and changelog

- [ ] Bump `version` in `package.json` (semver).
- [ ] Add a dated section under `CHANGELOG.md` with changes.
- [ ] Run `npm run build` and commit updated `dist/` if anything changed in `src/`.

## 2. Quality

- [ ] `npm run build` completes without errors.
- [ ] Open the demo: `npm run demo` → http://localhost:3000 — click through routes, intent, theme color.
- [ ] `npm pack --dry-run` — confirm only `dist/`, `LICENSE`, `README.md` are included.

## 3. Git

- [ ] `git status` clean (or only intended release files).
- [ ] Commit: `git commit -m "Release 1.2.0"`.
- [ ] Tag: `git tag -a 1.2.0 -m "1.2.0"` (same style as existing `1.0.0`, `1.1.0` tags).
- [ ] Push: `git push && git push origin 1.2.0`.

## 4. npm

- [ ] Logged in: `npm whoami`.
- [ ] First publish: `npm publish`.
- [ ] Verify on https://www.npmjs.com/package/komponentor

## 5. GitHub

- [ ] Create a [GitHub Release](https://github.com/vsergione/komponentor.js/releases) from tag `1.2.0`; paste the `CHANGELOG` section for 1.2.0.

## Notes

- **jQuery** is a `peerDependency` — consumers must load jQuery before Komponentor.
- Published package contains **built** `dist/` only (not `src/` or `docs/`).
- Demo and full docs stay in the git repo under `docs/`.
- Git tags `1.0.0` / `1.1.0` are historical; **1.2.0** is the first npm release.
