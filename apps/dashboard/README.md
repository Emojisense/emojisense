# Emojisense dashboard

Developers sign in with GitHub, create apps, create and revoke API keys, and watch usage against
their plan. One Cloudflare Worker serves the SPA as static assets and runs only for `/api/*`
(`run_worker_first`). It shares the D1 schema in `packages/platform/migrations` with the API
Worker. The API contract is the "Dashboard API" section of [docs/API.md](../../docs/API.md).

```
browser ──▶ /apps, /assets/* ──▶ static assets (free, no Worker)
        └─▶ /api/*            ──▶ Worker (src/worker) ──▶ D1 "emojisense"
                                                     └─▶ github.com (OAuth only)
```

## Run locally

From the repo root:

```bash
pnpm install
pnpm --filter @emojisense/platform build
cp apps/dashboard/.dev.vars.example apps/dashboard/.dev.vars
pnpm --filter @emojisense/dashboard db:migrate   # wrangler d1 migrations apply emojisense --local
pnpm --filter @emojisense/dashboard dev          # builds the SPA, then wrangler dev on :8790
```

Open http://localhost:8790 and use **Sign in as dev user**. Each name is its own account, so two
names let you test that one account cannot see the other's apps.

| Command | What it does |
| ------- | ------------ |
| `dev` | `vite build`, then `wrangler dev` on port 8790 |
| `dev:ui` | Rebuilds the SPA on change (run it in a second terminal next to `dev`) |
| `db:migrate` | Applies the platform migrations to local D1 |
| `test` | Worker tests (in-memory D1) and UI tests (happy-dom) |
| `check:worker` | Bundles the Worker with `wrangler deploy --dry-run` (no upload) |

- Local D1 lives in `<repo>/.wrangler/state` (`--persist-to ../../.wrangler/state`). If the API
  Worker uses the same directory and the same `database_id`, keys created here work against the
  local API.
- If port 8790 is taken, run `pnpm --filter @emojisense/dashboard dev --port 8796`. GitHub
  sign-in then needs a callback URL with that port.
- Dev sign-in needs `ENVIRONMENT=development` **and** a localhost URL. In production it answers
  404.

## GitHub OAuth app

1. Open GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Homepage URL: `http://localhost:8790`. Authorization callback URL:
   `http://localhost:8790/api/auth/github/callback`.
3. Copy the client ID, generate a client secret, and put both in `.dev.vars`.
4. For production, create a second OAuth app with the production callback URL. Then run
   `wrangler secret put GITHUB_CLIENT_ID` and `wrangler secret put GITHUB_CLIENT_SECRET`.

Scopes: `read:user user:email`. The dashboard reads the user id, name and verified primary
email. It uses the access token once and never stores it.

## Configuration

| Name | Kind | Purpose |
| ---- | ---- | ------- |
| `DB` | D1 binding | Shared database `emojisense`. Replace the placeholder `database_id` before a deploy. |
| `ASSETS` | assets binding | The built SPA in `dist/client` |
| `WAITLIST_LIMITER` | rate limit | 5 waitlist posts per minute per IP (the IP is only the in-memory key) |
| `ENVIRONMENT` | var | `development` enables dev sign-in on localhost. Default `production`. |
| `WEBSITE_ORIGINS` | var | Comma-separated website origins that may POST `/api/waitlist` (CORS) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | secrets | GitHub OAuth app |

## Behavior worth knowing

| Topic | Rule |
| ----- | ---- |
| Sessions | 32 random bytes in `es_session`: HttpOnly, SameSite=Lax, Secure except on localhost, 30 days. D1 stores only the SHA-256. |
| Writes | POST/PATCH/DELETE with an `Origin` other than the dashboard's own get 403, which also blocks same-site sibling domains. |
| Sign-in errors | Sign-in routes are navigations, so they redirect to `/?error=<code>` (`github_state`, `github_denied`, `github_failed`, `github_unconfigured`). |
| API errors | `{ "error": { "code", "message", "field"? } }` with 400, 401, 403, 404, 405, 409, 413, 415, 429 or 500. |
| Ownership | Another account's app or key answers 404, the same as a missing one. |
| Apps | `environment` is `prod` (default), `staging` or `dev`. `maxApps` is checked inside the INSERT, so parallel requests cannot exceed it. |
| Account plan | Migration 0001 stores the plan per app. Until there is an account plan, the account's plan is the best plan among its apps, and new apps inherit it. |
| Keys | The create response is the only place the full key appears. D1 stores its SHA-256 and the first 12 characters. |
| Allowed origins | `https://host[:port]` or `https://*.example.com`; `http://` only for localhost; at most 20. A publishable key with no origins (any origin) is allowed only in `dev` apps. Secret keys have none. |
| Usage | `GET /api/apps/:id/usage?period=YYYY-MM` (UTC, default current month, no future months). `status` is `ok`, `near_limit` (≥ 80%), `over_limit` (used ≥ limit) or `not_included` (limit 0). `limit: null` means unlimited. |
| Analytics | `GET /api/apps/:id/analytics?days=7\|30\|90` (default 30) from `query_daily`. The window is cut to the owner account's `analyticsRetentionDays` and zero-filled. Top lists: 20 entries, only queries searched ≥ 5 times in the window. Plans without analytics get `402 { "error": "plan_required", "plan": "pro", "message" }`. |
| Waitlist | Public and idempotent. New and known emails get the same answer. A repeat updates the plan and keeps the first date. |

`GET /api/apps/:id` (app + keys) is an addition to docs/API.md: the app page needs it to list keys.

## Tests

- `test/worker`: route handlers against `FakeD1`, which is real SQLite (`node:sqlite`) with the real
  migrations. Covers auth and sessions, GitHub OAuth (mocked fetch), ownership, the key
  lifecycle, origin rules, usage math and the waitlist.
- `test/ui`: the SPA in happy-dom with a fake `fetch`. Covers sign-in errors, the empty state and app
  creation, the plan limit and waitlist, create/reveal/revoke/edit of keys, and usage meters.
