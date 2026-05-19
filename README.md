# Komponentor

A lightweight JavaScript framework for building modular web applications with HTML-based components, a component tree, hash routing, and optional headless intents.

**By [Logimaxx Systems SRL](https://logimaxx.ro)** — monitoring, observability, and automation.

**Requires jQuery** (`>=1.9.0`) loaded before Komponentor.

> **Security:** Component HTML is fetched and executed in the browser (trusted code only). Do not mount URLs or markup from untrusted users. See **[docs/SECURITY.md](docs/SECURITY.md)**.

## Install

```bash
npm install komponentor jquery
```

Or use the built files from `dist/` (also on npm). Load jQuery first, then Komponentor:

```html
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="node_modules/komponentor/dist/komponentor.min.js"></script>
<script src="node_modules/komponentor/dist/ksimpleviews.min.js"></script>
```

After publishing, CDN (example):

```html
<script src="https://cdn.jsdelivr.net/npm/komponentor@1.2.0/dist/komponentor.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/komponentor@1.2.0/dist/ksimpleviews.min.js"></script>
```

## Demo

A minimal walkthrough lives in **[docs/demo/](docs/demo/)**. From the repo root:

```bash
npm install
npm run build
npm run demo
```

Open `http://localhost:3000` (serves `docs/demo/`). For local development without `serve`, run any static server from the **repository root** so `../../dist/` paths resolve.

## Documentation


| Document                                                            | Description                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **[HOW-TO-GUIDE.md](docs/HOW-TO-GUIDE.md)**                         | **Start here** — setup, mount, scan, router, intents, nested components, KModel sharing |
| **[komponentor.md](docs/komponentor.md)**                           | Komponentor API: config, mount options, Context, Komponent, Intent, hash/history router |
| **[ksimpleviews.md](docs/ksimpleviews.md)**                         | KSimpleViews: `KModel`, `KView`, templates, `getKModel`                                 |
| **[SECURITY.md](docs/SECURITY.md)**                                 | Trust model, XSS, CSP, safe component URLs and templates                                |
| **[KOMPONENTOR-AI-REFERENCE.md](docs/KOMPONENTOR-AI-REFERENCE.md)** | Canonical API reference for AI-assisted development                                     |
| **[CHANGELOG.md](CHANGELOG.md)**                                    | Version history                                                                         |
| **[RELEASE.md](RELEASE.md)**                                        | Release checklist (`npm run release`)                                                   |


**Runnable demo:** [docs/demo/](docs/demo/) (open `index.html` via `npm run demo`).

## Features

- **Components** — Load HTML by URL into a host element; optional `init_komponent(komponent, data)` script; no build step.
- **Component tree** — Parent/child hierarchy with cascade destroy.
- **Replace host** — Option `replaceHost: true` to replace the host element with the component root (host removed; `id` copied for selectors).
- **Scan** — Auto-mount components from `data-komponent="url|key=val"` markers in the DOM.
- **Router** — Hash or history mode; mount components in an outlet with route params.
- **Intents** — Temporary UI (e.g. modals): load HTML, mount into an outlet, `close()` when done; optional parent for tree lifecycle.
- **KSimpleViews** (optional) — `KModel` + `KView` for simple template binding.

## Repository layout


| Module           | Source                | Built output                                       |
| ---------------- | --------------------- | -------------------------------------------------- |
| **Komponentor**  | `src/komponentor.js`  | `dist/komponentor.js`, `dist/komponentor.min.js`   |
| **KSimpleViews** | `src/ksimpleviews.js` | `dist/ksimpleviews.js`, `dist/ksimpleviews.min.js` |


## Quick start

1. **Include jQuery, then Komponentor** (jQuery must load first):

```html
<div id="app"></div>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="path/to/komponentor.min.js"></script>
<script>
  komponentor.config.baseUrl = "/";
  komponentor.root("#app", "components/welcome.html");
</script>
```

1. **Define a component** (e.g. `components/welcome.html`):

```html
<div class="welcome">
  <h1>Hello</h1>
</div>
<script>
  function init_komponent(komponent, data) {
    komponent.find("h1").text("Hello, " + (data.name || "world"));
  }
</script>
```

1. **Use the router** (optional):

```javascript
komponentor.route({
  outlet: "#app",
  routes: {
    "#/": "components/home.html",
    "#/about": "components/about.html",
  },
  notFound: "components/404.html",
});
komponentor.navigate("#/about");
```

## API (Komponentor)


| Method                                                               | Description                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `komponentor.root(host, urlOrOpts)`                                  | Set app root (`Promise<Komponent>`).                              |
| `komponentor.mount(host, urlOrOpts)`                                 | Mount on `host` (`Promise<Komponent>`). `replaceHost` optional.   |
| `komponentor.unmount(host)`                                          | Destroy komponent on `host`.                                      |
| `komponentor.scan(container?, { parent?, replaceExisting? })`        | Mount all `[data-komponent]` in `container`.                      |
| `komponentor.route({ mode?, outlet, routes, notFound })`             | Start router (`mode`: `"hash"` or `"history"`).                   |
| `komponentor.navigate(pathOrHash, navOpts?)`                         | Navigate (hash or history path).                                  |
| `komponentor.intent(urlOrOpts).data(...).send({ parent?, outlet? })` | Temporary UI (e.g. modal); optional `parent` for tree lifecycle.  |
| `komponentor.runIntent(url, data, { parent? })`                      | Convenience wrapper for intent.                                   |


Component marker in HTML: `data-komponent="/path/to/file.html|key=value"`.

## Build

```bash
npm install
npm run build
```

Output: `dist/<name>.js` and `dist/<name>.min.js` (with source maps). Use `npm run watch` during development.

`npm publish` runs `prepublishOnly` → build automatically.

## Release

1. Note changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
2. `npm run release -- patch` (or `minor` / `major`) — bumps version, updates changelog, builds, tags.
3. `git push && git push origin <version>` then `npm publish`.

See **[RELEASE.md](RELEASE.md)** for the full checklist.

## Author & contact


|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Author**     | Sergiu Voicu                                                                               |
| **Company**    | [Logimaxx Systems SRL](https://logimaxx.ro)                                                |
| **LinkedIn**   | [linkedin.com/in/sergiu-voicu-88615010](https://www.linkedin.com/in/sergiu-voicu-88615010) |
| **Repository** | [github.com/logimaxx/komponentor.js](https://github.com/logimaxx/komponentor.js)         |


## License

MIT (see [LICENSE](LICENSE)).