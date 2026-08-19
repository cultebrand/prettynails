#!/usr/bin/env node
/* ===========================================================================
   MyNails — page scaffolder

   NOT a build step. The site is served exactly as it sits on disk; nothing
   here runs at deploy time and nothing here runs in a visitor's browser.

   What it is: the one place the shared chrome (head, masthead, footer) is
   written down, so the shop, the seven set pages, the guide, the FAQ and the
   legal pages cannot drift apart from each other. Run it by hand after adding
   a set to content/catalog.json or a question to content/faq.json:

       node tools/pages.mjs

   It rewrites only the pages it owns (listed in OWNED below) and never touches
   index.html, contact.html, login.html, signup.html or account.html — those
   have hand-written bodies and belong to the visual builder.
   =========================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const site = read("content/site.json");
const catalog = read("content/catalog.json");
const faq = read("content/faq.json");
const assurances = read("content/symbols/assurances.json");
const craft = read("content/craft.json");

const BRAND = "MyNails";
const ORIGIN = "https://put-on.com";
const OG_IMAGE = "/media/uploads/og-mynails.png";
const YEAR = 2026;

/* One cache-busting number for the whole site, because there were two.
   head() stamped the stylesheets ?v=18 while footer() stamped the scripts ?v=19
   and syncChrome() rewrote the hand-owned pages to ?v=19 — so the landing page
   and the shop asked for two different builds of the same file. Bump this once
   when either asset changes; nothing else in here carries a version. */
const ASSET_V = 22;

/* --- escaping --------------------------------------------------------------
   Every value below comes from content/*.json, which a non-technical editor
   fills in through the CMS. It is therefore untrusted input to this file and
   gets escaped on the way into markup — not because the editor is hostile, but
   because an apostrophe in a product name should not be able to end an
   attribute. */
const isFilled = (v) =>
  v != null && (typeof v === "string" ? v.trim() !== "" : Array.isArray(v) ? v.length > 0 : true);

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Prose from the CMS: blank lines become paragraphs. */
const paras = (s) =>
  String(s ?? "")
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("\n            ");

/* --- long-form layout ------------------------------------------------------
   A 62ch column of prose inside a 1400px frame leaves half the window empty.
   The page's own sections go in that half instead, pinned while you read, so a
   guide on a laptop behaves like a document rather than a scroll.

   The list is built from the headings themselves, which is what keeps it from
   drifting out of step with them: add an h2 to the copy below and it appears
   in the rail on the next run, anchored, with no second list to update. Pages
   with fewer than three headings do not get one — a rail listing two things is
   furniture, not navigation. */
const headingId = (s) =>
  s
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function longform(body) {
  const heads = [...body.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());

  if (heads.length < 3) {
    return `        <div class="prose__body">\n${body}\n        </div>`;
  }

  let i = 0;
  const anchored = body.replace(/<h2>/g, () => `<h2 id="${headingId(heads[i++])}">`);
  const items = heads
    .map(
      (h) =>
        `              <li><a href="#${headingId(h)}">${h.replace(/<[^>]*>/g, "")}</a></li>`,
    )
    .join("\n");

  return `        <div class="prose__layout">
          <div class="prose__body">
${anchored}
          </div>
          <nav class="toc" aria-label="On this page">
            <p class="toc__title">On this page</p>
            <ol>
${items}
            </ol>
          </nav>
        </div>`;
}

/* --- the menu --------------------------------------------------------------
   Root-absolute on purpose. These pages live at two depths (/shop and
   /sets/amour) and the site is served from a domain root, so a relative href
   would resolve differently depending on which page drew it. */
