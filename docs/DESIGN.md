# Emojisense design

The design of the website (`apps/web`) and the dashboard (`apps/dashboard`). It replaces the
earlier "emoji keyboard + stickers" look (yellow bands, keycap depth, DynaPuff).

## Principle: emoji are the only color

The UI is calm and near-monochrome: ink on white (or light ink on near-black in dark mode).
Emoji give all the color. Status colors (`--live`, `--good`, `--bad`, `--focus`) show state
only, never decoration. Logos are single-color (`currentColor`).

## Tokens

Source: `apps/web/src/styles/global.css`. The dashboard copies them in
`apps/dashboard/src/app/styles/tokens.css` (differences: `--ink-3` and `--good`, see below).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#0b0b0f` | page |
| `--bg-soft` | `#f6f6f8` | `#141419` | alternate sections (`.section-soft`), inline code |
| `--bg-sunk` | `#eeeef2` | `#1b1b22` | wells inside cards and demos |
| `--ink` | `#0d0d12` | `#f3f3f6` | text, headings |
| `--ink-2` | `#4b4b57` | `#b4b4c0` | body copy, leads |
| `--ink-3` | `#6b6b75` | `#8a8a96` | kickers, hints (dashboard: `#85858f` / `#7c7c88`) |
| `--line` | `#e7e7ec` | `#24242c` | hairlines, card borders |
| `--line-strong` | `#d3d3db` | `#34343e` | secondary button border |
| `--accent` / `--on-accent` | `#0d0d12` / `#ffffff` | `#f3f3f6` / `#0b0b0f` | primary button |
| `--live` | `#12b76a` | same | "live" dot |
| `--focus` | `#3d7bff` | same | focus ring (`0.1875rem` outline, `0.1875rem` offset) |
| `--good` | `#066e4e` | `#34d399` | success (dashboard light: `#0f9f74`) |
| `--bad` | `#c2410c` | `#fb923c` | errors |

| Shape and depth | Value |
|---|---|
| Radius | `--radius-sm` 0.625rem · `--radius` 0.875rem · `--radius-lg` 1.25rem · `--radius-xl` 1.75rem · `--pill` 999px |
| Shadow | `--shadow-sm`, `--shadow`, `--shadow-lg`: soft, low-opacity ink; stronger in dark mode |
| Easing | `--spring` `cubic-bezier(0.34, 1.56, 0.64, 1)` · `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)` |
| Layout | `--container` 72rem · `--gutter` `clamp(1rem, 4vw, 2rem)` |

Older names (`--brand`, `--sun`, `--cloud`, `--mint`, `--peach`, `--muted`, `--outline`, …) are
aliases kept for the docs and content pages. Do not use them in new code.

Dark mode follows `prefers-color-scheme`. There is no theme switch.

## Fonts

Self-hosted with Fontsource (no third-party requests).

| Role | Font | Token |
|---|---|---|
| Headings (h1–h3) | Bricolage Grotesque Variable (optical size axis) | `--font-display` |
| Body, buttons, UI | Hanken Grotesk Variable | `--font-body` |
| Kickers, code, hexcodes, numbers | DM Mono 400 / 500 | `--font-mono` |
| Emoji | Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji | `--font-emoji` (`.emoji`) |

Raster assets (favicons, share cards) draw emoji with Noto Color Emoji, never Apple's art
(`apps/web/scripts/brand-assets.mjs`).

## Type scale

| Element | Size | Weight / tracking / leading |
|---|---|---|
| Hero h1 | `clamp(2.75rem, 1.4rem + 5.6vw, 5.5rem)`, max 15ch | 700 · −0.045em · 0.98 |
| Section h2 | `clamp(2.125rem, 1.3rem + 2.8vw, 3.5rem)` | 700 · −0.035em · 1.04 |
| h3 | per component | 650 · −0.02em |
| Hero lead | `clamp(1.0625rem, 1rem + 0.45vw, 1.3125rem)` | 400 · 1.55 |
| Section lead | `clamp(1.0625rem, 1rem + 0.3vw, 1.25rem)` | 400 · 1.55 |
| Body | 1.0625rem | 400 · 1.6 |
| Button | 0.9375rem (large: 1rem) | 600 |
| Kicker | 0.8125rem, DM Mono | 500 · 0.02em |
| Code blocks | 0.875rem, DM Mono | 400 · 1.65 |
| Docs | `--step--1` 0.875rem · `--step-0` 1rem · `--step-1` 1.1875rem · `--step-2` `clamp(2rem, 1.4rem + 2.4vw, 2.75rem)`; prose h2 1.75rem, h3 1.25rem | |
| Dashboard | `--text-2xs` 0.6875rem · `xs` 0.75 · `sm` 0.8125 · `base` 0.875 · `md` 0.9375 · `lg` 1.0625rem | |

Headings use `text-wrap: balance`; paragraphs use `text-wrap: pretty`.

## Landing page

Sections in page order (`apps/web/src/pages/index.astro`). Sections have a block padding of
`clamp(4rem, 8vw, 6.5rem)`. A section is white or `.section-soft`; two white sections in a row
get a hairline between them.

