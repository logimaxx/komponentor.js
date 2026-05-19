# How to Use Komponentor (Single-File)

A practical guide for `**src/komponentor.js**`: the single-file framework for HTML-based components, a component tree, and hash routing. **Requires jQuery** (global `jQuery` or `$`, `>=1.9.0`).

---

## 1. Overview

**Komponentor** lets you:

- **Mount** HTML components by URL into a host element (fetch HTML, run optional init script, render).

- Build a **tree** of components (parent/children); destroy cascades down.
- **Scan** the DOM for `data-komponent="url|key=val"` and mount components automatically.
- Use optional **hash or history routing** to mount different components in an outlet by URL.

**Public API:**


| Method                                                            | Description                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `komponentor.root(host, urlOrOpts)`                               | Set app root: mount one component, replace previous root. Returns `**Promise<Komponent>`**.                       |
| `komponentor.mount(host, urlOrOpts)`                              | Mount a component on `host`. Returns `**Promise<Komponent>**` (awaits load, render, init).                        |
| `komponentor.unmount(host)`                                       | Destroy the komponent on `host`, if any. Returns `boolean`.                                                       |
| `komponentor.scan(container?, { parent?, replaceExisting? })`     | Find all `[data-komponent]` in `container` (default `body`) and mount each.                                       |
| `komponentor.route({ mode?, outlet, routes, notFound, ignore? })` | Configure and start router (`mode`: `"hash"` default or `"history"`).                                             |
| `komponentor.navigate(pathOrHash, navOpts?)`                      | Hash mode: set `location.hash`. History mode: `pushState` / `replaceState` then dispatch.                         |
| `komponentor.intent(urlOrOpts)`                                   | Fluent builder for an **intent** (temporary UI). `.data(...).send({ parent?, outlet? })` → `**Promise<Intent>`**. |
| `komponentor.runIntent(url, data, { parent?, outlet? })`          | Convenience: run an intent; returns `**Promise<Intent>**`.                                                        |


No build step. **jQuery is required** — load it before `komponentor.js` (see [komponentor.md](./komponentor.md)).

**Security:** Only load component HTML from paths you trust; scripts in components run in the page. See **[SECURITY.md](./SECURITY.md)**.

---

## 2. Setup

Include jQuery first, then `komponentor.js`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <div id="app"></div>

  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="path/to/komponentor.js"></script>
  <script>
    // Optional: pass config as plain object (if komponentor was pre-set as config)
    // Or configure after load:
    komponentor.config.debug = true;
    komponentor.config.baseUrl = "/";  // prepended to URLs starting with /
  </script>
</body>
</html>
```

**Config options:** `debug`, `baseUrl`, `overlayClass`, `overlayHtml`, `markerAttr` (default `data-komponent`), `errorHtml(url, err)`, `fetchOptions`.

---

## 3. Basic Usage

### 3.1 Mount a single component

Mount a component by URL into a host element. The host’s content is replaced by the fetched HTML; optional inline script can define `init_komponent(komponent, data)`.

```javascript
// host: selector string, Element, or jQuery object
komponentor.mount("#app", "components/welcome.html");
```

With options:

```javascript
await komponentor.mount("#app", {
  url: "components/panel.html",
  data: { title: "Hello", id: 42 },
  replaceHost: false,  // true = swap host for component root (see docs/komponentor.md)
  autoload: true,
  overlay: true,
});
```

**URL with inline params** (same as `data`):

```javascript
// "url|key=value|foo=bar" → url + data
komponentor.mount("#app", "components/user.html|id=5|tab=profile");
```

`komponentor.mount()` is **async** and resolves when load, render, and `init_komponent` finish:

```javascript
const k = await komponentor.mount("#app", "components/welcome.html");
// k.ctx.ready === true; k.readyPromise also resolves to k
```

To remount an existing instance on the same host: `await k.mount()`.

### 3.2 Set the app root

Use `root()` when you have a single top-level component and want to replace it on route change or re-init:

```javascript
await komponentor.root("#app", "components/main.html");
```

This stores the component as the “root”; you can use `emitRoot()` from any child context to send events to the root (see Advanced).

### 3.2a Replace host option

Use `**replaceHost: true**` in mount options to **replace** the host element with the component’s root (the host is removed from the DOM; the component’s first top-level element takes its place). The host’s `id` is copied to the new root so selectors (e.g. `#app` for the router outlet) still work. On destroy, the component root is removed from the DOM. See **docs/komponentor.md** for full implications (remount, router, fallback when host has no parent).

