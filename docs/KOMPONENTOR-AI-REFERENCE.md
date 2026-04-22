# Komponentor — API reference for AI-assisted development

This document is the **canonical reference** for the Komponentor library. Use it as context when generating or modifying code that uses Komponentor.

---

## 1. Purpose and scope

- **Komponentor** is an **internal** JavaScript runtime for:
  - **Component lifecycle**: load HTML by URL, parse, run init, mount into a host element.
  - **Persistent UI**: components live in a tree (parent/children), support local scan and destroy cascade.
  - **Temporary UI**: Intents (modals, dialogs, popups) mount into an outlet and unmount on close.
  - **Routing**: optional hash-based router that mounts components into an outlet.
- **Not** a general-purpose framework. It does **not** handle:
  - Templating or data-binding (that is **KViews** / KModel / KView).
  - Public plugin ecosystems; no formal extension API.
- **Dependencies**: **jQuery is required** (global `jQuery` or `$`).
- **Typical stack**: Komponentor (lifecycle, loading, mount, routing, temporary UI) + **KViews** (view/data-binding). Keep responsibilities separate.

---

## 2. Global entry point

- **`komponentor`** — Single global instance (or the object you assign before the script runs; it is used as config and then replaced by the instance).
- **Exposed classes** (on `komponentor`): `Komponentor`, `Komponent`, `Context`, `HashRouter`, `Intent`.

---

## 3. Concepts

| Concept | Description |
|--------|-------------|
| **Komponent** | Persistent UI node. Owns a host DOM element, has parent/children, participates in scan and destroy cascade. |
| **Intent** | **Temporary UI only** (modal, dialog, popup). Mounts real DOM into an outlet (default `body`), has `close(result)` and `destroy()`; not part of the declarative scan tree. |
| **Context** | Lifecycle and events for one Komponent or Intent. `k.ctx` — state, events, onDestroy, requestText, emitUp, emitRoot. |
| **Scan** | Declarative: find elements with `data-komponent="url|key=val"` and mount components. Only for **persistent** components, not intents. |
| **Host** | Normalized to a **jQuery collection** (selector string, DOM element, or jQuery set). Primary reference on instances is **`$host`**; **`hostEl`** = `$host[0]` when a raw DOM node is needed. |
| **Outlet** | For Intents: selector or element where the intent’s wrapper is appended (default `"body"`). For router: selector for the element where route components are mounted. |

---

## 4. Public API (komponentor)

### 4.1 Mounting persistent UI

```javascript
// Set app root; destroys any previous root. Returns Promise<Komponent> (resolves when mounted + ready).
komponentor.root(host, urlOrOpts)

// Mount a component at host. Returns Promise<Komponent> (awaits load, render, init).
komponentor.mount(host, urlOrOpts)
```

- **host**: CSS selector string, DOM element, or jQuery collection; internally normalized to a jQuery collection.
- **urlOrOpts**: String (URL or spec `"url|key=val|..."`) or options object (see Mount options below).
- **Return**: **`Promise<Komponent>`** that resolves when the component is fully loaded, rendered, and `init_komponent` has finished (or rejects when the mount fails). You can **`await`** it. Each instance also has **`readyPromise`** with the same semantics.

**Example:**

```javascript
const k = await komponentor.mount("#app", "app.html");
// k is ready; DOM and init are done

await komponentor.root("#app", { url: "app.html", data: { id: 1 } });
```

### 4.2 Scan (declarative child components)

```javascript
komponentor.scan(container?, { parent?, replaceExisting? })
```

- **container**: Element/selector to scan; default `document.body`.
- **parent**: Optional Komponent (or Intent) to attach mounted components to.
- **replaceExisting**: If `true`, destroy existing component on same host before mounting; default `false` (scan once per host).

**Example:**

```javascript
komponentor.scan("#main", { parent: appKomponent, replaceExisting: false });
```

### 4.3 Intent (temporary UI)

```javascript
// Fluent builder
komponentor.intent(urlOrOpts)
  .data(key, value)        // or .data({ key: value, ... })
  .send({ parent?, outlet? })

// Convenience
komponentor.runIntent(url, data, { parent?, outlet? })
```

