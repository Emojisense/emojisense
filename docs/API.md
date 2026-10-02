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
results are alias-only (and not cached). `overLimit: true` = the key's account has used its monthly
`semantic_calls` limit (see "Metering and plan limits"). Header: `Server-Timing: embed;dur=…, total;dur=…`.

## `POST /v1/suggest-reactions`

Request `{ "text": "we just shipped the new onboarding!", "locale": "en", "limit": 8 }`. The text
is truncated to 256 characters (≈ 64 tokens). The response has the same shape as search. **The
text is never logged or cached:** it is chat content.

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
same meme shared many times costs one call.

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
| 400 | Missing or empty `q` / `text`, an unreadable image, or an invalid emoji set hexcode |
| 401 | Unknown or revoked key |
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
| `GET /api/apps`, `POST /api/apps` | List own apps, then team apps (each with `role`, `ownerId`, `ownerName`, `emojiSet`) / create an app in the own account (`name`, `environment`) |
| `GET /api/apps/:id` | App + keys (viewer+) |
| `PATCH /api/apps/:id` | `{ name?, emojiSet? }` (developer+). `emojiSet` other than `native` needs Solo+ |
| `POST /api/apps/:id/keys` | Create a key (`kind`, `allowedOrigins`). The full key is returned once. (developer+) |
| `PATCH /api/keys/:id`, `DELETE /api/keys/:id` | Update origins / revoke (developer+) |
| `GET /api/apps/:id/usage?period=YYYY-MM` | Per metric: the account's total over all of its apps vs the owner's plan limit (`used`, `limit`, `percent`, `status`), and this app's part (`appUsed`) (viewer+) |
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
| `custom_emoji.created` | A tenant emoji is uploaded with the tenants API | `CustomEmoji` (see [Tenants API](#tenants-api-scale-secret-key)) |
| `custom_emoji.deleted` | A tenant emoji is deleted with the tenants API | `CustomEmoji` |
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
| Monthly call counts per app and metric | D1 `usage_monthly` | while the app exists |
| Tenants: your `externalId` and optional `name` per customer | D1 `tenants` | until you delete the tenant or the app |
| Webhook deliveries: event type, HTTP status, duration, time. No body, no response. | D1 `webhook_deliveries` | the last 50 per webhook |

- Never logged or stored: IP addresses (only an in-memory rate-limit key), keys, user
  identifiers, reaction text, images.
- Anonymous calls and development keys never reach `query_daily`.
- The dashboard names a query only when the app saw it ≥ 5 times in the window. Emojisense's own
  downstream jobs (shards, alias mining) use a query only when it was seen ≥ 5 times.
