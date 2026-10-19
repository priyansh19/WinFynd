# Shared tokens and classes

Every page loads three stylesheets, in this order:

```html
<link rel="stylesheet" href="css/wf.css">     <!-- the app theme, for product shots only (everything under .wf) -->
<link rel="stylesheet" href="css/site.css">   <!-- site tokens, layout and components (this guide) -->
<link rel="stylesheet" href="css/<page>.css"> <!-- your page only -->
```

and, at the end of `<body>`, `js/site.js` then `js/<page>.js`, both with `defer`. Put `<script>document.documentElement.classList.add("js")</script>` in `<head>` so scroll reveals never flash.

Rules: add page styles in `css/<page>.css` only. Do not rename, remove or restyle anything in `site.css`; new shared classes can be added at the end of it. Site classes never reuse a class name from `wf.css`.

## Tokens (`:root` in site.css)

Every token has a light-mode value, set by `prefers-color-scheme`. Use the tokens, not raw colours.

| Token | Use |
|---|---|
| `--bg`, `--bg-2`, `--surface` | Page background, a slightly deeper band, solid menus and popovers |
| `--text`, `--text2`, `--text3` | Headlines, body copy, captions and fine print (all pass WCAG AA on `--bg`) |
| `--card`, `--card-hover`, `--fill`, `--fill-strong` | Card surface, card on hover, subtle control fills |
| `--stroke`, `--stroke-strong`, `--stroke-hover` | 1 px borders: resting, controls, hovered cards |
| `--accent`, `--accent-strong`, `--on-accent`, `--focus` | `--accent` is for text and small marks (links, labels, selection pills); `--accent-strong` for fills; `--focus` for focus rings; `--on-accent` for text on an accent fill. In light mode `--accent` is #1f55c4, a step deeper than the app's #2f6ce5 (still used by `--accent-strong` and `--focus`), so accent text keeps 4.5:1 on the glows |
| `--ok` | Success and "on this PC". Light mode #0b600b (the app uses #0f7b0f), so green text keeps 4.5:1 on its own 15% tint over a glow; wf.css uses the same value inside product shots. Do not override it per page |
| `--spectrum`, `--spectrum-diag` | Progress, completion, the app icon and the Download button only: it always means "something good" |
| `--glow-blue`, `--glow-violet`, `--glow-pink`, `--glow-orange` | Bloom glows (see `.bloom`) |
| `--font`, `--font-display`, `--mono` | Segoe UI Variable Text, Segoe UI Variable Display, Cascadia Code (system fonts only) |
| `--ease` | Fluent decelerate `cubic-bezier(0,0,0,1)`, for every enter and hover transition |
| `--ease-standard` | Fluent standard, for things that move between two resting places |
| `--radius-s` 4, `--radius` 8, `--radius-l` 12, `--radius-xl` 16 | Corners (WinUI proportions) |
| `--container` 1200, `--gutter` 16 to 40, `--section-y` 80 to 136, `--header-h` 64 | Layout |
| `--shadow-card`, `--shadow-lift`, `--shadow-shot` | Resting card, hovered card, product shot |

