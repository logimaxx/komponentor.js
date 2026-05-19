# KSimpleViews

KSimpleViews provides simple **KModel** (observable data) and **KView** (template-backed view) binding. Views re-render when the model’s data changes. No Komponentor dependency.

**File:** `src/ksimpleviews.js`  
**Dependencies:** jQuery (required). Handlebars optional (full template syntax); otherwise a built-in `{{key}}` / `{{key.sub}}` fallback is used.

---

## Exports (global)

- **`KModel`** - Observable data container.
- **`KView`** - View that renders a single element’s `outerHTML` as a template and replaces it with the rendered output.
- **`getKModel(el)`** - Returns the KModel bound to the nearest `[is=kview]` ancestor of `el` (e.g. from an input’s `onchange`).

---

## KModel

Holds data and notifies bound views to re-render when data changes.

### Constructor

```javascript
const model = new KModel(initialData);
// initialData = plain object, e.g. { name: "Jane", count: 0 }
```

### Properties

- **`model.props`** - Read-only copy of current data (same reference as internal state).
- **`model.data`** - Get/set full data; setter triggers `render()` on all bound views.
- **`model.views`** - Array of bound KView instances.

### Events

KModel emits events you can subscribe to with **`on(event, fn, ctx)`** and unsubscribe with **`off(event, fn, ctx)`**. **`trigger(event, payload)`** fires an event (used internally; you can use it for custom events).

| Event | When | Payload |
|--------|------|---------|
| **`change`** | After **`update(name, value)`** or after **`data`** setter. | `{ name, value }` for `update`, or `{ data }` for full data set. |
| **`view:bind`** | When a view is added via **`bindView(view)`**. | `{ view }`. |
| **`view:unbind`** | When a view is removed via **`unbindView(view)`**. | `{ view }`. |
| **`destroy`** | When **`destroy()`** is called (before views are destroyed). | `{ model }` (this KModel). |

```javascript
model.on("change", (payload) => {
  if (payload.name) console.log("field changed:", payload.name, payload.value);
  else console.log("data replaced:", payload.data);
});
model.on("destroy", () => { /* cleanup */ });
```

### Methods

| Method | Description |
|--------|-------------|
| **`on(event, fn, ctx)`** | Subscribe to an event; optional `ctx` as `this` for `fn`. Returns this. |
| **`off(event, fn, ctx)`** | Unsubscribe (same `fn` and `ctx` as `on`). Returns this. |
| **`trigger(event, payload)`** | Emit event to all listeners. Returns this. |
| **`update(name, value)`** | Set `data[name] = value` and re-render all bound views. |
| **`bindView(view)`** | Register a KView (and call `view.setModel(this)` so it renders once). |
| **`unbindView(view)`** | Remove view from `views`. |
| **`unbindAllViews()`** | Clear `views` array. |
| **`render()`** | Call `render()` on each bound view. |
| **`destroy()`** | Destroy all bound views, clear `views` and internal data. |

### Example

```javascript
const model = new KModel({ name: "Jane", count: 0 });
model.update("count", 1);
model.props;   // { name: "Jane", count: 1 }
model.data = { name: "Other" };  // all bound views re-render
model.destroy();
```

---

## KView

Renders a **single** DOM element’s `outerHTML` as a template, then **replaces** that element with the rendered result. The template is compiled once (Handlebars if available, else built-in `{{key}}`).

### Constructor

```javascript
const view = new KView(el, lifecycle);
```

- **`el`** - Single element: jQuery collection of length 1, or HTMLElement, or selector string. The element’s **outerHTML** is used as the template source. After first render, this element is replaced by the rendered root.
- **`lifecycle`** - Optional object with **`onDestroy(fn)`**. If provided, `view.destroy()` is registered so the view is destroyed when the lifecycle is torn down (e.g. komponent context `k` with `k.ctx.onDestroy(...)`).

**Throws** if `el` does not resolve to exactly one node.

### Methods

| Method | Description |
|--------|-------------|
| **`setModel(model)`** | Set the KModel and call `render()`. Called automatically by `model.bindView(view)`. |
| **`getRoot()`** | Returns the current root as jQuery (mount element before first render, then the rendered root). |
| **`render()`** | Re-render using current `model.props`. Replaces current root with new output. |
| **`destroy()`** | Unbind from model, remove view root from DOM, clear references. |

### Binding model to view

Use **`model.bindView(view)`** (not the other way around). It adds the view to the model and calls `view.setModel(model)`, which triggers the first render.

```javascript
const model = new KModel({ name: "Jane" });
// lifecycle: object with onDestroy(fn), e.g. k.ctx when used with Komponentor
const view = new KView(document.querySelector("#form"), lifecycle);
model.bindView(view);
```

### Rendered root markup

After render, the root element has:

- **`[is=kview]`** - Attribute for identifying KView roots.
- **`data("model")`** - The KModel instance (so `getKModel(childEl)` works).

---

## getKModel(el)

Returns the **KModel** attached to the nearest ancestor that is a KView root (`[is=kview]`).

```javascript
// In HTML: input inside a KView-rendered block
<input type="text" name="name" value="{{name}}"
  onchange="getKModel(this).update('name', this.value)" />
```

- **`el`** - DOM element or jQuery; traversal uses `$(el).parents("[is=kview]").data("model")`.

---

## Template syntax

- **With Handlebars:** Full Handlebars syntax (`{{name}}`, `{{#if x}}...{{/if}}`, etc.). Use `window.Handlebars` before loading KSimpleViews.
- **Without Handlebars:** Only **`{{key}}`** and **`{{key.sub}}`** (dot path), no conditionals or loops.

Templates are compiled once from the element’s `outerHTML` at construction time.

### Escaping and XSS

- **Built-in fallback:** `{{key}}` values are converted with `String(value)` and written into HTML **without escaping**. If `model` data can contain user input or route parameters, this can cause **cross-site scripting (XSS)**.
- **Handlebars:** `{{name}}` is HTML-escaped by default. `{{{name}}}` and helpers that emit raw HTML are unsafe with untrusted data.

**Mitigation:** Only bind trusted data; sanitize or escape before `model.update()`; prefer Handlebars default mustaches; use `.text()` in jQuery when setting DOM from params. See **[SECURITY.md](./SECURITY.md)**.

---

## Integration with Komponentor

Inside a komponent’s `init_komponent(k)`:

```javascript
const model = new KModel({ name: "John", age: 2 });
model.bindView(new KView(k.find("#test"), k.ctx));   // k.ctx has onDestroy(fn)
model.bindView(new KView(k.find("#test2"), k.ctx));
k.data.test = model;
```

Pass the **lifecycle** object that has **`onDestroy(fn)`**. With Komponentor, use **`k.ctx`** so the view is destroyed when the component is destroyed.

---

## Load order

1. jQuery  
2. (Optional) Handlebars  
3. `ksimpleviews.js`