### 3.3 Component HTML and init

Each component is an **HTML file** that can contain:

- **Markup** – Any HTML. It’s parsed and inserted into the host (scripts are stripped and run in isolation).
- **Script** – Optional. Define `**init_komponent(k, data)`**. Script bodies are executed via `new Function` (trusted code only; see [SECURITY.md](./SECURITY.md)). Runs after markup is inserted, with:
  - `**k**` – The **Komponent** or **Intent** instance (`k.find` returns jQuery).
  - `**data`** – The `data` object passed at mount (or from `url|key=val`), plus `**data.route**` when mounted by the router.

Example component: `components/panel.html`

```html
<div class="panel">
  <h2 class="panel-title"></h2>
  <div class="panel-body"></div>
</div>
<script>
  function init_komponent(komponent, data) {
    komponent.find(".panel-title").text(data.title || "Untitled");
    komponent.find(".panel-body").text(data.body || "");
    komponent.ctx.on("custom:event", function (payload) {
      console.log("Received", payload);
    });
  }
</script>
```

**Komponent instance (`komponent`):**

- `komponent.hostEl` – Host DOM element.
- `komponent.ctx` – **Context** (lifecycle, events, request).
- `komponent.url`, `komponent.data` – URL and data.
- `komponent.parent` / `komponent.children` – Parent/children in the tree.
- `komponent.find(selector)` – jQuery search inside the host (`$host.find(selector)`).
- `komponent.mount()` – (Re-)run fetch/render/init on this instance; returns `Promise<this>`.
- `komponent.readyPromise` – resolves to this komponent when ready (or rejects on error).
- `komponent.scan({ replaceExisting })` – Scan inside host for `data-komponent`.
- `komponent.destroy()` – Destroy this component and its children.

**Context (`komponent.ctx`):**

- `ctx.on(event, fn, ctx)` / `ctx.off(event, fn, ctx)` / `ctx.trigger(event, payload)` – Scoped events.
- `ctx.state` – `"initial"` | `"loading"` | `"loaded"` | `"mounting"` | `"mounted"` | `"initializing"` | `"ready"` | `"error"` | `"closing"` (intent) | `"destroying"` | `"destroyed"`.
- `ctx.onDestroy(fn)` – Run `fn(ctx)` on destroy (reverse order).
- `ctx.requestText(url, fetchOpts)` – Fetch text with abort-on-destroy and stale guard (returns `Promise<string|null>`).
- `ctx.emitUp(event, payload)` – Trigger event on this context and each parent up the tree.
- `ctx.emitRoot(event, payload)` – Trigger on the manager’s root context (if any).

---

## 4. Scan and `data-komponent` markers

You can declare child components in HTML with the `**data-komponent`** attribute. Format: `**url|key=value|...**`.

Example:

```html
<div id="app">
  <div data-komponent="components/header.html"></div>
  <div data-komponent="components/content.html|page=home"></div>
  <div data-komponent="components/footer.html"></div>
</div>
```

Then run a **scan** so Komponentor mounts a component on each such node:

```javascript
komponentor.scan("#app");
```

Scan options:

```javascript
komponentor.scan("#app", {
  parent: someKomponent,  // attach mounted components as children of this
  replaceExisting: true,   // destroy and remount if a node already has a component
});
```

If you mounted a parent with `**autoload: true**` (default), that parent will **automatically** call `scan()` on its host after it becomes ready, so nested `data-komponent` placeholders inside the fetched HTML are mounted as children.

