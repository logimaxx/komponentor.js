/*! komponentor v1.3.0
 * Lightweight HTML-based components, hash routing, and intents for jQuery apps — no build step required.
 * (c) 2026 Sergiu Voicu <https://logimaxx.ro>
 * Released under the MIT License
 */

(() => {
  var __defProp = Object.defineProperty;
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
  (function(root, $) {
    "use strict";
    var _compiled, _model, _el, _destroyed, _data, _destroyed2, _listeners;
    if (!$ || typeof $.fn !== "object") {
      throw new Error("KSimpleViews requires jQuery");
    }
    const Handlebars = root.Handlebars;
    function defaultCompile(html) {
      return function(data) {
        if (data == null) data = {};
        return String(html).replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
          const parts = path.split(".");
          let v = data;
          for (const p of parts) {
            v = v != null && typeof v === "object" ? v[p] : void 0;
          }
          return v != null ? String(v) : "";
        });
      };
    }
    function compileTemplate(html) {
      if (Handlebars && typeof Handlebars.compile === "function") {
        return Handlebars.compile(html);
      }
      return defaultCompile(html);
    }
    class KView {
      /**
       * @param {jQuery|HTMLElement|string} el - Single element: mount point; its outerHTML is the template. Replaced by the rendered root on first render.
       * @param {KModel} model - KModel instance.
       * @param {Object} [lifecycle] - Optional object with onDestroy(fn); if provided, view.destroy() is called when lifecycle is torn down.
       * @throws {Error} If el is not a single node.
       */
      constructor(el, lifecycle) {
        __privateAdd(this, _compiled);
        __privateAdd(this, _model);
        __privateAdd(this, _el);
        __privateAdd(this, _destroyed, false);
        const $el = $(el);
        if ($el.length !== 1) {
          throw new Error("KView: el must be a single node (got " + $el.length + ")");
        }
        __privateSet(this, _el, $el);
        __privateSet(this, _compiled, compileTemplate($el[0].outerHTML));
        if (lifecycle && typeof lifecycle.onDestroy === "function") {
          lifecycle.onDestroy(() => this.destroy());
        }
      }
      render() {
        const existingData = __privateGet(this, _el).data("komponent") || null;
        if (__privateGet(this, _destroyed)) return;
        try {
          const html = __privateGet(this, _compiled).call(this, __privateGet(this, _model).props);
          const $content = $(html);
          __privateGet(this, _el).replaceWith($content);
          __privateSet(this, _el, $content);
          __privateGet(this, _el).data("model", __privateGet(this, _model)).attr("is", "kview");
        } catch (e) {
          const $error = $("<div>Error in KView.render</div>");
          __privateGet(this, _el).replaceWith($error);
          __privateSet(this, _el, $error);
          console.error("Error in KView.render", e);
        }
        if (existingData != null) {
          __privateGet(this, _el).data("komponent", existingData);
        }
      }
      /**
       * Current root element(s) in the DOM. Before first render, returns the mount element; after, the rendered root.
       * @returns {jQuery}
       */
      getRoot() {
        return __privateGet(this, _el) || $();
      }
      setModel(model) {
        if (__privateGet(this, _destroyed)) return;
        __privateSet(this, _model, model);
        this.render();
      }
      /**
       * Unbind this view from the model and mark as destroyed. Removes the view root from the DOM.
       */
      destroy() {
        if (__privateGet(this, _destroyed)) return;
        __privateSet(this, _destroyed, true);
        if (__privateGet(this, _model) && typeof __privateGet(this, _model).unbindView === "function") {
          __privateGet(this, _model).unbindView(this);
        }
        if (__privateGet(this, _el) && __privateGet(this, _el).length) __privateGet(this, _el).remove();
        __privateSet(this, _model, null);
        __privateSet(this, _el, null);
      }
    }
    _compiled = new WeakMap();
    _model = new WeakMap();
    _el = new WeakMap();
    _destroyed = new WeakMap();
    class KModel {
      constructor(data) {
        __publicField(this, "views", []);
        __privateAdd(this, _data, {});
        __privateAdd(this, _destroyed2, false);
        __privateAdd(this, _listeners, /* @__PURE__ */ new Map());
        __privateSet(this, _data, data || {});
      }
      // event -> [{ fn, ctx }]
      get props() {
        return __privateGet(this, _data);
      }
      get data() {
        return __privateGet(this, _data);
      }
      set data(val) {
        if (__privateGet(this, _destroyed2)) return;
        __privateSet(this, _data, val);
        this._trigger("change", { data: __privateGet(this, _data) });
        this.render();
      }
      /**
       * Subscribe to an event. Events: "change", "view:bind", "view:unbind", "destroy".
       * @param {string} event - Event name.
       * @param {function} fn - Callback(payload).
       * @param {*} [ctx] - Optional this for fn.
       * @returns {KModel} this
       */
      on(event, fn, ctx) {
        if (typeof fn !== "function") return this;
        const arr = __privateGet(this, _listeners).get(event) || [];
        arr.push({ fn, ctx: ctx || null });
        __privateGet(this, _listeners).set(event, arr);
        return this;
      }
      /**
       * Unsubscribe from an event.
       * @param {string} event - Event name.
       * @param {function} fn - Same function reference as passed to on().
       * @param {*} [ctx] - Optional context (must match on() to remove).
       * @returns {KModel} this
       */
      off(event, fn, ctx) {
        const arr = __privateGet(this, _listeners).get(event);
        if (!arr) return this;
        __privateGet(this, _listeners).set(
          event,
          arr.filter((l) => !(l.fn === fn && (ctx == null || l.ctx === ctx)))
        );
        return this;
      }
      /**
       * Emit an event to all listeners.
       * @param {string} event - Event name.
       * @param {*} payload - Data passed to listeners.
       * @returns {KModel} this
       */
      trigger(event, payload) {
        const arr = __privateGet(this, _listeners).get(event);
        if (!arr || !arr.length) return this;
        for (const l of arr.slice()) {
          try {
            l.fn.call(l.ctx || null, payload);
          } catch (e) {
            console.error("KModel event handler error", event, e);
          }
        }
        return this;
      }
      _trigger(event, payload) {
        this.trigger(event, payload);
      }
      update(name, val) {
        if (__privateGet(this, _destroyed2)) return;
        __privateGet(this, _data)[name] = val;
        this._trigger("change", { name, value: val });
        this.render();
      }
      bindView(view) {
        if (__privateGet(this, _destroyed2)) return;
        if (this.views.indexOf(view) === -1) {
          this.views.push(view);
          this._trigger("view:bind", { view });
        }
        view.setModel(this);
      }
      unbindView(view) {
        const i = this.views.indexOf(view);
        if (i !== -1) {
          this.views.splice(i, 1);
          this._trigger("view:unbind", { view });
        }
      }
      unbindAllViews() {
        this.views.length = 0;
      }
      render() {
        if (__privateGet(this, _destroyed2)) return;
        this.views.forEach((v) => v.render());
      }
      destroy() {
        if (__privateGet(this, _destroyed2)) return;
        __privateSet(this, _destroyed2, true);
        this._trigger("destroy", { model: this });
        this.views.forEach((v) => {
          if (v && typeof v.destroy === "function") v.destroy();
        });
        this.views.length = 0;
        __privateGet(this, _listeners).clear();
        __privateSet(this, _data, {});
      }
    }
    _data = new WeakMap();
    _destroyed2 = new WeakMap();
    _listeners = new WeakMap();
    root.KModel = KModel;
    root.KView = KView;
    root.getKModel = function(el) {
      return $(el).parents("[is=kview]").data("model");
    };
  })(typeof window !== "undefined" ? window : globalThis, typeof window !== "undefined" && window.jQuery);
})();
//# sourceMappingURL=ksimpleviews.js.map