- **urlOrOpts**: String (e.g. `"modal.html|id=1"`) or object `{ url, data, parent, outlet }`.
- **outlet**: Where to append the intent’s DOM; default `"body"`.
- **Error contract**: `intent().send()` and `runIntent()` return a promise that **resolves** with the Intent on success and **rejects** on failure (no url, load aborted/stale, outlet not found, or init throws). On failure the Intent is left with `ctx.state === "error"` and `readyPromise` rejected; the wrapper is unmounted if it was already in the DOM.
- **Return (on success)**: Intent instance. It has:
  - **`readyPromise`** — resolves with the Intent when mounted and init has run; **rejects** on any run failure.
  - **`resultPromise`** — resolves when `close(result)` is called (or with `undefined` on `destroy()`).
  - **`close(result?)`** — unmount DOM, resolve `resultPromise` with `result`, then destroy.
  - **`destroy()`** — unmount DOM, settle `resultPromise` if not yet settled, tear down.

**Example:**

```javascript
try {
  const i = await komponentor.intent("modal.html").data({ source: k }).send({ parent: k });
  await i.readyPromise;
  // In modal init or button handler: i.close({ confirmed: true });
  const result = await i.resultPromise;
} catch (e) {
  // run() failed: no url, load aborted, outlet not found, or init threw
}
```

### 4.4 Router

```javascript
komponentor.route({ mode?, outlet?, routes?, notFound?, ignore? })
komponentor.navigate(pathOrHash, { replace?, state? })
```

- **mode**: Router mode. `"hash"` (default) or `"history"`.
- **outlet**: Selector for the element where route components are mounted (e.g. `"#app"`). Resolved via `normalizeHost`, so **outletEl** in callbacks is a jQuery collection.
- **routes**:
  - In `"hash"` mode: Object `{ "#/path": urlOrHandler, ... }`.
  - In `"history"` mode: Object `{ "/path": urlOrHandler, ... }`.
  - Value can be:
    - **URL string** — Component is mounted with `replace: true` and route data.
    - **Callback** — `(outletEl, route) => void`.
- **notFound**: Optional. URL string or callback `(outletEl, route)`.
- **ignore**: Optional string/regex/function (or array) used to skip route dispatch for matching URLs.
- **navigate(pathOrHash, opts)**:
  - `"hash"` mode: sets `location.hash`.
  - `"history"` mode: uses `history.pushState()` (or `replaceState()` when `opts.replace === true`) and dispatches immediately.
- Listeners:
  - `"hash"` mode listens to **hashchange**.
  - `"history"` mode listens to **popstate**.
  - Both modes dispatch once immediately on `route(...)`.

**Example:**

```javascript
komponentor.route({
  mode: "hash",
  outlet: "#view",
  routes: {
    "#/": "home.html",
    "#/users/:id": "user.html",
    "#/custom": (outletEl, route) => {
      void komponentor.mount(outletEl, { url: "custom.html", data: { route }, replace: true });
    }
  },
  notFound: "404.html"
});
komponentor.navigate("#/users/5");
```

**History mode example:**

```javascript
komponentor.route({
  mode: "history",
  outlet: "#view",
  routes: {
    "/": "home.html",
    "/users/:id": "user.html"
  },
  notFound: "404.html"
});
komponentor.navigate("/users/5");
```

---

## 5. Mount options (urlOrOpts object)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| **url** | string | `""` | Component HTML URL. Can include spec: `"path.html|key=val|..."`. |
| **data** | object | `{}` | Merged with spec/attributes; passed to `init_komponent(k, data)`. |
| **replace** | boolean | `false` | If true, destroy existing component on same host before mounting. |
| **replaceHost** | boolean | `false` | **Advanced.** Replace host with component root (host removed; host `id` copied). Component HTML must have **exactly one** top-level element; otherwise throws. |
| **autoload** | boolean | `true` | After mount, scan host for `data-komponent` and mount children. |
| **overlay** | boolean | `true` | Show loading overlay during fetch. |
| **parent** | Komponent or Intent | `null` | Attach as child; destroyed when parent is destroyed. |

---

## 6. Component marker (declarative scan)

```html
<div data-komponent="/path/to/component.html"></div>
<div data-komponent="/view.html|id=5|foo=bar"></div>
```

- **Spec format**: `url|key=value|key2=value2`. URL plus optional pipe-separated `key=value` pairs merged into `data`.
- Other **data-\*** attributes on the element are merged into `data` (camelCase keys). The marker attribute itself is excluded.
- Config: **`komponentor.config.markerAttr`** (default `"data-komponent"`).