---

## 5. Router (hash and history)

Use the router to mount different components in an **outlet** when the URL changes.

**Hash mode** (default) — paths in `location.hash`:

```javascript
komponentor.route({
  mode: "hash",  // optional; default
  outlet: "#app",
  routes: {
    "#/": "components/home.html",
    "#/users": "components/user-list.html",
    "#/users/:id": "components/user-detail.html",
    "#/about": "components/about.html",
  },
  notFound: "components/404.html",
});
```

- `**outlet**` – Selector (or element) where the route component is mounted.
- `**routes**` – Object: hash pattern → **component URL (string)** or **callback(outletEl, route)**. Patterns like `#/users/:id` produce **params**. If the value is a function, it is called with the outlet element and `{ hash, params }`; you can then call `komponentor.mount(outletEl, ...)` with custom options or run any logic.
- `**notFound`** – URL (string) or callback(outletEl, route) when no route matches.

Navigate programmatically:

```javascript
komponentor.navigate("#/users/42");
```

**History mode** — paths in `location.pathname` (patterns without `#` prefix, e.g. `"/users/:id"`):

```javascript
komponentor.route({
  mode: "history",
  outlet: "#app",
  routes: {
    "/": "components/home.html",
    "/users/:id": "components/user-detail.html",
  },
});
komponentor.navigate("/users/42");
komponentor.navigate("/users/42", { replace: true });  // replaceState
```

In the mounted component, `**data.route**` is set by the router:

- Hash mode: `data.route.hash` (e.g. `"#/users/42"`), `data.route.params` (e.g. `{ id: "42" }`).
- History mode: `data.route.path`, `data.route.search`, `data.route.params`.

Example component for `#/users/:id`:

```html
<div class="user-detail">
  <p>User id: <span class="user-id"></span></p>
</div>
<script>
  function init_komponent(komponent, data) {
    const id = data.route && data.route.params && data.route.params.id;
    komponent.find(".user-id").text(id || "—");
  }
</script>
```

---

## 6. Advanced: Nested components

Nested components are the norm: a parent’s HTML contains placeholders with `data-komponent`; after the parent is mounted and rendered, **scan** runs (when `autoload` is true) and mounts a child component in each placeholder. Parent and children form a **tree**; destroy cascades from parent to children.

### 6.1 Parent/child tree

- When you **mount** with `parent: someKomponent`, the new component is linked as a child of `someKomponent`.
- When you **scan** with `parent: someKomponent`, every component mounted from that scan is attached to `someKomponent`.
- **Auto-scan** after a component’s mount does the same: components mounted from `data-komponent` inside its host become its children.

So you get:

- `**komponent.parent`** – Parent Komponent (or `null`).
- `**komponent.children**` – Array of child Komponents.
- `**komponent.ctx.parent**` / `**komponent.ctx.children**` – Same structure at the Context level.

Destroying a component destroys all of its children first, then clears the host content.

### 6.2 Passing data to nested components

**Option A: Inline in `data-komponent`**

```html
<div data-komponent="components/card.html|title=Hello&id=1"></div>
```

Parsed as `url = "components/card.html"`, `data = { title: "Hello", id: "1" }`.

**Option B: Parent sets data in init**

The parent’s HTML might have a placeholder without params; the parent can create a wrapper element and mount programmatically with custom data (see “Mount from init” below).

**Option C: Child reads from parent via `komponent.parent`**

In the child’s init:

```javascript
function init_komponent(komponent, data) {
  const parentData = komponent.parent && komponent.parent.data;
  // use parentData...
}
```

### 6.3 Events up and to root

- `**ctx.emitUp(event, payload)**` – Fires `event` on this context, then on `ctx.parent`, then its parent, and so on. Useful for “something happened in a child, notify ancestors.”
- `**ctx.emitRoot(event, payload)**` – Fires the event on the **root context** only (the one set with `komponentor.root()`). Use for app-level notifications (e.g. “open sidebar”, “show toast”).

