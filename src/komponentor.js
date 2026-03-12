/*!
 * Komponentor (single-file) — internal rapid-development runtime
 * - Komponent: persistent UI, tree (parent/children), scan, destroy cascade
 * - Intent: temporary UI only (modal, dialog, popup); mounts into outlet, close/destroy unmounts
 * - Shared load pipeline (resolve → fetch → parse → init) for both
 * - Optional hash router; declarative scan via data-komponent
 * - Requires jQuery
 *
 * Public API:
 *   komponentor.root(host, urlOrOpts)  → Komponent (has readyPromise)
 *   komponentor.mount(host, urlOrOpts) → Komponent (has readyPromise)
 *   komponentor.scan(container?, { parent?, replaceExisting? })
 *   komponentor.route({ outlet, routes, notFound })
 *   komponentor.navigate(hash)
 *   komponentor.intent(urlOrOpts).data(...).send({ parent, outlet }) → Intent (readyPromise, resultPromise, close(result), destroy())
 *   komponentor.runIntent(url, data, { parent, outlet }) → Intent
 *
 * Lifecycle (conceptual): initial → loading → loaded → mounting → mounted → initializing → ready | error; destroying → destroyed.
 * Intent adds: closing before destroyed. replaceHost is an advanced option (host replaced by component root).
 *
 * Component marker: <div data-komponent="/path/to/component.html|id=5|foo=bar"></div>
 *
 * Intent (temporary UI): mounts real DOM into outlet (default body). Use close(result) to dismiss and resolve resultPromise.
 */

