# Security

Komponentor is designed for **first-party, developer-authored components** on a known origin. It is **not** a sandbox for untrusted HTML or user-supplied component URLs.

This page describes trust boundaries, common risks, and mitigations. See also [komponentor.md](./komponentor.md) and [ksimpleviews.md](./ksimpleviews.md).

---

## Trust model

| You trust | Komponentor assumes |
|-----------|---------------------|
| Component `.html` files on your server (or fixed CDN paths) | Markup and `<script>` bodies are **application code** |
| URLs passed to `mount`, `route`, `data-komponent`, `intent` | Paths are **allowlisted** by your app, not raw user input |
| Data in `init_komponent(k, data)` and route `params` | Values are safe for how **you** render them (DOM, templates) |
| `komponentor.config` (overlay HTML, `errorHtml`, etc.) | Set only by your application |

**Do not:**

- Mount component URLs built from query strings, form fields, or API responses without an allowlist.
- Let end users author or upload component HTML.
- Render route params or model fields into HTML without escaping (especially with KSimpleViews’ built-in `{{key}}` fallback).

---

## Component loading executes code

Fetched component HTML is parsed in the browser. Inline `<script>` text is run via `new Function` with access to `komponent`, `data`, and the global `komponentor` instance — equivalent to **dynamic code execution** in the page context.

**Mitigation:** Serve components only from origins you control; use HTTPS; pin paths; treat compromised static hosting as a full application compromise.

---

## Cross-site scripting (XSS)

### Markup insertion

Component markup (minus `<script>` nodes) is inserted with jQuery `.html()`. Dangerous markup can still execute via event handlers, `javascript:` URLs, or similar — not only via `<script>` tags.

**Mitigation:** Author safe components; use Content-Security-Policy (see below); never load untrusted HTML.

### Default `errorHtml`

The default `errorHtml(url, err)` interpolates `url` into HTML. If `url` can contain attacker-controlled characters (e.g. `mount(host, userInput)`), a failed load can show **reflected XSS**.

**Mitigation:** Override `errorHtml` and escape values, or use DOM APIs with `.text()`:

```javascript
komponentor.config.errorHtml = (url, err) => {
  const $el = $("<div class='komponent-error'>").text("Failed to load: " + String(url));
  return $el[0].outerHTML;
};
```

### Route parameters and `data`

Hash/history routers pass `data.route.params` into mounted components. Param segments are matched with `[^/]+` (no path traversal in the router). Values are still **untrusted strings** if they come from the URL bar.

**Mitigation:** Use `.text()` / jQuery `.text()` for display; escape before template interpolation.

### KSimpleViews templates

- **Built-in `{{key}}` fallback:** Values are inserted as **plain text into HTML** with no escaping — user-controlled model data can cause XSS.
- **Handlebars:** Default escaping applies to `{{name}}`; triple-stash `{{{name}}}` and raw HTML helpers are unsafe with untrusted data.

**Mitigation:** Escape on write, use Handlebars with default mustaches, or only bind trusted data.

---

## `fetch` and URLs

`Context.requestText` and the load pipeline call `fetch(url, fetchOptions)` for component and intent URLs.

- Requests run in the **user’s browser** (not server-side SSRF).
- Relative URLs load from the **current origin**.
- Absolute URLs may load cross-origin if permitted; response text is then parsed and executed as a component.

`config.fetchOptions` is merged into `fetch()` (e.g. `credentials`, headers). Avoid pointing fetches at attacker-chosen origins with `credentials: "include"` unless intentional.

**Mitigation:** Allowlist component base paths; set `baseUrl` to a fixed prefix; never pass user input directly as `url`.

---

## `scan()` and the DOM

`komponentor.scan(container)` mounts every `[data-komponent]` under `container` (default `document.body`). If an attacker can inject that attribute into the page (stored HTML injection, compromised template), they can trigger loads of attacker-chosen specs.

**Mitigation:** Scan a dedicated app root, not `body`, when possible; prevent HTML injection in pages that use Komponentor.

---

## Content-Security-Policy (CSP)

Strict CSP affects Komponentor by design:

| Mechanism | CSP note |
|-----------|----------|
| `new Function` for component scripts | Requires `'unsafe-eval'` unless you avoid inline component scripts entirely |
| Inline handlers in component HTML / demos | Often require `'unsafe-inline'` for `script-src` or refactor to listeners in `init_komponent` |
| jQuery `.html()` | Does not execute `<script>` tags from strings; other vectors may still violate `default-src` |

Document CSP expectations for deployments. Many apps use a relaxed policy for legacy jQuery apps or load only trusted components without third-party markup.

---

## Configuration HTML

These config values are inserted with `.html()`:

- `overlayHtml`
- `routeTransitionHtml`
- `errorHtml` (return value)

Only set them from trusted application code.

---

## What is not a framework vulnerability

- **jQuery as a dependency** — supply-chain and version hygiene are your responsibility.
- **Hash routing** — changing `location.hash` does not by itself redirect users to external sites.
- **Event handler exceptions** — swallowed in the event bus by design (stability); log in `config.debug` or wrap handlers if you need audit trails.

---

## Checklist for adopters

1. Component URLs come from a fixed map or server-side allowlist, not the URL query or user input.
2. Component HTML is authored and deployed like source code, not CMS/user content.
3. Route params and model fields are escaped when rendered in HTML or templates.
4. `errorHtml` / custom overlays do not interpolate raw strings into HTML.
5. CSP and hosting are reviewed for your threat model.
6. Optional: `scan()` targets `#app` (or similar), not entire `document.body`.
