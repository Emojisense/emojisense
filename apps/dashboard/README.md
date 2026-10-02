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
pnpm db:migrate                                  # local D1 for BOTH Workers (see below)
pnpm --filter @emojisense/dashboard dev          # builds the SPA, then wrangler dev on :8790
```

Open http://localhost:8790 and use **Sign in as dev user**. Each name is its own account, so two
names let you test that one account cannot see the other's apps.

### Local database (D1 migrations)

`wrangler dev` does not apply migrations. Run this once, and again after a new file appears in
`packages/platform/migrations`:

```bash
pnpm db:migrate
# = cd apps/dashboard && wrangler d1 migrations apply emojisense --local --persist-to ../../.wrangler/state
```

| Rule | Why |
| ---- | --- |
| Both Workers use `--persist-to ../../.wrangler/state` (package scripts and `.claude/launch.json`) | One state directory at the repo root |
| Both `wrangler.jsonc` files have the same placeholder `database_id` (`00000000-…`) | Wrangler names the local SQLite file after the id, so one apply serves both Workers |

`pnpm --filter @emojisense/worker db:migrate` applies the same files to the same database, so it
prints "No migrations to apply" after the first run. To start from an empty database, delete
`.wrangler/state/v3/d1` and apply again. Before a deploy, replace the placeholder id in both
`wrangler.jsonc` files with the id that `wrangler d1 create emojisense` prints, then run
`wrangler d1 migrations apply emojisense --remote` once.

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
| `WEBSITE_ORIGINS` | var | Comma-separated website origins that may POST `/api/waitlist` (CORS). A form post without JavaScript is sent back to the posting origin (the first one when there is no `Origin`). |
| `EMOJI` | R2 binding | Custom emoji images, bucket `emojisense-emoji`, shared with the API Worker |
| `API_URL` | var | The API Worker's origin; custom emoji `imageUrl`s point at it. Locally `http://localhost:8788`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | secrets | GitHub OAuth app |

## Behavior worth knowing

| Topic | Rule |
| ----- | ---- |
| Sessions | 32 random bytes in `es_session`: HttpOnly, SameSite=Lax, Secure except on localhost, 30 days. D1 stores only the SHA-256. |
| Writes | POST/PATCH/DELETE with an `Origin` other than the dashboard's own get 403, which also blocks same-site sibling domains. |
| Sign-in errors | Sign-in routes are navigations, so they redirect to `/?error=<code>` (`github_state`, `github_denied`, `github_failed`, `github_unconfigured`). |
| API errors | `{ "error": { "code", "message", "field"?, "plan"? } }` with 400, 401, 402, 403, 404, 405, 409, 410, 413, 415, 429 or 500. Plan gates throw `planRequired(plan, message)` (`src/worker/http.ts`) or call `requirePlan` (`src/worker/plans.ts`). |
| Access | `accessFor(db, accountId, appId)` in `src/worker/access.ts` is the single gate for app and key routes: `{ role, plan, app }` or `undefined`. `requireAppAccess(…, permission)` turns that into 404 (no access, same as missing) or 403 `forbidden_role`. Permissions: `view` (viewer), `edit` (developer), `manage_team` and `view_billing` (admin), `change_plan` (owner). |
| Account plan | `accounts.plan` (migration 0002). Apps get the owner's plan; the legacy `apps.plan` column is ignored. Only billing will change it; nothing in the dashboard does yet. |
| Team | Pro and Scale. A membership works only while the owner's plan includes team members; after a downgrade the rows stay and work again after an upgrade. Team and billing routes take `?owner=<accountId>` (default: the caller). Members list the owner first. |
| Invites | `/invite/<token>` links: 32 random bytes, D1 stores only the SHA-256, single use, 7 days. The optional email is a label and is not checked on accept. |
| Apps | `environment` is `prod` (default), `staging` or `dev`. Apps are created in the caller's own account. `maxApps` is checked inside the INSERT, so parallel requests cannot exceed it; past it, `402 plan_required` names the next plan with room. `PATCH` sets `name` and `emojiSet` (`native`, or `twemoji`/`noto`/`fluent` on Solo+). |
| Billing | No provider yet. `GET /api/billing` sums this month's `usage_monthly` over the account's own apps (custom emoji = rows stored now). `POST /api/billing/upgrade` only records the waitlist; it never charges and never changes the plan. |
| Keys | The create response is the only place the full key appears. D1 stores its SHA-256 and the first 12 characters. |
| Allowed origins | `https://host[:port]` or `https://*.example.com`; `http://` only for localhost; at most 20. A publishable key with no origins (any origin) is allowed only in `dev` apps. Secret keys have none. |
| Usage | `GET /api/apps/:id/usage?period=YYYY-MM` (UTC, default current month, no future months). Limits are per account, so `used` is the account's total over all of its apps and `appUsed` is this app's part. `status` is `ok`, `near_limit` (≥ 80%), `over_limit` (used ≥ limit) or `not_included` (limit 0). `limit: null` means unlimited. `custom_emoji` is the rows stored now (a stock, not a monthly counter), in every period. |
| Custom emoji | `src/worker/routes/emoji.ts` and `emoji-import.ts` on the shared platform storage (`custom-emoji*.ts`, `emoji-image.ts`), the same code as the tenants API. Images go to R2 `EMOJI`; `imageUrl` uses `API_URL`. The limit counts every emoji of the account. Uploads, imports and deletes emit `custom_emoji.*` webhooks. Slack and Discord tokens are used once and never stored or logged. |
| Analytics | `GET /api/apps/:id/analytics?days=7\|30\|90` (default 30) from `query_daily`. The window is cut to the owner account's `analyticsRetentionDays` and zero-filled. Top lists: 20 entries, only queries searched ≥ 5 times in the window. Plans without analytics get `402 { "error": { "code": "plan_required", "plan": "pro", "message" } }`. Every team role may read them. |
| Waitlist | Public and idempotent. New and known emails get the same answer. A repeat updates the plan and keeps the first date. JSON or an HTML form body; a form post without `Accept: application/json` gets `303` to `<website>/waitlist/?status=ok\|error` (`waitlistReturnUrl` in `@emojisense/platform`). The API Worker's daily cron deletes rows 12 months after the first date. |
| Account deletion | `DELETE /api/me { confirm }` (`src/worker/account-deletion.ts`). `confirm` is the account email, or `delete my account` without one. R2 images first (503 and no change on failure), then one D1 batch for every owned row, the waitlist entry and the sessions. The SPA has no button yet. |

## Tests

- `test/worker`: route handlers against `FakeD1`, which is real SQLite (`node:sqlite`) with the real
  migrations. Covers auth and sessions, GitHub OAuth (mocked fetch), ownership, the key
  lifecycle, origin rules, usage math, the waitlist, roles on every app and key route
  (`access.test.ts`), team invites and members (`team.test.ts`), billing, and plan gates.
- `test/ui`: the SPA in happy-dom with a fake `fetch`. Covers sign-in errors, the empty state and app
  creation, the plan limit and waitlist, create/reveal/revoke/edit of keys, and usage meters.
