# Release

## One command

1. Edit **[CHANGELOG.md](CHANGELOG.md)** under `## [Unreleased]` (what changed).
2. Commit those changes on `main`.
3. Run:

```bash
npm run release -- patch
```

Use `patch`, `minor`, or `major` (semver).

The script will:

- Move `[Unreleased]` → `[x.y.z] - date` in the changelog
- Bump `package.json`
- Run `npm run build` (updates `dist/` banners)
- Create git commit `Release x.y.z` and tag `x.y.z`

Then publish:

```bash
git push && git push origin x.y.z
npm publish
```

Optional: [GitHub Release](https://github.com/vsergione/komponentor.js/releases/new) — paste the new changelog section.

## Other commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Build `dist/` |
| `npm run demo` | Serve `docs/demo/` on port 3000 |
| `npm pack --dry-run` | Preview npm package contents |

## Notes

- Git tags use **`1.2.0`** (no `v` prefix) — see `.npmrc`.
- `npm publish` runs `prepublishOnly` → build again before upload.
- Only `dist/`, `LICENSE`, and `README.md` are published to npm.
