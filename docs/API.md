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
- Not metered: static packs and shards, hosted emoji set images, on-device search.
- Monthly UTC periods, no daily caps. Limits come from `PLANS` in `@emojisense/platform`.
- **One shared cache.** The cache key is the normalized query, locale, limit, mode and index
  version. It has no key, app or origin in it, so every app warms the same edge cache.
- **Over the limit, the API never fails.** A query that is in the shared cache is still answered
  (`"cached": true`, not metered). Other queries return `200` with `"overLimit": true` and
  alias-only (hybrid) or empty (semantic) results. The SDK keeps asking (the edge cache may know
  the next query), remembers each over-limit miss, and stays on the on-device dictionary and
  shards for those.

## `GET /v1/search`

| Param | Default | Notes |
| ----- | ------- | ----- |
| `q` | — | Required. Normalized server-side (PACK_FORMAT.md §3), max 64 characters. |
| `locale` | `en` | A pack locale: `en`, `zh`, `hi`, `es`, `ar`, `fr`, `bn`, `pt`, `ru`, `id`, `tr` |
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

## `GET /v1/sets/:set/:hexcode.svg`

One emoji image from a hosted set. Pickers use it when their `emojiSet` option is not `native`.
No key, not metered, not rate limited.

| Part | Values |
| ---- | ------ |
| `set` | `twemoji`, `noto`, `fluent` |
| `hexcode` | Emojibase hexcode of a pack emoji or of one of its single-tone variants, e.g. `1F44D`, `1F44D-1F3FD`, `2764-FE0F-200D-1F525`. Case and U+FE0F spelling do not matter. `hexcodeOf(emoji)` in `emojisense` makes it. |

- `200`: `image/svg+xml` with `Cache-Control: public, max-age=31536000, immutable`, CORS `*`, a
  `Link: <license>; rel="license"` header and a CSP that blocks scripts when the file is opened
  directly.
- Each file comes from a pinned upstream commit through jsDelivr, once per edge location, and
  then from the Cache API. The Worker fetches only paths of its own mapping (never a URL from the
  request).
- Errors (JSON `{ error, message }`): `400 invalid_hexcode`, `404 unknown_set`, `404 unknown_emoji`
  (not in the pack), `404 not_in_set` (the set does not draw it, e.g. country flags in Fluent),
  `502 upstream_unavailable`. The 404s are cacheable for a day.
- Coverage per set: [packages/worker/reports/sets-coverage.md](../packages/worker/reports/sets-coverage.md).

| Set | Upstream | License |
| --- | -------- | ------- |
| Twemoji | `jdecked/twemoji` v17.0.3 | graphics CC BY 4.0 |
| Noto | `googlefonts/noto-emoji` v2026-09-24-unicode18_0 | images Apache 2.0, flags public domain |
| Fluent | `microsoft/fluentui-emoji` (2026-08-24) | MIT |

**Attribution:** Twemoji graphics © Twitter, Inc. and the jdecked/twemoji contributors, CC BY 4.0.
Noto Emoji © Google LLC, Apache 2.0. Fluent Emoji © Microsoft Corporation, MIT. The images are
served unmodified. License texts: [NOTICE](../NOTICE). Apps that show these images should credit
the set, for example on an "About" screen.

## `GET /v1/health`

`{ "ok": true, "packVersion": "0.1.0", "model": "embeddinggemma@256", "semantic": true }`

## Status codes

| Status | Meaning |
| ------ | ------- |
| 400 | Missing or empty `q` / `text`, an unreadable image, or an invalid emoji set hexcode |
| 401 | Unknown or revoked key |
| 403 | Origin not allowed for this publishable key, or a secret key sent from a browser |
| 413 | Image larger than 256 KB |
| 429 | Rate limited (per second). Retry after the seconds in `Retry-After`. |

## Dashboard API (`apps/dashboard`, cookie session)