| # | Section | Content | Interactivity |
|---|---|---|---|
| 1 | Hero | Kicker with live dot, h1, lead, live search, two buttons (primary "Get a free API key", secondary "Read the docs"), `npm install emojisense` line, "Works with" logo strip. Centered, soft radial `--bg-soft` glow at the top. | `HeroSearch` island (`client:load`): the real engine in the browser. It types example queries until the visitor focuses the field; a button pauses it. |
| 2 | Use cases | Five live demos in tabs: Chat, Docs, Workspaces, Photos, AI assistant | `UseCases` island (`client:visible`) |
| 3 | Why it matters | "Pickers match names. People type feelings.": the same queries, name search vs Emojisense | static, computed at build time with the real packs (`lib/showcase.ts`) |
| 4 | Features | Bento grid: 6 columns, cells span 2, 3 or 6. 2 columns at ≤ 60rem, 1 column at ≤ 40rem. | static |
| 5 | Culture | One search read by region or by date, a calendar of moments, and three steps (AI proposes, an editor decides, search adds it). Reads the approved entries in `packages/data/culture/entries`; the section has `data-culture-source="data"` (or `"empty"`). | `CultureLens` island (`client:visible`) |
| 6 | Edge network | Dark band in both modes: dot world map with city bubbles (a search and its emoji) and four facts | CSS animation |
| 7 | Gets better with use | How a search gets answered, layer by layer, and the daily learning loop | a switch shows the over-limit state |
| 8 | Integrations | Cards in four groups: frameworks, editors and pickers, native and apps, AI and servers | hover lift |
| 9 | Developers | Code samples: React, any framework, JavaScript, HTTP API | `CodeTabs` island |
| 10 | Pricing | Plans from `PLANS` in `@emojisense/platform` | monthly / yearly switch |
| 11 | FAQ, final call to action | `<details>` list, closing buttons | none |

## Motion

| Rule | Detail |
|---|---|
| Short and purposeful | UI transitions take 120–260 ms with `--ease-out`. One-shot entrances ("pop", "rise", a switched price) take 200–520 ms with `--spring` or `--ease-out`. |
| Loops only where they explain | Edge bubbles, the photo scan line, typing carets, pings and loading indicators. No decorative loops. |
| Autoplay stops at the first touch | Hero search and the demos play an example until the visitor takes over. |
| Reduced motion | `prefers-reduced-motion: reduce` sets every animation and transition to 0.01 ms, one iteration, no smooth scroll (`global.css`, dashboard `base.css`). |
| Reduced motion: end state at once | Islands check `matchMedia`: hero search shows the first example, the chat, docs, photo and assistant demos show their final state without typing, the culture lens does not smooth-scroll. Loops get a still state: the edge map shows five fixed bubbles. |

## Dashboard app shell

`apps/dashboard/src/app/shell/`. Same tokens and fonts, calmer: tables and forms stay plain.

| Part | Detail |
|---|---|
| Grid | Sticky sidebar (`--sidebar-width` 15.5rem) + main column; content max `--content-width` 72rem |
| Sidebar | Wordmark, app switcher, the current app's sections (Overview, Keys, Custom emoji, Analytics, Emoji sets, Tenants, Webhooks), Account (Team, Billing, Settings). A section that the app's plan does not include shows the name of the plan that has it. At the bottom: a one-line nudge to the next plan (not on Scale) and the account menu. |
| Top bar | `--topbar-height` 3.25rem with breadcrumbs (Apps › app › section) |
| Narrow screens (≤ 60rem) | The sidebar is an off-canvas drawer behind a scrim. Escape closes it and puts focus back on the menu button. The scrim, the close button and a navigation also close it. |
| Empty states | An emoji, a title, one sentence and the action that fills the page (`EmptyState`) |
| Mock mode | A dev-only mode with fixture data, for screenshots and UI work without the API |

## Embedded UI

| Surface | Look today |
|---|---|
| Chrome extension (picker, toast, options page) | calm, near-monochrome; tokens and fonts bundled |
| `<emojisense-picker>`, Tiptap and Lexical menus | still the earlier keycap look (yellow selection, ink outlines; the web component also sets Figtree). Themable through `--emojisense-*` properties. The old spec: `git show bd6ea87:docs/DESIGN.md`. |
| shadcn registry picker (`packages/react/registry`) | keycap-like tiles from the host app's shadcn theme tokens; no Emojisense colors |

## Rules

- Emoji carry the color. Do not add brand colors, colored gradients, glassmorphism or emoji used
  as filler in headings. Neutral glows, fade masks and loading shimmers are fine.
- Use `rem` for sizes. Use `px` only where `rem` cannot work (the 1px visually-hidden box, the
  999px pill radius).
- Every motion has a reduced-motion state.
- Text contrast is at least 4.5:1 in both modes.
- No real company logos except the "Works with" tools, and those in one ink color.
- Open: the mark. The nav and the dashboard use 🦖; the favicon and app icons use a monochrome
  winking face (`apps/web/public/favicon.svg`). See TASKS.md.