const MENU = [
  { href: "/shop", label: "Shop" },
  { href: "/about", label: "About" },
  { href: "/guide", label: "Fit &amp; care" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

const ACCESS_SCRIPT = `      (function () {
        var signedIn = false;
        try {
          signedIn = Boolean(localStorage.getItem("qa.account"));
        } catch (error) {
          /* private mode, or storage refused — treated as signed out */
        }
        if (signedIn) document.documentElement.dataset.account = "in";
      })();`;

function head({ title, description, path, jsonld = [], preload = [] }) {
  const url = ORIGIN + path;
  const preloads = preload
    .map((p) => `    <link rel="preload" as="image" href="${esc(p)}" />\n`)
    .join("");
  const blocks = jsonld
    .map(
      (b) =>
        `    <script type="application/ld+json">\n` +
        JSON.stringify(b, null, 2)
          .split("\n")
          .map((l) => "      " + l)
          .join("\n") +
        `\n    </script>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="canonical" href="${esc(url)}" />

    <!-- Generated by tools/pages.mjs. Edit the copy in content/*.json or in
         the template there, then re-run it; hand edits here are overwritten. -->
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${BRAND}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(ORIGIN + OG_IMAGE)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="theme-color" content="#f7f3ef" />

    <link rel="icon" href="/media/uploads/icon-32.png" sizes="32x32" />
    <link rel="icon" href="/media/uploads/icon-16.png" sizes="16x16" />
    <link rel="apple-touch-icon" href="/media/uploads/icon-180.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,500&amp;family=Italiana&amp;family=Jost:wght@300..600&amp;display=swap"
    />
    <link rel="stylesheet" href="/assets/css/styles.css?v=${ASSET_V}" />
    <link rel="stylesheet" href="/assets/css/page.css?v=${ASSET_V}" />
${preloads}
    <!-- Where content/ and media/ live. These pages are not all at the same
         depth — a set's page is /sets/<slug> — so main.js is told the root
         rather than guessing it from the current directory. -->
    <meta name="site-root" content="/" />
    <meta name="page-access" content="public" />
    <meta name="page-redirect" content="" />
${blocks}

    <script>
${ACCESS_SCRIPT}
    </script>
  </head>
  <body>
    <a href="#main" class="skip">Skip to content</a>
${banner()}`;
}

/* The announcement bar, baked open when there is something to announce.
   `data-when` binds the TEXT, not the object around it: render.js's isFilled
   ends in `return true` for any non-null object, so binding the wrapper
   un-hides an empty bar. Baked rather than left to JavaScript because the one
   component built to say when this shop opens should not need a script to say
   it. */
function banner() {
  const a = site.announcement || {};
  const text = typeof a === "string" ? a : a.text;
  if (!isFilled(text)) {
    return `    <aside aria-label="Announcement" data-when="site.announcement.text" class="banner" hidden>
      <p data-text="site.announcement.text"></p>
    </aside>
`;
  }
  const inner =
    isFilled(a.href) && isFilled(a.cta)
      ? `<a href="${esc(a.href)}"><span data-text="site.announcement.text">${esc(text)}</span> <span class="banner__cta">${esc(a.cta)} &rarr;</span></a>`
      : `<span data-text="site.announcement.text">${esc(text)}</span>`;
  return `    <aside aria-label="Announcement" data-when="site.announcement.text" class="banner">
      <p>${inner}</p>
    </aside>
`;
}

function masthead(current, float) {
  const links = MENU.map(
    (m) => `<a href="${m.href}"${m.href === current ? ' aria-current="page"' : ""}>${m.label}</a>`,
  ).join("");
  return `    <header data-symbol="site-header" class="masthead${float ? " masthead--float" : ""}">
      <a href="/" class="brand"><span class="brand__name">${BRAND}</span></a>
      <nav aria-label="Pages" data-list="pages.pages" class="masthead__nav">${links}</nav>
      <div class="masthead__end">
        <a href="/waitlist" class="btn btn--solid masthead__cta">Join the waitlist</a>
        <a href="/login" class="masthead__account" data-account-when="out">Sign in</a>
        <a href="/account" class="masthead__account" data-account-when="in">Your account</a>
      </div>
    </header>

    <main id="main">
`;
}

/* --- the footer ------------------------------------------------------------
   Written once here and stamped into every page, generated and hand-owned
   alike (see syncChrome at the bottom), because a footer that differs by one
   link between two pages is the exact thing that reads as unfinished.

   Four columns: who this is, the whole shop, the pages that answer questions,
   and one more chance to join the waitlist — which is the only conversion this
   site has while the shop is shut. */
function footer() {
  const social = site.contact.links
    .filter((l) => l.url && l.label && /^https?:/.test(l.url))
    .map(
      (l) =>
        `            <li><a href="${esc(l.url)}" rel="noopener" target="_blank">${esc(l.label)}</a></li>`,
    )
    .join("\n");

  const sets = catalog.items
    .map((i) => `            <li><a href="/sets/${esc(i.slug)}">${esc(i.title)}</a></li>`)
    .join("\n");

  return `    </main>

    <footer data-symbol="site-footer" class="colophon">
      <div class="colophon__grid">
        <div class="colophon__brand">
          <a href="/" class="brand"><span class="brand__name">${BRAND}</span></a>
          <p class="colophon__blurb">
            Handmade press-on nail sets, made one nail at a time in Copenhagen
            and sold in small runs.
          </p>
          <ul class="colophon__social">
${social || "            <!-- add a social link in Settings → Contact → Footer links -->"}
          </ul>
        </div>

        <nav class="colophon__col" aria-label="Shop">
          <h2 class="colophon__heading">The seven</h2>
          <ul>
${sets}
            <li><a href="/shop"><strong>All seven sets</strong></a></li>
          </ul>
        </nav>

        <nav class="colophon__col" aria-label="Help">
          <h2 class="colophon__heading">Help</h2>
          <ul>
            <li><a href="/guide">Fit &amp; care</a></li>
            <li><a href="/guide#sizing">Sizing</a></li>
            <li><a href="/shipping">Shipping &amp; returns</a></li>
            <li><a href="/faq">FAQ</a></li>
            <li><a href="/contact">Contact</a></li>
          </ul>
        </nav>

        <div class="colophon__col colophon__signup">
          <h2 class="colophon__heading">The waitlist</h2>
          <p>One email, sent when the next run of sets is ready. Nothing else.</p>
          <form
            data-symbol="waitlist-form"
            class="notify notify--compact"
            novalidate=""
            data-form="waitlist"
            data-success="You are on the list. We will write once, when the sets are ready."
            method="post"
            action="${esc(site.backend.url)}/api/f/waitlist"
          >
            <div class="notify__row">
              <label class="visually-hidden" for="footer-email">Email address</label>
              <input
                id="footer-email"
                class="notify__input"
                type="email"
                name="email"
                required=""
                autocomplete="email"
                placeholder="you@example.com"
              />
              <button type="submit" class="btn btn--solid">Join</button>
            </div>
            <p role="status" aria-live="polite" class="notify__status"></p>
          </form>
        </div>
      </div>

      <div class="colophon__legal">
        <p>&copy; ${YEAR} ${BRAND} · Handmade in Copenhagen, Denmark</p>
        <ul>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/terms">Terms</a></li>
          <li><a href="/shipping">Shipping &amp; returns</a></li>
        </ul>
      </div>
    </footer>

    <script src="/assets/js/render.js?v=${ASSET_V}"></script>
    <script src="/assets/js/main.js?v=${ASSET_V}"></script>
  </body>
</html>
`;
}

const page = (meta, body) => head(meta) + masthead(meta.current) + body + footer();

/* --- structured data ------------------------------------------------------ */

const ORG = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: BRAND,
  url: ORIGIN,
  logo: ORIGIN + OG_IMAGE,
  email: site.contact.email,
  address: { "@type": "PostalAddress", addressLocality: "Copenhagen", addressCountry: "DK" },
};

const crumbs = (trail) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map((t, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: t.name,
    item: ORIGIN + t.href,
  })),
});

/* --- shared blocks -------------------------------------------------------- */

const setCard = (item) => `          <li class="set" style="--tint: ${esc(item.wash)}; --set-deep: ${esc(item.deep)}">
            <a class="set__link" href="/sets/${esc(item.slug)}">
              <figure class="set__figure">
                <img src="${esc(item.image)}" alt="${esc(item.image_alt)}" loading="lazy" decoding="async" />
              </figure>
              ${item.run_note ? `<p class="set__status">${esc(item.run_note)}</p>` : ""}
              <div class="set__head">
                <h3 class="set__name">${esc(item.title)}</h3>
                <p class="set__price">${esc(item.price)}</p>
              </div>
              <p class="set__finish">${esc(item.finish)}</p>
              <p class="set__note">${esc(item.blurb)}</p>
              <span class="set__more">View the set</span>
            </a>
          </li>`;

/* --- the shop's own two partials ------------------------------------------
   Deliberately NOT setCard(). That one is rendered here for /shop and again at
   the foot of all seven set pages, and index.html carries a third, hand-baked
   copy of it in a different element order with the data-* hooks render.js
   rebuilds on load. Editing it to improve one page silently rewrites nine, and
   desynchronises the landing page from the shop the moment JavaScript runs.
   These two are only ever called from OWNED["shop.html"], so the blast radius
   of everything below is exactly one file.

   It also buys something render.js structurally cannot do: an ordinal.
   renderSymbolItems has no item index, so a CMS re-bind could never reproduce
   "01"–"07" — which is why the case is not CMS-bound and says so in the markup. */

/* What the seven have in common, stated once.

   This replaces a seven-row index that sat above the photographs and repeated
   every set's name, finish, shape, price and run — the same seven facts the
   labels below already carry, in a table sorted by price whose numerals ran
   01 02 03 04 06 05 07 because they were catalogue positions. On a phone it
   was two screens of spreadsheet before the first nail.

   These four are the opposite: only what is true of the whole catalogue, so
   nothing here is printed a second time further down. All of it is read out
   of content/catalog.json rather than typed, so it cannot drift from the
   sets. */
