# Komponentor refactor — summary and migration

## What changed and why

1. **Intent is temporary UI only**  
   Intent now mounts real DOM into an outlet (default `document.body`), creates its own root container (`.komponentor-intent`), and removes that DOM on `close()` or `destroy()`. It is no longer headless or a generic background runner.

2. **Shared load pipeline**  
   `_runLoadPipeline(url, ctx, ownerForInit)` centralizes: resolve URL → fetch HTML → parse HTML → extract script/init. Both Komponent and Intent use it, so load/parse/init logic is not duplicated.

3. **Explicit lifecycle**  
   States used in flow: `initial` → `loading` → `loaded` → `mounting` → `mounted` → `initializing` → `ready` (or `error`). Intent adds `closing` before teardown. Context and destroy use `destroying` → `destroyed`. Semantics are documented in code.

4. **Async consistency**  
   - Komponent: `mount()` and `root()` return the instance; each instance has a `readyPromise` that resolves with the instance when ready (or rejects on mount error).
   - Intent: instance has `readyPromise` (resolves when mounted and init ran) and `resultPromise` (resolves when `close(result)` is called). `close(result)` unmounts DOM and settles `resultPromise`.

5. **DOM ownership / instance tracking**  
   Instance and lock tracking moved to manager-level `WeakMap`s (`_instanceByElement`, `_lockByElement`). No more `data-*` or other DOM-attached metadata for ownership.

6. **replaceHost**  
   Kept as an advanced/special case; default path is “append into host”. Comment in `_renderIntoHost` clarifies.

7. **Scan**  
   Declarative `data-komponent` scan unchanged; scoped to persistent components only (not intents).

---

## Migration note (public API)

- **Komponent**  
  - **Added:** `readyPromise` on every Komponent instance (resolve when ready, reject on mount error).  
  - **Unchanged:** `root(host, urlOrOpts)`, `mount(host, urlOrOpts)`, `scan(...)`, `remount()`, `destroy()`, `find`/`findAll`, `opts`, `ctx`, `children`, `parent`.

- **Intent**  
  - **Added:** `readyPromise`, `resultPromise`, `close(result)`, `outlet` option (default `"body"`).  
  - **Behavior change:** Intent now mounts its content into the outlet; you no longer need to append `k.hostEl` to `body` in init. Use `k.close()` instead of `k.hostEl.remove(); k.destroy()`.  
  - **Fluent:** `intent(...).send({ parent, outlet })` — `outlet` is optional.  
  - **runIntent:** `runIntent(url, data, { parent, outlet })` — `outlet` optional.

- **Instance tracking**  
  - `getInst` / `setInst` / `lockHost` / `unlockHost` / `clearInst` are no longer global helpers; they are **methods on the Komponentor instance**. If you had custom code calling these, switch to `komponentor.getInst(el)` etc.

- **Correctness over compatibility**  
  - Any code that relied on Intent not mounting (e.g. manual append in init) should be updated to use the new outlet/mount and `close()`.

---

## Intentional compromises (internal pragmatic tool)

- **Single file**  
  Still one file; no split into modules for now.

- **replaceHost**  
  Kept as a special case; default path does not rely on it.

- **Lifecycle**  
  No formal state machine object; states are set on Context and used in order. Not every state is used by both Komponent and Intent.

- **Router**  
  Hash router only; no history or advanced routing.

- **Intent result**  
  `resultPromise` is resolve-only (no reject path for “cancel”); `close(undefined)` or `destroy()` settles it.

- **jQuery**  
  Still required; no abstraction over DOM.

---

## Review refactor (second pass) — summary

1. **Host abstraction**  
   Host is officially a jQuery object. `normalizeHost()` returns jQuery; `$host` is the primary reference, `hostEl = $host[0]` where a raw DOM node is needed (e.g. WeakMap keys). Komponent constructor now takes `($host, opts)`; all lock/existing-instance logic lives in `Komponentor.mount()`.

2. **Intent find/findAll**  
   Intent exposes `find(selector)` and `findAll(selector)` that query inside its mounted wrapper (`$host`).

3. **No constructor factory**  
   Komponent constructor only constructs. Lock and “return existing instance” / concurrent-mount handling are done in `Komponentor.mount()` using `lockHost($host, true)` before `new Komponent()`. `_skipMount` removed.

4. **Intent lifecycle**  
   Single source of truth: only `Context.destroy()` sets `destroying` → `destroyed`. Intent `close()` sets `closing`, unmounts, resolves `resultPromise`, then calls `ctx.destroy()` and `_unlinkFromParent()`; it does not set `ctx.state = "destroyed"`. Intent `destroy()` unmounts, calls `ctx.destroy()`, unlinks; no duplicate state transitions.

5. **_parseHtml fail fast**  
   Script parse/execution errors in init extraction are no longer caught; they propagate so mount/intent run go into error flow.

6. **Intent DOM contract**  
   Intent owns one wrapper element (`$host`). Content is appended inside it. `find()`/`findAll()` query inside `$host`. `close()`/`destroy()` remove `$host` from DOM. Intent no longer uses `$container`/`$hostEl`; only `$host` and `hostEl`.

7. **replaceHost rule**  
   When `replaceHost === true`, the component HTML must have **exactly one** top-level element; otherwise an error is thrown. No implicit wrapping or shape-changing by node count.

8. **Router**  
   `load` event binding removed from `HashRouter.start()`; only `hashchange` and the single initial `_handler()` call are used. Avoids duplicate routing on load.

### API-affecting notes

- **Komponent**: Constructor signature is unchanged from the caller’s perspective (still `mount(host, opts)` with host as selector/element/jQuery). Internally the second argument is the normalized jQuery host.
- **Intent**: Use `$host` (and `hostEl`) instead of `$container`/`$hostEl`. If you had code using `intent.$hostEl` or `intent.$container`, switch to `intent.$host`.
- **replaceHost**: Components that relied on zero or multiple top-level elements with `replaceHost: true` will now throw; ensure exactly one root element.
- **Script errors**: Fetched HTML with broken or throwing script in `<script>` will now fail the mount/intent run instead of continuing without init.
