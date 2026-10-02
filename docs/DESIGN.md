# Emojisense design: "emoji keyboard + stickers"

Owner feedback (2026-10-02): emoji are fun, so the product must feel fun. This replaces the
earlier "Unicode code chart" look. The vernacular comes from where people use emoji: the phone
emoji keyboard, chat reactions and sticker sheets. Fun does not mean noisy. **The emoji are the
color and the decoration.** The UI around them is bold, simple and readable.

## Tokens

```css
:root {
  --sun: #FFD23F;        /* emoji yellow: brand, hero bands, active states */
  --ink: #1E1631;        /* text, outlines, keycap depth */
  --paper: #FFFFFF;      /* page */
  --cloud: #F4F6FF;      /* alternate section / input background */
  --tomato: #FF5B3A;     /* errors, "nothing found" accents */
  --mint: #12C79C;       /* success, "found it" */
  --sky: #3D7BFF;        /* links, focus ring partner */
  --bubblegum: #FF6FB5;  /* highlights, badges */
  --muted: #6B6380;      /* secondary text */

  --radius-key: 0.875rem;
  --radius-pill: 999px;
  --radius-card: 1.25rem;
  --outline: 0.125rem solid var(--ink);
  --depth: 0 0.25rem 0 var(--ink);           /* keycap depth (hard, no blur) */
  --depth-pressed: 0 0.0625rem 0 var(--ink);
  --spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  --font-display: "DynaPuff", system-ui, sans-serif;     /* headings only, with restraint */
  --font-body: "Figtree", system-ui, sans-serif;
  --font-mono: "DM Mono", ui-monospace, monospace;       /* hexcodes, counters, code */
  --font-emoji: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #17121F; --cloud: #221A2E; --ink: #F5F1FF; --muted: #A79FBA;
    --depth: 0 0.25rem 0 #0B0811; --depth-pressed: 0 0.0625rem 0 #0B0811;
  }
}
```

Google Fonts: `DynaPuff:wght@500;700`, `Figtree:wght@400;600;800`, `DM Mono:wght@400`.

## Components

| Component | Look | Behavior |
|---|---|---|
| **Keycap** (emoji result tile, buttons) | rounded square, `--outline`, white fill, `--depth` underneath | press: translateY(0.1875rem) + `--depth-pressed`. Active/selected: `--sun` fill. Hover: tiny wobble (rotate ±3°). |
| **Reaction pill** (examples, chips, filters, counts) | `--radius-pill`, outline, emoji + label (+ count), like chat reactions | selected: `--sky` 15% tint fill + sky outline |
| **Sticker** (the hero answer, empty states, illustrations) | the emoji very large, with a white die-cut outline (stacked `drop-shadow(0 0 0.15rem #fff)` + soft shadow), rotated −6° to 6° | lands with a pop (scale 0.4 → 1.08 → 1, spring); on hover it "peels" slightly |
| **Chat composer** (hero search input) | big rounded input like a message box, emoji button on the left, a send-like answer slot on the right | the answer slot shows the top result as a sticker |
| **Ticket** (session tally, replaces the thermal receipt) | punched-hole ticket card in `--sun` with mono numbers | numbers tick up with a short count animation |
| **Card** | `--radius-card`, outline, white, `--depth` | — |

## Motion

- Springy and short (150–350 ms, `--spring`). Results stagger in by 15 ms each, max 12.
- One celebration moment: when a confident answer lands, a burst of 6–10 copies of **that
  emoji** (not generic confetti) for ≤ 600 ms. Never on every keystroke: only when the top
  result changes after a pause.
- `prefers-reduced-motion: reduce` → no wobble, no burst, no stagger. Instant state changes.

## Voice

Playful but specific. Use emoji in copy where they carry meaning, not as filler.

- ✔ "Type "jurassic park". Get 🦖." · "Nothing here 🫥 — name search only matches names."
- ✘ "Supercharge your emoji experience 🚀✨🔥"

## Per surface

| Surface | Fun level | Notes |
|---|---|---|
| Landing + demo | high | yellow hero band, keycap grid, sticker answer, emoji burst |
| Docs, pricing | medium | same tokens; readable long text; code blocks in `--cloud` |
| Dashboard | calm | keycap buttons, pill badges, sticker empty states ("No apps yet 🐣"); tables and forms stay plain and clear |
| Chrome extension overlay, web component, editor menus | compact | keycap results in a rounded popover, pill for the query state; themable via CSS custom properties |

## Never

Real company names or logos, Apple emoji images, generic gradient blobs, purple-to-blue
gradients, glassmorphism, emoji spam in headings, motion without the reduced-motion fallback,
text on `--sun` below 4.5:1 contrast (`--ink` on `--sun` is fine).
