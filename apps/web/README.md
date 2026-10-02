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
and pricing use the same tokens with calmer layouts. Fonts (DynaPuff, Figtree, DM Mono) are
self-hosted through Fontsource, so the site makes no third-party requests.

## Layout

| Path | Purpose |
| ---- | ------- |
| `src/pages/` | `/`, `/pricing/`, `/waitlist/`, `/docs/*`, `404`, `sitemap.xml`, `robots.txt` |
| `src/islands/` | `HeroSearch` (live search) and `WaitlistForm` (React) |
| `src/content/` | Landing copy and claims, docs page list |
| `src/lib/` | Pure helpers: pricing view of `PLANS`, waitlist submit, Markdown rendering, readout text |
| `test/` | Unit tests, landing claims checked against the data pack, build smoke test |
