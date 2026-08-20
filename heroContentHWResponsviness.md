# Skill: heroContentHWResponsviness

Hero centerpiece height/width responsiveness. Use this skill whenever a hero's
featured media (the hand image here, but any centerpiece image or video) is
reported as being cut by the fold, "overflowing to the page beneath it", or
needing to "fit on all screens".

## The invariant

The hero's featured media must be **fully visible inside the first viewport at
every screen size**, and must **never paint over the section below the hero**.

## How to apply it

### 1. Find out which layout mode the media is in — the fix differs

- **In flow** (typical phone/tablet layout): the media pushes content down, so
  it can never overlap the next section — but it *can* cross the fold. The fix
  is viewport-budget sizing (step 2).
- **Absolutely positioned** (typical desktop layout, e.g. hung from one side):
  it *can* bleed into the section below. Make sure the hero panel clips it
  (`overflow: hidden` or `clip` on the panel), or anchor the element's bottom
  with `inset-block-end` instead of giving it a fixed height.

### 2. Viewport-budget sizing for the in-flow case

Never size the media with a bare viewport unit (`48svh`, `60vh`, …) — that
ignores everything stacked above it. Budget instead:

```css
/* width = (first screen − chrome above the media) through the aspect ratio */
.hero__stage {
  width: min(
    100%,
    max(9rem, calc((100svh - <chrome-rem>) * (<imgW> / <imgH>)))
  );
  aspect-ratio: <imgW> / <imgH>;
}
```

- `<chrome-rem>` = measured height of everything above the media on the first
  screen (announcement banner + ribbon + masthead + eyebrow + title + margins).
  In this repo that is ~30rem on a phone. Re-measure if the chrome changes.
- Use `svh`, not `vh` — mobile browser UI eats into `vh` and reintroduces the
  overflow this skill exists to prevent.
- Keep a small floor (`max(9rem, …)`) so very short landscape screens get a
  legible image instead of a thumbnail; the floor is the one deliberate
  exception to the fold rule.
- Let `aspect-ratio` derive the height — never set width and height to two
  unrelated viewport values.

### 3. Repo mechanics

- The rule lives on `.hero__stage` in `assets/css/styles.css` (search for
  "Sized against what the first screen actually has left").
- Every HTML page pins asset versions (`styles.css?v=N`). After any CSS edit,
  bump `v=N` to `v=N+1` across all pages or browsers keep serving the old
  file:
  `find . -name "*.html" -not -path "./dynamic-admin/*" -not -path "./static-admin/*" -exec sed -i '' 's/v=N/v=N+1/g' {} +`

### 4. Verify — screenshot matrix, never a single size

Render the page headlessly at each viewport and confirm the media's bottom
edge sits above the fold and the next section is untouched:

```bash
for s in "375,667" "412,914" "768,1024" "1440,900"; do
  w=${s%,*}; h=${s#*,}
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless --disable-gpu --hide-scrollbars \
    --window-size=$w,$h --screenshot=fit-$w-$h.png "http://localhost:8000/"
done
```

Look at every screenshot. A claim about "all screens" is only proven by the
matrix, not by one lucky viewport.
