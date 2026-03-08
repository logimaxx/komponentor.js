# Komponentor

Komponentor is an internal JavaScript runtime for loading HTML components by URL, managing a tree of components (lifecycle, destroy cascade), temporary UI (Intents: modals, dialogs), and optional hash-based routing.

**File:** `src/komponentor.js`  
**Dependencies:** jQuery (required).

**For AI-assisted development and full API details**, use **[KOMPONENTOR-REFERENCE.md](./KOMPONENTOR-REFERENCE.md)** as the canonical reference.

---

## Public API

| Method | Description |
|--------|-------------|
| `komponentor.root(host, urlOrOpts)` | Set the app root: mount component at `host`, destroy any existing root. Returns the root Komponent instance. |
| `komponentor.mount(host, urlOrOpts)` | Mount a component at `host`. Returns the Komponent instance (mount runs async). |
| `komponentor.scan(container?, { parent?, replaceExisting? })` | Scan `container` (default `document.body`) for `data-komponent` markers and mount components. |
| `komponentor.route({ outlet, routes, notFound })` | Configure and start the hash router. |
| `komponentor.navigate(hash)` | Set `location.hash` (triggers route handler). |
| `komponentor.intent(urlOrOpts)` | Fluent intent builder: `.data(key, val)` or `.data(obj)`, then `.send({ parent })` -> runs intent and returns the Intent. |
| `komponentor.runIntent(url, data, { parent })` | Convenience: run an intent and return it after completion. |

---

## Configuration

The global `komponentor` is a **Komponentor** instance. If you assign a plain object to `komponentor` before the script runs, it is used as initial config.

```javascript
komponentor.config.debug = true;
komponentor.config.baseUrl = "/api";   // prepended to URLs starting with /
komponentor.config.markerAttr = "data-komponent";
komponentor.config.overlayClass = "komponent-overlay";
komponentor.config.overlayHtml = "<div>Loading</div>";
komponentor.config.errorHtml = (url, err) => `<div>Failed: ${url}</div>`;
komponentor.config.fetchOptions = {};  // optional; passed to fetch() for component and intent requests
```

---

## Component marker

Declare child components in HTML:

```html
<div data-komponent="/path/to/component.html"></div>
<div data-komponent="/view.html|id=5|foo=bar"></div>
```

- **Spec format:** `url|key=value|key2=value2` — URL plus optional pipe-separated key=value pairs merged into `data`.
- Other `data-*` attributes on the element are also merged into the component's `data` (camelCase keys).

---

## Mount options

`urlOrOpts` can be a string (URL or full spec) or an object:

| Option | Description |
|--------|-------------|
| `url` | Component HTML URL (or spec with `|key=val`). |
| `data` | Object merged with parsed spec/attributes, passed to `init_komponent(k, data)`. |
| `replace` | If true, destroy existing component on same host before mounting. |
| `replaceHost` | If true, **replace** the host element with the component root (host is removed from DOM). See implications below. |
| `autoload` | If true (default), scan for `data-komponent` children after mount. |
| `overlay` | If true (default), show loading overlay during fetch. |
| `parent` | Komponent or Intent instance; new component is attached as child. |

### Implications of `replaceHost: true`

- **Default (`replaceHost: false`):** The host element stays; its `innerHTML` is cleared and the component content is appended inside it. On destroy, only the host’s contents are cleared; the host remains.
- **With `replaceHost: true`:** The host node is **removed** and the component’s root is inserted in its place. The root is chosen as: the template’s **first element** if there is exactly one top-level element (text nodes are ignored); otherwise an empty `<div>` (no elements) or a wrapper `<div>` (multiple top-level elements). The component’s `hostEl` is updated to this new root, and the instance is re-attached to it (`KEY_INST`). The host’s **`id`** is copied to the new root so selectors like `#app` still resolve (e.g. for the router outlet).
- **Fallback:** If the host has no parent when rendering (e.g. already removed from the DOM), the implementation falls back to the default append behavior and does not replace. With `config.debug === true`, a log message is emitted.
- **Destroy:** With replace-host, `destroy()` **removes** the component root from the DOM and clears the instance reference. With default behavior, destroy only clears `hostEl.innerHTML`.
- **remount():** With replace-host, after `destroy()` the previous root is no longer in the document. `remount()` then calls `mount(this.hostEl, ...)` on that detached node, so the new component’s content is not in the document. Prefer creating a new host and calling `mount(host, urlOrOpts)` yourself when using replace-host and needing to “remount”.
- **Router:** Using `replaceHost: true` on the root/outlet (e.g. `root("#app", "app.html", { replaceHost: true })`) is fine: the new root keeps the host’s `id`, so the outlet selector `#app` still works for the next route change.

---

## Komponent instance

Each mounted component is a **Komponent** with:

- **`hostEl`** - DOM element that hosts the component.
- **`opts`** - Normalized mount options.
- **`data`** - Data passed to init.
- **`ctx`** - **Context** (see below).
- **`parent`** / **`children`** - Component tree (parent may be Komponent or Intent).
- **`readyPromise`** - Promise that resolves with this instance when ready, or rejects on mount error.

**Methods:**