Example: child notifies parent and root.

In a child component:

```javascript
  function init_komponent(komponent, data) {
    komponent.find("button.report").on("click", function () {
      komponent.ctx.trigger("child:clicked", { id: data.id });
      komponent.ctx.emitUp("child:clicked", { id: data.id });
      komponent.ctx.emitRoot("notify", { message: "Child " + data.id + " clicked" });
    });
  }
```

In a parent or root component you can subscribe:

```javascript
komponent.ctx.on("child:clicked", function (payload) {
  console.log("Child clicked", payload);
});
```

### 6.4 Full example: Nested layout + list + cards

**Structure:**

- **Shell** – Layout with header, main area, footer.
- **Main** – Contains a list of cards (each card is a component).

**index.html**

```html
<div id="app"></div>
<script src="komponentor.js"></script>
<script>
  komponentor.config.baseUrl = "./";
  await komponentor.root("#app", "components/shell.html");
</script>
```

**components/shell.html**

```html
<div class="shell">
  <header class="shell-header">
    <h1>App</h1>
  </header>
  <main class="shell-main" data-komponent="components/main.html"></main>
  <footer class="shell-footer">© Example</footer>
</div>
<script>
  function init_komponent(komponent, data) {
    komponent.ctx.on("notify", function (payload) {
      console.log("Root received:", payload);
    });
  }
</script>
```

**components/main.html**

```html
<div class="main">
  <h2>Items</h2>
  <div class="card-list">
    <div data-komponent="components/card.html|title=First&id=1"></div>
    <div data-komponent="components/card.html|title=Second&id=2"></div>
    <div data-komponent="components/card.html|title=Third&id=3"></div>
  </div>
</div>
<script>
  function init_komponent(komponent, data) {
    // optional: react to child events
    komponent.ctx.on("child:clicked", function (payload) {
      console.log("Main: child clicked", payload);
    });
  }
</script>
```

**components/card.html**

```html
<div class="card">
  <h3 class="card-title"></h3>
  <button type="button" class="card-action">Action</button>
</div>
<script>
  function init_komponent(komponent, data) {
    komponent.find(".card-title").text(data.title || "Card");
    komponent.find(".card-action").on("click", function () {
      komponent.ctx.emitUp("child:clicked", { id: data.id });
      komponent.ctx.emitRoot("notify", { message: "Card " + data.id + " action" });
    });
  }
</script>
```

Flow:

1. **root("#app", "shell.html")** mounts the shell; shell’s host is `#app`.
2. Shell’s HTML includes `<main data-komponent="components/main.html">`. After shell is ready, **autoload** runs **scan** on the shell’s host, so **main.html** is mounted inside that `<main>`.
3. Main’s HTML includes three `data-komponent="components/card.html|..."`. After main is ready, scan runs inside main’s host, so three **card** components are mounted.
4. Tree: **Shell** → **Main** → **Card** (×3). Clicking a card button emits up and to root; shell and main can listen.

### 6.5 Mount a child from init (programmatic mount)

If you need to create a child placeholder in code and mount with custom options:

```javascript
function init_komponent(komponent, data) {
  const container = komponent.find(".dynamic-slots");
  if (!container) return;
  const placeholder = document.createElement("div");
  container.appendChild(placeholder);
  await komponent.manager.mount(placeholder, {
    url: "components/widget.html",
    data: { source: data.source },
    parent: komponent,
    replaceHost: false,  // optional: true to replace placeholder with component root
  });
}
```

Here `komponent.manager` is the **Komponentor** instance. The new component is attached as a child of `komponent` because of `parent: komponent`.

### 6.6 Intents (temporary UI: modals, dialogs)

An **Intent** loads component HTML and mounts it into an **outlet** (default `"body"`) inside a wrapper element. Use intents for modals, dialogs, and other UI that should be removed when dismissed. The init function receives `**(intent, data)`** where `intent` is the Intent instance (same `init_komponent` name as komponents).