(function (global) {
    "use strict";

    const $ = global.jQuery;
    if (!$ || typeof $.fn !== "object") throw new Error("Komponentor requires jQuery");

    // ----------------------------
    // utils
    // ----------------------------
    // Instance/lock tracking: manager-level WeakMaps (no DOM-attached metadata).
    // Element identity is the raw DOM node; jQuery sets are normalized to [0] where needed.
    function isPlainObject(x) {
      return x && typeof x === "object" && x.constructor === Object;
    }

    function uid(prefix = "") {
      return (
        prefix +
        Math.random().toString(36).slice(2, 9) +
        "_" +
        Math.random().toString(36).slice(2, 7)
      );
    }

    /** Host abstraction: always returns a jQuery collection (single element in practice). */
    function normalizeHost(host) {
      if (host == null) throw new Error("Invalid host");
      if (typeof host === "string") {
        const $el = $(host);
        if (!$el.length) throw new Error("Host not found: " + host);
        return $el;
      }
      if (host.jquery) return host;
      const $el = $(host);
      if (!$el.length) throw new Error("Invalid host type");
      return $el;
    }

    /** Normalize to raw DOM element for WeakMap key. */
    function toElement(elOrJq) {
      if (!elOrJq) return null;
      if (elOrJq.jquery && elOrJq.length) return elOrJq[0];
      const el = typeof elOrJq === "string" ? $(elOrJq)[0] : elOrJq;
      return el && el.nodeType ? el : null;
    }

    function parseSpec(specText) {
      // "/a/b.html|x=1|y=2" -> { url, data }
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

    // data-komponent -> "komponent" (dataset key for exclusion)
    function markerAttrToDatasetKey(attrName) {
      if (!attrName || !String(attrName).toLowerCase().startsWith("data-")) return null;
      return String(attrName)
        .slice(5)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }

    // All data-* attributes from element as object (camelCase keys), excluding markerAttr
    function getDataAttributesFromElement(elOrJq, markerAttr) {
      const $el = elOrJq && elOrJq.jquery ? elOrJq : $(elOrJq);
      if (!$el.length) return {};
      const excludeKey = markerAttrToDatasetKey(markerAttr);
      const out = {};
      $.each($el.data(), function (key, val) {
        if (key !== excludeKey) out[key] = val;
      });
      return out;
    }
  
    // ----------------------------
    // EventBus (scoped)
    // ----------------------------
    class EventBus {
      constructor() {
        this._map = new Map(); // event -> [{fn,ctx}]
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
            // swallow: event handlers must not crash framework
            // (caller can enable debug logs in config)
          }
        }
      }
      clear() {
        this._map.clear();
      }
    }
  
    // ----------------------------
    // Context (kernel)
    // ----------------------------
    class Context {
      constructor(owner, manager) {
        this.id = uid("k_");
        this.owner = owner; // Komponent instance
        this.manager = manager; // Komponentor
        this.parent = null;
        this.children = [];
        this.ready = false;
        this._destroyed = false;
  
        this._state = "initial";
        this._bus = new EventBus();
        this._destroyers = [];
  
        // request lifecycle (1 active per context, abort on new/destroy)
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
  
      on(event, fn, ctx) {
        this._bus.on(event, fn, ctx || this);
        return this;
      }
      off(event, fn, ctx) {
        this._bus.off(event, fn, ctx || this);
        return this;
      }
      trigger(event, payload) {
        this._bus.emit(event, payload, this);
        return this;
      }
  
      // bubble-up event (cross-branch through common ancestor)
      emitUp(event, payload) {
        let p = this.parent;
        while (p) {
          p.trigger(event, payload);
          p = p.parent;
        }
        return this;
      }
  
      // root-level event (global within app root)
      emitRoot(event, payload) {
        const root = this.manager && this.manager._rootCtx ? this.manager._rootCtx : null;
        if (root) root.trigger(event, payload);
        return this;
      }
  
      onDestroy(fn) {
        if (typeof fn === "function") this._destroyers.push(fn);
        return this;
      }
  
      requestAbort() {
        try {
          if (this._req.ctrl) this._req.ctrl.abort();
        } catch (_) {}
        this._req.ctrl = null;
      }
  
      // fetch wrapper with stale-guard
      async requestText(url, fetchOpts = {}) {
        this._req.token += 1;
        const t = this._req.token;
  
        this.requestAbort();
        const ctrl = new AbortController();
        this._req.ctrl = ctrl;
  
        const res = await fetch(url, Object.assign({}, fetchOpts, { signal: ctrl.signal }));
        if (this._destroyed) return null;
        if (t !== this._req.token) return null; // stale
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const text = await res.text();
        if (this._destroyed) return null;
        if (t !== this._req.token) return null;
        return text;
      }
  
      destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
  
        this.state = "destroying";
        this.trigger("context:destroy", this);
  
        this.requestAbort();
  
        // destroy children contexts first (safety)
        const kids = this.children.slice();
        this.children = [];
        for (const ch of kids) {
          try {
            if (ch && typeof ch.destroy === "function") ch.destroy();
          } catch (_) {}
        }
  
        // run destroyers in reverse
        const ds = this._destroyers.slice().reverse();
        this._destroyers = [];
        for (const fn of ds) {
          try {
            fn(this);
          } catch (_) {}
        }
  
        this._bus.clear();
        this.ready = false;
        this.state = "destroyed";
      }
    }
  
    // ----------------------------
    // Komponent (node in tree). Host abstraction is jQuery ($host); hostEl = $host[0] where raw node is needed.
    // ----------------------------
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

        this._lockToken = lockToken !== undefined ? lockToken : this;
        if (lockToken === undefined) manager.setInst(this.$host, this);
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

      find(selector) {
        return this.$host.find(selector);
      }

      // public: mount once (if re-called, destroys first by policy)
      // Lifecycle: loading -> loaded -> mounting -> mounted -> initializing -> ready (or error)
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
  
      // scan local branch only
      scan({ replaceExisting = false } = {}) {
        if (this._destroyed) return this;
  
        // If your model says "scan can be re-run and must replace", you can allow it;
        // but default stays "once" to keep branch stable unless explicitly changed.
        if (this._scanned && replaceExisting !== true) return this;
        this._scanned = true;
  
        this.manager.scan(this.$host, {
          parent: this,
          replaceExisting,
        });
  
        return this;
      }
  
      // explicit remount policy: destroy then mount
      async remount() {
        if (this._destroyed) return this;
        this.destroy();
        // create a fresh instance on same host
        return this.manager.mount(this.$host, Object.assign({}, this.opts, { replace: true }));
      }
  
      destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
  
        // destroy children first (component-level)
        const kids = this.children.slice();
        this.children = [];
        for (const ch of kids) {
          try {
            ch.destroy();
          } catch (_) {}
        }
  
        // context destroy (also destroys ctx children via ctx.children)
        try {
          this.ctx.destroy();
        } catch (_) {}
  
        try {
          if (this.opts.replaceHost) {
            this.$host.remove();
            this.manager.clearInst(this.$host, this);
          } else {
            this.$host.empty();
          }
        } catch (_) {}
  
        // unlink from parent component list (best effort)
        if (this.parent && this.parent.children) {
          const i = this.parent.children.indexOf(this);
          if (i !== -1) this.parent.children.splice(i, 1);
        }
      }
    }

    // ----------------------------
    // Intent (temporary UI only: modal, dialog, popup, overlay).
    // DOM contract: Intent owns a single wrapper element ($host). Content is appended inside it.
    // find()/findAll() query inside $host. close()/destroy() remove $host from DOM.
    // ----------------------------
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

      find(selector) {
        return this.$host.find(selector);
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
        } catch (_) {}
        this._unlinkFromParent();
      }

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
          } catch (_) {}
        }
        if (this.parent && this.parent.children) {
          const i = this.parent.children.indexOf(this);
          if (i !== -1) this.parent.children.splice(i, 1);
        }
      }

      destroy() {
        this._teardown(undefined);
      }
    }

    // ----------------------------
    // HashRouter (optional)
    // ----------------------------
    class HashRouter {
      constructor(manager) {
        this.manager = manager;
        this._started = false;
        this._handler = null;
        this.routes = []; // [{ pattern, keys, regex, url }]
        this.outlet = null;
        this.notFound = null;
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
  
      configure({ outlet = "#app", routes = {}, notFound = null } = {}) {
        this.outlet = outlet;
        this.notFound = notFound;
        this.routes = [];
  
        // accept object map or array; value per route is url (string) or callback(outletEl, route)
        if (Array.isArray(routes)) {
          routes.forEach((r) => this.add(r.path, r.url != null ? r.url : r.handler));
        } else {
          Object.entries(routes).forEach(([path, urlOrHandler]) => this.add(path, urlOrHandler));
        }
        return this;
      }
  
      add(pathPattern, urlOrHandler) {
        
        const c = this._compile(pathPattern);
        this.routes.push({ pattern: pathPattern, keys: c.keys, regex: c.regex, handler: urlOrHandler });
        return this;
      }
  
      match(hash) {
        for (const r of this.routes) {
          const m = r.regex.exec(hash);
          if (!m) continue;
          const params = {};
          r.keys.forEach((k, i) => (params[k] = m[i + 1]));
          return { handler: r.handler, route: { hash, params } };
        }
        return null;
      }
  
      start() {
        if (this._started) return;
        this._started = true;
  
        this._handler = () => {
          const hash = global.location.hash || "#/";
          const match = this.match(hash);
          const outletEl = normalizeHost(this.outlet);
          
  
          if (!match) {
            if (this.notFound) {
              const route = { hash, params: {} };
              if (typeof this.notFound === "function") {
                this.notFound(outletEl, route);
              } else {
                this.manager.mount(outletEl, {
                  url: this.notFound,
                  data: { route },
                  replace: true,
                  parent: null,
                });
              }
            }
            return;
          }
  
          if (typeof match.handler === "function") {
            match.handler(outletEl, match.route);
          } else {
            this.manager.mount(outletEl, {
              url: match.handler,
              data: { route: match.route },
              replace: true,
              parent: null,
            });
          }
        };
  
        $(global).on("hashchange", this._handler);
        this._handler();
      }

      stop() {
        if (!this._started) return;
        this._started = false;
        if (this._handler) {
          $(global).off("hashchange", this._handler);
        }
        this._handler = null;
      }
  
      navigate(hash) {
        global.location.hash = hash;
      }
    }
  
    // ----------------------------
    // Komponentor (manager / API)
    // ----------------------------
    class Komponentor {
      constructor(config = {}) {
        this.config = Object.assign(
          {
            debug: false,
            baseUrl: null,
            // overlay:
            overlayClass: "komponent-overlay",
            overlayHtml:
              "<div style='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)'>Loading</div>",
            // scan:
            markerAttr: "data-komponent",
            // error rendering:
            errorHtml: (url, err) =>
              `<div style="padding:8px;border:1px solid #c00;background:#fee">Failed to load <b>${url}</b></div>`,
          },
          config
        );

        // DOM ownership: WeakMap<Element, Instance> (no data-* on nodes)
        this._instanceByElement = new WeakMap();
        this._lockByElement = new WeakMap();
  
        this._root = null;    // Komponent
        this._rootCtx = null; // Context (for root bus convenience)
  
        this.router = new HashRouter(this);
  
        // overlay service
        this.overlay = {
          show: (k) => this._overlayShow(k),
          hide: (k) => this._overlayHide(k),
        };
      }

      _el(elOrJq) {
        return toElement(elOrJq);
      }
      getInst(elOrJq) {
        const el = this._el(elOrJq);
        return el ? this._instanceByElement.get(el) || null : null;
      }
      setInst(elOrJq, inst) {
        const el = this._el(elOrJq);
        if (el) this._instanceByElement.set(el, inst);
      }
      clearInst(elOrJq, inst) {
        const el = this._el(elOrJq);
        if (el && this._instanceByElement.get(el) === inst) this._instanceByElement.delete(el);
      }
      lockHost(elOrJq, owner) {
        const el = this._el(elOrJq);
        if (!el || this._lockByElement.get(el)) return false;
        this._lockByElement.set(el, owner);
        return true;
      }
      unlockHost(elOrJq, owner) {
        const el = this._el(elOrJq);
        if (!el) return;
        const cur = this._lockByElement.get(el);
        if (cur === owner || owner == null) this._lockByElement.delete(el);
      }
  
      log(...args) {
        if (this.config.debug) console.log("[komponentor]", ...args);
      }
  
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
            replaceHost: false,  // if true, replace the host element with the component root (see docs)
            autoload: true,  // default: scan data-komponent children after mount
            overlay: true,
            parent: null,
          },
          opts
        );
        // allow "url|x=1|y=2" in url field too
        if (typeof o.url === "string" && o.url.includes("|")) {
          const parsed = parseSpec(o.url);
          o.url = parsed.url;
          o.data = Object.assign({}, parsed.data, o.data || {});
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
  
      _resolveUrl(url) {
        if (!url) return url;
        return (this.config.baseUrl && url[0] === "/") ? this.config.baseUrl + url : url;
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
  
      _parseHtml(htmlText, komponent, sourceUrl) {
        const $wrap = $("<div>").html(String(htmlText));
        const $scripts = $wrap.find("script");
        let code = $scripts.map(function () { return $(this).text(); }).get().join("\n");
        $scripts.remove();
        const $content = $wrap.contents();

        let init = null;
        if (code.trim()) {
          if (sourceUrl && typeof global.location !== "undefined") {
            try {
              sourceUrl = new URL(sourceUrl, global.location.origin).href;
            } catch (_) {}
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
          // replaceHost rule: exactly one top-level element required; throw otherwise.
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

      _renderError(komponent, err) {
        try {
          komponent.$host.html(this.config.errorHtml(komponent.url, err));
        } catch (_) {}
      }

      _overlayShow(k) {
        const $host = k.$host;
        if (!$host || !$host.length) return;

        if (k._overlayEl && k._overlayEl.parent().length) return;

        const $ov = $("<div>")
          .addClass(this.config.overlayClass)
          .html(this.config.overlayHtml)
          .css({
            position: "relative",
            minHeight: "30px",
            border: "1px dashed silver",
            background: "#eee",
            zIndex: "999999"
          });

        k._overlayEl = $ov;
        $host.prepend($ov);
      }

      _overlayHide(k) {
        if (k._overlayEl && k._overlayEl.parent().length) k._overlayEl.remove();
        k._overlayEl = null;
      }
  
      // ---------- Public API ----------
      root(host, urlOrOpts) {
        const $host = normalizeHost(host);
        if (this._root) {
          try {
            this._root.destroy();
          } catch (_) {}
          this._root = null;
          this._rootCtx = null;
        }
        const k = this.mount($host, Object.assign({}, this._normalizeOpts(urlOrOpts), { replace: true, parent: null }));
        this._root = k;
        this._rootCtx = k && k.ctx ? k.ctx : null;
        return k;
      }
  
      mount(host, urlOrOpts) {
        const $host = normalizeHost(host);
        const opts = this._normalizeOpts(urlOrOpts);
        const existing = this.getInst($host);
        if (existing && existing instanceof Komponent && opts.replace) existing.destroy();
        if (existing && !opts.replace) return existing;
        const lockToken = {};
        if (!this.lockHost($host, lockToken)) {
          const cur = this.getInst($host);
          if (cur) return cur;
          throw new Error("Host is already mounting (concurrent mount detected).");
        }
        const k = new Komponent(this, $host, opts, lockToken);
        this.setInst($host, k);
        k.mount();
        return k;
      }
  
      scan(container, { parent = null, replaceExisting = false } = {}) {
        const $root = normalizeHost(container == null ? "body" : container);
        const attr = this.config.markerAttr;
        const $nodes = $root.find("[" + attr + "]");

        $nodes.each(function () {
          const node = this;
          const $node = $(node);
          const spec = $node.attr(attr) || "";
          const parsed = parseSpec(spec);
          const dataFromAttrs = getDataAttributesFromElement($node, attr);
          const data = Object.assign({}, parsed.data, dataFromAttrs);

          const existing = this.getInst($node);
          if (existing && !replaceExisting) return;
          if (existing && replaceExisting) {
            try { existing.destroy(); } catch (_) {}
          }

          this.mount($node, {
            url: parsed.url,
            data,
            parent: parent,
            replace: true,
          });
        }.bind(this));
      }
  
      route({ outlet = "#app", routes = {}, notFound = null } = {}) {
        this.router.configure({ outlet, routes, notFound }).start();
      }
  
      navigate(hash) {
        this.router.navigate(hash);
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
              outlet: outlet != null ? outlet : _outlet,
            });
            await intent.run();
            return intent;
          },
        };
      }

      /** Convenience: runIntent(url, data, { parent, outlet }) -> Intent (after run). */
      async runIntent(url, data, { parent, outlet } = {}) {
        const opts = this._normalizeIntentOpts({ url, data });
        const intent = new Intent(this, {
          url: opts.url,
          data: opts.data,
          parent: parent != null ? parent : opts.parent,
          outlet: outlet != null ? outlet : opts.outlet,
        });
        await intent.run();
        return intent;
      }
    }
  
    // ----------------------------
    // expose namespace
    // ----------------------------
    const K = global.komponentor = global.komponentor || {};
    // If user already has an instance, keep it; else create default instance
    if (!(K instanceof Komponentor)) {
      const inst = new Komponentor(K && isPlainObject(K) ? K : {});
      // copy instance onto global
      global.komponentor = inst;
    }
  
    // also expose classes for power users
    global.komponentor.Komponentor = Komponentor;
    global.komponentor.Komponent = Komponent;
    global.komponentor.Context = Context;
    global.komponentor.HashRouter = HashRouter;
    global.komponentor.Intent = Intent;
  
  })(window);
  