- **`find(selector)`** - `hostEl.querySelector(selector)`.
- **`findAll(selector)`** - `hostEl.querySelectorAll(selector)` as array.
- **`mount()`** - Run mount (fetch, render, init). Returns a Promise; usually called internally.
- **`scan({ replaceExisting })`** - Scan this component’s host for `data-komponent` and mount children (once per lifetime unless `replaceExisting: true`).
- **`remount()`** - Destroy this component and mount a fresh one on the same host.
- **`destroy()`** - Destroy children, destroy context; then clear `hostEl.innerHTML` (default) or remove `hostEl` from DOM (if `replaceHost` was used), and unlink from parent.

---

## Context (lifecycle and events)

Each Komponent (and Intent) has a **Context** `k.ctx`:

- **`k.ctx.id`** - Unique id.
- **`k.ctx.ready`** - True after init has run.
- **`k.ctx.state`** - `"initial"` | `"loading"` | `"loaded"` | `"mounting"` | `"mounted"` | `"initializing"` | `"ready"` | `"error"` | `"closing"` (Intent) | `"destroying"` | `"destroyed"`.
- **`k.ctx.parent`** - Parent context (if any).
- **`k.ctx.children`** - Child contexts.

**Events:** `on(event, fn, ctx)`, `off(event, fn, ctx)`, `trigger(event, payload)`.

- **`state:change`** - `{ state, ctx }`.
- **`state:<name>`** - When state becomes `<name>`.
- **`context:destroy`** - When context is being destroyed.

**Lifecycle:**

- **`onDestroy(fn)`** - Register a function to run when the context is destroyed (children destroyed first, then destroyers in reverse order).
- **`requestText(url, fetchOpts)`** - Fetch URL with abort on destroy or new request; returns response text or null if stale/destroyed.
- **`requestAbort()`** - Abort current request.
- **`emitUp(event, payload)`** - Trigger event on this context and each parent up the tree.
- **`emitRoot(event, payload)`** - Trigger event on the root context.
- **`destroy()`** - Abort request, destroy children, run destroyers, clear events.

---

## Init convention

Fetched HTML may contain a `<script>` that defines:

```javascript
function init_komponent(k, data) {
  // k = Komponent (or Intent) instance
  // data = opts.data
  // Use k.ctx.onDestroy(() => { ... }) for cleanup
}
```

If present, this function is called after the fragment is rendered into the host. Scripts are stripped from the fragment; only the function is extracted and run in an isolated scope.

---

## Intents (temporary UI)

Intents are **for temporary UI only** (modals, dialogs, popups). They load component HTML, mount it into an **outlet** (default `body`), and remove it on **`close()`** or **`destroy()`**.

**Fluent builder:**

```javascript
const intent = await komponentor.intent("modal.html|id=1")
  .data("model", myModel)
  .data({ source: k })
  .send({ parent: k, outlet: "body" });
await intent.readyPromise;
// To dismiss and return a result: intent.close({ confirmed: true });
const result = await intent.resultPromise;
```

**Convenience:**

```javascript
const intent = await komponentor.runIntent("modal.html", { task: "sync" }, { outlet: "#overlay" });
```

- **`parent`** — Optional; Intent is destroyed when parent is destroyed.
- **`outlet`** — Where to append the intent’s DOM; default `"body"`.
- Intent has **`readyPromise`**, **`resultPromise`**, **`close(result?)`**, **`destroy()`**, **`ctx`**, **`url`**, **`data`**, **`children`**. Use **`close(result)`** to unmount and resolve **`resultPromise`**; do not manually remove DOM.

---

## Hash router

```javascript
komponentor.route({
  outlet: "#app",           // selector for mount target
  routes: {
    "#/": "view1.html",
    "#/users/:id": "user.html",
    "#/custom": (outletEl, route) => {
      // route = { hash, params }; mount or run custom logic
      komponentor.mount(outletEl, { url: "custom.html", data: { route }, replace: true });
    }
  },
  notFound: "404.html"      // optional; can be a URL string or callback(outletEl, route)
});
```

- **Routes** are matched by hash (e.g. `#/users/5`). Pattern `:id` captures one segment.
- Each route value can be:
  - **URL string** – The manager mounts that component in the outlet with `data: { route: { hash, params } }` and `replace: true`.
  - **Callback** – `(outletEl, route) => void`. You can call `komponentor.mount(outletEl, ...)` with custom options, or run any logic. `route` is `{ hash, params }`.
- **notFound** – Optional. Either a URL string (mount that component) or a callback `(outletEl, route)` where `route` has `params: {}`.
- **`komponentor.navigate(hash)`** – Sets `location.hash` (handler runs on `hashchange`).

---

## Exposed classes

For advanced use, the following are attached to `komponentor`:

- **`Komponentor`** - Manager class.
- **`Komponent`** - Component node class.
- **`Context`** - Lifecycle/event context.
- **`HashRouter`** - Router class.
- **`Intent`** - Intent class.

---

## Load order

1. jQuery (optional).
2. `komponentor.js`.


---

## Quick example

```html
<div id="app" data-komponent="app.html"></div>
<script src="komponentor.js"></script>
<script>
  komponentor.config.baseUrl = "./";
  komponentor.root("#app", "app.html");
</script>
```

Or with router:

```javascript
komponentor.route({ outlet: "#app", routes: { "#/": "home.html" } });
```
