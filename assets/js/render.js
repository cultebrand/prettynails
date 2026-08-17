/* ===========================================================================
   MyNails — shared content renderers
   One copy of the JSON -> HTML logic, used from two places:
     - assets/js/main.js   re-renders live in the visitor's browser
     - static-admin/builder.js    bakes the same markup into index.html at save time,
                           so the page is complete without JavaScript
   No build step; this file defines window.PureRender and nothing else.
   =========================================================================== */

(function () {
  "use strict";

  /** Read `a.b.c` out of an object, returning undefined rather than throwing. */
  function get(root, path) {
    return String(path)
      .split(".")
      .reduce(function (node, key) {
        return node == null ? undefined : node[key];
      }, root);
  }

  function isFilled(value) {
    if (value == null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  function el(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* --- renderers ------------------------------------------------------------
     Each takes (container, items, opts). `opts.asset` maps a CMS media path
     (`/media/uploads/x.jpg`) to whatever URL form the caller needs — absolute
     for the live page, root-relative for baked HTML.

     Most lists render through symbol templates (see renderSymbolItems below);
     only site chrome that predates any symbol keeps a hand renderer here. */

  function renderLinks(container, items) {
    var doc = container.ownerDocument;
    container.replaceChildren();

    items.forEach(function (item) {
      if (!isFilled(item.url) || !isFilled(item.label)) return;
      var li = el(doc, "li");
      var a = el(doc, "a", null, item.label);
      a.setAttribute("href", item.url);
      if (/^https?:/.test(item.url)) {
        a.setAttribute("rel", "noopener");
        a.setAttribute("target", "_blank");
      }
      li.appendChild(a);
      container.appendChild(li);
    });
  }

  /** The site menu, rendered from the Pages list (content/pages.json). Only
      pages given a menu label appear; while none have one, the hand-written
      links in the markup are left alone. */
  function renderNav(container, pages) {
    var doc = container.ownerDocument;
    var items = pages.filter(function (page) {
      return isFilled(page.nav_label);
    });

    if (!items.length) return;
    container.replaceChildren();

    items.forEach(function (page) {
      var a = el(doc, "a", null, page.nav_label);
      // Extensionless: GitHub Pages serves account.html for /account, so the
      // file on disk keeps its extension and the address people see does not.
      //
      // Root-relative, because these pages no longer all sit at the same depth
      // — a set's page is /sets/<slug>, and a bare "shop" drawn there would
      // resolve to /sets/shop. The custom domain serves this site from the
      // root, which is what makes a leading slash correct.
      a.setAttribute("href", page.slug === "index" ? "/" : "/" + page.slug);
      if (
        doc.defaultView &&
        doc.defaultView.location &&
        doc.defaultView.location.pathname.replace(/\.html$/, "") === a.getAttribute("href")
      ) {
        a.setAttribute("aria-current", "page");
      }
      container.appendChild(a);
    });
  }

  var RENDERERS = {
    "site.contact.links": renderLinks,
    "pages.pages": renderNav,
  };

  /* --- symbol-bound content ---------------------------------------------------
     A container inside a symbol carrying data-list="symbol:items" renders the
     symbol's OWN items (from its Sveltia entry) through a template the
     designer drew: one item element with data-text="item.<field>" slots. The
     template travels with the markup — as the visible first child in the
     builder's drawing, and as a <template data-item> in exported pages — so
     any tool can re-render the list without knowing the item's shape. */

  function renderSymbolItems(container, items, opts) {
    var doc = container.ownerDocument;
    var template = container.querySelector("template[data-item]");
    var proto = template
      ? template.content.firstElementChild
      : container.firstElementChild;

    if (!proto) return;

    if (!template) {
      template = doc.createElement("template");
      template.setAttribute("data-item", "");
      template.content.appendChild(proto.cloneNode(true));
    }

    container.replaceChildren(template);
    items.forEach(function (item) {
      var clone = proto.cloneNode(true);

      // Text slots: fill when the item has the field, drop the element when
      // it does not — optional fields (price, status) simply disappear.
      clone.querySelectorAll('[data-text^="item."]').forEach(function (slot) {
        var value = item[slot.getAttribute("data-text").slice(5)];
        if (isFilled(value)) slot.textContent = value;
        else slot.remove();
      });

      // Link slots: data-href="/sets/{slug}" points an anchor at the item's
      // own page. A pattern rather than a field, because the address is made
      // of the item plus a path the item knows nothing about — and keeping the
      // path in the drawing means the builder can change where a card goes
      // without anyone editing this file. An item missing the field it names
      // leaves the drawn href alone rather than linking to /sets/undefined.
      var linked = Array.prototype.slice.call(clone.querySelectorAll("[data-href]"));
      if (clone.hasAttribute && clone.hasAttribute("data-href")) linked.unshift(clone);
      linked.forEach(function (host) {
        var pattern = host.getAttribute("data-href");
        var missing = false;
        var href = pattern.replace(/\{([a-z0-9_]+)\}/gi, function (_, key) {
          if (!isFilled(item[key])) {
            missing = true;
            return "";
          }
          return encodeURIComponent(item[key]);
        });
        if (!missing) host.setAttribute("href", href);
      });

      // Colour slots: data-vars="--tint:wash;--set-deep:deep" paints the item's
      // own colours onto the element as custom properties, so a set carries its
      // tint in the CMS rather than in a stylesheet nobody editing content can
      // reach. Absent fields are skipped and the CSS fallback stands.
      var painted = Array.prototype.slice.call(clone.querySelectorAll("[data-vars]"));
      if (clone.hasAttribute && clone.hasAttribute("data-vars")) painted.unshift(clone);
      painted.forEach(function (host) {
        host
          .getAttribute("data-vars")
          .split(";")
          .forEach(function (pair) {
            var half = pair.split(":");
            if (half.length !== 2) return;
            var name = half[0].trim();
            var value = item[half[1].trim()];
            if (name && isFilled(value)) host.style.setProperty(name, value);
          });
      });

      // Image slots: data-img="item.image" appends an <img> when the item has
      // one (alt from data-img-alt's field, falling back to the title) and
      // removes the class named in data-img-empty; otherwise the drawn
      // empty-state stands.
      //
      // The item's root element counts as a host. querySelectorAll only ever
      // returns descendants, so a template whose outermost element IS the
      // image slot — the hero's stacked hands are exactly that — would
      // otherwise render every item pictureless.
      var slots = Array.prototype.slice.call(clone.querySelectorAll("[data-img]"));
      if (clone.hasAttribute && clone.hasAttribute("data-img")) slots.unshift(clone);
      slots.forEach(function (host) {
        var value = item[host.getAttribute("data-img").slice(5)];
        if (!isFilled(value)) return;
        var img = doc.createElement("img");
        img.setAttribute("src", opts && opts.asset ? opts.asset(value) : value);
        var altKey = (host.getAttribute("data-img-alt") || "").slice(5);
        img.setAttribute("alt", (altKey && item[altKey]) || item.title || "");
        img.setAttribute("loading", "lazy");
        var emptyClass = host.getAttribute("data-img-empty");
        if (emptyClass) host.classList.remove(emptyClass);
        host.appendChild(img);
      });

      container.appendChild(clone);
    });
  }

  /* --- binding ----------------------------------------------------------- */

  /**
   * Apply the content object to every data-text / data-when / data-list hook
   * under `root`. Works on the live document and on a detached DOMParser
   * document alike. `opts.asset` is required only if catalog items carry images.
   */
  function bindAll(root, content, opts) {
    opts = opts || {};
    if (typeof opts.asset !== "function") {
      opts.asset = function (path) {
        return path;
      };
    }

    root.querySelectorAll("[data-text]").forEach(function (node) {
      var value = get(content, node.getAttribute("data-text"));
      if (isFilled(value)) node.textContent = value;
    });

    root.querySelectorAll("[data-when]").forEach(function (node) {
      if (isFilled(get(content, node.getAttribute("data-when")))) {
        node.removeAttribute("hidden");
      } else {
        node.setAttribute("hidden", "");
      }
    });

    root.querySelectorAll("[data-list]").forEach(function (node) {
      var path = node.getAttribute("data-list");

      if (path === "symbol:items") {
        var host = node.closest("[data-symbol]");
        var entry = host && get(content, "symbolEntries." + host.getAttribute("data-symbol"));
        if (entry) {
          // A symbol either carries its own items or binds another
          // collection's through its template (source, e.g. "catalog.items").
          var symbolItems = entry.source ? get(content, entry.source) : entry.items;
          if (Array.isArray(symbolItems) && symbolItems.length) {
            renderSymbolItems(node, symbolItems, opts);
          }
        }
        return;
      }

      var items = get(content, path);
      var render = RENDERERS[path];
      if (render && Array.isArray(items) && items.length) render(node, items, opts);
    });
  }

  window.PureRender = {
    get: get,
    isFilled: isFilled,
    bindAll: bindAll,
    renderSymbolItems: renderSymbolItems,
    RENDERERS: RENDERERS,
  };
})();