const money = (price) => Number(String(price).replace(/\D/g, ""));

/* Six of the seven are "Almond · Medium". A column repeating one string seven
   times is not information; the exception is. */
const commonShape = [...catalog.items.reduce((tally, item) => tally.set(item.shape, (tally.get(item.shape) || 0) + 1), new Map())].sort(
  (a, b) => b[1] - a[1],
)[0][0];

const lastWord = (shape) => shape.split("·").pop().trim();

const tally = () => {
  const prices = catalog.items.map((item) => money(item.price));
  const wears = [...new Set(catalog.items.map((item) => item.wear))];
  /* Only the notes that open with a count — "Made to order · about 2 weeks"
     has a number in it that is a fortnight, not a quantity. */
  const runs = catalog.items
    .map((item) => /^(\d+)\b/.exec(item.run_note || ""))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const odd = catalog.items.filter((item) => item.shape !== commonShape);

  const rows = [
    ["Price", `kr ${Math.min(...prices)} – ${Math.max(...prices)}`],
    [
      "Shape",
      odd.length
        ? `${commonShape.replace(" · ", ", ").toLowerCase().replace(/^./, (c) => c.toUpperCase())} — ${odd
            .map((item) => `${item.title} is ${lastWord(item.shape).toLowerCase()}`)
            .join(", ")}`
        : commonShape,
    ],
    ["Wear", `${wears.join(", ")} on the hand`],
    ["Run", runs.length ? `${Math.min(...runs)} to ${Math.max(...runs)} of each set` : "Made in small runs"],
  ];

  return `          <dl class="tally">
${rows.map(([term, value]) => `            <div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join("\n")}
          </dl>`;
};

/* One compartment of the case: the set's ten nails lying in its own tint, the
   photograph of it worn tucked into the corner, and four short lines of label
   printed beside the object rather than over it.

   The blurb is not here. It is on the set's own page, and seven paragraphs of
   it down a grid is what made this page a wall of prose nobody read. */
const caseTray = (item, index) => {
  const eager = index < 3;
  return `            <li class="tray" id="set-${esc(item.slug)}" data-status="${esc(item.status || "")}" style="--tint: ${esc(
    item.wash,
  )}; --set-shade: ${esc(item.shade)}; --set-deep: ${esc(item.deep)}">
              <figure class="tray__figure" data-pin="${
                /* By shelf, not by compartment. Alternating every tile puts
                   the two prints of a row either side of the gutter facing
                   each other, which crowds it and reads as symmetry; by shelf
                   they walk down the page instead. Two columns above 40rem. */
                Math.floor(index / 2) % 2 ? "start" : "end"
              }">
                <img class="tray__lay" src="${esc(item.lay)}" alt="${esc(item.lay_alt)}" width="1350" height="900" ${
                  eager
                    ? 'loading="eager" fetchpriority="high"'
                    : 'loading="lazy" fetchpriority="low"'
                } decoding="async" />
                <img class="tray__worn" src="${esc(item.hand)}" alt="" loading="lazy" decoding="async" />
              </figure>
              <div class="tray__label">
                <div class="tray__head">
                  <span class="tray__no">${String(index + 1).padStart(2, "0")}</span>
                  <h3 class="tray__name"><a class="tray__link" href="/sets/${esc(
                    item.slug,
                  )}" aria-label="${esc(item.title)} — ${esc(item.finish.toLowerCase())}, ${esc(
                    item.price,
                  )}">${esc(item.title)}</a></h3>
                  <p class="tray__price">${esc(item.price)}</p>
                </div>
                <p class="tray__spec">${esc(
                  /* The head states the shape the catalogue shares. Repeating
                     "Almond · Medium" under six of seven photographs spends a
                     line on the one fact that never distinguishes them; the
                     set that departs from it still says so. */
                  item.shape === commonShape ? item.finish : `${item.finish} · ${lastWord(item.shape)}`,
                )}</p>
                <p class="tray__line">${esc(item.tagline)}</p>
                <p class="tray__run">${esc(item.run_note || "")}</p>
                <!-- A span, not an anchor: .tray__link::after already covers the
                     whole compartment, so a second link here would be a target
                     nothing can reach. This is the affordance for the one that
                     is there — the tile was clickable with no sign of it. -->
                <span class="tray__more" aria-hidden="true">See ${esc(item.title)}</span>
              </div>
            </li>`;
};

const waitlistBlock = ({ heading, note, item, level = 2 }) => `      <section id="waitlist" class="waitlist"${
    item ? ` style="--wash: ${esc(item.wash)}; --shade: ${esc(item.shade)}; --deep: ${esc(item.deep)}"` : ""
  }>
        <div class="waitlist__inner">
          <div>
            <p class="eyebrow">The studio is not open yet</p>
            <h${level} class="waitlist__title">${esc(heading)}</h${level}>
          </div>
          <div>
            <p class="waitlist__note">${esc(note)}</p>
            <form
              data-symbol="waitlist-form"
              class="notify"
              novalidate=""
              data-form="waitlist"
              data-success="You are on the list. We will write once, when the sets are ready."
              method="post"
              action="${esc(site.backend.url)}/api/f/waitlist"
            >
              <div class="notify__row">
                <label class="visually-hidden" for="waitlist-email">Email address</label>
                <input
                  id="waitlist-email"
                  class="notify__input"
                  type="email"
                  name="email"
                  required=""
                  autocomplete="email"
                  placeholder="you@example.com"
                />
                <button type="submit" class="btn btn--solid">Join the waitlist</button>
              </div>
              <noscript>
                <p class="notify__note">
                  JavaScript is off, so this form cannot send. Email
                  <a href="mailto:${esc(site.contact.email)}">${esc(site.contact.email)}</a>
                  with the subject &quot;Opening notice&quot; and you will be added to the list.
                </p>
              </noscript>
              <p id="waitlist-status" role="status" aria-live="polite" class="notify__status"></p>
            </form>
          </div>
          <ul class="waitlist__panel">
            <li>One email, not a newsletter</li>
            <li>Sent the day a run is ready</li>
            <li>Never passed to anyone else</li>
          </ul>
        </div>
      </section>
`;

/* The four facts that make this worth 540 kr, carried next to the buy moment
   rather than only as the last paragraph of /about. Deliberately only the
   facts the box list does not already state — printing "twelve sizes" twice
   200px apart reads worse than not printing it at all. */
const assurancesBlock = () => `      <section class="assurances" data-symbol="assurances">
        <ul class="assurances__row" data-list="symbol:items">
          <template data-item><li class="assurance"><p class="assurance__title" data-text="item.title"></p><p class="assurance__body" data-text="item.body"></p></li></template>
