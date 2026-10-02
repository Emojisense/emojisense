# Emojisense HTTP API (v1)

Base URL: your deployment of `packages/worker` (locally `http://localhost:8787` via `wrangler dev`).
All responses are JSON with `Access-Control-Allow-Origin: *`. Requests are simple `GET`s, so
browsers send no CORS preflight.

## `GET /v1/search`

| Param | Default | Notes |
| ----- | ------- | ----- |
| `q` | — | Required. Normalized server-side (see PACK_FORMAT.md §3); max 64 characters. An empty result after normalization → `400`. |
| `locale` | `en` | `en` or `tr`. Ranks matches from that locale's pack first. |
| `limit` | `24` | 1–50. |
| `mode` | `hybrid` | `hybrid`: alias + semantic, fused on the server (for thin clients). `semantic`: semantic only (the SDK fuses with its own on-device alias results). |
| `pack` | — | The client's pack version. Informational in v1. |
| `key` | — | Publishable key (`pk_…`). Without a key, a stricter anonymous rate limit applies. |

```json
{
  "query": "jurassic park",
  "results": [{ "emoji": "🦖", "id": "1F996", "score": 0.82, "source": "alias" }],
  "packVersion": "0.1.0",
  "model": "embeddinggemma@256",
  "cached": false
}
```

- `source`: `alias` (Tier 0 dictionary), `semantic` (embedding match), `custom` (tenant emoji, Phase 3).
- `score`: 0–1, comparable only within one source.
- `id`: Emojibase hexcode of the base emoji. Apply skin tones on the client.
- `degraded: true`: Workers AI was unavailable. The results are alias-only and are not cached.
- `cached: true`: served from the edge cache of this data center.

Headers: `Cache-Control: public, max-age=3600, s-maxage=86400` and
`Server-Timing: embed;dur=…, total;dur=…`.

| Status | Meaning |
| ------ | ------- |
| 400 | Missing or empty `q` |
| 401 | Unknown publishable key |
| 429 | Rate limited. Retry after the number of seconds in the `Retry-After` header. |

## `GET /v1/pack/:version/:file`

Static, immutable data packs: `manifest.json`, `pack.en.json`, `pack.tr.json`,
`vectors.<model>.<dims>.bin`. They have `Cache-Control: public, max-age=31536000, immutable`.
The format is in [PACK_FORMAT.md](PACK_FORMAT.md).

## `GET /v1/health`

```json
{ "ok": true, "packVersion": "0.1.0", "model": "embeddinggemma@256", "semantic": true }
```

## Privacy

The Worker never logs IP addresses, keys or user identifiers. The IP is used only as an
in-memory rate-limit key. Analytics Engine receives counts, cache status and latency. It
receives the normalized query text only when the on-device tier had no confident match. That
text is the input for alias mining.

## Planned

- Phase 2: `POST /v1/suggest-reactions` `{ text }` → top-k emoji for a message.
- Phase 3 (secret keys): `POST/GET/DELETE /v1/tenants/:id/emoji`, `POST /v1/tenants/:id/import/slack`.
