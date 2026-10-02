# Emojisense HTTP API (v1)

Two services, both Cloudflare Workers:

| Service | Package | Base (local) | Purpose |
| ------- | ------- | ------------ | ------- |
| Search API | `packages/worker` | `http://localhost:8788` | search, reactions, image → emoji, static packs and shards |
| Dashboard | `apps/dashboard` | `http://localhost:8790` | accounts, apps, keys, usage, waitlist (`/api/*`) |

Shared contracts: `@emojisense/platform` (D1 schema, plans, key helpers) and
[PACK_FORMAT.md](PACK_FORMAT.md) (packs, vectors, shards).

## Authentication

| Key | Where | Sent as | Checks |
| --- | ----- | ------- | ------ |
| Publishable `pk_live_…` | browsers, extensions | `?key=` query parameter (no CORS preflight) | `Origin` must match the key's allowed origins (empty list = any; dev keys only) |
| Secret `sk_live_…` | servers only (MCP, bots, tenant writes) | `Authorization: Bearer sk_live_…` | never accepted with an `Origin` header (blocks use from browsers) |
| none | demos, local dev | — | stricter anonymous rate limit per IP |

The `Origin` check stops misuse from other websites. It does not stop servers, which can forge
headers. Every key also has per-second rate limits.

## Metering and plan limits

- Metered: each Worker call to `/v1/search` and `/v1/suggest-reactions` (`semantic_calls`, also
  when the response comes from the Cache API) and each `/v1/classify-image` (`image_classifications`).
- Not metered: static packs and shards, on-device search.
- Monthly UTC periods, no daily caps. Limits come from `PLANS` in `@emojisense/platform`.
- **Over the limit, the API never fails.** It returns `200` with `"overLimit": true` and empty
  semantic results. The SDK then stays on the on-device dictionary and shards until the cooldown
  ends.

## `GET /v1/search`

| Param | Default | Notes |
| ----- | ------- | ----- |
| `q` | — | Required. Normalized server-side (PACK_FORMAT.md §3), max 64 characters. |
| `locale` | `en` | `en` or `tr` |
| `limit` | `24` | 1–50 |
| `mode` | `hybrid` | `hybrid` = alias + semantic fused on the server (thin clients). `semantic` = semantic only (the SDK fuses with its own on-device results). |
| `pack` | — | Client pack version (informational) |
| `key` | — | Publishable key |

```json
{
  "query": "jurassic park",
  "results": [{ "emoji": "🦖", "id": "1F996", "score": 0.82, "source": "alias" }],
  "packVersion": "0.1.0",
  "model": "embeddinggemma@256",
  "cached": false,
  "degraded": false,
  "overLimit": false
}
```

`source`: `alias` | `semantic` | `custom`. `degraded: true` = Workers AI was unavailable, so the
results are alias-only (and not cached). Header: `Server-Timing: embed;dur=…, total;dur=…`.

## `POST /v1/suggest-reactions`

Request `{ "text": "we just shipped the new onboarding!", "locale": "en", "limit": 8 }`. The text
is truncated to 256 characters (≈ 64 tokens). The response has the same shape as search. **The
text is never logged or cached:** it is chat content.

## `POST /v1/classify-image`

Request: `Content-Type: image/jpeg` or `image/webp`, max 256 KB. Clients downscale to ~384 px
first. Optional header `X-Image-Hash: <16 hex>` (64-bit perceptual hash) enables the cache, so the
same meme shared many times costs one call.

```json
{ "caption": "a puppy asleep on a sofa", "reaction": "aww, so cute", "results": [{ "emoji": "🐶", "id": "1F436", "score": 0.7, "source": "semantic" }], "cached": false, "overLimit": false }
```

The image is never stored. It is processed in memory and dropped. Only the caption is cached,
keyed by the perceptual hash.

## Static files

| Path | Content | Cache |
| ---- | ------- | ----- |
| `/v1/pack/:version/manifest.json`, `pack.<locale>.json`, `pack.<locale>.ext.json`, `vectors.<model>.<dims>.bin` | data packs | `public, max-age=31536000, immutable` |
| `/p/:packVersion/index.json`, `/p/:packVersion/<key>.json` | precomputed results (layer 2 shards) | immutable |

These are static asset requests: free, and they do not run the Worker.

## `GET /v1/health`

`{ "ok": true, "packVersion": "0.1.0", "model": "embeddinggemma@256", "semantic": true }`

## Status codes

| Status | Meaning |
| ------ | ------- |
| 400 | Missing or empty `q` / `text`, or an unreadable image |
| 401 | Unknown or revoked key |
| 403 | Origin not allowed for this publishable key, or a secret key sent from a browser |
| 413 | Image larger than 256 KB |
| 429 | Rate limited (per second). Retry after the seconds in `Retry-After`. |

## Dashboard API (`apps/dashboard`, cookie session)

| Method + path | Purpose |
| ------------- | ------- |
| `GET /api/auth/github` → callback `/api/auth/github/callback` | Sign in with GitHub (local dev: `/api/auth/dev`) |
| `POST /api/auth/logout` | End session |
| `GET /api/me` | Account + plan summary |
| `GET /api/apps`, `POST /api/apps` | List / create apps (`name`, `environment`) |
| `POST /api/apps/:id/keys` | Create a key (`kind`, `allowedOrigins`). The full key is returned once. |
| `PATCH /api/keys/:id`, `DELETE /api/keys/:id` | Update origins / revoke |
| `GET /api/apps/:id/usage?period=YYYY-MM` | Usage per metric vs plan limits |
| `POST /api/waitlist` | Public: `{ email, plan }` for the Pro waitlist |

## Privacy

- Never logged: IP addresses (only an in-memory rate-limit key), keys, user identifiers,
  reaction text, images.
- Analytics Engine receives counts, cache status, latency, and the normalized text (≤ 64 chars) of
  search queries that reached the Worker. Downstream jobs use a query only when it was seen ≥ 5
  times.
