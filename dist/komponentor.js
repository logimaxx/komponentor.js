/*! komponentor v1.0.0
 * A jQuery plugin to create modular web apps
 * (c) 2026 Sergiu Voicu (Logimaxx Systems SRL) https://logimaxx.ro
 * Released under the MIT License
 */

(() => {
  /*!
   * Komponentor (single-file) — internal rapid-development runtime
   * - Komponent: persistent UI, tree (parent/children), scan, destroy cascade
   * - Intent: temporary UI only (modal, dialog, popup); mounts into outlet, close/destroy unmounts
   * - Shared load pipeline (resolve → fetch → parse → init) for both
   * - Optional hash/history router; declarative scan via data-komponent
   * - Requires jQuery
   *
   * Public API:
   *   komponentor.root(host, urlOrOpts)  → Promise<Komponent> (resolves when mounted and ready)
   *   komponentor.mount(host, urlOrOpts) → Promise<Komponent> (awaits full load + render + init)
   *   komponentor.unmount(host) → boolean (true if a Komponent on that host was torn down)
   *   komponent.unmount() / intent.unmount() — same as destroy() (lifecycle + DOM teardown)
   *   komponentor.scan(container?, { parent?, replaceExisting? })
   *   komponentor.route({ mode, outlet, routes, notFound })
   *   komponentor.navigate(pathOrHash, { replace?, state? })
   *   Router modes: `hash` (default) or `history`; optional full-page transition overlay (`config.routeTransition*`).
   *   komponentor.intent(urlOrOpts).data(...).send({ parent, outlet }) → Intent (readyPromise, resultPromise, close(result), destroy())
   *   komponentor.runIntent(url, data, { parent, outlet }) → Intent
   *
   * Lifecycle (conceptual): initial → loading → loaded → mounting → mounted → initializing → ready | error; destroying → destroyed.
   * Intent adds: closing before destroyed. replaceHost is an advanced option (host replaced by component root).
   *
   * Component marker: <div data-komponent="/path/to/component.html|id=5|foo=bar"></div>
   *
   * Mounted host: jQuery stores the Komponent on the host via `$(host).data(config.hostKomponentDataKey)`
   * (default `komponentorKomponent`). Optional marker attribute `config.hostKomponentMountedAttr` (default
   * `data-komponentor-instance`) is set to `1` while mounted (cleared on unmount). The live instance cannot live in a
   * string HTML attribute; use `.data()` or `komponentor.getInst(host)`.
   *
   * Intent (temporary UI): mounts real DOM into outlet (default body). Use close(result) to dismiss and resolve resultPromise.
   */
  (function(global) {
    "use strict";
    const $ = global.jQuery;
    if (!$ || typeof $.fn !== "object") throw new Error("Komponentor requires jQuery");
    function isPlainObject(x) {
      return x && typeof x === "object" && x.constructor === Object;
    }
    function uid(prefix = "") {
      return prefix + Math.random().toString(36).slice(2, 9) + "_" + Math.random().toString(36).slice(2, 7);
    }
    function normalizeHost(host) {
      if (host == null) throw new Error("Invalid host");
      if (typeof host === "string") {
        const $el2 = $(host);
        if (!$el2.length) throw new Error("Host not found: " + host);
        return $el2;
      }
      if (host.jquery) return host;
      const $el = $(host);
      if (!$el.length) throw new Error("Invalid host type");
      return $el;
    }
    function toElement(elOrJq) {
      if (!elOrJq) return null;
      if (elOrJq.jquery && elOrJq.length) return elOrJq[0];
      const el = typeof elOrJq === "string" ? $(elOrJq)[0] : elOrJq;
      return el && el.nodeType ? el : null;
    }
    function parseSpec(specText) {
      const out = { url: "", data: {} };
      if (!specText) return out;
      const parts = String(specText).split("|");
      out.url = parts.shift() || "";
      parts.forEach((p) => {
        if (!p) return;
        const i = p.indexOf("=");
        if (i === -1) {
          out.data[p] = null;
        } else {
          const k = p.slice(0, i);
          const v = p.slice(i + 1);
          out.data[k] = v === "" ? "" : v;
        }
      });
      return out;
    }
    function markerAttrToDatasetKey(attrName) {
      if (!attrName || !String(attrName).toLowerCase().startsWith("data-")) return null;
      return String(attrName).slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }
    function getDataAttributesFromElement(elOrJq, markerAttr) {
      const $el = elOrJq && elOrJq.jquery ? elOrJq : $(elOrJq);
      if (!$el.length) return {};
      const excludeKey = markerAttrToDatasetKey(markerAttr);
      const out = {};
      $.each($el.data(), function(key, val) {
        if (key !== excludeKey) out[key] = val;
      });
      return out;
    }
    class EventBus {
      constructor() {
        this._map = /* @__PURE__ */ new Map();
      }
      on(event, fn, ctx) {
        if (typeof fn !== "function") return;
        const arr = this._map.get(event) || [];
        arr.push({ fn, ctx: ctx || null });
        this._map.set(event, arr);
      }
      off(event, fn, ctx) {
        const arr = this._map.get(event);
        if (!arr) return;
        this._map.set(
          event,
          arr.filter((l) => !(l.fn === fn && (ctx == null || l.ctx === ctx)))
        );
      }
      emit(event, payload, thisArg) {
        const arr = this._map.get(event);
        if (!arr || !arr.length) return;
        for (const l of arr.slice()) {
          try {
            l.fn.call(l.ctx || thisArg || null, payload);
          } catch (e) {
          }
        }
      }
      clear() {
        this._map.clear();
      }
    }
    class Context {
      constructor(owner, manager) {
        this.id = uid("k_");
        this.owner = owner;
        this.manager = manager;
        this.parent = null;
        this.children = [];
        this.ready = false;
        this._destroyed = false;
        this._state = "initial";
        this._bus = new EventBus();
        this._destroyers = [];
        this._req = { token: 0, ctrl: null };
      }
      get state() {
        return this._state;
      }
      set state(v) {
        this._state = v;
        this.trigger("state:change", { state: v, ctx: this });
        this.trigger(`state:${v}`, this);
      }
      /** Subscribe on this context’s bus; `ctx` defaults to this Context. */
      on(event, fn, ctx) {
        this._bus.on(event, fn, ctx || this);
        return this;
      }
      off(event, fn, ctx) {
        this._bus.off(event, fn, ctx || this);
        return this;
      }
      /** Emit to listeners on this context only. */
      trigger(event, payload) {
        this._bus.emit(event, payload, this);
        return this;
      }
      /** Walk `ctx.parent` and trigger the same event on each ancestor context. */
      emitUp(event, payload) {
        let p = this.parent;
        while (p) {
          p.trigger(event, payload);
          p = p.parent;
        }
        return this;
      }
      /** Emit on the root komponent’s context (set by `komponentor.root`). */
      emitRoot(event, payload) {
        const root = this.manager && this.manager._rootCtx ? this.manager._rootCtx : null;
        if (root) root.trigger(event, payload);
        return this;
      }
      /** Run `fn(this)` during `destroy`, after children, in reverse registration order. */
      onDestroy(fn) {
        if (typeof fn === "function") this._destroyers.push(fn);
        return this;
      }
      /** Abort the in-flight `requestText` for this context (new request or destroy). */
      requestAbort() {
        try {
          if (this._req.ctrl) this._req.ctrl.abort();
        } catch (_) {
        }
        this._req.ctrl = null;
      }
      /**
       * GET `url` as text; bumps a token so overlapping calls discard stale results.
       * @returns {Promise<string|null>} `null` if destroyed or superseded.
       */
      async requestText(url, fetchOpts = {}) {
        this._req.token += 1;
        const t = this._req.token;
        this.requestAbort();
        const ctrl = new AbortController();
        this._req.ctrl = ctrl;
        const res = await fetch(url, Object.assign({}, fetchOpts, { signal: ctrl.signal }));
        if (this._destroyed) return null;
        if (t !== this._req.token) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const text = await res.text();
        if (this._destroyed) return null;
        if (t !== this._req.token) return null;
        return text;
      }
      /** Tear down children, run `onDestroy` callbacks, clear bus; idempotent. */
      destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this.state = "destroying";
        this.trigger("context:destroy", this);
        this.requestAbort();
        const kids = this.children.slice();
        this.children = [];
        for (const ch of kids) {
          try {
            if (ch && typeof ch.destroy === "function") ch.destroy();
          } catch (_) {
          }
        }
        const ds = this._destroyers.slice().reverse();
        this._destroyers = [];
        for (const fn of ds) {
          try {
            fn(this);
          } catch (_) {
          }
        }
        this._bus.clear();
        this.ready = false;
        this.state = "destroyed";
      }
    }
    class Komponent {
      constructor(manager, $host, opts, lockToken) {
        this.manager = manager;
        this.$host = $host;
        this.hostEl = this.$host[0];
        this.opts = manager._normalizeOpts(opts);
        this.url = this.opts.url || "";
        this.data = this.opts.data || {};
        this.parent = this.opts.parent || null;
        this.children = [];
        this._scanned = false;
        this._destroyed = false;
        this._lockToken = lockToken !== void 0 ? lockToken : this;
        if (lockToken === void 0) manager.setInst(this.$host, this);
        this.ctx = new Context(this, manager);
        if (this.parent && (this.parent instanceof Komponent || this.parent instanceof Intent)) {
          this.parent.children.push(this);
          this.ctx.parent = this.parent.ctx;
          this.parent.ctx.children.push(this.ctx);
        }
        this.ctx.onDestroy(() => {
          manager.unlockHost(this.$host, this._lockToken);
          manager.clearInst(this.$host, this);
        });
        this._readyResolve = null;
        this._readyReject = null;
        this.readyPromise = new Promise((resolve, reject) => {
          this._readyResolve = resolve;
          this._readyReject = reject;
        });
      }
      /** @returns {jQuery} Descendants of this component’s host element. */
      find(selector) {
        return this.$host.find(selector);
      }
      /**
       * Attach (or re-attach) this instance to a new parent after mount/init.
       * Updates both the structural tree (parent.children) and the Context linkage
       * (ctx.parent + parent.ctx.children) so destroy cascades stay correct.
       */
      setParent(newParent) {
        if (this._destroyed) return this;
        if (newParent != null && !(newParent instanceof Komponent || newParent instanceof Intent)) {
          throw new Error("Komponent.setParent: parent must be Komponent or Intent (or null).");
        }
        if (this.parent === newParent) return this;
        const oldParent = this.parent;
        if (oldParent && oldParent.children) {
          const i = oldParent.children.indexOf(this);
          if (i !== -1) oldParent.children.splice(i, 1);
        }
        if (oldParent && oldParent.ctx && oldParent.ctx.children) {
          const j = oldParent.ctx.children.indexOf(this.ctx);
          if (j !== -1) oldParent.ctx.children.splice(j, 1);
        }
        this.parent = newParent || null;
        this.ctx.parent = this.parent ? this.parent.ctx : null;
        if (this.parent) {
          if (!this.parent.children.includes(this)) this.parent.children.push(this);
          if (!this.parent.ctx.children.includes(this.ctx)) this.parent.ctx.children.push(this.ctx);
        }
        return this;
      }
      /**
       * Fetch, parse, render, run `init_komponent`, then autoload `data-komponent` children.
       * Resolves `readyPromise` on success; unlocks host in `finally`.
       */
      async mount() {
        if (this._destroyed) return this;
        this.ctx.state = "loading";
        if (this.opts.overlay !== false) this.manager.overlay.show(this);
        try {
          const parsed = await this.manager._runLoadPipeline(this.url, this.ctx, this);
          if (parsed == null) {
            this.ctx.state = "error";
            const err = new Error("Component load aborted or stale");
            if (this._readyReject) this._readyReject(err);
            return this;
          }
          const { content, init } = parsed;
          this.ctx.state = "loaded";
          this.ctx.state = "mounting";
          this.manager._renderIntoHost(this, content);
          this.ctx.state = "mounted";
          this.ctx.state = "initializing";
          if (typeof init === "function") await init(this, this.data);
          this.ctx.ready = true;
          this.ctx.state = "ready";
          if (this.opts.autoload !== false) {
            this.scan({ replaceExisting: this.opts.replaceExistingChildren === true });
          }
          if (this._readyResolve) this._readyResolve(this);
        } catch (e) {
          this.ctx.state = "error";
          this.manager._renderError(this, e);
          if (this.manager.config.debug) this.manager.log("mount error", e);
          if (this._readyReject) this._readyReject(e);
        } finally {
          this.manager.overlay.hide(this);
          this.manager.unlockHost(this.$host, this._lockToken);
        }
        return this;
      }
      /**
       * Mount nested components under this host (one pass by default).
       * @param {{ replaceExisting?: boolean }} opts Pass `replaceExisting: true` to re-scan and replace.
       */
      scan({ replaceExisting = false } = {}) {
        if (this._destroyed) return this;
        if (this._scanned && replaceExisting !== true) return this;
        this._scanned = true;
        this.manager.scan(this.$host, {
          parent: this,
          replaceExisting
        });
        return this;
      }
      /** Destroy this instance and mount the same options again on the same host. */
      async remount() {
        if (this._destroyed) return this;
        this.destroy();
        return this.manager.mount(this.$host, Object.assign({}, this.opts, { replace: true }));
      }
      /** Destroy children, context, and clear/replace host per `replaceHost` / normal empty. */
      destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        const kids = this.children.slice();
        this.children = [];
        for (const ch of kids) {
          try {
            ch.destroy();
          } catch (_) {
          }
        }
        try {
          this.ctx.destroy();
        } catch (_) {
        }
        try {
          if (this.opts.replaceHost) {
            this.$host.remove();
            this.manager.clearInst(this.$host, this);
          } else {
            this.$host.empty();
          }
        } catch (_) {
        }
        if (this.parent && this.parent.children) {
          const i = this.parent.children.indexOf(this);
          if (i !== -1) this.parent.children.splice(i, 1);
        }
      }
      /** Alias for {@link #destroy}: tear down children, context, and clear/remove host DOM. */
      unmount() {
        this.destroy();
      }
    }
    const INTENT_CONTAINER_CLASS = "komponentor-intent";
    class Intent {
      constructor(manager, opts) {
        this.manager = manager;
        opts = manager._normalizeIntentOpts(opts);
        this.url = opts.url || "";
        this.data = opts.data || {};
        this.parent = opts.parent || null;
        this.outlet = opts.outlet != null ? opts.outlet : "body";
        this.children = [];
        this.$host = null;
        this.hostEl = null;
        this._destroyed = false;
        this._resultSettled = false;
        this.ctx = new Context(this, manager);
        if (this.parent && (this.parent instanceof Komponent || this.parent instanceof Intent)) {
          this.parent.children.push(this);
          this.ctx.parent = this.parent.ctx;
          this.parent.ctx.children.push(this.ctx);
        }
        this._readyResolve = null;
        this._readyReject = null;
        this.readyPromise = new Promise((resolve, reject) => {
          this._readyResolve = resolve;
          this._readyReject = reject;
        });
        this._resultResolve = null;
        this.resultPromise = new Promise((resolve) => {
          this._resultResolve = resolve;
        });
      }
      /** @returns {jQuery} Descendants inside the intent wrapper (`$host` set after `run()`). */
      find(selector) {
        return this.$host.find(selector);
      }
      /**
       * Attach (or re-attach) this intent to a new parent after it was created/mounted.
       * Keeps Context linkage in sync (parent.ctx.children) for correct destroy cascades.
       */
      setParent(newParent) {
        if (this._destroyed) return this;
        if (newParent != null && !(newParent instanceof Komponent || newParent instanceof Intent)) {
          throw new Error("Intent.setParent: parent must be Komponent or Intent (or null).");
        }
        if (this.parent === newParent) return this;
        const oldParent = this.parent;
        if (oldParent && oldParent.children) {
          const i = oldParent.children.indexOf(this);
          if (i !== -1) oldParent.children.splice(i, 1);
        }
        if (oldParent && oldParent.ctx && oldParent.ctx.children) {
          const j = oldParent.ctx.children.indexOf(this.ctx);
          if (j !== -1) oldParent.ctx.children.splice(j, 1);
        }
        this.parent = newParent || null;
        this.ctx.parent = this.parent ? this.parent.ctx : null;
        if (this.parent) {
          if (!this.parent.children.includes(this)) this.parent.children.push(this);
          if (!this.parent.ctx.children.includes(this.ctx)) this.parent.ctx.children.push(this.ctx);
        }
        return this;
      }
      /** Mount temporary UI into outlet and run init. Wrapper ($host) is created and appended to outlet.
       * On success returns this; on failure sets ctx.state to "error", rejects readyPromise, and throws. */
      async run() {
        if (this.ctx._destroyed || this._destroyed) return this;
        if (!this.url) {
          this.ctx.state = "error";
          this.manager.log("intent run: no url");
          const err = new Error("intent run: no url");
          if (this._readyReject) this._readyReject(err);
          throw err;
        }
        this.ctx.state = "loading";
        this.manager.log("intent run", this.url);
        try {
          const parsed = await this.manager._runLoadPipeline(this.url, this.ctx, this);
          if (parsed == null) {
            this.ctx.state = "error";
            const err = new Error("Intent load aborted or stale");
            if (this._readyReject) this._readyReject(err);
            throw err;
          }
          const { content, init } = parsed;
          this.ctx.state = "loaded";
          this.ctx.state = "mounting";
          const $outlet = $(this.outlet);
          if (!$outlet.length) {
            throw new Error("Intent outlet not found: " + this.outlet);
          }
          this.$host = $("<div>").addClass(INTENT_CONTAINER_CLASS).append(content.clone());
          this.hostEl = this.$host[0];
          $outlet.append(this.$host);
          this.ctx.state = "mounted";
          this.ctx.state = "initializing";
          if (typeof init === "function") await init(this, this.data);
          this.ctx.ready = true;
          this.ctx.state = "ready";
          if (this._readyResolve) this._readyResolve(this);
          return this;
        } catch (e) {
          if (this.$host && this.$host.length) this._unmount();
          this.ctx.state = "error";
          if (this.manager.config.debug) this.manager.log("intent run error", this.url, e);
          if (this._readyReject) this._readyReject(e);
          throw e;
        }
      }
      /** Resolve `resultPromise`, destroy context, unlink from parent; internal close path. */
      _teardown(result) {
        if (this._destroyed) return;
        this._destroyed = true;
        this._unmount();
        if (!this._resultSettled && this._resultResolve) {
          this._resultSettled = true;
          this._resultResolve(result);
        }
        try {
          this.ctx.destroy();
        } catch (_) {
        }
        this._unlinkFromParent();
      }
      /** Dismiss intent and resolve `resultPromise` with `result` (once). */
      close(result) {
        if (this._destroyed) return;
        if (this._resultSettled) return;
        this.ctx.state = "closing";
        this._teardown(result);
      }
      _unmount() {
        if (this.$host && this.$host.length) {
          this.$host.remove();
          this.$host = null;
          this.hostEl = null;
        }
      }
      _unlinkFromParent() {
        const kids = this.children.slice();
        this.children = [];
        for (const ch of kids) {
          try {
            if (ch && typeof ch.destroy === "function") ch.destroy();
          } catch (_) {
          }
        }
        if (this.parent && this.parent.children) {
          const i = this.parent.children.indexOf(this);
          if (i !== -1) this.parent.children.splice(i, 1);
        }
      }
      /** Force teardown without a result (same as `close` with no meaningful payload). */
      destroy() {
        this._teardown(void 0);
      }
      /** Alias for {@link #destroy}: remove wrapper from DOM and tear down context. */
      unmount() {
        this.destroy();
      }
    }
    class HashRouter {
      constructor(manager) {
        this.manager = manager;
        this._started = false;
        this._handler = null;
        this.routes = [];
        this.outlet = null;
        this.notFound = null;
        this.ignore = null;
      }
      /** @returns {boolean} When true, hashchange does not run routing (see `ignore` option). */
      _isIgnored(hash) {
        if (!this.ignore) return false;
        const h = hash || "#/";
        if (typeof this.ignore === "function") return this.ignore(h) === true;
        const arr = Array.isArray(this.ignore) ? this.ignore : [this.ignore];
        for (const x of arr) {
          if (x instanceof RegExp && x.test(h)) return true;
          if (typeof x === "string" && (h === x || h.startsWith(x + "/") || h.startsWith(x + "?"))) return true;
        }
        return false;
      }
      // "#/users/:id" -> regex + keys. Param segments :name are replaced with ([^/]+).
      _compile(pattern) {
        const keys = [];
        let rx = "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rx = rx.replace(/:([a-zA-Z0-9_]+)/g, (_, k) => {
          keys.push(k);
          return "([^/]+)";
        });
        rx += "$";
        return { regex: new RegExp(rx), keys };
      }
      /** Replace route table and outlet; call `start()` separately to bind `hashchange`. */
      configure({ outlet = "#app", routes = {}, notFound = null, ignore = null } = {}) {
        this.outlet = outlet;
        this.notFound = notFound;
        this.ignore = ignore;
        this.routes = [];
        if (Array.isArray(routes)) {
          routes.forEach((r) => this.add(r.path, r.url != null ? r.url : r.handler));
        } else {
          Object.entries(routes).forEach(([path, urlOrHandler]) => this.add(path, urlOrHandler));
        }
        return this;
      }
      /** Register one pattern (e.g. `#/users/:id`) → component URL or `(outletEl, route) => void`. */
      add(pathPattern, urlOrHandler) {
        const c = this._compile(pathPattern);
        this.routes.push({ pattern: pathPattern, keys: c.keys, regex: c.regex, handler: urlOrHandler });
        return this;
      }
      /** @returns {{ handler: *, route: { hash: string, params: Object } }|null} First matching route. */
      match(hash) {
        for (const r of this.routes) {
          const m = r.regex.exec(hash);
          if (!m) continue;
          const params = {};
          r.keys.forEach((k, i) => params[k] = m[i + 1]);
          return { handler: r.handler, route: { hash, params } };
        }
        return null;
      }
      /** Listen for `hashchange` and run current hash once (idempotent if already started). */
      start() {
        if (this._started) return;
        this._started = true;
        this._handler = () => {
          const hash = global.location.hash || "#/";
          if (this._isIgnored(hash)) return;
          const match = this.match(hash);
          if (!match && !this.notFound) return;
          const rtOn = this.manager.config.routeTransitionOverlay !== false;
          let seq = 0;
          let $rt = null;
          const run = async () => {
            if (rtOn) {
              seq = ++this.manager._routeTransitionSeq;
              $rt = this.manager._routeTransitionShow();
            }
            try {
              const outletEl = normalizeHost(this.outlet);
              if (!match) {
                if (this.notFound) {
                  const route = { hash, params: {} };
                  if (typeof this.notFound === "function") {
                    await Promise.resolve(this.notFound(outletEl, route));
                  } else {
                    await this.manager.mount(outletEl, {
                      url: this.notFound,
                      data: { route },
                      replace: true,
                      parent: null
                    });
                  }
                }
                return;
              }
              if (typeof match.handler === "function") {
                await Promise.resolve(match.handler(outletEl, match.route));
              } else {
                await this.manager.mount(outletEl, {
                  url: match.handler,
                  data: { route: match.route },
                  replace: true,
                  parent: null
                });
              }
            } catch (e) {
              if (this.manager.config.debug) this.manager.log("route handler error", e);
            } finally {
              if (rtOn && seq === this.manager._routeTransitionSeq) {
                await this.manager._routeTransitionHide($rt);
              }
            }
          };
          void run();
        };
        $(global).on("hashchange", this._handler);
        this._handler();
      }
      /** Remove `hashchange` listener; next `start()` rebinds. */
      stop() {
        if (!this._started) return;
        this._started = false;
        if (this._handler) {
          $(global).off("hashchange", this._handler);
        }
        this._handler = null;
      }
      /** Set hash (triggers handler via `hashchange` when it actually changes). */
      navigate(hash) {
        global.location.hash = hash;
      }
    }
    class HistoryRouter {
      constructor(manager) {
        this.manager = manager;
        this._started = false;
        this._handler = null;
        this.routes = [];
        this.outlet = null;
        this.notFound = null;
        this.ignore = null;
      }
      /** @returns {boolean} When true, popstate does not run routing (see `ignore` option). */
      _isIgnored(path) {
        if (!this.ignore) return false;
        const p = path || "/";
        if (typeof this.ignore === "function") return this.ignore(p) === true;
        const arr = Array.isArray(this.ignore) ? this.ignore : [this.ignore];
        for (const x of arr) {
          if (x instanceof RegExp && x.test(p)) return true;
          if (typeof x === "string" && (p === x || p.startsWith(x + "/") || p.startsWith(x + "?"))) return true;
        }
        return false;
      }
      // "/users/:id" -> regex + keys. Param segments :name are replaced with ([^/]+).
      _compile(pattern) {
        const keys = [];
        let rx = "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rx = rx.replace(/:([a-zA-Z0-9_]+)/g, (_, k) => {
          keys.push(k);
          return "([^/]+)";
        });
        rx += "$";
        return { regex: new RegExp(rx), keys };
      }
      /** Replace route table and outlet; call `start()` separately to bind `popstate`. */
      configure({ outlet = "#app", routes = {}, notFound = null, ignore = null } = {}) {
        this.outlet = outlet;
        this.notFound = notFound;
        this.ignore = ignore;
        this.routes = [];
        if (Array.isArray(routes)) {
          routes.forEach((r) => this.add(r.path, r.url != null ? r.url : r.handler));
        } else {
          Object.entries(routes).forEach(([path, urlOrHandler]) => this.add(path, urlOrHandler));
        }
        return this;
      }
      /** Register one pattern (e.g. `/users/:id`) → component URL or `(outletEl, route) => void`. */
      add(pathPattern, urlOrHandler) {
        const c = this._compile(pathPattern);
        this.routes.push({ pattern: pathPattern, keys: c.keys, regex: c.regex, handler: urlOrHandler });
        return this;
      }
      /** @returns {{ handler: *, route: { path: string, search: string, params: Object } }|null} First matching route. */
      match(pathname, search) {
        for (const r of this.routes) {
          const m = r.regex.exec(pathname);
          if (!m) continue;
          const params = {};
          r.keys.forEach((k, i) => params[k] = m[i + 1]);
          return { handler: r.handler, route: { path: pathname, search: search || "", params } };
        }
        return null;
      }
      /** Dispatch current browser location to route handlers. */
      _dispatch() {
        const pathname = global.location.pathname || "/";
        const search = global.location.search || "";
        if (this._isIgnored(pathname + search)) return;
        const match = this.match(pathname, search);
        if (!match && !this.notFound) return;
        const rtOn = this.manager.config.routeTransitionOverlay !== false;
        let seq = 0;
        let $rt = null;
        const run = async () => {
          if (rtOn) {
            seq = ++this.manager._routeTransitionSeq;
            $rt = this.manager._routeTransitionShow();
          }
          try {
            const outletEl = normalizeHost(this.outlet);
            if (!match) {
              if (this.notFound) {
                const route = { path: pathname, search, params: {} };
                if (typeof this.notFound === "function") {
                  await Promise.resolve(this.notFound(outletEl, route));
                } else {
                  await this.manager.mount(outletEl, {
                    url: this.notFound,
                    data: { route },
                    replace: true,
                    parent: null
                  });
                }
              }
              return;
            }
            if (typeof match.handler === "function") {
              await Promise.resolve(match.handler(outletEl, match.route));
            } else {
              await this.manager.mount(outletEl, {
                url: match.handler,
                data: { route: match.route },
                replace: true,
                parent: null
              });
            }
          } catch (e) {
            if (this.manager.config.debug) this.manager.log("route handler error", e);
          } finally {
            if (rtOn && seq === this.manager._routeTransitionSeq) {
              await this.manager._routeTransitionHide($rt);
            }
          }
        };
        void run();
      }
      /** Listen for `popstate` and run current location once (idempotent if already started). */
      start() {
        if (this._started) return;
        this._started = true;
        this._handler = () => this._dispatch();
        $(global).on("popstate", this._handler);
        this._handler();
      }
      /** Remove `popstate` listener; next `start()` rebinds. */
      stop() {
        if (!this._started) return;
        this._started = false;
        if (this._handler) {
          $(global).off("popstate", this._handler);
        }
        this._handler = null;
      }
      /** Push or replace history entry, then dispatch route immediately. */
      navigate(path, { replace = false, state = null } = {}) {
        if (replace) global.history.replaceState(state, "", path);
        else global.history.pushState(state, "", path);
        this._dispatch();
      }
    }
    class Komponentor {
      constructor(config = {}) {
        this.config = Object.assign(
          {
            debug: false,
            baseUrl: null,
            // overlay:
            overlayClass: "komponent-overlay",
            overlayHtml: "<div style='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)'>Loading</div>",
            // scan:
            markerAttr: "data-komponent",
            // host ↔ Komponent: jQuery .data key + optional data-* marker (see file banner)
            hostKomponentDataKey: "komponentorKomponent",
            hostKomponentMountedAttr: "data-komponentor-instance",
            // error rendering:
            errorHtml: (url, err) => `<div style="padding:8px;border:1px solid #c00;background:#fee">Failed to load <b>${url}</b></div>`,
            // full-screen fade when hash router navigates (see HashRouter)
            routeTransitionOverlay: true,
            routeTransitionClass: "komponent-route-transition",
            routeTransitionHtml: "<div style='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)'>Loading</div>",
            routeTransitionFadeMs: 280,
            routeTransitionBackground: "rgba(255,255,255,0.95)"
          },
          config
        );
        this._instanceByElement = /* @__PURE__ */ new WeakMap();
        this._lockByElement = /* @__PURE__ */ new WeakMap();
        this._routeTransitionSeq = 0;
        this._routeTransitionEl = null;
        this._root = null;
        this._rootCtx = null;
        this.hashRouter = new HashRouter(this);
        this.historyRouter = new HistoryRouter(this);
        this.router = this.hashRouter;
        this.overlay = {
          show: (k) => this._overlayShow(k),
          hide: (k) => this._overlayHide(k)
        };
      }
      /** @returns {Element|null} Raw DOM node for WeakMap keys. */
      _el(elOrJq) {
        return toElement(elOrJq);
      }
      /** @returns {Komponent|null} Instance mounted on this host element, if any. */
      getInst(elOrJq) {
        const el = this._el(elOrJq);
        if (!el) return null;
        const fromMap = this._instanceByElement.get(el);
        if (fromMap) return fromMap;
        const fromData = $(el).data(this.config.hostKomponentDataKey);
        return fromData instanceof Komponent ? fromData : null;
      }
      /** Associate a host element with a `Komponent` instance. */
      setInst(elOrJq, inst) {
        const el = this._el(elOrJq);
        if (!el) return;
        this._instanceByElement.set(el, inst);
        const $el = $(el);
        $el.data(this.config.hostKomponentDataKey, inst);
        const mountedAttr = this.config.hostKomponentMountedAttr;
        if (mountedAttr) $el.attr(mountedAttr, "1");
      }
      /** Drop mapping only if it still points at `inst`. */
      clearInst(elOrJq, inst) {
        const el = this._el(elOrJq);
        if (!el || this._instanceByElement.get(el) !== inst) return;
        this._instanceByElement.delete(el);
        const $el = $(el);
        const key = this.config.hostKomponentDataKey;
        if ($el.data(key) === inst) $el.removeData(key);
        const mountedAttr = this.config.hostKomponentMountedAttr;
        if (mountedAttr) $el.removeAttr(mountedAttr);
      }
      /**
       * Prevent concurrent `mount` on the same host until `unlockHost` (after load finishes).
       * @returns {boolean} False if host already locked.
       */
      lockHost(elOrJq, owner) {
        const el = this._el(elOrJq);
        if (!el || this._lockByElement.get(el)) return false;
        this._lockByElement.set(el, owner);
        return true;
      }
      /** Release lock when `owner` matches (or `owner == null` for forced clear). */
      unlockHost(elOrJq, owner) {
        const el = this._el(elOrJq);
        if (!el) return;
        const cur = this._lockByElement.get(el);
        if (cur === owner || owner == null) this._lockByElement.delete(el);
      }
      /** `console.log` wrapper when `config.debug` is true. */
      log(...args) {
        if (this.config.debug) console.log("[komponentor]", ...args);
      }
      /** Normalize mount options string/object; merges `url|k=v` into `data`; applies route overlay rule. */
      _normalizeOpts(opts) {
        if (typeof opts === "string") {
          return { url: opts, data: {}, replace: false, autoload: true, overlay: true };
        }
        if (!isPlainObject(opts)) {
          return { url: "", data: {}, replace: false, autoload: true, overlay: true };
        }
        const o = Object.assign(
          {
            url: "",
            data: {},
            replace: false,
            replaceHost: false,
            // if true, replace the host element with the component root (see docs)
            autoload: true,
            // default: scan data-komponent children after mount
            overlay: true,
            parent: null
          },
          opts
        );
        if (typeof o.url === "string" && o.url.includes("|")) {
          const parsed = parseSpec(o.url);
          o.url = parsed.url;
          o.data = Object.assign({}, parsed.data, o.data || {});
        }
        if (this.config.routeTransitionOverlay !== false && this._routeTransitionEl && this._routeTransitionEl.length && this._routeTransitionEl.parent().length) {
          o.overlay = false;
        }
        return o;
      }
      /** Intent opts: url, data, parent, outlet (default body). */
      _normalizeIntentOpts(urlOrOpts) {
        let url = "";
        let data = {};
        let parent = null;
        let outlet = "body";
        if (typeof urlOrOpts === "string") {
          const parsed = parseSpec(urlOrOpts);
          url = parsed.url;
          data = Object.assign({}, parsed.data);
        } else if (isPlainObject(urlOrOpts)) {
          const o = urlOrOpts;
          url = o.url || "";
          const fromUrl = url && url.includes("|") ? parseSpec(url).data : {};
          data = Object.assign({}, fromUrl, o.data || {});
          parent = o.parent != null ? o.parent : null;
          outlet = o.outlet != null ? o.outlet : "body";
        }
        return { url, data, parent, outlet };
      }
      /** Prefix `config.baseUrl` for root-relative component URLs. */
      _resolveUrl(url) {
        if (!url) return url;
        return this.config.baseUrl && url[0] === "/" ? this.config.baseUrl + url : url;
      }
      /**
       * Shared load pipeline: resolve URL, fetch HTML, parse, extract script/init.
       * Used by both Komponent and Intent. Returns { content, init } or null if aborted/stale.
       */
      async _runLoadPipeline(url, ctx, ownerForInit) {
        const resolvedUrl = this._resolveUrl(url);
        const htmlText = await ctx.requestText(resolvedUrl, this.config.fetchOptions || {});
        if (htmlText == null) return null;
        return this._parseHtml(htmlText, ownerForInit, resolvedUrl || url);
      }
      /**
       * Strip scripts from fragment, concatenate script bodies, eval via `Function` for `init_komponent`.
       * @returns {{ content: jQuery, init: Function|null }}
       */
      _parseHtml(htmlText, komponent, sourceUrl) {
        const $wrap = $("<div>").html(String(htmlText));
        const $scripts = $wrap.find("script");
        let code = $scripts.map(function() {
          return $(this).text();
        }).get().join("\n");
        $scripts.remove();
        const $content = $wrap.contents();
        let init = null;
        if (code.trim()) {
          if (sourceUrl && typeof global.location !== "undefined") {
            try {
              sourceUrl = new URL(sourceUrl, global.location.origin).href;
            } catch (_) {
            }
            code = code + "\n//# sourceURL=" + sourceUrl;
          }
          const fn = new Function(
            "komponent",
            "data",
            "komponentor",
            `
            "use strict";
            ${code}
            return (typeof init_komponent === "function") ? init_komponent : null;
            `
          );
          const maybe = fn(komponent, komponent.data, this).bind(komponent);
          if (typeof maybe === "function") init = maybe;
        }
        return { content: $content, init };
      }
      /** Append parsed nodes into host, or swap host for single root when `replaceHost`. */
      _renderIntoHost(komponent, content) {
        const $host = komponent.$host;
        if (komponent.opts.replaceHost) {
          const $parent = $host.parent();
          if (!$parent.length) {
            if (this.config.debug) this.log("replaceHost: host has no parent, falling back to append");
            $host.empty().append(content.clone());
            return;
          }
          const $clone = content.clone();
          const $elementNodes = $clone.filter("*");
          if ($elementNodes.length !== 1) {
            throw new Error(
              "replaceHost requires exactly one top-level element in the component HTML; got " + $elementNodes.length
            );
          }
          const $newRoot = $elementNodes.eq(0);
          const hostId = $host.attr("id");
          if (hostId) $newRoot.attr("id", hostId);
          $host.replaceWith($newRoot);
          this.clearInst($host, komponent);
          this.setInst($newRoot, komponent);
          komponent.hostEl = $newRoot[0];
          komponent.$host = $newRoot;
        } else {
          $host.empty().append(content.clone());
        }
      }
      /** Replace host inner HTML with `config.errorHtml` after a failed mount. */
      _renderError(komponent, err) {
        try {
          komponent.$host.html(this.config.errorHtml(komponent.url, err));
        } catch (_) {
        }
      }
      /** Loading layer prepended to component host (skipped when route full-page overlay is active). */
      _overlayShow(k) {
        const $host = k.$host;
        if (!$host || !$host.length) return;
        if (k._overlayEl && k._overlayEl.parent().length) return;
        const $ov = $("<div>").addClass(this.config.overlayClass).html(this.config.overlayHtml).data("k", k).css({
          position: "relative",
          minHeight: "30px",
          border: "1px dashed #eee",
          background: "#eee",
          zIndex: "999999"
        });
        k._overlayEl = $ov;
        $host.prepend($ov);
      }
      /** Remove loading layer created by `_overlayShow`. */
      _overlayHide(k) {
        if (k._overlayEl && k._overlayEl.parent().length) k._overlayEl.remove();
        k._overlayEl = null;
      }
      /** Full-page layer during hash route changes; returns jQuery node or null. */
      _routeTransitionShow() {
        if (this.config.routeTransitionOverlay === false) return null;
        if (this._routeTransitionEl && this._routeTransitionEl.parent().length) {
          this._routeTransitionEl.stop(true, true).remove();
          this._routeTransitionEl = null;
        }
        const $el = $("<div>").addClass(this.config.routeTransitionClass).html(this.config.routeTransitionHtml).css({
          position: "fixed",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 2147483646,
          background: this.config.routeTransitionBackground
        });
        $("body").append($el);
        this._routeTransitionEl = $el;
        return $el;
      }
      /**
       * Fade out and remove the route transition layer; no-op if `forEl` was already replaced.
       * @param {jQuery} [forEl] Layer returned by `_routeTransitionShow` for this navigation.
       */
      _routeTransitionHide(forEl) {
        if (this.config.routeTransitionOverlay === false) return Promise.resolve();
        const $el = forEl && forEl.jquery ? forEl : this._routeTransitionEl;
        if (!$el || !$el.length || !$el.parent().length) return Promise.resolve();
        const ms = Math.max(0, Number(this.config.routeTransitionFadeMs) || 0);
        return new Promise((resolve) => {
          $el.fadeOut(ms, () => {
            try {
              $el.remove();
            } catch (_) {
            }
            if (this._routeTransitionEl && this._routeTransitionEl[0] === $el[0]) {
              this._routeTransitionEl = null;
            }
            resolve();
          });
        });
      }
      // ---------- Public API ----------
      /**
       * Replace app root: destroy previous root komponent, mount new one, wire `_rootCtx` for `emitRoot`.
       * @returns {Promise<Komponent>}
       */
      async root(host, urlOrOpts) {
        const $host = normalizeHost(host);
        if (this._root) {
          try {
            this._root.destroy();
          } catch (_) {
          }
          this._root = null;
          this._rootCtx = null;
        }
        const k = await this.mount($host, Object.assign({}, this._normalizeOpts(urlOrOpts), { replace: true, parent: null }));
        this._root = k;
        this._rootCtx = k && k.ctx ? k.ctx : null;
        return k;
      }
      /**
       * Load HTML into `host`, render, run init, return when ready (or error state inside komponent).
       * @returns {Promise<Komponent>}
       */
      async mount(host, urlOrOpts) {
        const $host = normalizeHost(host);
        const opts = this._normalizeOpts(urlOrOpts);
        const existing = this.getInst($host);
        if (existing && existing instanceof Komponent && opts.replace) existing.destroy();
        if (existing && !opts.replace) return existing;
        const lockToken = {};
        if (!this.lockHost($host, lockToken)) {
          const cur = this.getInst($host);
          if (cur) return cur;
          console.error("Host is already mounting (concurrent mount detected).", host, urlOrOpts);
          throw new Error("Host is already mounting (concurrent mount detected).");
        }
        const k = new Komponent(this, $host, opts, lockToken);
        this.setInst($host, k);
        await k.mount();
        return k;
      }
      /**
       * Destroy the {@link Komponent} registered on `host`, if any. Intents are not keyed by host; use `intent.unmount()`.
       * @returns {boolean} True when an instance was found and torn down.
       */
      unmount(host) {
        const $host = normalizeHost(host);
        const k = this.getInst($host);
        if (k && k instanceof Komponent && !k._destroyed) {
          k.unmount();
          return true;
        }
        return false;
      }
      /**
       * Find `[data-komponent]` under container and mount each (fire-and-forget `Promise`s).
       * @param {string|Element|jQuery} [container] Default `body`.
       */
      scan(container, { parent = null, replaceExisting = false } = {}) {
        const $root = normalizeHost(container == null ? "body" : container);
        const attr = this.config.markerAttr;
        const $nodes = $root.find("[" + attr + "]");
        $nodes.each(function() {
          const node = this;
          const $node = $(node);
          const spec = $node.attr(attr) || "";
          const parsed = parseSpec(spec);
          const dataFromAttrs = getDataAttributesFromElement($node, attr);
          const data = Object.assign({}, parsed.data, dataFromAttrs);
          const existing = this.getInst($node);
          if (existing && !replaceExisting) return;
          if (existing && replaceExisting) {
            try {
              existing.destroy();
            } catch (_) {
            }
          }
          void this.mount($node, {
            url: parsed.url,
            data,
            parent,
            replace: true
          });
        }.bind(this));
      }
      /**
       * Configure router and start listening (`hashchange` or `popstate` + initial dispatch).
       * @param {{
       *   mode?: "hash"|"history",
       *   outlet?: string|Element|jQuery,
       *   routes?: Object|Array,
       *   notFound?: (string|Function|null),
       *   ignore?: (string|RegExp|Function|Array)
       * }} opts
       */
      route({ mode = "hash", outlet = "#app", routes = {}, notFound = null, ignore = null } = {}) {
        const nextRouter = mode === "history" ? this.historyRouter : this.hashRouter;
        this.hashRouter.stop();
        this.historyRouter.stop();
        this.router = nextRouter;
        this.router.configure({ outlet, routes, notFound, ignore }).start();
      }
      /**
       * Navigate via currently active router.
       * - hash mode: `navigate("#/page")`
       * - history mode: `navigate("/page", { replace, state })`
       */
      navigate(pathOrHash, navOpts) {
        this.router.navigate(pathOrHash, navOpts || {});
      }
      /** Fluent intent builder. .data(...).send({ parent, outlet }) -> Intent (after run). Intent has readyPromise, resultPromise, close(result), destroy(). */
      intent(urlOrOpts) {
        const manager = this;
        const opts = manager._normalizeIntentOpts(urlOrOpts);
        let _url = opts.url;
        let _data = Object.assign({}, opts.data);
        let _outlet = opts.outlet;
        return {
          data(objOrKey, val) {
            if (objOrKey != null && typeof objOrKey === "object") {
              Object.assign(_data, objOrKey);
            } else if (objOrKey != null) {
              _data[objOrKey] = val;
            }
            return this;
          },
          async send({ parent, outlet } = {}) {
            const intent = new Intent(manager, {
              url: _url,
              data: _data,
              parent: parent != null ? parent : opts.parent,
              outlet: outlet != null ? outlet : _outlet
            });
            await intent.run();
            return intent;
          }
        };
      }
      /** Convenience: runIntent(url, data, { parent, outlet }) -> Intent (after run). */
      async runIntent(url, data, { parent, outlet } = {}) {
        const opts = this._normalizeIntentOpts({ url, data });
        const intent = new Intent(this, {
          url: opts.url,
          data: opts.data,
          parent: parent != null ? parent : opts.parent,
          outlet: outlet != null ? outlet : opts.outlet
        });
        await intent.run();
        return intent;
      }
    }
    const K = global.komponentor = global.komponentor || {};
    if (!(K instanceof Komponentor)) {
      const inst = new Komponentor(K && isPlainObject(K) ? K : {});
      global.komponentor = inst;
    }
    global.komponentor.Komponentor = Komponentor;
    global.komponentor.Komponent = Komponent;
    global.komponentor.Context = Context;
    global.komponentor.HashRouter = HashRouter;
    global.komponentor.HistoryRouter = HistoryRouter;
    global.komponentor.Intent = Intent;
  })(window);
})();
//# sourceMappingURL=komponentor.js.map
