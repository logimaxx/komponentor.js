# How to Use Komponentor (Single-File)

A practical guide for **`src/komponentor.js`**: the single-file, jQuery-optional framework for HTML-based components, a component tree, and hash routing.

---

## 1. Overview

**Komponentor** lets you:

- **Mount** HTML components by URL into a host element (fetch HTML, run optional init script, render).
- Build a **tree** of components (parent/children); destroy cascades down.
- **Scan** the DOM for `data-komponent="url|key=val"` and mount components automatically.
- Use optional **hash routing** to mount different components in an outlet by path.

**Public API:**

| Method | Description |
|--------|-------------|
| `komponentor.root(host, urlOrOpts)` | Set app root: mount one component, replace previous root. |
| `komponentor.mount(host, urlOrOpts)` | Mount a component on `host` (load HTML from URL, render, optional init). Options: `replaceHost: true` to replace host with component root. |
| `komponentor.scan(container?, { parent?, replaceExisting? })` | Find all `[data-komponent]` in `container` and mount each. |
| `komponentor.route({ outlet, routes, notFound })` | Configure and start hash router. |
| `komponentor.navigate(hash)` | Set `location.hash` (triggers route). |
| `komponentor.intent(urlOrOpts)` | Fluent builder for a **headless intent** (no DOM, no render). `.data(...).send({ parent })` → Intent. |
| `komponentor.runIntent(url, data, { parent })` | Convenience: create and run an intent; returns the Intent instance. |

No build step; no jQuery required (jQuery is used only as a helper when present).

---

## 2. Setup

Include the single script (and optionally jQuery):

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
</head>
<body>
  <div id="app"></div>

  <!-- Optional: jQuery (used only if present) -->
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
komponentor.mount("#app", {
  url: "components/panel.html",
  data: { title: "Hello", id: 42 },
  replace: true,
  replaceHost: false,  // set true to replace the host element with the component root (see docs/komponentor.md)
  autoload: true,
  overlay: true,
});
```

**URL with inline params** (same as `data`):

```javascript
// "url|key=value|foo=bar" → url + data
komponentor.mount("#app", "components/user.html|id=5|tab=profile");
```

`mount()` returns the **Komponent** instance immediately; loading is async. To wait for it:

```javascript
const k = komponentor.mount("#app", "components/welcome.html");
await k.mount();  // wait for load + render + init
```

### 3.2 Set the app root

Use `root()` when you have a single top-level component and want to replace it on route change or re-init:

```javascript
komponentor.root("#app", "components/main.html");
```

This stores the component as the “root”; you can use `emitRoot()` from any child context to send events to the root (see Advanced).

### 3.2a Replace host option

Use **`replaceHost: true`** in mount options to **replace** the host element with the component’s root (the host is removed from the DOM; the component’s first top-level element takes its place). The host’s `id` is copied to the new root so selectors (e.g. `#app` for the router outlet) still work. On destroy, the component root is removed from the DOM. See **docs/komponentor.md** for full implications (remount, router, fallback when host has no parent).

### 3.3 Component HTML and init

Each component is an **HTML file** that can contain:

- **Markup** – Any HTML. It’s parsed and inserted into the host (scripts are stripped and run in isolation).
- **Script** – Optional. Define **`init_komponent(komponent, data)`** (or assign it). It runs after the HTML is rendered, with:
  - **`komponent`** – The Komponent instance.
  - **`data`** – The `data` object passed at mount (or from `url|key=val`).

Example component: `components/panel.html`

