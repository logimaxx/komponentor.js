/*!
 * Komponentor (single-file)
 * - Tree of components (parent/children), local scan
 * - Destroy cascades
 * - Optional hash router
 * - jQuery optional (used only as helper if present)
 *
 * Public API (minimal):
 *   komponentor.root(host, urlOrOpts)
 *   komponentor.mount(host, urlOrOpts)
 *   komponentor.scan(container?, { parent?, replaceExisting? })
 *   komponentor.route({ outlet, routes, notFound }) — routes: path -> url (string) or callback(outletEl, route)
 *   komponentor.navigate(hash)
 *   komponentor.intent(urlOrOpts)  -> fluent .data(...).send({ parent })
 *   komponentor.runIntent(url, data, { parent })
 *
 * Mount option: replaceHost: true — replace the host element with the component root (host is removed; id is copied so e.g. #app still works). Destroy then removes the new root from DOM. remount() mounts onto the detached node unless you pass a new host.
 *
 * Component marker:
 *   <div data-komponent="/path/to/component.html|id=5|foo=bar"></div>
 *
 * Intent usage examples:
 *   // From a component (intent becomes part of the branch; destroyed when parent is destroyed)
 *   async function init_komponent(k, data) {
 *     const i = await komponentor.intent("modal.html|id=1").data({ source: k }).send({ parent: k });
 *     // i.ctx.ready, i.data; i may mount DOM via komponentor.mount(...) inside modal's init
 *   }
 *
 *   // Global intent (no parent; not attached to any component tree)
 *   const i = await komponentor.runIntent("service/worker.html", { task: "sync" });
 */

