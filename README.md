# Komponentor

A lightweight JavaScript framework for building modular web applications with HTML-based components, a component tree, hash routing, and optional headless intents.

**Requires jQuery** (`>=1.9.0`) loaded before Komponentor.

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
```

## Demo

A minimal walkthrough lives in **[docs/demo/](docs/demo/)**. From the repo root:

```bash
npm install
npm run build
npm run demo
```

Open `http://localhost:3000` (serves `docs/demo/`). For local development without `serve`, run any static server from the **repository root** so `../../dist/` paths resolve.

## Features

- **Components** — Load HTML by URL into a host element; optional `init_komponent(komponent, data)` script; no build step.
- **Component tree** — Parent/child hierarchy with cascade destroy.
- **Replace host** — Option `replaceHost: true` to replace the host element with the component root (host removed; `id` copied for selectors).
- **Scan** — Auto-mount components from `data-komponent="url|key=val"` markers in the DOM.
- **Hash router** — Map hash paths to components; mount in an outlet with route params.
- **Intents** — Headless flows: load HTML, run init, attach UI (e.g. modals); optional parent for tree lifecycle.
- **KSimpleViews** (optional) — `KModel` + `KView` for simple template binding.

## Repository layout

| Module | Source | Built output |
|--------|--------|--------------|
| **Komponentor** | `src/komponentor.js` | `dist/komponentor.js`, `dist/komponentor.min.js` |
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

2. **Define a component** (e.g. `components/welcome.html`):

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

3. **Use the router** (optional):

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

| Method | Description |
|--------|-------------|
| `komponentor.root(host, urlOrOpts)` | Set app root; replace previous root. |
| `komponentor.mount(host, urlOrOpts)` | Mount a component on `host`. Options include `replaceHost: true`. |
| `komponentor.scan(container?, { parent?, replaceExisting? })` | Mount all `[data-komponent]` in `container`. |
| `komponentor.route({ outlet, routes, notFound })` | Configure and start hash router. |
| `komponentor.navigate(hash)` | Set `location.hash`. |
| `komponentor.intent(urlOrOpts).data(...).send({ parent? })` | Run an intent; optional `parent` for tree lifecycle. |
| `komponentor.runIntent(url, data, { parent? })` | Convenience wrapper for intent. |

Component marker in HTML: `data-komponent="/path/to/file.html|key=value"`.

## Build

```bash
npm install
npm run build
```

Output: `dist/<name>.js` and `dist/<name>.min.js` (with source maps). Use `npm run watch` during development.

`npm publish` runs `prepublishOnly` → build automatically.

## Documentation

- **[docs/komponentor.md](docs/komponentor.md)** — API, config, mount/scan, Context, Komponent, Intent, router.
- **[docs/ksimpleviews.md](docs/ksimpleviews.md)** — KModel, KView, templates, lifecycle.
- **[docs/HOW-TO-GUIDE.md](docs/HOW-TO-GUIDE.md)** — Practical guide: setup, router, intents, nested components.

## Author

**Sergiu Voicu** · [Logimaxx Systems SRL](https://logimaxx.ro)

## License

MIT (see [LICENSE](LICENSE)).