```html
<div class="panel">
  <h2 class="panel-title"></h2>
  <div class="panel-body"></div>
</div>
<script>
  function init_komponent(komponent, data) {
    komponent.find(".panel-title").textContent = data.title || "Untitled";
    komponent.find(".panel-body").textContent = data.body || "";
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
- `komponent.find(selector)` – `hostEl.querySelector(selector)`.
- `komponent.findAll(selector)` – `Array.from(hostEl.querySelectorAll(selector))`.
- `komponent.mount()` – (Re-)run mount (async).
- `komponent.scan({ replaceExisting })` – Scan inside host for `data-komponent`.
- `komponent.destroy()` – Destroy this component and its children.

**Context (`komponent.ctx`):**

- `ctx.on(event, fn, ctx)` / `ctx.off(event, fn, ctx)` / `ctx.trigger(event, payload)` – Scoped events.
- `ctx.state` – `"initial"` | `"loading"` | `"rendering"` | `"init"` | `"ready"` | `"error"` | `"destroying"` | `"destroyed"`.
- `ctx.onDestroy(fn)` – Run `fn(ctx)` on destroy (reverse order).
- `ctx.requestText(url, fetchOpts)` – Fetch text with abort-on-destroy and stale guard (returns `Promise<string|null>`).
- `ctx.emitUp(event, payload)` – Trigger event on this context and each parent up the tree.
- `ctx.emitRoot(event, payload)` – Trigger on the manager’s root context (if any).

---

## 4. Scan and `data-komponent` markers

You can declare child components in HTML with the **`data-komponent`** attribute. Format: **`url|key=value|...`**.

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

If you mounted a parent with **`autoload: true`** (default), that parent will **automatically** call `scan()` on its host after it becomes ready, so nested `data-komponent` placeholders inside the fetched HTML are mounted as children.

---

## 5. Hash router

Use the router to mount different components in an outlet based on the hash.

```javascript
komponentor.route({
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

- **`outlet`** – Selector (or element) where the route component is mounted.
- **`routes`** – Object: hash pattern → **component URL (string)** or **callback(outletEl, route)**. Patterns like `#/users/:id` produce **params**. If the value is a function, it is called with the outlet element and `{ hash, params }`; you can then call `komponentor.mount(outletEl, ...)` with custom options or run any logic.
- **`notFound`** – URL (string) or callback(outletEl, route) when no route matches.

Navigate programmatically:

```javascript
komponentor.navigate("#/users/42");
```

In the mounted component, **`data.route`** is set by the router:

- `data.route.hash` – e.g. `"#/users/42"`.
- `data.route.params` – e.g. `{ id: "42" }`.

Example component for `#/users/:id`:

```html
<div class="user-detail">
  <p>User id: <span class="user-id"></span></p>
</div>
<script>
  function init_komponent(komponent, data) {
    const id = data.route && data.route.params && data.route.params.id;
    komponent.find(".user-id").textContent = id || "—";
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

- **`komponent.parent`** – Parent Komponent (or `null`).
- **`komponent.children`** – Array of child Komponents.
- **`komponent.ctx.parent`** / **`komponent.ctx.children`** – Same structure at the Context level.

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

- **`ctx.emitUp(event, payload)`** – Fires `event` on this context, then on `ctx.parent`, then its parent, and so on. Useful for “something happened in a child, notify ancestors.”
- **`ctx.emitRoot(event, payload)`** – Fires the event on the **root context** only (the one set with `komponentor.root()`). Use for app-level notifications (e.g. “open sidebar”, “show toast”).

Example: child notifies parent and root.

In a child component:

```javascript
function init_komponent(komponent, data) {
  const btn = komponent.find("button.report");
  if (btn) {
    btn.addEventListener("click", function () {
      komponent.ctx.trigger("child:clicked", { id: data.id });
      komponent.ctx.emitUp("child:clicked", { id: data.id });
      komponent.ctx.emitRoot("notify", { message: "Child " + data.id + " clicked" });
    });
  }
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
  komponentor.root("#app", "components/shell.html");
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
    komponent.find(".card-title").textContent = data.title || "Card";
    komponent.find(".card-action").addEventListener("click", function () {
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
  komponent.manager.mount(placeholder, {
    url: "components/widget.html",
    data: { source: data.source },
    parent: komponent,
    replaceHost: false,  // optional: true to replace placeholder with component root
  });
}
```

Here `komponent.manager` is the **Komponentor** instance. The new component is attached as a child of `komponent` because of `parent: komponent`.

### 6.6 Intents (headless: no DOM, no render)

An **Intent** loads an HTML file and runs its init script **without** attaching to a DOM node. No rendering, no overlay, no `data-komponent` bindings. Data comes only from the URL spec (`url|key=val`) and from programmatic `.data()` or arguments. Intents can be part of the component tree (when created with a **parent**), so they are destroyed when the parent is destroyed.

**Fluent API:**

```javascript
// Build URL + data, then run. Returns the Intent instance (after run).
const intent = await komponentor.intent("modals/confirm.html|action=delete")
  .data({ id: 42, title: "Delete item?" })
  .send({ parent: komponent });  // optional: attach to component tree
```

**Convenience:**

```javascript
const intent = await komponentor.runIntent("services/sync.html", { task: "full" });
```

**Intent instance:** `intent.url`, `intent.data`, `intent.ctx` (Context: `on`, `trigger`, `requestText`, `onDestroy`, `state`, `ready`). The init function in the intent’s HTML receives `(intent, data)` and can, for example, call `komponentor.mount(el, ...)` to attach UI elsewhere.

#### Example 1: Intent from a component (part of the tree)

Use an intent as a child of a component so it is torn down when the component is destroyed (e.g. when leaving the route).

```javascript
// Inside a component's init_komponent(komponent, data)
async function init_komponent(komponent, data) {
  const openModalBtn = komponent.find("#open-modal");
  openModalBtn.addEventListener("click", async function () {
    const i = await komponentor.intent("modals/dialog.html|title=Confirm")
      .data({ message: "Continue?", source: komponent })
      .send({ parent: komponent });
    // i.ctx.ready; i.data. Dialog's init may call komponentor.mount(outlet, ...) to show UI.
    // When komponent is destroyed, this intent is destroyed too (cascade).
  });
}
```

**modals/dialog.html** (no host element; init runs with the Intent instance):

```html
<script>
  function init_komponent(intent, data) {
    // intent is the Intent instance; intent.manager is Komponentor
    const outlet = document.getElementById("modal-outlet");
    if (outlet) {
      intent.manager.mount(outlet, {
        url: "modals/dialog-view.html",
        data: data,
        parent: null,
      });
    }
  }
</script>
```

#### Example 2: Global intent (no parent)

Run a headless script that is not attached to any component tree (e.g. a background task or one-off setup).

```javascript
// No parent: intent is not in any tree; you manage its lifecycle yourself.
const intent = await komponentor.runIntent("services/analytics.html", {
  event: "pageview",
  path: location.pathname,
});
// intent.ctx.ready; use or store intent reference; call intent.destroy() when done.
```

---

### 6.7 Rescan / replace children

By default, **scan** runs only once per component (on first load). To allow re-scanning and replacing existing child components:

- When calling **scan** manually: `komponentor.scan(container, { parent: k, replaceExisting: true })`.
- For the automatic scan after mount, the component option **`replaceExistingChildren`** is not in the default opts; the single-file implementation uses **`opts.autoload !== false`** and **`opts.replaceExistingChildren === true`** to decide whether to pass `replaceExisting: true` to scan. So when creating a component (e.g. via `manager.mount` with opts), you can pass `replaceExistingChildren: true` if you want its automatic scan to replace existing children.

---

## 7. Quick reference

| Goal | Use |
|------|-----|
| Mount one component | `komponentor.mount(host, urlOrOpts)` |
| Set app root (replace on re-root) | `komponentor.root(host, urlOrOpts)` |
| Mount from markers in DOM | `komponentor.scan(container?, { parent?, replaceExisting? })` |
| Hash routing | `komponentor.route({ outlet, routes, notFound })`, `komponentor.navigate(hash)` |
| Headless intent (no DOM) | `komponentor.intent(urlOrOpts).data(...).send({ parent? })`, `komponentor.runIntent(url, data, { parent? })` |
| In component: DOM query | `komponent.find(selector)`, `komponent.findAll(selector)` |
| In component: events | `komponent.ctx.on` / `off` / `trigger` |
| In component: bubble to ancestors | `komponent.ctx.emitUp(event, payload)` |
| In component: notify root | `komponent.ctx.emitRoot(event, payload)` |
| In component: fetch | `komponent.ctx.requestText(url, fetchOpts)` |
| In component: cleanup | `komponent.ctx.onDestroy(fn)` |
| Nested placeholders | Put `data-komponent="url|key=val"` in HTML; use autoload or call `scan()` |
| Intent in tree (destroy with parent) | Pass `parent: komponent` to `.send({ parent })` or `runIntent(..., { parent })` |

For more examples, see the **examples** folder and **docs/USAGE-GUIDE.md** (older multi-file stack).