${assurances.items
  .map(
    (a) =>
      `          <li class="assurance"><p class="assurance__title" data-text="item.title">${esc(a.title)}</p><p class="assurance__body" data-text="item.body">${esc(a.body)}</p></li>`,
  )
  .join("\n")}
        </ul>
      </section>
`;

/* --- the pages ------------------------------------------------------------ */

const OWNED = {};

/* Shop -------------------------------------------------------------------- */
OWNED["shop.html"] = page(
  {
    title: `Shop all seven sets — ${BRAND}`,
    description:
      "Seven handmade press-on nail sets, each in twelve sizes and reusable. Glazed milk, aurora pearl, satin marble, jelly gloss, mirror chrome and more.",
    path: "/shop",
    current: "/shop",
    // The first compartment is the page's largest image and its LCP element.
    preload: [catalog.items[0].lay],
    jsonld: [
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "The seven sets",
        itemListElement: catalog.items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: item.title,
          url: `${ORIGIN}/sets/${item.slug}`,
        })),
      },
      crumbs([
        { name: "Home", href: "/" },
        { name: "Shop", href: "/shop" },
      ]),
    ],
  },
  `      <nav class="crumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="/">Home</a></li>
          <li><a href="/shop" aria-current="page">Shop</a></li>
        </ol>
      </nav>

      <section class="case">
        <div class="case__head">
          <div class="case__lede">
            <p class="eyebrow">Every set we make</p>
            <h1 class="case__title">The seven</h1>
            <!-- The old blurb spent its three sentences on ten nails, two
                 spares, twelve sizes and four or five wears — every one of
                 which "What arrives" prints again two thousand pixels down
                 the same page. This says the thing only the shop can say. -->
            <p class="case__blurb">
              Seven sets, and that is the whole catalogue. Each one is a single idea
              carried across ten nails, sculpted and painted here in Copenhagen: about
              four hours of work for most of them, and fourteen for Amour.
            </p>
            <p class="case__facts">
              <a href="/guide#sizing">How to size</a>
              <a href="/shipping">Shipping &amp; returns</a>
              <a href="/faq">Questions</a>
            </p>
          </div>

${tally()}
        </div>

        <h2 class="visually-hidden">All seven sets</h2>
        <!-- Not CMS-bound on purpose: no data-symbol, no data-list. The label
             carries an ordinal, and render.js's renderSymbolItems has no item
             index, so a re-bind could only ever produce these tiles without
             their numbers. The seven live in content/catalog.json and this file
             renders them; edit the catalogue and re-run tools/pages.mjs. -->
        <ol class="case__trays">
${catalog.items.map(caseTray).join("\n")}
        </ol>
      </section>

      <section class="case__closer" aria-labelledby="whats-in-the-box">
        <figure class="closer__figure">
          <img src="/media/uploads/nails/box-open.webp" alt="An open box: ten almond nails seated in a die-cut card insert, with spares, a glue vial and adhesive tabs in the lid" width="1350" height="900" loading="lazy" decoding="async" />
        </figure>
        <div class="closer__body">
          <h2 class="closer__title" id="whats-in-the-box">What arrives</h2>
          <!-- Figures, not words. Every quantity on this page used to be
               spelled out — ten nails, twelve sizes, eighteen in the first
               run — which is a fine rule for a sentence and the wrong one for
               a list somebody is scanning. The prose still spells them; the
               counts here and in the facts panel are read, not read aloud. -->
          <ul class="closer__list">
            <li>10 nails, plus 2 spares</li>
            <li>12 sizes in the box, so it fits without a fitting</li>
            <li>Glue, adhesive tabs, a file and a cuticle stick</li>
            <li>The box is the storage — the set goes back in it</li>
            <li>Worn 4 or 5 times with care</li>
          </ul>
          <p class="closer__links">
            <a href="/guide#sizing">Find your size</a> ·
            <a href="/guide">Fit &amp; care</a> ·
            <a href="/shipping">Shipping &amp; returns</a>
          </p>
        </div>
      </section>

${assurancesBlock()}
${waitlistBlock({
  heading: "Sets are made in small runs, and small runs go quickly.",
  note: "Leave an address and we’ll write once — when the first seven sets are ready to order. Nothing else, ever.",
  item: catalog.items[catalog.items.length - 1],
})}`,
);

/* Set detail × 7 ----------------------------------------------------------- */
catalog.items.forEach((item, index) => {
  const prev = catalog.items[(index - 1 + catalog.items.length) % catalog.items.length];
  const next = catalog.items[(index + 1) % catalog.items.length];

  OWNED[`sets/${item.slug}.html`] = page(
    {
      title: `${item.title} — ${item.finish} press-on nails | ${BRAND}`,
      description: item.blurb,
      path: `/sets/${item.slug}`,
      current: "/shop",
      preload: [item.hand],
      jsonld: [
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: item.title,
          description: item.blurb,
          image: [ORIGIN + item.image, ORIGIN + item.hand],
          brand: { "@type": "Brand", name: BRAND },
          material: item.finish,
          offers: {
            "@type": "Offer",
            url: `${ORIGIN}/sets/${item.slug}`,
            price: String(item.price).replace(/[^\d.]/g, ""),
            priceCurrency: "DKK",
            availability:
              "https://schema.org/" +
              ({ "sold-out": "SoldOut", "few-left": "LimitedAvailability", "made-to-order": "MadeToOrder" }[
                item.status
              ] || "PreOrder"),
          },
        },
        crumbs([
          { name: "Home", href: "/" },
          { name: "Shop", href: "/shop" },
          { name: item.title, href: `/sets/${item.slug}` },
        ]),
      ],
    },
    `      <nav class="crumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="/">Home</a></li>
          <li><a href="/shop">Shop</a></li>
          <li aria-current="page">${esc(item.title)}</li>
        </ol>
      </nav>

      <article class="detail" style="--wash: ${esc(item.wash)}; --shade: ${esc(item.shade)}; --deep: ${esc(item.deep)}">
        <div class="detail__media">
          <figure class="detail__hand">
            <img
              src="${esc(item.hand)}"
              alt="${esc(item.hand_alt)}"
              width="1200"
              height="1579"
              fetchpriority="high"
              decoding="async"
            />
          </figure>
          <figure class="detail__macro">
            <img src="${esc(item.image)}" alt="${esc(item.image_alt)}" loading="lazy" decoding="async" />
          </figure>