File kinds come from `wf.css` and work anywhere on the page: add `k-doc`, `k-img`, `k-audio`, `k-video`, `k-slide`, `k-sheet`, `k-code`, `k-other` (or `k-amber` for folders, `k-ask` from site.css for Ask) and use `var(--k)`. Light mode switches them to their deeper values automatically (spreadsheets are #0b6631 on the site, a step deeper than the app's #0f7a3c, for 4.5:1 on their tint).

```html
<span class="kc k-audio">Recordings</span>   <!-- .kc colours text with the kind's hue -->
```

## Page frame

**Header and footer.** Paste `partials/header.html` right after `<body>` and `partials/footer.html` right after `</main>`. Mark your page's link with `aria-current="page"` in both navs of the header. Give `<main>` the id `main` (the skip link targets it).

```html
<a href="privacy.html" aria-current="page">Privacy</a>
```

**Container and sections.** `.container` centres content at 1200 px with the gutter. `.section` gives the standard vertical rhythm; consecutive sections share their padding.

```html
<section class="section" aria-labelledby="faq-title"><div class="container">...</div></section>
```

**Section head.** Eyebrow, title and lead, left aligned; add `--center` to centre it.

```html
<div class="section-head section-head--center"><p class="eyebrow">Privacy</p><h2 class="title" id="faq-title">Your files stay on your PC.</h2><p class="lead">...</p></div>
```

## Type

| Class | Size | Example |
|---|---|---|
| `.display` | 42 to 80 px, page h1 | `<h1 class="display">Find anything on your PC by describing it.</h1>` |
| `.title` | 32 to 56 px, section h2 | `<h2 class="title">Four shortcuts, from any app.</h2>` |
| `.title-s` | 24 to 30 px | `<h2 class="title-s">Eight kinds of file, one search box.</h2>` |
| `.heading` | 20 px, card h3 | `<h3 class="heading">Shows the page that matched</h3>` |
| `.lead` | 17 to 20 px, intro paragraph | `<p class="lead">Type what you remember.</p>` |
| `.body` | 16 px, card copy | `<p class="body">Pick the folders, a search model and your shortcuts.</p>` |
| `.fine` | 13 px, notes | `<p class="fine">Searching what is shown in videos needs FFmpeg.</p>` |
| `.mono` | Cascadia Code | `<code class="mono">%APPDATA%\app.winfynd.desktop</code>` |
| `.ui` | The name of a button, switch or setting in running copy: `--text`, semibold | `switch off <span class="ui">Allow full OS context</span>` |

Use `.ui` for every control name in body copy (not a page-made class like `.pv-ui`). It is not for the CTA band, where text is dark ink.

**Eyebrow.** A small label above a title, in the colour of what the section is about. Put a kind class on it (default is the accent). In light mode site.css mixes the eyebrow colour 10% toward black, because eyebrows often sit on a hero glow; that keeps every kind at 4.5:1 or better there (worst measured 4.85 on a 390 px hero), so pages need no colour override for eyebrows.

```html
<p class="eyebrow k-audio"><svg ...></svg>Recordings</p>
```

## Buttons and links

`.button` is the base (44 px). Variants:

```html
<a class="button button--primary" href="download.html">Download for Windows</a>   <!-- spectrum: Download only -->
<a class="button button--secondary" href="how-it-works.html">See how it works</a> <!-- card surface -->
<a class="button button--ink button--large" href="download.html">Download</a>      <!-- dark, on the CTA band -->
<a class="button button--glass button--large" href="https://github.com/priyansh19/WinFynd">Source on GitHub</a> <!-- on the CTA band -->
<a class="button button--secondary button--small" href="help.html">Help</a>        <!-- 36 px; --large is 52 px -->
<a class="link-arrow" href="privacy.html">Read how WinFynd handles your data<svg ...></svg></a> <!-- arrow nudges on hover -->
```

## Cards and chips

**Tile.** The site's card: lifts 2 px and brightens its stroke on hover (150 ms). A kind class tints its top-left corner. `.tile--flat` turns the hover off for cards that are not links.

```html
<article class="tile k-doc"><h3 class="heading">Documents</h3><p class="body">PDF, Word, PowerPoint, Excel...</p></article>
```

**Kind chip.** A file kind's name in its own hue with a dot; `--plain` drops the dot.

```html
<span class="kind-chip k-img">Photos</span>
```

**Icon badge.** A 40 px rounded square tinted with a kind's hue.

```html
<span class="icon-badge k-sheet"><svg width="20" height="20" ...></svg></span>
```

**Keycaps.** Page-sized keys (the app's small ones are `.kbd` in wf.css).

```html
<span class="keys"><kbd class="keycap">Alt</kbd><span class="keys-plus" aria-hidden="true">+</span><kbd class="keycap keycap--wide">Space</kbd></span>
```

## Light, motion and product shots

**Bloom.** A soft spectrum-hue glow placed in a corner or behind a product shot, never animated, never a full-page wash. The parent needs `position: relative` (`.section` has it). Size with `--w` and `--h`. `.bloom` has `overflow-anchor: none`: a glow placed in percentages of a tall box moves when an answer opens above it, and as Chrome's scroll anchor it would make the page jump. Pages need not repeat it.

```html
<div class="bloom bloom--violet" style="--w: 900px; --h: 700px; right: -420px; top: 10%"></div>
```

**Scroll reveal.** Fade and 16 px rise, 400 ms, once. `[data-reveal-group]` staggers the `.reveal` items inside it by 70 ms. Content is hidden only when `.js` is on `<html>`, so it is all visible without JavaScript; reduced motion turns it into a plain fade. When the page opens at a `#hash`, or a same-page `#link` is followed, site.js shows the target, its `.reveal` ancestors, everything before it and the part of it on the first screen at once (no rise), so the link lands exactly; pages need no code for this.

**Anchor offset.** `html { scroll-padding-top: header + 16px }` is the one offset for every `#id` target, the skip link and `scrollIntoView`: targets land 16 px under the sticky header. Do not add `scroll-margin-top` to targets (it adds to the padding). Avoid `overflow: hidden` on a box that holds `#id` targets: it is still a scroll container and an anchor jump can scroll it; use `overflow: clip`.

```html
<div class="section-head" data-reveal-group><p class="eyebrow reveal">Ask</p><h2 class="title reveal">...</h2></div>
```

**Product-shot frame.** Product visuals are live HTML built from the artboard markup with wf.css, inside `.wf auto` (follows the visitor's light or dark mode). `.shot` is the figure, `.shot-desk` paints the Windows wallpaper behind a floating window, `.shot-window` gives a bare window the shot shadow. `[data-fit="760"]` says the visual is designed 760 px wide; `js/site.js` zooms it down to fit its parent (`.fit-frame` clips it without JS). `.launcher.static` (wf.css) puts a launcher in normal flow.

Two things to watch with shots. A `.shot` is positioned, so its large shadow draws over plain text next to it and dims it. site.css handles the common case: every sibling of a `.shot` (copy before, beside or after it in the same parent) gets `position: relative; z-index: 1`, at zero specificity so any page rule that positions an element still wins. Only copy that is not a sibling (for example the next section's heading, under a shot that ends a section) still needs its own `position: relative; z-index: 1`. And `[data-fit]` zooms the text too: a window whose 12 px text is zoomed below about 0.92 renders under the 11 px minimum. When the column is much narrower than the design width, let the window resize to its column instead of zooming it. `.shot figcaption` uses `--text2` (13 px), which keeps 4.5:1 on the glows behind shots.

```html
<figure class="shot" aria-label="An answer in WinFynd with three numbered sources">
  <div class="fit-frame"><div class="wf auto" data-fit="760"><div class="launcher static">...</div></div></div>
</figure>
```

**CTA band.** The one place the spectrum fills a large area. Dark ink text on it; use `.button--ink` and `.button--glass`.

```html
<div class="cta-band"><h2 class="title">Find the file you're thinking of.</h2><p>Free for Windows 10 and 11.</p><a class="button button--ink" href="download.html">Download for Windows</a></div>
```

**Utilities.** `.visually-hidden` hides text but keeps it for screen readers. Focus rings (`:focus-visible`) are global: 2 px in `--focus`.

## Shared JavaScript (`js/site.js`)

- Sets `.js` on `<html>`, runs the scroll reveal, the header's scrolled state and the mobile menu (a `<details>`, so it works without JavaScript too).
- `WinFynd.whenActive(el, function (active) { ... })`: run a demo only while `el` is on screen and the tab is visible. Every looping animation must use it.
- `WinFynd.reducedMotion()`: true when the visitor asked for reduced motion. Show a static state instead of a loop.
- `WinFynd.fit(el)`: apply `[data-fit]` zooming to an element added later.
- `WinFynd.revealNow(el)`: show `el`'s reveal content (and everything before it) at once, without the rise. site.js already calls it for `#hash` loads, same-page `#links` and `hashchange`; call it yourself before scrolling to something with `scrollIntoView`.
- `WinFynd.fmt(51204)` gives `"51,204"`.

**Release switch.** Flipped on 18 October 2026 when 0.1.0 was published: site.css now hides `.until-release`. Primary Download buttons link straight to the installer; update that URL for each new version. Before that: Until 0.1.0 is published, `css/site.css` hides `.after-release`, so its `.until-release` twin shows ("Coming soon" on the Download card, Home's hero note and the Changelog status). At release, change that one selector to `.until-release`.

```html
<span class="until-release">0.1.0 coming soon</span><span class="after-release">Version 0.1.0</span>
```