| Method + path | Purpose |
| ------------- | ------- |
| `GET /api/auth/github` → callback `/api/auth/github/callback` | Sign in with GitHub (local dev: `/api/auth/dev`) |
| `POST /api/auth/logout` | End session |
| `GET /api/me` | Account, its own `plan`, `appCount`, `waitlistPlan`, `teams: [{ ownerId, ownerName, role }]` |
| `GET /api/apps`, `POST /api/apps` | List own apps, then team apps (each with `role`, `ownerId`, `ownerName`, `emojiSet`) / create an app in the own account (`name`, `environment`) |
| `GET /api/apps/:id` | App + keys (viewer+) |
| `PATCH /api/apps/:id` | `{ name?, emojiSet? }` (developer+). `emojiSet` other than `native` needs Solo+ |
| `POST /api/apps/:id/keys` | Create a key (`kind`, `allowedOrigins`). The full key is returned once. (developer+) |
| `PATCH /api/keys/:id`, `DELETE /api/keys/:id` | Update origins / revoke (developer+) |
| `GET /api/apps/:id/usage?period=YYYY-MM` | Usage per metric vs the owner's plan limits (viewer+) |
| `GET /api/apps/:id/analytics?days=7\|30\|90` | Search analytics (Pro and Scale, viewer+), see below |
| `GET /api/team` | `{ ownerId, role, members, invites }` (Pro+, any member) |
| `POST /api/team/invites` | `{ role, email? }` → `{ invite, url }`. The link `/invite/<token>` is shown once and works once, for 7 days (admin+) |
| `DELETE /api/team/invites/:id` | Withdraw an open invite (admin+) |
| `PATCH /api/team/members/:id` | `{ role }` (admin+). The owner cannot change. |
| `DELETE /api/team/members/:id` | Remove a member (admin+), or leave the team (the member) |
| `POST /api/invites/:token/accept` | Signed in: join the owner's team → `{ team: { ownerId, ownerName, role } }` |
| `GET /api/billing` | `{ plan, period, usage, limits, appCount, provider: null, waitlistPlan }` (owner, admin) |
| `POST /api/billing/upgrade` | `{ plan, email? }` → `{ status: "waitlist", plan }`. Never charges (owner only) |
| `POST /api/waitlist` | Public: `{ email, plan }` for the Pro waitlist |

### Roles, plans and errors

- **Plan.** It lives on the account (`accounts.plan`). Every app of the account gets it, and team
  members see the owner's plan.
- **Roles.** owner > admin (everything except changing the plan) > developer (apps, keys, custom
  emoji, webhooks; no team management) > viewer (read only). A team membership counts only while
  the owner's plan includes team members (Pro, Scale).
- **Team scope.** Team and billing routes act on the caller's own account. Add
  `?owner=<accountId>` to act on another owner's team (needs a membership with a high enough role).
- **Errors.** Every error is `{ "error": { "code", "message", "field"?, "plan"? } }`.

| Status | `code` | When |
| ------ | ------ | ---- |
| 402 | `plan_required` | The plan lacks the feature. `plan` = the cheapest plan that has it (also `POST /api/apps` past `maxApps`). |
| 403 | `forbidden_role` | The caller can see the app or team, but the role is too low |
| 404 | `not_found` | No app, key, team or member, or no access to it (the same answer) |
| 404 | `invite_not_found` | Unknown or withdrawn invite link |
| 409 | `invite_own_team`, `already_member`, `owner_immutable`, `plan_not_higher` | Invite for the own team, a second membership, a change to the owner, an upgrade to the same or a lower plan |
| 410 | `invite_used`, `invite_expired` | The invite was accepted already, or is older than 7 days |

### `GET /api/apps/:id/analytics`

| Param | Default | Notes |
| ----- | ------- | ----- |
| `days` | `30` | `7`, `30` or `90`. Cut to the plan's retention (Pro 30, Scale 365). |

```json
{
  "days": [{ "day": "2026-10-14", "searches": 0, "misses": 0 }, { "day": "2026-10-15", "searches": 412, "misses": 9 }],
  "topQueries": [{ "query": "ship it", "searches": 120 }],
  "topMisses": [{ "query": "lgtm", "misses": 7 }]
}
```

- `days`: one entry per UTC day of the window, oldest first, today last, `0` for days without
  searches. A miss is a search that returned no result.
- `topQueries`, `topMisses`: up to 20 entries over the window. A query is named only when the app
  saw it at least 5 times in the window. Day totals count every search.
- The plan is the account's (team members see the owner's plan). Free and Solo get `402
  { "error": { "code": "plan_required", "plan": "pro", "message": "…" } }`.
- Data comes from keyed `/v1/search` calls only, cache hits and over-limit answers included,
  flushed in batches (≈ 10 s delay).

## Privacy

What the hosted service collects, and for how long:

| Data | Where | Kept |
| ---- | ----- | ---- |
| Per app, UTC day and normalized search query (≤ 64 chars): number of searches and of misses. Only keyed `/v1/search` calls. | D1 `query_daily` | Pro: 30 days. Scale: 365 days. Free and Solo: 7 days (not shown; an upgrade then shows the last week). A daily cron deletes older rows. |
| Normalized search query text (≤ 64 chars) of every search that reached the Worker, with cache status, latency and scores. No app. | Analytics Engine | Analytics Engine retention (3 months) |
| Monthly call counts per app and metric | D1 `usage_monthly` | while the app exists |

- Never logged or stored: IP addresses (only an in-memory rate-limit key), keys, user
  identifiers, reaction text, images.
- Anonymous calls and development keys never reach `query_daily`.
- The dashboard names a query only when the app saw it ≥ 5 times in the window. Emojisense's own
  downstream jobs (shards, alias mining) use a query only when it was seen ≥ 5 times.