${
  (item.gallery || []).length
    ? `          <div class="nails">
            <p class="nails__title">Every nail in the set</p>
            <ul class="nails__grid">
${item.gallery
  .map(
    (g) =>
      `              <li class="nails__cell"><img src="${esc(g.image)}" alt="${esc(g.alt)}" loading="lazy" decoding="async" /></li>`,
  )
  .join("\n")}
            </ul>
            <p class="nails__note">
              ${item.gallery.length} of the ten photographed on their own. ${
                item.slug === "amour" || item.slug === "matcha-latte"
                  ? "No two are the same."
                  : "Sizes are matched to your hand from the twelve in the box."
              }
            </p>
          </div>`
    : ""
}
        </div>

        <div class="detail__lede">
          <p class="eyebrow">Set ${String(index + 1).padStart(2, "0")} of ${String(catalog.items.length).padStart(2, "0")}</p>
          <h1 class="detail__title">${esc(item.title)}</h1>
          <p class="detail__tagline">${esc(item.tagline)}</p>

          <p class="detail__price">${esc(item.price)}</p>
          <p class="detail__terms">
            Made to order in Copenhagen · VAT included ·
            <a href="/shipping">delivery &amp; returns</a>
          </p>
          ${item.run_note ? `<p class="set__status detail__run">${esc(item.run_note)}</p>` : ""}

          <dl class="specs">
            <div><dt>Finish</dt><dd>${esc(item.finish)}</dd></div>
            <div><dt>Shape</dt><dd>${esc(item.shape)}</dd></div>
            <div><dt>Wear</dt><dd>${esc(item.wear)}</dd></div>
          </dl>

          <div class="detail__body">
            ${paras(item.story)}
          </div>

          <ul class="detail__includes">
            <li>Ten hand-finished nails, plus two spares</li>
            <li>Twelve sizes in the box — no fitting needed</li>
            <li>Glue, adhesive tabs, a mini file and a cuticle stick</li>
            <li>Reusable: soaked off gently, a set goes back on four or five times</li>
          </ul>

          <div class="detail__actions">
            <a class="btn btn--solid" href="#waitlist">Join the waitlist</a>
            <a class="btn btn--ghost" href="/guide">Read the fit guide</a>
          </div>
          <p class="detail__aside">
            Not open for orders yet. The waitlist is one email, sent when this set is ready.
          </p>
        </div>
      </article>

${assurancesBlock()}
      <!-- The three nearest sets by price, so the row answers "what else is
           near this?" rather than "what did we happen to make next?" -->
      <section class="related">
        <header class="section-head section-head--split">
          <h2 class="section-head__title">You might also like</h2>
          <p class="eyebrow"><a href="/shop">All seven sets →</a></p>
        </header>
        <ul class="set-grid">
${catalog.items
  .filter((o) => o.slug !== item.slug)
  .sort(
    (a, b) =>
      Math.abs(Number(String(a.price).replace(/\D/g, "")) - Number(String(item.price).replace(/\D/g, ""))) -
      Math.abs(Number(String(b.price).replace(/\D/g, "")) - Number(String(item.price).replace(/\D/g, ""))),
  )
  .slice(0, 3)
  .map(setCard)
  .join("\n")}
        </ul>
      </section>

      <nav class="pager" aria-label="Other sets">
        <a class="pager__link pager__link--prev" href="/sets/${esc(prev.slug)}">
          <span class="pager__dir">Previous</span>
          <span class="pager__name">${esc(prev.title)}</span>
        </a>
        <a class="pager__all" href="/shop">All seven</a>
        <a class="pager__link pager__link--next" href="/sets/${esc(next.slug)}">
          <span class="pager__dir">Next</span>
          <span class="pager__name">${esc(next.title)}</span>
        </a>
      </nav>

${waitlistBlock({
  heading: `${item.title} is made in small runs, and small runs go quickly.`,
  note: "Leave an address and we’ll write once — when this set is ready to order. Nothing else, ever.",
  item,
})}`,
  );
});

/* About -------------------------------------------------------------------- */
OWNED["about.html"] = page(
  {
    title: `About the studio — ${BRAND}`,
    description:
      "A one-person press-on nail studio in Copenhagen. How the sets are made, why they are made in small runs, and what that means for what you can buy.",
    path: "/about",
    current: "/about",
    jsonld: [
      ORG,
      crumbs([
        { name: "Home", href: "/" },
        { name: "About", href: "/about" },
      ]),
    ],
  },
  `      <section class="prose">
        <header class="section-head">
          <p class="eyebrow">About</p>
          <h1 class="section-head__title">A small studio in Copenhagen</h1>
        </header>

${longform(`          <p class="prose__lede">
            Every set on this site was made by hand, one nail at a time, at a desk in
            Copenhagen. There is no factory behind this and no third party finishing the
            work. That is the whole reason the runs are small.
          </p>

          <p>
            The studio started because salon appointments are three hours long and the
            result lasts three weeks. Press-ons undo that arithmetic: the three hours
            happen once, here, and afterwards the same set goes on in ten minutes and
            comes off without damage when you have had enough of it.
          </p>

          <h2>How a set is actually made</h2>
          <p>
            A set begins as ten bare tips in the sizes that box will hold. The base goes
            on in thin coats and is cured between each one. Anything sculpted — a bow, a
            flower, a heart — is built in passes rather than in one lump, because gel
            that goes on thick slumps before it sets and loses its edges.
          </p>
          <p>
            Detail work is painted with a liner brush under a lamp. The top coat goes on
            last and is the only step that cannot be corrected: a dust speck under it
            stays there for the life of the set, which is why a nail is more often
            started again than fixed.
          </p>
          <p>
            A simple set is about four hours. Amour, where every nail is a different
            picture, is closer to fourteen.
          </p>

          <h2>Why the runs are small</h2>
          <p>
            Because one person is making them. A run is however many sets can be
            finished properly between one opening and the next, and when they are gone
            they are gone until the next run. We would rather sell out than send out
            something rushed.
          </p>

          <h2>What this means for you</h2>
          <p>
            Two things. Sets sell quickly, so the waitlist is worth being on — it is one
            email, sent when a run is ready. And no two sets are truly identical: the
            marble in Matcha Latte drags differently every time, and the orchid in
            Orchid Veil is painted freehand twice. If you need ten nails that match each
            other exactly, this is not the right studio.
          </p>

          <h2>Materials</h2>
          <p>
            Soak-off gel, cured under UV. No MMA. The tips are recyclable ABS. Nothing
            is tested on animals, and nothing in a box needs a salon to remove it.
          </p>`)}

        <aside class="prose__cta">
          <p>Questions the FAQ does not answer, or a custom set in mind?</p>
          <a class="btn btn--solid" href="/contact">Write to the studio</a>
        </aside>
      </section>

