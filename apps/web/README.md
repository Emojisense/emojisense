# @emojisense/web

The public website: landing page with a live search, pricing, docs and the Pro waitlist. It is a
static site, served as Cloudflare Workers static assets.

## Stack: Astro with React islands

| Need | Why Astro fits |
| ---- | -------------- |
| SEO and fast first paint | Every page is HTML at build time. Pages ship no JavaScript unless they hold an island. |
| The live search and the waitlist form | React islands (`client:load`) reuse `@emojisense/react` as it is. Only these two components hydrate. |
| Pricing from `PLANS`, docs from `docs/*.md` | Page code runs at build time, so it imports `@emojisense/platform` and the Markdown files directly. Nothing is copied by hand. |
| Workers static assets | `astro build` writes plain files to `dist/`. `wrangler.jsonc` serves them; no Worker code runs. |

A Vite multi-page setup would need custom plugins for layouts, Markdown and pre-rendered React.
Astro does this out of the box, with fewer moving parts to maintain.

## Run

```bash
pnpm --filter @emojisense/web dev        # http://localhost:4321
pnpm --filter @emojisense/web build      # static files in dist/
pnpm --filter @emojisense/web preview    # build, then serve dist/ with wrangler like production
pnpm --filter @emojisense/web test       # unit tests + build smoke test
```

The live search needs the API for its packs (`pnpm --filter @emojisense/worker dev:offline`). The
waitlist form needs the dashboard. Without them, both pages still render and show an inline error.

Without JavaScript, the waitlist form posts a normal HTML form to the dashboard. The dashboard
answers with a redirect to `/waitlist/?status=ok#waitlist-joined` (or `status=error`). The page
shows the matching `<noscript>` message through the CSS `:target` rule. When the script runs, the
island reads `?status=` and shows the same result. The site origin must be in the dashboard's
`WEBSITE_ORIGINS`.

## Configuration

Copy `.env.example` to `.env`. Every value is public and ends up in the built pages.

| Variable | Default | Used for |
| -------- | ------- | -------- |
| `PUBLIC_SITE_URL` | `https://emojisense.com` | canonical links, sitemap, structured data |
| `PUBLIC_API_URL` | `http://localhost:8788` | packs and semantic search for the live search |
| `PUBLIC_PACK_VERSION` | `0.1.0` | pack path `/v1/pack/<version>/` |
| `PUBLIC_PUBLISHABLE_KEY` | `pk_demo` | the site's own key; bind it to the site origin |
| `PUBLIC_DASHBOARD_URL` | `http://localhost:8790` | "Get a key" links and `POST /api/waitlist` |
| `PUBLIC_REPO_URL` | `https://github.com/emojisense/emojisense` | source links in the docs |

## Design

`docs/DESIGN.md` ("emoji keyboard + stickers"): an emoji-yellow hero band, keycap result tiles,
reaction-pill chips and the top answer as a die-cut sticker in a chat-composer search box. One
celebration: a burst of the answer's own emoji when it settles, never with reduced motion. Docs
and pricing use the same tokens with calmer layouts. Fonts (Bricolage Grotesque, Hanken Grotesk,
DM Mono) are self-hosted through Fontsource, so the site makes no third-party requests.

## Share cards

Every page has its own Open Graph / X card (1200 × 630 PNG), drawn at build time in the page's
language: `src/og/registry.ts` maps pages to cards, `src/og/templates/` draws them, and
`src/pages/og/[...card].png.ts` writes `dist/og/<locale>/<page>-<hash>.png`. The hash changes
with the card, so social networks fetch the new image after a change.

Text is shaped with HarfBuzz and drawn as paths (Arabic, Devanagari and Bengali need it), then
rasterized with resvg. Fonts: `src/og/fonts/` (`node scripts/og-fonts.mjs`) and the
@fontsource packages. Emoji art: Noto at the API's pinned commit, cached in
`node_modules/.cache/og-emoji/`. `test/og.test.ts` renders every card and fails on any text cut
short.

Shared playground searches are the only dynamic part. The site's Worker (`src/worker/`) runs for
`/s/*` and `/og/q/*` only; every other request stays a free static asset:

- `/s/?q=…&locale=…` (the playground's "Copy share link") is the playground page with share tags
  for the query, `noindex`.
- `/og/q/<version>/<locale>/<query>.png` draws the query and its top emoji from the API (no key,
  so no model call). One canonical URL per query, the Cache API, then rate limits on renders
  (`OG_IP_LIMITER` 10 a minute per IP, `OG_LOCATION_LIMITER` 60 a minute per location). A refused
  or failed render redirects to the playground's static card.

Put a Cloudflare WAF rate-limiting rule in front of both paths, so floods never reach the Worker
(Security → WAF → Rate limiting rules, one rule per zone):

| Field | Value |
| ----- | ----- |
| If incoming requests match | `starts_with(http.request.uri.path, "/s") or starts_with(http.request.uri.path, "/og/q/")` |
| Characteristics | IP |
| Requests / period | 30 per 10 seconds |
| Action / duration | Block for 10 seconds |

## Layout

| Path | Purpose |
| ---- | ------- |
| `src/pages/` | `/`, `/pricing/`, `/waitlist/`, `/docs/*`, `404`, `sitemap.xml`, `robots.txt` |
| `src/islands/` | `HeroSearch` (live search) and `WaitlistForm` (React) |
| `src/content/` | Landing copy and claims, docs page list |
| `src/lib/` | Pure helpers: pricing view of `PLANS`, waitlist submit, Markdown rendering, readout text |
| `test/` | Unit tests, landing claims checked against the data pack, build smoke test |