- `**intent.find(selector)**` — jQuery search inside the intent wrapper.
- `**intent.close(result?)**` — remove DOM, resolve `**resultPromise**`, destroy context.
- `**intent.readyPromise**` / `**intent.resultPromise**` — await ready or user result.
- Pass `**parent: komponent**` so the intent is destroyed when the parent komponent is destroyed.

**Fluent API:**

```javascript
const intent = await komponentor.intent("modals/confirm.html|action=delete")
  .data({ id: 42, title: "Delete item?" })
  .send({ parent: komponent, outlet: "body" });
await intent.readyPromise;
const result = await intent.resultPromise;  // after intent.close(...)
```

**Convenience:**

```javascript
const intent = await komponentor.runIntent("modals/confirm.html", { task: "full" }, { parent: k });
```

#### Example: Modal intent (see also [docs/demo/about.html](demo/about.html))

**In a komponent** — open modal on click:

```javascript
async function init_komponent(komponent, data) {
  komponent.find("#open-modal").on("click", () => {
    komponentor.intent("modals/theme.html")
      .data("theme", komponent.data.theme)
      .send({ parent: komponent });
  });
}
```

**modals/theme.html** — markup + init; show Bootstrap modal, close on dismiss:

```html
<div class="modal" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-body">…</div>
    </div>
  </div>
</div>
<script>
  function init_komponent(intent, data) {
    const $modal = intent.find(".modal");
    $modal.on("hidden.bs.modal", () => intent.close());
    new bootstrap.Modal($modal[0]).show();
  }
</script>
```

#### Example: Intent without parent

No `parent` — not tied to the komponent tree; call `**intent.close()**` or `**intent.destroy()**` yourself when done.

---

### 6.7 Rescan / replace children

By default, each komponent **scans its host only once** after mount (`_scanned` flag). To replace existing child komponents:

- **Manual scan:** `komponentor.scan(container, { parent: k, replaceExisting: true })` or `komponent.scan({ replaceExisting: true })`.
- **Automatic scan after mount:** pass `**replaceExistingChildren: true`** in mount options so autoload calls `scan({ replaceExisting: true })`:

```javascript
await komponentor.mount(host, {
  url: "parent.html",
  replaceExistingChildren: true,
});
```

---

## 7. Quick reference


| Goal                                 | Use                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| Mount one component                  | `await komponentor.mount(host, urlOrOpts)`                                            |
| Set app root (replace on re-root)    | `await komponentor.root(host, urlOrOpts)`                                             |
| Unmount by host                      | `komponentor.unmount(host)`                                                           |
| Mount from markers in DOM            | `komponentor.scan(container?, { parent?, replaceExisting? })`                         |
| Routing                              | `komponentor.route({ mode?, outlet, routes, notFound })`, `komponentor.navigate(...)` |
| Modal / temporary UI                 | `await komponentor.intent(...).send({ parent?, outlet? })`, `intent.close(result)`    |
| In component: DOM query              | `komponent.find(selector)` (jQuery)                                                   |
| In component: events                 | `komponent.ctx.on` / `off` / `trigger`                                                |
| In component: bubble to ancestors    | `komponent.ctx.emitUp(event, payload)`                                                |
| In component: notify root            | `komponent.ctx.emitRoot(event, payload)`                                              |
| In component: fetch                  | `komponent.ctx.requestText(url, fetchOpts)`                                           |
| In component: cleanup                | `komponent.ctx.onDestroy(fn)`                                                         |
| Nested placeholders                  | Put `data-komponent="url                                                              |
| Intent in tree (destroy with parent) | Pass `parent: komponent` to `.send({ parent })` or `runIntent(..., { parent })`       |


For a runnable walkthrough, see **[docs/demo/](demo/)** (router, intent, shared `KModel`).

For trust boundaries, XSS, CSP, and safe URLs/templates, see **[SECURITY.md](./SECURITY.md)**.