${waitlistBlock({
  heading: "Sets are made in small runs, and small runs go quickly.",
  note: "Leave an address and we’ll write once — when the next run is ready to order. Nothing else, ever.",
})}`,
);

/* Fit & care --------------------------------------------------------------- */
OWNED["guide.html"] = page(
  {
    title: `Fit &amp; care — how to apply, wear and remove | ${BRAND}`,
    description:
      "How to size a set, apply it so it lasts, look after it while you wear it, and take it off without damaging your own nails.",
    path: "/guide",
    current: "/guide",
    jsonld: [
      {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "How to apply a press-on nail set",
        totalTime: "PT10M",
        step: craft.steps.map((s, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: s.title,
          text: s.body,
        })),
      },
      crumbs([
        { name: "Home", href: "/" },
        { name: "Fit & care", href: "/guide" },
      ]),
    ],
  },
  `      <section class="prose">
        <header class="section-head">
          <p class="eyebrow">Fit &amp; care</p>
          <h1 class="section-head__title">Ten minutes on, three weeks worn</h1>
          <p class="section-head__blurb">
            Most sets that fail early fail for one of two reasons: the nail was the wrong
            size, or the natural nail was not dry when the glue went on. Both take a
            minute to get right.
          </p>
        </header>

${longform(`          <h2>Sizing</h2>
          <p>
            Twelve sizes come in every box, which covers most hands without a sizing kit.
            Lay all ten out and match each one dry before any glue is opened.
          </p>
          <p>
            A nail fits when it meets both sidewalls without pressing into them and stops
            just short of the cuticle. If a nail sits between two sizes, take the larger
            and file the sides down — a nail that is too narrow lifts at the corners
            within a day.
          </p>

          <h2>Preparing your own nails</h2>
          <p>
            Cut short, file flat, and push the cuticle back. Buff the surface just enough
            to take the shine off, then wipe every nail with alcohol and let it dry
            completely. Skip that wipe and the set will lift in two days regardless of
            how good the glue is.
          </p>

          <h2>Applying</h2>
          <p>
            A bead of glue on your own nail and a thin line inside the press-on. Set the
            press-on at the cuticle first, then roll it down flat towards the tip so no
            air is trapped underneath. Hold ten seconds. Do one nail at a time and start
            with your non-dominant hand.
          </p>
          <p>
            Adhesive tabs instead of glue if you only want the set for an evening — they
            hold for two or three days and come off in warm water.
          </p>

          <h2>Wearing</h2>
          <p>
            Showering and washing up are fine. Long soaks in hot water are what loosens
            glue, so gloves for washing up will add days to a set. Treat them as nails,
            not tools: opening a can with them is what snaps a tip.
          </p>
          <p>
            If one nail lifts at the edge, re-glue it that day. A lifted nail that stays
            lifted traps water underneath it.
          </p>

          <h2>Removing</h2>
          <p>
            Soak your fingertips in warm, soapy water with a few drops of oil for ten
            minutes, then work a cuticle stick gently under the free edge and lift. If it
            resists, soak it longer. Nothing here should hurt.
          </p>
          <p class="prose__warn">
            Never pull a press-on that is still stuck. That is what takes a layer of your
            own nail with it, and it is the only way these cause damage.
          </p>

          <h2>Keeping the set</h2>
          <p>
            Scrape the old glue off the underside with the cuticle stick, wipe with
            alcohol and put the set back in its box. Stored that way a set will go back
            on four or five times.
          </p>`)}

        <aside class="prose__cta">
          <p>Still not sure which size or shape to take?</p>
          <a class="btn btn--solid" href="/contact">Ask the studio</a>
        </aside>
      </section>

${waitlistBlock({
  heading: "Sets are made in small runs, and small runs go quickly.",
  note: "Leave an address and we’ll write once — when the next run is ready to order. Nothing else, ever.",
})}`,
);

/* FAQ ---------------------------------------------------------------------- */
OWNED["faq.html"] = page(
  {
    title: `Frequently asked questions — ${BRAND}`,
    description:
      "How long a set lasts, whether it will fit, whether press-ons damage your nails, reuse, shipping and custom work.",
    path: "/faq",
    current: "/faq",
    jsonld: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.items.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      },
      crumbs([
        { name: "Home", href: "/" },
        { name: "FAQ", href: "/faq" },
      ]),
    ],
  },
  `      <section class="prose">
        <header class="section-head">
          <p class="eyebrow">FAQ</p>
          <h1 class="section-head__title">Questions we get asked</h1>
        </header>

        <ul class="faq" data-symbol="faq" data-list="symbol:items">
          <template data-item><li class="faq__item"><h2 class="faq__q" data-text="item.question"></h2><p class="faq__a" data-text="item.answer"></p></li></template>
${faq.items
  .map(
    (f) =>
      `          <li class="faq__item"><h2 class="faq__q" data-text="item.question">${esc(f.question)}</h2><p class="faq__a" data-text="item.answer">${esc(f.answer)}</p></li>`,
  )
  .join("\n")}
        </ul>

        <aside class="prose__cta">
          <p>Something we have not covered?</p>
          <a class="btn btn--solid" href="/contact">Write to the studio</a>
        </aside>
      </section>

${waitlistBlock({
  heading: "Sets are made in small runs, and small runs go quickly.",
  note: "Leave an address and we’ll write once — when the next run is ready to order. Nothing else, ever.",
})}`,
);

/* /waitlist ---------------------------------------------------------------- *
   The banner, the header and eleven in-page buttons all point at the waitlist;
   until now none of them could be linked to from outside the site, because it
   only ever existed as an anchor inside other pages. */
OWNED["waitlist.html"] = page(
  {
    title: `Join the waitlist — ${BRAND}`,
    description:
      "One email, sent the day the next run of handmade press-on sets is ready to order. Nothing else.",
    path: "/waitlist",
    current: "",
    jsonld: [
      crumbs([
        { name: "Home", href: "/" },
        { name: "Waitlist", href: "/waitlist" },
      ]),
    ],
  },
  waitlistBlock({
    heading: "Sets are made in small runs, and small runs go quickly.",
    note: "Leave an address and we’ll write once — when the next run is ready to order. Nothing else, ever.",
    level: 1,
  }),
);

/* Legal -------------------------------------------------------------------- */
const legal = (slug, title, description, body) => {
  OWNED[`${slug}.html`] = page(
    {
      title: `${title} — ${BRAND}`,
      description,
      path: `/${slug}`,
      current: "",
      jsonld: [
        crumbs([
          { name: "Home", href: "/" },
          { name: title, href: `/${slug}` },
        ]),
      ],
    },
    `      <section class="prose prose--legal">
        <header class="section-head">
          <p class="eyebrow">Legal</p>
          <h1 class="section-head__title">${title}</h1>
          <p class="section-head__blurb">Last updated ${YEAR}-08-17.</p>
        </header>
${longform(body)}
      </section>