(function (global) {
    "use strict";
  
    const $ = global.jQuery || null;
  
    // ----------------------------
    // utils
    // ----------------------------
    const KEY_INST = "__kp_instance__";
    const KEY_LOCK = "__kp_mounting__";
  
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
  
    function normalizeHost(host) {
     
      if (!host) throw new Error("Invalid host");
      if (typeof host === "string") {
        const el = document.querySelector(host);
        if (!el) throw new Error(`Host not found: ${host}`);
        return el;
      }
      if ($ && host instanceof $) return host[0];
      if (host instanceof Element) return host;
      throw new Error("Invalid host type");
    }
  
    function getInst(el) {
      return el ? el[KEY_INST] || null : null;
    }
    function setInst(el, inst) {
      el[KEY_INST] = inst;
    }
    function clearInst(el, inst) {
      if (el && el[KEY_INST] === inst) el[KEY_INST] = null;
    }
  
    function lockHost(el, inst) {
      // lock to prevent concurrent double-mount
      if (el[KEY_LOCK]) return false;
      el[KEY_LOCK] = inst || true;
      return true;
    }
    function unlockHost(el, inst) {
      if (!el) return;
      if (el[KEY_LOCK] === inst || inst == null) el[KEY_LOCK] = null;
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
    function getDataAttributesFromElement(el, markerAttr) {
      if (!el || !el.dataset) return {};
      const excludeKey = markerAttrToDatasetKey(markerAttr);
      const out = {};
      for (const key in el.dataset) {
        if (key === excludeKey) continue;
        out[key] = el.dataset[key];
      }
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
    // Komponent (node in tree)
    // ----------------------------
    class Komponent {
      constructor(manager, host, opts) {
        this.manager = manager;
  
        this.hostEl = normalizeHost(host);
        this.$host = $ ? $(this.hostEl) : null;
  
        this.opts = manager._normalizeOpts(opts);
        this.url = this.opts.url || "";
        this.data = this.opts.data || {};
  
        this.parent = this.opts.parent || null;
        this.children = [];
        this._scanned = false;
        this._destroyed = false;
  
        // mount "lock" early (prevents concurrent double-mount)
        if (!lockHost(this.hostEl, this)) {
          // if another mount is in-flight, best effort: return existing instance if any
          const existing = getInst(this.hostEl);
          if (existing) return existing;
          // else: allow but it's risky; throw in debug
          if (manager.config.debug) {
            throw new Error("Host is already mounting (concurrent mount detected).");
          }
        }
  
        // attach instance to host early (ownership)
        setInst(this.hostEl, this);
  
        // context
        this.ctx = new Context(this, manager);
  
        // link parent/child (component tree); parent may be Komponent or Intent
        if (this.parent && (this.parent instanceof Komponent || this.parent instanceof Intent)) {
          this.parent.children.push(this);
          this.ctx.parent = this.parent.ctx;
          this.parent.ctx.children.push(this.ctx);
        }
  
        // cleanup ownership on destroy
        this.ctx.onDestroy(() => {
          unlockHost(this.hostEl, this);
          clearInst(this.hostEl, this);
        });
      }
  
      // helper: scoped query
      find(selector) {
        return this.hostEl.querySelector(selector);
      }

      findAll(selector) {
        return Array.from(this.hostEl.querySelectorAll(selector));
      }
  
      // public: mount once (if re-called, destroys first by policy)
      async mount() {
        if (this._destroyed) return this;
  
        // policy: if mount called again, destroy then remount (user requested)
        // (manager.mount() also enforces replace if needed)
        this.ctx.state = "loading";
  
        try {
          // overlay
          if (this.opts.overlay !== false) this.manager.overlay.show(this);
  
          // fetch html
          const url = this.manager._resolveUrl(this.url);
          const htmlText = await this.ctx.requestText(url, this.manager.config.fetchOptions || {});
          if (htmlText == null) return this;
  
          // parse -> template + init
          const {fragment, init} = this.manager._parseHtml(htmlText, this);
          this.ctx.state = "rendering";
  
          // render into host (replace contents)
          this.manager._renderIntoHost(this, fragment);
  
          this.ctx.state = "init";
          // run init (if exists)
          if (typeof init === "function") {
            await init(this, this.data);
          }
  
          this.ctx.ready = true;
          this.ctx.state = "ready";
  
          // auto-scan children (once per component lifetime)
          if (this.opts.autoload !== false) {
            this.scan({ replaceExisting: this.opts.replaceExistingChildren === true });
          }
  
        } catch (e) {
          this.ctx.state = "error";
          this.manager._renderError(this, e);
          if (this.manager.config.debug) this.manager.log("mount error", e);
        } finally {
          this.manager.overlay.hide(this);
          unlockHost(this.hostEl, this);
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
  
        this.manager.scan(this.hostEl, {
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
        return this.manager.mount(this.hostEl, Object.assign({}, this.opts, { replace: true }));
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
  
        // DOM ownership cleanup
        try {
          if (this.opts.replaceHost) {
            if (this.hostEl.parentNode) this.hostEl.parentNode.removeChild(this.hostEl);
            clearInst(this.hostEl, this);
          } else {
            this.hostEl.innerHTML = "";
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
    // Intent (headless: no DOM, no render, no data-bind)
    // ----------------------------
    class Intent {
      constructor(manager, opts) {
        this.manager = manager;
        opts = manager._normalizeIntentOpts(opts);
        this.url = opts.url || "";
        this.data = opts.data || {};
        this.parent = opts.parent || null;
        this.children = [];
        this.hostEl = null;

        this.ctx = new Context(this, manager);

        if (this.parent && (this.parent instanceof Komponent || this.parent instanceof Intent)) {
          this.parent.children.push(this);
          this.ctx.parent = this.parent.ctx;
          this.parent.ctx.children.push(this.ctx);
        }
      }

      async run() {
        if (this.ctx._destroyed) return this;
        if (!this.url) {
          this.ctx.state = "error";
          this.manager.log("intent run: no url");
          return this;
        }
        this.ctx.state = "loading";
        this.manager.log("intent run", this.url);

        try {
          const url = this.manager._resolveUrl(this.url);
          const htmlText = await this.ctx.requestText(url, this.manager.config.fetchOptions || {});
          if (htmlText == null) return this;
          const { fragment, init } = this.manager._parseHtml(htmlText, this);
          this.hostEl = fragment.cloneNode(true);
          console.log("hostEl",this.hostEl);
          //document.body.appendChild(this.hostEl);
          this.ctx.state = "init";
          if (typeof init === "function") {
            await init(this, this.data);
          }
          this.ctx.ready = true;
          this.ctx.state = "ready";
        } catch (e) {
          this.ctx.state = "error";
          if (this.manager.config.debug) this.manager.log("intent run error", this.url, e);
        }
        return this;
      }

      destroy() {
        const kids = this.children.slice();
        this.children = [];
        for (const ch of kids) {
          try {
            if (ch && typeof ch.destroy === "function") ch.destroy();
          } catch (_) {}
        }
        try {
          this.ctx.destroy();
        } catch (_) {}
        if (this.parent && this.parent.children) {
          const i = this.parent.children.indexOf(this);
          if (i !== -1) this.parent.children.splice(i, 1);
        }
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
  
      // "#/users/:id" -> regex + keys
      _compile(pattern) {
        const keys = [];
        let rx = "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rx = rx.replace(/\\:([a-zA-Z0-9_]+)/g, (_, k) => {
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
  
        global.addEventListener("hashchange", this._handler);
        global.addEventListener("load", this._handler);
        this._handler();
      }
  
      stop() {
        if (!this._started) return;
        this._started = false;
        if (this._handler) {
          global.removeEventListener("hashchange", this._handler);
          global.removeEventListener("load", this._handler);
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
  
        this._root = null;    // Komponent
        this._rootCtx = null; // Context (for root bus convenience)
  
        this.router = new HashRouter(this);
  
        // overlay service
        this.overlay = {
          show: (k) => this._overlayShow(k),
          hide: (k) => this._overlayHide(k),
        };
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

      /** Intent opts only: url + data from spec and programmatic. No DOM/dataset. urlSpecData < programmaticData. */
      _normalizeIntentOpts(urlOrOpts) {
        let url = "";
        let data = {};
        let parent = null;
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
        }
        return { url, data, parent };
      }
  
      _resolveUrl(url) {
        let returnedUrl = url;
        if (!url) return url;
        returnedUrl = (this.config.baseUrl && url[0] === "/") ? this.config.baseUrl + url : url;
        console.log("returnedUrl",this.config.baseUrl,url, returnedUrl);
        return returnedUrl;
      }
  
      // parse HTML string into DOM fragment + init function (scoped, no global pollution)
      _parseHtml(htmlText, komponent) {
        // Put into template, strip <script>, keep scripts text, return fragment
        const t = document.createElement("template");
        t.innerHTML = String(htmlText);
  
        const scripts = Array.from(t.content.querySelectorAll("script"));
        const code = scripts.map((s) => s.textContent || "").join("\n");
        scripts.forEach((s) => s.remove());
  
        const fragment = t.content; // DocumentFragment
  
        // init extraction:
        // Convention: scripts may define function init_komponent(k, data) { ... }
        // We execute scripts in an isolated scope and then grab init_komponent if defined.
        let init = null;
        if (code.trim()) {
          try {
            // NOTE: This runs arbitrary code from fetched HTML. That's your current model.
            // Keep it isolated (no global init function).
            const fn = new Function(
              "komponent",
              "data",
              "komponentor",
              `
              "use strict";
              ${code}
              // if code declared function init_komponent, it will overwrite our local binding only if it was declared as var/let assignment.
              // to support "function init_komponent(...) {}", we detect it via Function constructor scope:
              return (typeof init_komponent === "function") ? init_komponent : null;
            `
            );
            // run once to obtain init function; then call later
            const maybe = fn(komponent, komponent.data, this);
            if (typeof maybe === "function") init = maybe;
          } catch (e) {
            if (this.config.debug) this.log("init parse error", e);
          }
        }
        return { fragment, init };
      }
  
      _renderIntoHost(komponent, fragment) {
        const host = komponent.hostEl;
        if (komponent.opts.replaceHost) {
          const parent = host.parentNode;
          if (!parent) {
            if (this.config.debug) this.log("replaceHost: host has no parent, falling back to append");
            host.innerHTML = "";
            host.appendChild(fragment.cloneNode(true));
            return;
          }
          const clone = fragment.cloneNode(true);
          const childElements = clone.children ? Array.from(clone.children) : [];
          let newRoot;
          if (childElements.length === 1) {
            newRoot = childElements[0];
          } else if (childElements.length === 0) {
            newRoot = document.createElement("div");
          } else {
            newRoot = document.createElement("div");
            while (clone.firstChild) newRoot.appendChild(clone.firstChild);
          }
          if (host.id) newRoot.id = host.id;
          parent.replaceChild(newRoot, host);
          clearInst(host, komponent);
          setInst(newRoot, komponent);
          komponent.hostEl = newRoot;
          if (komponent.$host) komponent.$host = $ ? $(newRoot) : null;
        } else {
          host.innerHTML = "";
          host.appendChild(fragment.cloneNode(true));
        }
      }
  
      _renderError(komponent, err) {
        try {
          komponent.hostEl.innerHTML = this.config.errorHtml(komponent.url, err);
        } catch (_) {}
      }
  
      _overlayShow(k) {
        const host = k.hostEl;
        if (!host) return;
  
        // If host isn't positioned, overlay absolute positioning is messy; simplest:
        // create overlay as first child with position:relative wrapper.
        // Minimal, predictable.
        // You can replace this later with a better overlay implementation.
  
        // avoid duplicate overlay
        if (k._overlayEl && k._overlayEl.parentNode) return;
  
        const ov = document.createElement("div");
        ov.className = this.config.overlayClass;
        ov.innerHTML = this.config.overlayHtml;
  
        ov.style.position = "relative";
        ov.style.minHeight = "30px";
        ov.style.border = "1px dashed silver";
        ov.style.background = "#eee";
        ov.style.zIndex = "999999";
  
        k._overlayEl = ov;
        host.insertBefore(ov, host.firstChild);
      }
  
      _overlayHide(k) {
        const ov = k._overlayEl;
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        k._overlayEl = null;
      }
  
      // ---------- Public API ----------
      root(host, urlOrOpts) {
        console.log("root", host);
        const el = normalizeHost(host);
        console.log("el", el);
        // destroy existing root if any
        if (this._root) {
          try {
            this._root.destroy();
          } catch (_) {}
          this._root = null;
          this._rootCtx = null;
        }
        const k = this.mount(el, Object.assign({}, this._normalizeOpts(urlOrOpts), { replace: true, parent: null }));
        this._root = k;
        this._rootCtx = k && k.ctx ? k.ctx : null;
        return k;
      }
  
      mount(host, urlOrOpts) {
        const el = normalizeHost(host);
        const opts = this._normalizeOpts(urlOrOpts);
  
        // policy requested by you:
        // - if mounting onto a host that already has a component, destroy first
        const existing = getInst(el);
        
        if (existing && existing instanceof Komponent && opts.replace) existing.destroy();
        if (existing && !opts.replace) return existing;
  
        // create new component
        const k = new Komponent(this, el, opts);
  
        // run mount async (fire-and-forget); user can await if they want:
        // return k.mount() would change API; so keep instance return and let user await k.mount() optionally.
        k.mount();
  
        return k;
      }
  
      scan(container = document.body, { parent = null, replaceExisting = false } = {}) {
        const root = normalizeHost(container);
        const attr = this.config.markerAttr;

        const nodes = Array.from(root.querySelectorAll(`[${attr}]`));
        for (const node of nodes) {
          const spec = node.getAttribute(attr) || "";
          const parsed = parseSpec(spec);
          const dataFromAttrs = getDataAttributesFromElement(node, attr);
          const data = Object.assign({}, parsed.data, dataFromAttrs);

          const existing = getInst(node);
          if (existing && !replaceExisting) continue;

          if (existing && replaceExisting) {
            try {
              existing.destroy();
            } catch (_) {}
          }

          this.mount(node, {
            url: parsed.url,
            data,
            parent: parent,
            replace: true,
          });
        }
      }
  
      route({ outlet = "#app", routes = {}, notFound = null } = {}) {
        this.router.configure({ outlet, routes, notFound }).start();
      }
  
      navigate(hash) {
        this.router.navigate(hash);
      }

      /** Fluent intent builder. .data(objOrKey, val).send({ parent }) -> Intent (after run). */
      intent(urlOrOpts) {
        const manager = this;
        const opts = manager._normalizeIntentOpts(urlOrOpts);
        let _url = opts.url;
        let _data = Object.assign({}, opts.data);
        return {
          data(objOrKey, val) {
            if (objOrKey != null && typeof objOrKey === "object") {
              Object.assign(_data, objOrKey);
            } else if (objOrKey != null) {
              _data[objOrKey] = val;
            }
            return this;
          },
          async send({ parent } = {}) {
            const intent = new Intent(manager, { url: _url, data: _data, parent });
            await intent.run();
            return intent;
          },
        };
      }

      /** Convenience: runIntent(url, data, { parent }) -> Intent (after run). */
      async runIntent(url, data, { parent } = {}) {
        const opts = this._normalizeIntentOpts({ url, data });
        const intent = new Intent(this, { url: opts.url, data: opts.data, parent });
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
  