---

## 7. Komponent instance

- **Properties**: **`$host`** (jQuery — primary host reference), **`hostEl`** (= `$host[0]`), `opts`, `data`, `ctx`, `parent`, `children`, **`readyPromise`** (resolves with this instance when ready; **rejects** on mount error or when load is aborted/stale — in the latter case `ctx.state` is set to `"error"`).
- **Methods**:
  - **`find(selector)`** — First element matching selector inside `$host`. Returns DOM element or `null`.
  - **`findAll(selector)`** — Array of elements matching selector inside `$host`.
  - **`mount()`** — Async; called by manager. Returns a Promise that resolves to this instance (or rejects via `readyPromise` on error/abort).
  - **`scan({ replaceExisting })`** — Scan this component’s `$host` for `data-komponent` and mount children (once per lifetime unless `replaceExisting: true`).
  - **`remount()`** — Destroy this component and mount a fresh one on the same `$host` (same opts).
  - **`destroy()`** — Destroy children, destroy context, clear or remove host content, unlink from parent.

---

## 8. Intent instance

- **Properties**: `url`, `data`, `outlet`, `ctx`, `parent`, `children`, **`readyPromise`** (resolves with this when mounted and init ran; **rejects** on any run failure), **`resultPromise`**, **`$host`** (jQuery wrapper; Intent owns it), **`hostEl`** (= `$host[0]` when mounted).
- **Methods**:
  - **`find(selector)`** — First element matching selector inside `$host`; `null` if not mounted.
  - **`findAll(selector)`** — Array of elements matching selector inside `$host`.
  - **`run()`** — Load HTML, mount wrapper into outlet, run init. **On success** returns `this`. **On failure** (no url, load aborted/stale, outlet not found, init throws): sets `ctx.state` to `"error"`, rejects `readyPromise`, unmounts wrapper if already in DOM, then **throws** — so `send()` / `runIntent()` reject.
  - **`close(result?)`** — Unmount `$host`, resolve `resultPromise` with `result`, then destroy. Use for dialogs.
  - **`destroy()`** — Unmount `$host`, resolve `resultPromise` with `undefined` if not yet settled, tear down.

---

## 9. Context (k.ctx)

- **Properties**: `id`, `owner`, `manager`, `parent`, `children`, **`ready`** (boolean), **`state`** (string).
- **Lifecycle states**: `initial` → `loading` → `loaded` → `mounting` → `mounted` → `initializing` → `ready` (or `error`); on destroy: `destroying` → `destroyed`. Intent can use `closing` before destroyed.
- **Events**: `on(event, fn, ctx)`, `off(event, fn, ctx)`, `trigger(event, payload)`.
  - **`state:change`** — payload `{ state, ctx }`.
  - **`state:<name>`** — when state becomes `<name>`.
  - **`context:destroy`** — when context is being destroyed.
- **Methods**:
  - **`onDestroy(fn)`** — Run `fn(ctx)` when context is destroyed (children first, then destroyers in reverse).
  - **`requestText(url, fetchOpts)`** — Fetch URL; aborts on destroy or new request. Returns response text or `null` if stale/destroyed.
  - **`requestAbort()`** — Abort current request.
  - **`emitUp(event, payload)`** — Trigger on this context and each parent up the tree.
  - **`emitRoot(event, payload)`** — Trigger on the root context (app root).
  - **`destroy()`** — Abort request, destroy children, run destroyers, clear events.

---

## 10. Component HTML and init convention

- Fetched HTML can contain a **`<script>`** that defines **`function init_komponent(k, data)`**.
- **k**: Komponent or Intent instance.
- **data**: Merged options data (spec + attributes + programmatic).
- Scripts are **stripped** from the fragment; only the init function is extracted and run. No global pollution.
- **Fail fast**: If script parsing or execution fails when extracting `init_komponent`, the error is thrown and the mount/intent run goes into the error flow (no silent fallback).
- Init can use `k.ctx.onDestroy(...)` for cleanup, `k.find()` / `k.findAll()`, and for Intents: `k.close(result)`, `k.$host`, etc.

**Example (Komponent):**

```javascript
function init_komponent(k, data) {
  k.ctx.onDestroy(() => { /* cleanup */ });
  void komponentor.mount(k.find("#nested"), "nested.html", { parent: k }); // or await if init_komponent is async
}
```