${waitlistBlock({
  heading: "Sets are made in small runs, and small runs go quickly.",
  note: "Leave an address and we’ll write once — when the next run is ready to order. Nothing else, ever.",
})}`,
  );
};

/* Shipping & returns ------------------------------------------------------ *
   Its own page rather than a clause buried in /terms. It is the page a shopper
   looks for before they trust a studio they have not heard of, and burying it
   in legal prose is how a site tells them not to bother. */
OWNED["shipping.html"] = page(
  {
    title: `Shipping &amp; returns — ${BRAND}`,
    description:
      "Where we ship, what it costs, how long a set takes to reach you, and how returns and faults are handled.",
    path: "/shipping",
    current: "",
    jsonld: [
      crumbs([
        { name: "Home", href: "/" },
        { name: "Shipping & returns", href: "/shipping" },
      ]),
    ],
  },
  `      <section class="prose">
        <header class="section-head">
          <p class="eyebrow">Shipping &amp; returns</p>
          <h1 class="section-head__title">Getting a set to you, and back</h1>
          <p class="section-head__blurb">
            Everything is made and packed by hand in Copenhagen. Nothing is drop-shipped,
            so the honest answer to “when will it arrive” depends on which run it is in.
          </p>
        </header>

${longform(`          <p class="prose__lede">
            The shop is not open for orders yet. This page is what will apply the
            moment it is, and it is here now so nobody has to guess.
          </p>

          <h2>Where we ship</h2>
          <p>
            Denmark first, then the rest of the EU. Outside the EU is not offered yet —
            customs on a small parcel of handmade goods costs more than the goods, and
            we would rather not put you through it.
          </p>

          <h2>What it costs</h2>
          <p>
            Denmark: a flat 39 kr, and free over 500 kr. Rest of the EU: a flat 79 kr,
            and free over 800 kr. The exact amount is shown before you pay, never after.
          </p>

          <h2>How long it takes</h2>
          <p>
            Sets are made in runs, not held on a shelf. A set that is already finished
            and boxed leaves within two working days. A set still being made leaves when
            its run does, and the expected date is stated on the set before you order.
          </p>
          <p>
            Once it is posted: one to two working days inside Denmark, three to six
            across the EU. You get a tracking number by email when it leaves, not a
            week later.
          </p>

          <h2>How it arrives</h2>
          <p>
            In a rigid box, each nail in its own recess, with glue, adhesive tabs, a
            mini file and a cuticle stick. The box is the storage: a set you soak off
            properly goes back in it and back on four or five times.
          </p>

          <h2>Changing or cancelling an order</h2>
          <p>
            Before a set is made, write to us and it is changed or cancelled with no
            fuss. Once a custom set is under way it cannot be cancelled, because it
            cannot be sold to anyone else.
          </p>

          <h2>Returns</h2>
          <p>
            Fourteen days from the day it reaches you, no reason needed. Tell us by
            email inside those fourteen days and send the set back unused and in its
            box. We refund the price and standard delivery within fourteen days of it
            arriving. Return postage is yours.
          </p>
          <p class="prose__warn">
            Two things cannot come back: a set that has been worn, on hygiene grounds,
            and a custom set made to your own design and measurements. Both are the law
            rather than our preference, and the custom one is said again before any
            custom order is confirmed.
          </p>

          <h2>If something is wrong with it</h2>
          <p>
            You have a two-year right of complaint under Danish law. A set that arrives
            damaged, or turns out to be faulty, is replaced or refunded and you do not
            pay return postage. Photograph the box before you take anything out of it
            and write to us the same week.
          </p>

          <h2>If a nail breaks later</h2>
          <p>
            Every box holds two spares for exactly this. If you get through both, write
            to us — single replacement nails are made and posted at cost for the life
            of the set.
          </p>`)}

        <aside class="prose__cta">
          <p>Something here not covered?</p>
          <a class="btn btn--solid" href="/contact">Write to the studio</a>
        </aside>
      </section>

${waitlistBlock({
  heading: "Sets are made in small runs, and small runs go quickly.",
  note: "Leave an address and we’ll write once — when the next run is ready to order. Nothing else, ever.",
})}`,
);

legal(
  "privacy",
  "Privacy",
  "What data this site collects, why, how long it is kept and how to have it deleted.",
  `          <p class="prose__lede">
            Short version: the only personal data this site collects is what you type
            into a form, and the only thing we do with it is answer you.
          </p>

          <h2>What is collected</h2>
          <p>
            <strong>The waitlist form</strong> takes your email address, and optionally a
            name and which set you are waiting for. <strong>The contact form</strong>
            takes your email address, a subject and a message. <strong>An account</strong>,
            if you make one, stores your email address and any details you add to it.
          </p>
          <p>
            No analytics, no advertising pixels and no third-party trackers run on this
            site. Nothing is sold or shared with anyone for marketing.
          </p>

          <h2>Why</h2>
          <p>
            The waitlist address is used for exactly one email, sent when a run of sets
            is ready to order. Contact messages are used to reply to you. Account details
            are used to send you what you order. That is the complete list.
          </p>

          <h2>Cookies</h2>
          <p>
            One cookie, and only if you sign in: the session cookie that keeps you signed
            in. There is no cookie banner because there is nothing to consent to.
          </p>

          <h2>How long it is kept</h2>
          <p>
            Waitlist addresses are deleted once the run they were for has opened and the
            email has gone out. Contact messages are kept while a conversation is open
            and deleted within twelve months. Account data is kept until you close the
            account.
          </p>

          <h2>Where it is stored</h2>
          <p>
            Form submissions and accounts are held on servers inside the EU. The site
            itself is static and stores nothing about you.
          </p>

          <h2>Your rights</h2>
          <p>
            Under the GDPR you can ask for a copy of what is held about you, ask for it to
            be corrected, or ask for it to be deleted. Write to
            <a href="mailto:${esc(site.contact.email)}">${esc(site.contact.email)}</a> and
            it will be done within thirty days. You can also complain to Datatilsynet,
            the Danish data protection authority.
          </p>

          <h2>Changes</h2>
          <p>
            If this page changes in a way that affects you, the date at the top changes
            with it.
          </p>`,
);

legal(
  "terms",
  "Terms",
  "The terms these sets are sold under: pricing, delivery, returns, the right of withdrawal and liability.",
  `          <p class="prose__lede">
            These terms cover orders placed on this site. They do not affect the statutory
            rights you have as a consumer in the EU, which sit above anything written here.
          </p>

          <h2>Who you are buying from</h2>
          <p>
            ${BRAND}, a sole trader based in Copenhagen, Denmark. Reach us at
            <a href="mailto:${esc(site.contact.email)}">${esc(site.contact.email)}</a>.
          </p>

          <h2>Orders</h2>
          <p>
            The shop is not open yet. When it is, an order is accepted once you receive a
            confirmation email. If a set sells out between your order and that
            confirmation, the order is cancelled and refunded in full.
          </p>

          <h2>Prices</h2>
          <p>
            Prices are in Danish kroner and include VAT. Delivery is charged separately
            and shown before you pay.
          </p>

          <h2>Delivery</h2>
          <p>
            Sets are made to order in small runs and dispatched from Copenhagen. Expected
            dispatch is stated on the set before you order. Delays are told to you by
            email, not left to be discovered.
          </p>

          <h2>Right of withdrawal</h2>
          <p>
            You have fourteen days from receiving an order to withdraw from it, without
            giving a reason. Tell us by email within those fourteen days and return the
            set unused and in its box; the money, including standard delivery, is refunded
            within fourteen days of the return arriving. Return postage is yours to pay.
          </p>
          <p>
            Two exceptions, both of them the law rather than our preference. A set that has
            been worn cannot be returned on hygiene grounds. A custom set made to your
            design and measurements is exempt from the right of withdrawal, and this is
            said again before any custom order is confirmed.
          </p>

          <h2>Faults</h2>
          <p>
            You have a two-year right of complaint under Danish law. A set that arrives
            damaged or turns out to be faulty is replaced or refunded, and you do not pay
            return postage. Photograph the box before removing anything and write to us in
            the same week.
          </p>

          <h2>What these are and are not</h2>
          <p>
            These are reusable press-on nails, applied with glue or adhesive tabs. Wear
            depends on how they are applied and how they are treated, so the two to three
            weeks quoted is a typical result and not a guarantee. Applied or removed
            against the instructions in the <a href="/guide">fit guide</a> they can damage
            your natural nail, and that is not covered.
          </p>
          <p>
            The materials are cured soak-off gel on ABS tips. If you have a known acrylate
            allergy, do not use them.
          </p>

          <h2>Liability</h2>
          <p>
            Nothing here limits our liability for death, personal injury or anything else
            that cannot be limited by law.
          </p>

          <h2>Law</h2>
          <p>
            Danish law applies. Disputes can be taken to Nævnenes Hus or through the EU
            Online Dispute Resolution platform.
          </p>`,
);

/* 404 ---------------------------------------------------------------------- */
OWNED["404.html"] = page(
  {
    title: `Page not found — ${BRAND}`,
    description: "That page does not exist.",
    path: "/404",
    current: "",
  },
  `      <section class="prose prose--center">
        <header class="section-head">
          <p class="eyebrow">Error 404</p>
          <h1 class="section-head__title">This page isn’t here</h1>
          <p class="section-head__blurb">
            The address may be mistyped, or the page may have moved. Everything below
            still works.
          </p>
        </header>
        <div class="notfound__links">
          <a class="btn btn--solid" href="/shop">Shop the seven</a>
          <a class="btn btn--ghost" href="/">Back to the front</a>
        </div>
        <ul class="notfound__list">
          <li><a href="/about">About the studio</a></li>
          <li><a href="/guide">Fit &amp; care</a></li>
          <li><a href="/faq">FAQ</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </section>
