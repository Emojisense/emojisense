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
- Not metered: static packs and shards, hosted emoji set images, custom emoji images and custom
  packs, on-device search.
- Monthly UTC periods, no daily caps. Limits come from `PLANS` in `@emojisense/platform`.
- **Limits are per account.** The plan belongs to the account (`accounts.plan`), so the calls of
  all of its apps count against one limit per metric. When the account's total for the month
  reaches the limit, every app of the account gets `"overLimit": true`. Usage is still stored per
  app, so the dashboard shows each app's part.
- Each API instance counts calls in memory. Its copy of the account's total is never older than
  a minute, and each write of its counts (about every 10 s while busy) refreshes it. So calls on
  other instances can take about a minute to count, and an account can go a little over its limit.
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
| `q` | — | Required, max 64 characters. The semantic tier embeds it with its accents and punctuation (PACK_FORMAT.md §3, "Embedding text"); aliases, custom emoji and analytics use its normalized form. |
| `locale` | `en` | A pack locale: `en`, `zh`, `hi`, `es`, `ar`, `fr`, `bn`, `pt`, `ru`, `id`, `tr`. See [Locales](#locales). Semantic search covers the English and this locale's emoji vectors (PACK_FORMAT.md §5). |
| `limit` | `24` | 1–50 |
| `mode` | `hybrid` | `hybrid` = alias + semantic fused on the server (thin clients). `semantic` = semantic only (the SDK fuses with its own on-device results). |
| `pack` | — | Client pack version (informational) |
| `key` | — | Publishable key |
| `tenant` | — | The app owner's id for one of their customers (`tenants.external_id`, ≤ 128 characters): that tenant's custom emoji are searched too |
| `culture` | `0` | `1` (or `true`) applies the [culture layer](#culture-in-search) to the answer. `0`, `false` or none: the canonical ranking only. Any other value answers `400`. |
| `region` | — | ISO 3166-1 alpha-2 code of the user's region, e.g. `GB`, `BR` (case does not matter). Turns on regional culture entries; used only with `culture=1`. A code that is not a real region answers `400`. |

```json
{
  "query": "jurassic park",
  "results": [{ "emoji": "🦖", "id": "1F996", "score": 0.82, "source": "alias" }],
  "packVersion": "0.1.0",
  "model": "embeddinggemma@256",
  "cached": false,
  "degraded": false,
  "overLimit": false,
  "aliasLocale": "en"
}
```

`source`: `alias` | `semantic` | `custom` | `culture` (only with `culture=1`). `degraded: true` = Workers AI was unavailable, so the
results are alias-only (and not cached). `overLimit: true` = the key's account has used its monthly
`semantic_calls` limit (see "Metering and plan limits"). `aliasLocale`: the locale whose aliases
were fused into the results; `null` in `semantic` mode, or when that locale's pack could not be
loaded (the results are then semantic-only and not cached). `culture`: `{ "from": "2026-10-02",
"region": "GB" }`, the culture file applied (its first day) and the region, or `null` when culture
is off or the locale has no culture file. Header: `Server-Timing: embed;dur=…, total;dur=…`.

**Custom emoji.** With a key, the app's custom emoji (app-wide, plus the tenant's with `tenant=`)
are matched against the query and put first, in both modes, within `limit`:

```json
{ "emoji": ":party_parrot:", "id": "C-x7Kq2", "score": 0.95, "source": "custom",
  "imageUrl": "https://api.emojisense.com/v1/custom/app_1/x7Kq2", "shortcode": "party_parrot" }
```

- They are matched per request from a per-isolate copy of the app's emoji that is at most 60 s
  old, and never enter the shared cache. Over the plan limit and when Workers AI is down they are
  still merged.
- When the app has custom emoji, the answer has `Cache-Control: private, max-age=60`.
- A tenant emoji replaces an app-wide emoji with the same shortcode. An unknown `tenant` searches
  the app-wide emoji only.

### Locales

- The API accepts every pack locale. A BCP 47 tag counts as its language, case-insensitive:
  `en-US` → `en`, `pt-BR` → `pt`, `zh-Hans` and `zh-Hant` → `zh` (the pack is Simplified Chinese).
  No `locale` (or an empty one) means `en`.
- Any other language answers `400` with the supported list, e.g. `unknown locale "de": use one of
  en, zh, hi, es, ar, fr, bn, pt, ru, id, tr (or a BCP 47 tag of one, e.g. pt-BR)`.
- Search and reactions rank with the English pack plus the requested locale's pack, the same
  data an SDK loads on the device. English matches still count, slightly below the locale's own.
- `en` and `tr` are built into the Worker. The other locales load their core pack on the first
  request in a Worker instance (≈ 0.1–0.3 s once), then answer as fast as `en`.

## `POST /v1/suggest-reactions`

Request `{ "text": "we just shipped the new onboarding!", "locale": "en", "limit": 8 }`. The text
is truncated to 256 characters (≈ 64 tokens). `locale` follows the [search rules](#locales) and
picks the alias pack. The response has the same shape as search, with the caller's custom emoji
first (`tenant` in the body or the query). **The text is never logged or cached:** it is chat
content.

Results are reactions, not topics: "we just shipped the new onboarding!" gives 🎉 🙌 👏, not 📦.
The ranking fuses the emoji in the text, intent cues (thanks, congratulations, condolences,
laughter, agreement… in en, tr, es, fr, de, pt, it), a reaction vocabulary ranked by the message
embedding, alias hits per clause and the nearest emoji of the catalog. A topical emoji needs two
signals, or a very close embedding match, so "smoke tests are failing" does not give 🚬. One
embedding call per request, no LLM. `source` is `semantic` for the embedding signals and
`alias` for the rest; over the limit, all results are `alias`. The list can be shorter than
`limit` when the text gives little to go on.

## `POST /v1/classify-image`

Request: `Content-Type: image/jpeg` or `image/webp`, max 256 KB. Clients downscale to ~384 px
first. Optional header `X-Image-Hash: <16 hex>` (64-bit perceptual hash) enables the cache, so the
same meme shared many times costs one call. Query: `?locale=&limit=` (`locale` is checked as in
[search](#locales); the label is English, so the keywords are ranked with English aliases).

```json
{ "caption": "a puppy asleep on a sofa", "reaction": "aww, so cute", "keywords": ["puppy", "sofa", "sleeping"], "results": [{ "emoji": "🐶", "id": "1F436", "score": 0.92, "source": "semantic" }], "cached": false, "degraded": false, "overLimit": false }
```

The vision model returns the caption, a likely reaction, 3–6 `keywords` and up to 8 emoji of its
own choice. Proposed emoji that are not in the catalog are dropped. The results fuse those emoji,
an alias search per keyword and the nearest emoji to the caption embedding; an emoji with too
little evidence is dropped, so the list can be shorter than `limit`. Gender and direction
variants (🚵 🚵‍♀️ 🚵‍♂️) appear once. `score` is the fused evidence, 0–1. `degraded: true` = no
caption embedding (fewer results).

The image is never stored or logged. It is processed in memory and dropped. Only the label
(caption, reaction, keywords, proposed emoji) is cached, and only with `X-Image-Hash`, keyed by
the perceptual hash, the vision model and the prompt version.

## Static files

| Path | Content | Cache |
| ---- | ------- | ----- |
| `/v1/pack/:version/manifest.json`, `pack.<locale>.json`, `pack.<locale>.ext.json`, `vectors.<model>.<dims>[.<locale>].bin` | data packs | `public, max-age=31536000, immutable` |
| `/p/:packVersion/index.json`, `/p/:packVersion/<key>.json` | precomputed results (layer 2 shards) | immutable |
| `/v1/culture/:packVersion/culture.<locale>.json`, `/v1/culture/:packVersion/index.json` | culture layer: editorial associations by culture, region and moment ([PACK_FORMAT.md §9](PACK_FORMAT.md)) | `public, max-age=3600` |

These are static asset requests: free, and they do not run the Worker. All send
`Access-Control-Allow-Origin: *`.

### Culture files

`GET /v1/culture/0.1.0/culture.es.json` returns the Spanish culture file: every lasting entry
plus the seasonal and event entries active in the next 14 days, with their exact windows, so the
SDK switches them on and off offline. The files are rebuilt daily under the same pack version, so
they are cached for an hour and never `immutable`. A locale without a file answers `404`; clients
then search without the culture layer.

| Field of a culture result (SDK) | Meaning |
| ------------------------------- | ------- |
| `source` | `"culture"` |
| `context` | Why the emoji fits, in the file's locale |
| `cultureId` | The entry id, e.g. `goat-football` |

The SDK applies the culture layer on the device after fusion. Thin clients can ask the search API
for it with `culture=1` ([Culture in search](#culture-in-search)). Culture results never rank above
the top canonical result, except a regional sense in the caller's region (below).

### Culture in search

`GET /v1/search?q=goat&culture=1` (and `&region=AR` for regional entries):

```json
{ "query": "goat",
  "results": [
    { "emoji": "🐐", "id": "1F410", "score": 1, "source": "alias" },
    { "emoji": "⚽", "id": "26BD", "score": 0.6, "source": "culture",
      "context": "Football's greatest-of-all-time debate", "cultureId": "goat-football" }
  ],
  "culture": { "from": "2026-10-02", "region": "AR" }, "…": "…" }
```

- **Off by default.** The SDKs ask for `mode=semantic` and apply the culture file on the device;
  a default-on server would apply it twice. Existing callers keep the ranking they tested.
- Culture results go right after the canonical (fused) top result, at most 5, cut to `limit`;
  `score` is the entry's weight (0–1). Custom emoji still come first.
- **Regional senses** (`kind: "regional"`, [PACK_FORMAT.md §9](PACK_FORMAT.md)) are the only
  exception: with a `region` in the entry's scope, a query equal to its trigger puts its emoji
  first and the canonical answer second (`football` with `region=GB`: ⚽ then 🏈). Without
  `region`, or with a region outside the scope, the canonical answer stays first.
- Windows are checked against the server's UTC day, so a seasonal entry can start or end a few
  hours early or late for a user. The SDK uses the user's local day.
- Culture is applied to each answer after the shared cache, like custom emoji. The cache holds
  the canonical answer only, so `culture` and `region` do not split it and no answer carries
  another day's or region's culture. Culture answers send `Cache-Control: public, max-age=3600`
  (the culture file's own lifetime).
- Metering does not change: a culture answer is one `semantic_calls` call, cached or not.

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

## `GET /v1/custom/:appId/:emojiId`

The image of one custom emoji: the `imageUrl` of results, custom packs and the dashboard. No key,
not metered, not rate limited.

- `200`: the stored bytes (`image/png`, `image/gif`, `image/webp` or `image/svg+xml`) with
  `Cache-Control: public, max-age=31536000, immutable`, an `ETag`, CORS `*`,
  `Cross-Origin-Resource-Policy: cross-origin`, `X-Content-Type-Options: nosniff` and a CSP that
  sandboxes the file and blocks scripts and requests when it is opened directly. An id always
  points at the same image (a new image is a new emoji), so edges and browsers keep it.
- `404` for an unknown emoji, an emoji of another app, or a missing object. `503` when the
  database cannot be read (not cached).
- A deleted emoji is gone from D1 and R2 at once, but an edge location that cached the image can
  still serve it until its cache entry is evicted.

## `GET /v1/custom-pack`

The app's custom emoji as a pack ([PACK_FORMAT.md §9](PACK_FORMAT.md)), so the SDK searches them
on the device (`loadCustomPack` in `emojisense`). Not metered.

| Param | Notes |
| ----- | ----- |
| `key` | Required (a publishable key; a secret key goes in `Authorization`). Anonymous calls get `401`. |
| `tenant` | Optional, as in search: adds that tenant's emoji. |

- `Cache-Control: public, max-age=60`. The edge caches it for 60 s per app, tenant and pack
  layout version (no key in the cache key), so dashboard edits show up within about a minute.
- Development keys (`DEV_KEYS`) get an empty pack. When the database cannot be read, the answer
  is an empty pack with `Cache-Control: no-store`.

## `GET /v1/health`

`{ "ok": true, "packVersion": "0.1.0", "model": "embeddinggemma@256", "semantic": true }`

## Tenants API (Scale, secret key)

Tenants are your own customers. Each tenant has its own custom emoji, next to the app-wide ones.
Call these routes from your server with a secret key: `Authorization: Bearer sk_live_…`.
Browsers cannot call them (a request with an `Origin` header is refused, and CORS does not allow
`Authorization`). The account that owns the app must be on Scale.

| Method + path | Body | Answer |
| ------------- | ---- | ------ |
| `GET /v1/tenants?limit=&cursor=` | — | `{ tenants: Tenant[], nextCursor }`, ordered by `externalId`. `limit` 1–500 (default 100). Pass `nextCursor` as `cursor` for the next page; `null` = last page. |
| `POST /v1/tenants` | JSON `{ externalId, name? }` | `201` + `Tenant` when created. `200` + the existing `Tenant` when the `externalId` is taken (safe to call on every sign-in; `name` is not changed). |
| `DELETE /v1/tenants/:externalId` | — | `{ tenant: Tenant, emojiDeleted }`. Deletes the tenant's custom emoji (rows and images) too. |
| `GET /v1/tenants/:externalId/emoji` | — | `{ emoji: CustomEmoji[], used, limit }`. `used` / `limit`: custom emoji of every app of the account vs the plan limit. |
| `POST /v1/tenants/:externalId/emoji` | `multipart/form-data`: `file`, `shortcode`, `aliases` (comma-separated, optional) | `201` + `CustomEmoji` |
| `DELETE /v1/tenants/:externalId/emoji/:shortcode` | — | the deleted `CustomEmoji` |

```json
// Tenant
{ "id": "Qm3xV0aT9cLr2PzK8wYe", "externalId": "acme", "name": "Acme Inc", "createdAt": 1760529600000, "emojiCount": 2 }

// CustomEmoji
{
  "id": "h7Q2mXn4Lw9pRt0sVb1c",
  "shortcode": "party_parrot",
  "aliases": ["party time", "dance"],
  "imageUrl": "https://api.emojisense.dev/v1/custom/<appId>/h7Q2mXn4Lw9pRt0sVb1c",
  "tenantId": "Qm3xV0aT9cLr2PzK8wYe",
  "tenantExternalId": "acme",
  "source": "api",
  "bytes": 18234,
  "createdAt": 1760529600000
}
```

```bash
curl -X POST https://api.emojisense.dev/v1/tenants \
  -H "Authorization: Bearer $EMOJISENSE_SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"externalId":"acme","name":"Acme Inc"}'

curl -X POST https://api.emojisense.dev/v1/tenants/acme/emoji \
  -H "Authorization: Bearer $EMOJISENSE_SECRET_KEY" \
  -F file=@party_parrot.gif -F shortcode=party_parrot -F aliases="party time, dance"
```

- `externalId`: your id for the customer, 1–128 characters of letters, digits and `. _ ~ : @ + -`.
  Encode it in the path (`encodeURIComponent`).
- `shortcode`: 1–64 characters of `a–z 0–9 _ + -`; `:party_parrot:` is accepted and stored as
  `party_parrot`. Unique per tenant. Aliases are normalized like search queries (≤ 20, ≤ 64
  characters each).
- Images: PNG, GIF, WebP or SVG, at most 256 KB. The type is read from the file's bytes. An SVG
  with a script, an `on…=` handler, a `javascript:` link, an external `href` or `url()`, a
  `<foreignObject>` or a DOCTYPE/ENTITY is refused (`unsafe_svg`).
- Custom emoji count against the plan's `custom_emoji` limit across all apps of the account.
- Every create and delete sends a [webhook event](#webhooks-scale).
- Errors of these routes: `{ "error": "<code>", "message": "…", … }`.

| Status | `error` | When |
| ------ | ------- | ---- |
| 400 | `invalid_request` (+ `field`), `invalid_json`, `invalid_multipart`, `unsafe_svg` | A field is missing or invalid |
| 401 | `unauthorized` | No key (an unknown or revoked key: see the table below) |
| 402 | `plan_required` (+ `plan: "scale"`) | The account is not on Scale |
| 403 | `secret_key_required`, `development_key`, `plan_limit` (+ `used`, `limit`) | A publishable key; a `DEV_KEYS` key (no app row); the custom emoji limit is reached |
| 404 | `tenant_not_found`, `emoji_not_found`, `not_found` | No such tenant, shortcode or route |
| 409 | `shortcode_taken` | The tenant already has this shortcode |
| 413 | `image_too_large`, `body_too_large` | Image > 256 KB, JSON body > 16 KB |
| 415 | `unsupported_media_type`, `unsupported_image` | Wrong `Content-Type`, or not PNG/GIF/WebP/SVG |
| 503 | `unavailable`, `storage_unavailable` | The database or the image bucket is not reachable |

## Status codes

| Status | Meaning |
| ------ | ------- |
| 400 | Missing or empty `q` / `text`, a `locale` without a pack, an unreadable image, an invalid emoji set hexcode, or a `tenant` longer than 128 characters |
| 401 | Unknown or revoked key, or no key for `/v1/custom-pack` |
| 402 | The account's plan does not include the feature (tenants API) |
| 403 | Origin not allowed for this publishable key, or a secret key sent from a browser |
| 413 | Image larger than 256 KB |
| 429 | Rate limited (per second). Retry after the seconds in `Retry-After`. |

## Dashboard API (`apps/dashboard`, cookie session)

| Method + path | Purpose |
| ------------- | ------- |
| `GET /api/auth/github` → callback `/api/auth/github/callback` | Sign in with GitHub (local dev: `/api/auth/dev`) |
| `POST /api/auth/logout` | End session |
| `GET /api/me` | Account, its own `plan`, `appCount`, `waitlistPlan`, `teams: [{ ownerId, ownerName, role }]` |
| `DELETE /api/me` | `{ confirm }` → `{ ok: true }` and a cleared session cookie. Deletes the account and everything it owns, see below (the account itself) |
| `GET /api/apps`, `POST /api/apps` | List own apps, then team apps (each with `role`, `ownerId`, `ownerName`, `emojiSet`) / create an app in the own account (`name`, `environment`) |
| `GET /api/apps/:id` | App + keys (viewer+) |
| `PATCH /api/apps/:id` | `{ name?, emojiSet? }` (developer+). `emojiSet` other than `native` needs Solo+ |
| `POST /api/apps/:id/keys` | Create a key (`kind`, `allowedOrigins`). The full key is returned once. (developer+) |
| `PATCH /api/keys/:id`, `DELETE /api/keys/:id` | Update origins / revoke (developer+) |
| `GET /api/apps/:id/usage?period=YYYY-MM` | Per metric: the account's total over all of its apps vs the owner's plan limit (`used`, `limit`, `percent`, `status`), and this app's part (`appUsed`). `custom_emoji` is the emoji stored now, in every period. (viewer+) |
| `GET /api/apps/:id/analytics?days=7\|30\|90` | Search analytics (Pro and Scale, viewer+), see below |
| `GET /api/apps/:id/tenants?limit=&cursor=` | `{ tenants: [{ id, externalId, name, createdAt, emojiCount }], nextCursor }` (Scale, viewer+) |
| `POST /api/apps/:id/tenants` | `{ externalId, name? }` → `201 { tenant }`; a taken `externalId` is `409 tenant_exists` (Scale, developer+) |
| `GET /api/apps/:id/tenants/:tenantId` | `{ tenant }` (Scale, viewer+) |
| `DELETE /api/apps/:id/tenants/:tenantId` | → `{ tenant, emojiDeleted }`, with the tenant's custom emoji (Scale, developer+) |
| `GET /api/apps/:id/webhooks` | `{ webhooks: [{ id, appId, url, events, enabled, createdAt, disabledAt, lastDelivery }] }` (Scale, viewer+) |
| `POST /api/apps/:id/webhooks` | `{ url, events? }` → `201 { webhook, secret }`. The `whsec_…` secret is shown only here. `events` defaults to all. At most 10 per app (`409 webhook_limit`). (Scale, developer+) |
| `PATCH /api/webhooks/:id` | `{ url?, events?, enabled? }` → `{ webhook }` (Scale, developer+) |
| `DELETE /api/webhooks/:id` | → `{ ok: true }`, with its deliveries (Scale, developer+) |
| `POST /api/webhooks/:id/test` | Sends one `webhook.test` event now (no retries, also when disabled) → `{ delivery }` (Scale, developer+) |
| `GET /api/webhooks/:id/deliveries` | `{ deliveries: [{ id, event, status, ok, durationMs, createdAt }] }`, the last 50, newest first (Scale, viewer+) |
| `GET /api/apps/:id/emoji[?tenantId=]` | Custom emoji → `{ emoji: CustomEmoji[], used, limit }` (viewer+), see below |
| `POST /api/apps/:id/emoji` | Multipart upload: `file`, `shortcode`, `aliases`, `tenantId?` → `201 CustomEmoji` (Solo+, developer+) |
| `PATCH /api/apps/:id/emoji/:emojiId` | `{ shortcode?, aliases? }` → `CustomEmoji` (developer+) |
| `DELETE /api/apps/:id/emoji/:emojiId` | → `{ ok: true }` (developer+, any plan) |
| `POST /api/apps/:id/emoji/import/slack` | `{ token }` → `{ imported, skipped, remaining, skippedBy }` (Pro+, developer+) |
| `POST /api/apps/:id/emoji/import/discord` | `{ botToken, guildId }` → like the Slack import (Pro+, developer+) |
| `GET /api/team` | `{ ownerId, role, members, invites }` (Pro+, any member) |
| `POST /api/team/invites` | `{ role, email? }` → `{ invite, url }`. The link `/invite/<token>` is shown once and works once, for 7 days (admin+) |
| `DELETE /api/team/invites/:id` | Withdraw an open invite (admin+) |
| `PATCH /api/team/members/:id` | `{ role }` (admin+). The owner cannot change. |
| `DELETE /api/team/members/:id` | Remove a member (admin+), or leave the team (the member) |
| `POST /api/invites/:token/accept` | Signed in: join the owner's team → `{ team: { ownerId, ownerName, role } }` |
| `GET /api/billing` | `{ plan, period, usage, limits, appCount, provider: null, waitlistPlan }` (owner, admin) |
| `POST /api/billing/upgrade` | `{ plan, email? }` → `{ status: "waitlist", plan }`. Never charges (owner only) |
| `POST /api/waitlist` | Public: `{ email, plan }` (`plan` defaults to `pro`) as JSON, or the same fields as an HTML form (`application/x-www-form-urlencoded`). A form post without `Accept: application/json` gets `303` to `<website>/waitlist/?status=ok#waitlist-joined` or `?status=error#waitlist-failed` (the website is the posting `WEBSITE_ORIGINS` entry, or the first one when there is no `Origin`). Other origins get `403`; 5 posts per minute per IP. |

### Roles, plans and errors

- **Plan.** It lives on the account (`accounts.plan`). Every app of the account gets it, and team
  members see the owner's plan. Its monthly limits count the usage of all apps of the account.
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
| 409 | `tenant_exists`, `webhook_limit` | A tenant with this `externalId` exists; the app has 10 webhooks |
| 410 | `invite_used`, `invite_expired` | The invite was accepted already, or is older than 7 days |
| 400 | `confirmation_required` | `DELETE /api/me` without the right `confirm` value |
| 503 | `storage_unavailable` | `DELETE /api/me` could not delete the custom emoji images. Nothing was deleted; try again. |

### `DELETE /api/me` (account deletion)

```json
{ "confirm": "ada@example.com" }
```

- `confirm` is the account's email (any case, spaces trimmed). An account without an email sends
  `"delete my account"`. Only the signed-in account can delete itself. Team roles do not apply.
- One request deletes the account and everything it owns: its apps with their API keys, monthly
  usage, search analytics (`query_daily`), tenants, custom emoji (rows and R2 images) and
  webhooks with their deliveries; its own team members and invites; its memberships in other
  teams; all its sessions; and the waitlist entry of its email.
- The R2 images go first. When R2 fails, the answer is `503 storage_unavailable` and no row is
  deleted. Then one D1 batch (one transaction) deletes the rows.
- The API Worker caches key lookups for 60 s per isolate, so a deleted key can work for up to a
  minute, as after a revocation. Usage that an isolate has not flushed yet for a deleted app is
  dropped.
- Not deleted: invites that other owners sent to this email (their data), anonymous Analytics
  Engine points (they have no app, key or account), copies of custom emoji images that an edge
  cache or a browser already holds (until evicted), and D1 Time Travel history (see
  [Privacy](#privacy)).
- The dashboard's Settings page has a "Delete account" dialog that asks for the same `confirm`
  text (`isDeleteAccountConfirmed` in `apps/dashboard/src/shared/contract.ts`).

Custom emoji routes add these codes:

| Status | `code` | When |
| ------ | ------ | ---- |
| 400 | `invalid_request` (`field`: `shortcode`, `aliases`, `tenantId`, `file`, `token`, `botToken`, `guildId`) | A field breaks the rules below |
| 400 | `unsafe_svg` (`field: file`) | The SVG has scripts, event handlers, `javascript:`, external links or `url()`, entity declarations or embedded documents |
| 400 | `import_auth_failed` (`field: token`, `botToken` or `guildId`) | Slack or Discord refused the token, or the bot is not in the server. The message names the provider's error code, never the token. |
| 402 | `plan_required` | Upload on Free (`plan: "solo"`), import below Pro (`plan: "pro"`), or the account is at its plan's custom emoji limit (`plan` = the cheapest plan with a higher limit) |
| 403 | `plan_limit` | At the limit of the top plan (Scale) |
| 409 | `shortcode_taken` (`field: shortcode`) | The shortcode exists in the same scope (app-wide, or the same tenant) |
| 413 | `image_too_large` (`field: file`) | The image is larger than 256 KB |
| 415 | `unsupported_image` (`field: file`), `unsupported_media_type` | The file is not PNG, GIF, WebP or SVG (checked by its bytes, not its name or type), or the upload is not `multipart/form-data` |
| 429 | `import_rate_limited` | Slack or Discord is limiting requests (`Retry-After: 60`) |
| 502 | `import_unavailable` | Slack or Discord did not answer, or answered with another error |
| 503 | `storage_unavailable` | The R2 binding `EMOJI` is missing |

### Custom emoji

```ts
type CustomEmoji = {
  id: string;
  shortcode: string;        // without colons
  aliases: string[];        // normalized search phrases
  imageUrl: string;         // `${API_URL}/v1/custom/<appId>/<id>`, immutable
  tenantId: string | null;  // tenants.id; null = app-wide
  tenantExternalId?: string | null; // tenants API and webhooks only
  source: "upload" | "slack" | "discord" | "api";
  bytes: number;
  createdAt: number;        // epoch ms
};
```

- **List.** `{ emoji, used, limit }`, newest first. `?tenantId=<tenants.id>` lists one tenant's
  emoji. `used` is what the limit counts: every emoji of every app of the owning account (tenants
  included); `limit` is the owner plan's `custom_emoji` (`0` on Free, `null` = unlimited). Every
  role may list, on every plan.
- **Upload.** `multipart/form-data` with `file` (≤ 256 KB; PNG, GIF, WebP or SVG by magic bytes),
  `shortcode`, `aliases` (comma-separated, optional) and `tenantId` (optional, a `tenants.id` of
  this app). Images are stored in R2 under `custom/<appId>/<tenantId or "_">/<id>.<ext>`.
- **Shortcode.** Surrounding colons and spaces are dropped and letters lowercased
  (`":Party_Parrot:"` → `party_parrot`); then it must be 1–64 characters of `a–z 0–9 _ + -`
  with at least one letter or digit. Unique per app-wide scope and per tenant.
- **Aliases.** A comma-separated string (forms) or a string array (JSON). Each is normalized like
  a query (PACK_FORMAT.md §3); empty and repeated ones are dropped; at most 20.
- **Limit.** The plan's `custom_emoji` limit counts every emoji of every app of the account, tenant
  emoji included, the same rule as the tenants API and `GET /api/billing`. The check is part of
  the INSERT, so parallel uploads cannot pass it together.
- **Edit and delete** are not plan-gated, so an account that moved to a lower plan can still
  clean up. A rename keeps the image and the id.
- **Webhooks.** Uploads, imports and deletes emit `custom_emoji.created` / `custom_emoji.deleted`
  (Scale). A rename sends nothing.
- **Search.** The API Worker serves the images and merges custom matches into `/v1/search` and
  `/v1/suggest-reactions` within about a minute of a change.

### Slack and Discord import

- Slack: `{ token }`, a user token (`xoxp-…`) with `emoji:read`. The dashboard calls
  `GET https://slack.com/api/emoji.list` with it and downloads each image from Slack's CDN
  (`*.slack-edge.com` over HTTPS only). `alias:` entries are not imported.
- Discord: `{ botToken, guildId }`. The dashboard calls `GET /api/v10/guilds/:guildId/emojis` with
  `Authorization: Bot …` and downloads `https://cdn.discordapp.com/emojis/<id>.gif|png?size=128`.
- Names become shortcodes by the rules above (Discord names are lowercased). Emoji whose
  shortcode exists already, whose image fails the upload checks, or that do not fit the plan
  limit are skipped.
- **Batches.** One call stores at most 50 new emoji. While `remaining > 0`, call again with the
  same token; emoji imported earlier then count as `exists`.
- The token is used for that one request: never stored, logged or returned.

```json
{ "imported": 50, "skipped": 7, "remaining": 12,
  "skippedBy": { "alias": 4, "exists": 1, "invalid": 2, "limit": 0, "failed": 0 } }
```

`skippedBy`: `alias` (Slack aliases), `exists` (shortcode taken), `invalid` (name or image breaks
the rules, or the provider entry is unusable), `limit` (over the plan limit), `failed` (download
failed).

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

## Webhooks (Scale)

Create webhooks in the dashboard (`POST /api/apps/:id/webhooks`). Each one has a URL, a list of
events and a secret (`whsec_…`, shown once). Emojisense sends each event as a `POST` with a JSON
body to every enabled webhook of the app that subscribes to it.

### Events

| `type` | When | `data` |
| ------ | ---- | ------ |
| `tenant.created` | A tenant is created (tenants API or dashboard) | `{ id, externalId, name, createdAt }` |
| `tenant.deleted` | A tenant is deleted | `{ id, externalId, name, createdAt, emojiDeleted }` |
| `custom_emoji.created` | A custom emoji is uploaded (tenants API or dashboard) or imported from Slack or Discord (one event per emoji) | `CustomEmoji` with `tenantExternalId` (`null` for app-wide emoji) |
| `custom_emoji.deleted` | A custom emoji is deleted (tenants API or dashboard) | `CustomEmoji` with `tenantExternalId` |
| `usage.threshold` | The account reaches 80% or 100% of a monthly limit (`semantic_calls`, `image_classifications`) | `{ metric, threshold, period, used, limit }` |
| `webhook.test` | "Send test event" in the dashboard; never subscribed | `{ webhookId, message }` |

```json
{
  "id": "evt_7tQe2mV9xKp4Lr8Za1Bc3dWf",
  "type": "tenant.created",
  "createdAt": 1760529600000,
  "appId": "Hn5sK2pQ8vRw1mXc4tYb",
  "data": { "id": "Qm3xV0aT9cLr2PzK8wYe", "externalId": "acme", "name": "Acme Inc", "createdAt": 1760529600000 }
}
```

`usage.threshold` counts every app of the account, because plan limits belong to the account. It
fires once per account, UTC month, metric and threshold, and goes to the webhooks of every app of
the account with the same `id`. A plan change in the month sets new thresholds, which can fire
again (the new `limit` is in `data`).

```json
{
  "id": "evt_3f9a1c0e5b7d2a4c6e8f0b1d3a5c7e9f",
  "type": "usage.threshold",
  "createdAt": 1760529600000,
  "appId": "Hn5sK2pQ8vRw1mXc4tYb",
  "data": { "metric": "semantic_calls", "threshold": 80, "period": "2026-10", "used": 12000000, "limit": 15000000 }
}
```

### Delivery

| Header | Value |
| ------ | ----- |
| `Content-Type` | `application/json` |
| `Emojisense-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` |
| `Emojisense-Event` | the event `type` |
| `Emojisense-Event-Id` | the event `id` (the same on every retry) |
| `User-Agent` | `Emojisense-Webhooks/1.0` |

- Any `2xx` answer within 10 s is a success. Anything else (other status, redirect, timeout,
  network error) is retried: up to 3 attempts, at once, after 10 s and after 60 s more. Each
  attempt gets a fresh `t` and signature; the body stays the same.
- Redirects are not followed. Answer at the URL you registered.
- Every attempt is recorded (`GET /api/webhooks/:id/deliveries`): event, HTTP status (`null` for a
  network error, a timeout or a refused URL), duration and time. Only the last 50 per webhook are
  kept. Bodies are not stored.
- An event can arrive more than once (a retry after a slow answer, or one `usage.threshold`
  through two apps) and out of order. Use the event `id` to drop duplicates.
- A disabled webhook, or one of an account that is no longer on Scale, gets nothing. Disabling
  or deleting a webhook also stops its pending retries.
- ⚠ The retries run in the Worker's `waitUntil`, which Cloudflare ends 30 s after the response.
  In production the 60 s attempt is therefore usually cut off. Do not rely on the third attempt.

**URL rules.** `https` only, and the host must be public: no `localhost`, private, loopback,
link-local or reserved IP addresses (IPv4 and IPv6, including IPv4-mapped forms), and no internal
names (`*.local`, `*.internal`, single-label hosts, …). No user name or password in the URL. The
rules are checked when the webhook is saved and again before each delivery. With
`ENVIRONMENT=development`, `http://localhost`, `http://127.0.0.1` and `http://[::1]` are allowed
too, for local receivers.

### Verify the signature

Compute HMAC-SHA256 over `"<t>.<raw body>"` with the whole secret (including `whsec_`) as the key.
Compare it in constant time with each `v1` value, and refuse a `t` older than 5 minutes. Use the
raw body exactly as received: parsing and re-serializing JSON changes the bytes.

Node (Express):

```js
import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

export function verifyEmojisense(rawBody, header, secret, toleranceSeconds = 300) {
  const fields = (header ?? "").split(",").map((part) => part.trim().split("="));
  const t = Number(fields.find(([name]) => name === "t")?.[1]);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return fields
    .filter(([name]) => name === "v1")
    .some(([, value]) => {
      const given = Buffer.from(value ?? "", "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

const app = express();
app.post("/hooks/emojisense", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body.toString("utf8");
  if (!verifyEmojisense(rawBody, req.get("Emojisense-Signature"), process.env.EMOJISENSE_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(rawBody);
  // Handle event.type here; drop an event.id you have seen before.
  res.sendStatus(204);
});
```

Python:

```python
import hashlib
import hmac
import time


def verify_emojisense(raw_body: bytes, header: str | None, secret: str, tolerance: int = 300) -> bool:
    if not header:
        return False
    fields = [part.strip().partition("=") for part in header.split(",")]
    timestamps = [value for name, _, value in fields if name == "t"]
    signatures = [value for name, _, value in fields if name == "v1"]
    if not timestamps or not timestamps[0].isdigit():
        return False
    t = int(timestamps[0])
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


# Flask: verify_emojisense(request.get_data(), request.headers.get("Emojisense-Signature"), SECRET)
```

## Privacy

What the hosted service collects, and for how long:

| Data | Where | Kept |
| ---- | ----- | ---- |
| Per app, UTC day and normalized search query (≤ 64 chars): number of searches and of misses. Only keyed `/v1/search` calls. | D1 `query_daily` | Pro: 30 days. Scale: 365 days. Free and Solo: 7 days (not shown; an upgrade then shows the last week). A daily cron deletes older rows. |
| Normalized search query text (≤ 64 chars) of every search that reached the Worker, with cache status, latency and scores. No app. | Analytics Engine | Analytics Engine retention (3 months) |
| Monthly call counts per app and metric | D1 `usage_monthly` | until the account is deleted (apps have no delete route) |
| Tenants: your `externalId` and optional `name` per customer | D1 `tenants` | until you delete the tenant or the account |
| Webhook deliveries: event type, HTTP status, duration, time. No body, no response. | D1 `webhook_deliveries` | the last 50 per webhook |
| Custom emoji: shortcode, aliases, size, source, and the image | D1 `custom_emoji`, R2 `emojisense-emoji` | until the emoji, its tenant or the account is deleted (edge copies of the image until evicted) |
| Waitlist: email, plan, date of the first sign-up | D1 `waitlist` | 12 months after the first sign-up (`WAITLIST_KEEP_MONTHS`). The same daily cron deletes older rows. Also deleted with an account of the same email. |
| Accounts, sessions, apps, keys (SHA-256 + first 12 chars), team, webhooks | D1 | until `DELETE /api/me`. Sessions expire after 30 days; expired rows go at the next sign-in. Revoked keys stay, marked as revoked. |
| Our own `console` records: event names, error types, counts | Workers Logs | up to 7 days (Paid plan; 3 days on Free). `invocation_logs` is off in both `wrangler.jsonc` files, so request URLs are never logged. |

- Never logged or stored: IP addresses (only an in-memory rate-limit key), user identifiers,
  reaction text, images sent to `/v1/classify-image`, Slack and Discord tokens. Keys are stored
  only as a hash and a 12-character prefix, never logged.
- Logs never hold query or message text, keys, IP addresses or emails. Workers AI failures log
  the error type only, because a message could quote the input.
- Anonymous calls and development keys never reach `query_daily`.
- The dashboard names a query only when the app saw it ≥ 5 times in the window. Emojisense's own
  downstream jobs (shards, alias mining) read Analytics Engine, never `query_daily`, and use a
  query only when it was seen ≥ 5 times.
- `DELETE /api/me` deletes an account and everything it owns (see the Dashboard API). D1 Time
  Travel can still restore the database to a point in the last 30 days (Paid plan).