**Example (Intent — modal):**

```javascript
function init_komponent(k) {
  const modalEl = k.$host.find(".modal")[0];
  modalEl.addEventListener("hidden.bs.modal", () => k.close());
  new bootstrap.Modal(modalEl).show();
}
```

---

## 11. Configuration

```javascript
komponentor.config.debug       // boolean; default false
komponentor.config.baseUrl     // string; prepended to URLs starting with /
komponentor.config.markerAttr  // string; default "data-komponent"
komponentor.config.overlayClass
komponentor.config.overlayHtml
komponentor.config.errorHtml  // (url, err) => string
komponentor.config.fetchOptions  // object; passed to fetch() for component/intent requests
```

---

## 12. Manager-only methods (advanced)

Use when you need instance tracking or normalization:

- **`komponentor.getInst(elOrJq)`** — Komponent or Intent attached to element, or `null`.
- **`komponentor.setInst(elOrJq, inst)`** — Attach instance to element (internal).
- **`komponentor.clearInst(elOrJq, inst)`** — Clear only if current instance is `inst`.
- **`komponentor.lockHost(elOrJq, owner)`** — Lock host for mount (prevents concurrent mount). Returns `true` if locked. **owner** is the lock token (e.g. a plain object) or the instance that holds the lock; same value must be passed to `unlockHost`.
- **`komponentor.unlockHost(elOrJq, owner)`** — Unlock after mount or on destroy; pass the same **owner** used for `lockHost`.

Arguments can be DOM element, jQuery collection, or selector string. Instance tracking uses WeakMaps keyed by the raw DOM node.

---

## 13. Integration with KViews

- **Komponentor** handles: loading HTML, mounting, component tree, scan, routing, temporary UI (Intent), lifecycle.
- **KViews** (KModel, KView) handle: observable data and view binding (e.g. `getKModel(el).update('name', val)`, `model.bindView(new KView(...))`).
- In component init, you may create a KModel, bind KViews to parts of `k.$host` or `k.find(...)`, and pass `k.data.model` or similar into child components or intents. Do **not** move data-binding or template logic into Komponentor.

---

## 14. Common patterns (for AI)

- **Root + scan**: `komponentor.root("#app", "app.html");` — app.html’s init can call `komponentor.scan(k.$host, { parent: k })` or rely on `autoload: true`.
- **Router (hash)**: `komponentor.route({ mode: "hash", outlet: "#app", routes: { "#/": "home.html" } });` then links with `href="#/..."` or `komponentor.navigate("#/path")`.
- **Router (history)**: `komponentor.route({ mode: "history", outlet: "#app", routes: { "/": "home.html" } });` then links with normal paths (`href="/..."`) or `komponentor.navigate("/path")`.
- **Modal with result**: Use `try/catch` (or `.catch()`) on `send()` / `runIntent()` — they reject when the intent fails. On success: `const i = await komponentor.intent("modal.html").data({ model }).send({ parent: k }); const result = await i.resultPromise;` and in modal init/button: `k.close({ confirmed: true })`.
- **Replace host (e.g. root outlet)**: `komponentor.root("#app", { url: "app.html", replaceHost: true });` so `#app` is replaced by the component root (id preserved).
- **Await ready**: `const k = await komponentor.mount(host, opts);` — `k` is ready when the promise resolves (or `await k.readyPromise` if you already hold the instance).

---

## 15. What to avoid

- Do **not** use Intent for non-UI or “headless” work; Intent is for temporary UI that mounts and unmounts.
- Do **not** append Intent’s DOM manually in init; it is already mounted into the outlet. Use `k.close()` instead of `k.$host.remove(); k.destroy()`.
- Do **not** put data-binding or template logic in Komponentor; use KViews for that.
- Do **not** call `getInst` / `setInst` / etc. as globals; they are methods on the manager: `komponentor.getInst(el)`.
- Do **not** rely on script errors in component HTML being swallowed; script/init extraction is **fail fast** — errors propagate and fail the mount or intent run.
- Do **not** assume `intent().send()` or `runIntent()` always resolve; they **reject** on failure — handle with try/catch or `.catch()`.

---

## 16. File and load order

- **Library**: `src/komponentor.js`
- **Load**: jQuery first, then `komponentor.js`. Then your app script or inline init that calls `komponentor.root(...)` or `komponentor.route(...)`.