`,
);

/* --- chrome, stamped into the hand-owned pages too -------------------------
   index.html, contact.html, login.html, signup.html and account.html have
   hand-written bodies this file must not touch. Their footer is not part of
   that body — it is site chrome, and a footer that gains a column on twelve
   pages and not on five is precisely the drift that reads as unfinished.

   So the footer between <footer data-symbol="site-footer"> and </footer> is
   replaced with the canonical one, and nothing else in the file is. Same for
   the menu inside the masthead, which is the other thing that must match
   everywhere. The masthead itself is left alone: the landing page's floats
   over the hero and carries a note the others do not. */
const HAND_OWNED = [
  "index.html",
  "contact.html",
  "login.html",
  "signup.html",
  "account.html",
];

function syncChrome() {
  const canonical = footer();
  const body = canonical.slice(
    canonical.indexOf('<footer data-symbol="site-footer"'),
    canonical.indexOf("</footer>") + "</footer>".length,
  );
  const menu = MENU.map((m) => `<a href="${m.href}">${m.label}</a>`).join("");
  const bar = banner().trim();
  const headerOf = (float) => {
    const m = masthead("", float);
    return m.slice(m.indexOf("<header"), m.indexOf("</header>") + "</header>".length);
  };

  let touched = 0;
  for (const file of HAND_OWNED) {
    const path = join(ROOT, file);
    let html = readFileSync(path, "utf8");
    const before = html;

    // The landing page's footer clears the floating dock; the others have none.
    const dockGap = / class="colophon dock-gap"/.test(html) ? " dock-gap" : "";
    html = html.replace(
      /<footer data-symbol="site-footer"[\s\S]*?<\/footer>/,
      body.replace('class="colophon"', `class="colophon${dockGap}"`),
    );

    // The whole masthead, not just its menu: the landing page carried a
    // tagline where every other page carried a filled button, so the header
    // changed shape and height the moment anybody left the front door.
    const floats = /class="masthead masthead--float"/.test(html);
    html = html.replace(
      /<header data-symbol="site-header"[\s\S]*?<\/header>/,
      headerOf(floats),
    );

    // Four of these shipped the announcement aside without `hidden`, so with
    // JS off they drew an empty dark strip above the masthead.
    html = html.replace(/ *<aside aria-label="Announcement"[\s\S]*?<\/aside>/, "    " + bar);

    // Every asset is versioned together off ASSET_V. The pattern has to match
    // any number of digits: it used to be /\?v=1[0-9]"/, which would have
    // silently stopped matching at 20 and pinned these five pages to the old
    // build for ever, while the generated pages moved on.
    html = html.replace(/\?v=\d+"/g, `?v=${ASSET_V}"`);

    if (html !== before) {
      writeFileSync(path, html);
      touched += 1;
      console.log("  synced chrome in", file);
    }
  }
  return touched;
}

/* --- write ---------------------------------------------------------------- */

let written = 0;
for (const [rel, html] of Object.entries(OWNED)) {
  const out = join(ROOT, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  written += 1;
  console.log("  wrote", rel);
}

/* sitemap.xml — every page this site actually serves, so adding a set updates
   it without anyone remembering to. Sign-in-only pages are left out. */
const urls = [
  { loc: "/", priority: "1.0" },
  { loc: "/shop", priority: "0.9" },
  ...catalog.items.map((i) => ({ loc: `/sets/${i.slug}`, priority: "0.8" })),
  { loc: "/about", priority: "0.6" },
  { loc: "/guide", priority: "0.6" },
  { loc: "/faq", priority: "0.6" },
  { loc: "/waitlist", priority: "0.7" },
  { loc: "/shipping", priority: "0.5" },
  { loc: "/contact", priority: "0.5" },
  { loc: "/privacy", priority: "0.2" },
  { loc: "/terms", priority: "0.2" },
];

writeFileSync(
  join(ROOT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${ORIGIN}${u.loc}</loc><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>
`,
);
console.log("  wrote sitemap.xml");

const synced = syncChrome();
console.log(`\n${written + 1} files written, ${synced} hand-owned pages synced.`);
