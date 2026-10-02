# Emojisense dashboard

Developers sign in with Clerk (email or a social account), create apps, create and revoke API
keys, and watch usage against their plan. One Cloudflare Worker serves the SPA as static assets
and runs only for `/api/*` (`run_worker_first`). It shares the D1 schema in
`packages/platform/migrations` with the API Worker. The API contract is the "Dashboard API"
section of [docs/API.md](../../docs/API.md).

```
browser ──▶ /apps, /assets/*        ──▶ static assets (free, no Worker)
   │    └─▶ /api/* + Bearer token   ──▶ Worker (src/worker) ──▶ D1 "emojisense"
   │                                     checks the Clerk token with the public JWT key:
   │                                     no network call, no secret
   └──────▶ Clerk Frontend API      ──▶ clerk-js and Clerk's UI, sign-in, token refresh
            (clerk.emojisense.com in production)
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
names let you test that one account cannot see the other's apps. This needs no Clerk keys, and
neither does mock mode (`pnpm --filter @emojisense/dashboard dev:mock`, fixtures instead of the
Worker).

To try Clerk locally, use the development instance: put `VITE_CLERK_PUBLISHABLE_KEY` in
`apps/dashboard/.env.local` (read at build time) and fill the Clerk lines of `.dev.vars`. The
SPA at http://localhost:8790 then shows Clerk's sign-in next to the dev sign-in.

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
- If port 8790 is taken, run `pnpm --filter @emojisense/dashboard dev --port 8796`. With Clerk,
  the default authorized party is the page's own origin, so no other change is needed.
- Dev sign-in needs `ENVIRONMENT=development` **and** a localhost URL. In production it answers
  404.

## Clerk

Sign-in runs on [Clerk](https://clerk.com). The dashboard needs only public values from it; the
secret key is optional.

| Instance | Used by | Publishable key | Frontend API |
| -------- | ------- | --------------- | ------------ |
| Development | localhost, app.emojisense.dev | `pk_test_ZmVhc2libGUtYmxvd2Zpc2gtOTY4MC5jbGVyay5hY2NvdW50cy5kZXYk` | `feasible-blowfish-9680.clerk.accounts.dev` |
| Production (domain `emojisense.com`) | app.emojisense.com | `pk_live_…` (after the DNS check) | `clerk.emojisense.com`; Account Portal `accounts.emojisense.com` |

Set these in the Clerk Dashboard, for each instance:

1. **Sessions → Customize session token → Claims.** The Worker reads the email and the name
   from the token, so it never calls Clerk's Backend API:

   ```json
   {
     "email": "{{user.primary_email_address}}",
     "email_verified": "{{user.email_verified}}",
     "name": "{{user.full_name || user.username}}"
   }
   ```

   Without these claims (or without a verified email) a new user gets `403 email_required` and
   no account: the email links legacy accounts, matches invites and confirms deletion.
2. **User & authentication:** email address on, required, and verified at sign-up. Social
   connections are optional (production needs your own OAuth credentials for each one). Turn on
   "allow users to delete their accounts", so that Settings → Delete account can delete the
   Clerk user with Clerk JS.
3. **API keys → Show JWT public key → PEM:** this is `CLERK_JWT_KEY`. It is public.
4. **Production only, Domains:** add the DNS records that the page lists for `emojisense.com`
   (CNAMEs for `clerk` (Frontend API), `accounts` (Account Portal) and the email records). In
   Cloudflare DNS, set them to **DNS only**, not proxied, or Clerk's DNS check fails. Then deploy
   the certificates.

The dashboard renders Clerk's combined sign-in and sign-up form on its own pages (hash routing),
so Clerk's paths stay at their defaults. The app is on the instance's domain (app.emojisense.com
on emojisense.com), so no satellite domain and no extra allowed origin are needed; the
development instance accepts any origin.

How the Worker checks a request (`src/worker/clerk.ts`): `Authorization: Bearer <token>` from
Clerk's `getToken()`; signature with `CLERK_JWT_KEY` (`verifyJwt` from `@clerk/backend/jwt`);
`azp` in `CLERK_AUTHORIZED_PARTIES` (default: the dashboard's own origin); `iss` is the Frontend
API in `CLERK_PUBLISHABLE_KEY`; `exp`/`nbf`; the session is not `pending`. Cookies are not read.

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
| `CLERK_PUBLISHABLE_KEY` | var (public) | The Clerk instance. The Worker derives the token issuer from it. |
| `CLERK_JWT_KEY` | var (public) | The instance's JWT public key (PEM; newlines may be `\n` or left out). Verifies sessions without a network call. |
| `CLERK_AUTHORIZED_PARTIES` | var | Comma-separated origins whose tokens count (`azp`), e.g. `https://app.emojisense.com`. Default: the dashboard's own origin. |
| `CLERK_SECRET_KEY` | secret, optional | Only lets `DELETE /api/me` delete the Clerk user on the server. Without it the SPA does that with Clerk JS. |
| `ADMIN_EMAILS` | secret | Comma-separated emails of the accounts that see the internal Culture page, compared with the session's verified email claim. A secret so no email is in git: `wrangler secret put ADMIN_EMAILS --env <env>`. |
| `CULTURE_ADMIN` | service binding | The API Worker's `CultureAdmin` RPC entrypoint (`emojisense-api`, `-dev`, `-production`). Not reachable from the internet. Without it the Culture page answers 503. |
| `VITE_CLERK_PUBLISHABLE_KEY` | build-time env | The same publishable key for the SPA. The `_headers` CSP allows exactly that instance's Frontend API. Without it the build offers only the localhost dev sign-in. |

## Behavior worth knowing

| Topic | Rule |
| ----- | ---- |
| Sign-in | A Clerk session token on every API call (see [Clerk](#clerk)); 401 without a valid one. The SPA asks `GET /api/me` once Clerk has loaded and again when Clerk's user changes. A 401 or `email_required` while Clerk has a session shows "We could not open your account" with Try again and Sign out, so a setup mistake cannot loop; so does a sign-out that Clerk refused. If clerk-js does not load (Clerk's status event says `error`), the app says so instead of spinning. After sign-in Clerk always goes to `/` (forced redirect URLs, so a `redirect_url` in the query is ignored). |
| Accounts | The first request of a Clerk user creates the account from the claims; it needs a verified email (`403 email_required` otherwise). `account_created` is logged with `verifiedEmail: true/false` only. Name and email then follow the claims; only a verified email is stored, and an email that another account has stays out (UNIQUE). A legacy GitHub account with the same verified email moves to Clerk once (`accounts.clerk_user_id`, migration 0003). |
| Dev sign-in | `/api/auth/dev?login=<name>` sets `es_dev_account` (the account id, HttpOnly). It works only with `ENVIRONMENT=development` on localhost, and never opens an account that has a Clerk user. |
| Writes | POST/PATCH/DELETE with an `Origin` other than the dashboard's own get 403, which also blocks same-site sibling domains. |
| CSP | `vite.config.ts` emits `_headers` from `static-headers.ts`. With a Clerk key it adds only Clerk's sources: the Frontend API (script, connect), `img.clerk.com`, Cloudflare Turnstile and `*.protect.clerk.com` (script, frame, connect), `worker-src 'self' blob:`, and `style-src 'unsafe-inline'` (Clerk's CSS-in-JS). |
| API errors | `{ "error": { "code", "message", "field"?, "plan"? } }` with 400, 401, 402, 403, 404, 405, 409, 410, 413, 415, 429 or 500. Plan gates throw `planRequired(plan, message)` (`src/worker/http.ts`) or call `requirePlan` (`src/worker/plans.ts`). |
| Access | `accessFor(db, accountId, appId)` in `src/worker/access.ts` is the single gate for app and key routes: `{ role, plan, app }` or `undefined`. `requireAppAccess(…, permission)` turns that into 404 (no access, same as missing) or 403 `forbidden_role`. Permissions: `view` (viewer), `edit` (developer), `manage_team` and `view_billing` (admin), `change_plan` (owner). |
| Account plan | `accounts.plan` (migration 0002). Apps get the owner's plan; the legacy `apps.plan` column is ignored. Only billing will change it; nothing in the dashboard does yet. |
| Team | Pro and Scale. A membership works only while the owner's plan includes team members; after a downgrade the rows stay and work again after an upgrade. Team and billing routes take `?owner=<accountId>` (default: the caller). Members list the owner first. |
| Invites | `/invite/<token>` links: 32 random bytes, D1 stores only the SHA-256, single use, 7 days. With an email, only a caller whose verified email (the claim) matches can accept (`403 invite_email_mismatch`); without one, anyone with the link. |
| Apps | `environment` is `prod` (default), `staging` or `dev`. Apps are created in the caller's own account. `maxApps` is checked inside the INSERT, so parallel requests cannot exceed it; past it, `402 plan_required` names the next plan with room. `PATCH` sets `name` and `emojiSet` (`native`, or `twemoji`/`noto`/`fluent` on Solo+). |
| Billing | No provider yet. `GET /api/billing` sums this month's `usage_monthly` over the account's own apps (custom emoji = rows stored now). `POST /api/billing/upgrade` only records the waitlist; it never charges and never changes the plan. |
| Keys | The create response is the only place the full key appears. D1 stores its SHA-256 and the first 12 characters. |
| Allowed origins | `https://host[:port]` or `https://*.example.com`; `http://` only for localhost; at most 20. A publishable key with no origins (any origin) is allowed only in `dev` apps. Secret keys have none. |
| Usage | `GET /api/apps/:id/usage?period=YYYY-MM` (UTC, default current month, no future months). Limits are per account, so `used` is the account's total over all of its apps and `appUsed` is this app's part. `status` is `ok`, `near_limit` (≥ 80%), `over_limit` (used ≥ limit) or `not_included` (limit 0). `limit: null` means unlimited. `custom_emoji` is the rows stored now (a stock, not a monthly counter), in every period. |
| Custom emoji | `src/worker/routes/emoji.ts` and `emoji-import.ts` on the shared platform storage (`custom-emoji*.ts`, `emoji-image.ts`), the same code as the tenants API. Images go to R2 `EMOJI`; `imageUrl` uses `API_URL`. The limit counts every emoji of the account. Uploads, imports and deletes emit `custom_emoji.*` webhooks. Slack and Discord tokens are used once and never stored or logged. |
| Analytics | `GET /api/apps/:id/analytics?days=7\|30\|90[&country=BR][&locale=pt]` (default 30) from `query_daily`. The window is cut to the owner account's `analyticsRetentionDays` and zero-filled. Top lists: 20 entries, only queries searched ≥ 5 times in the window (and filter). `countries` and `locales`: up to 50 each; each follows the other filter only. Plans without analytics get `402 { "error": { "code": "plan_required", "plan": "pro", "message" } }`. Every team role may read them. |
| Waitlist | Public and idempotent. New and known emails get the same answer. A repeat updates the plan and keeps the first date. JSON or an HTML form body; a form post without `Accept: application/json` gets `303` to `<website>/waitlist/?status=ok\|error` (`waitlistReturnUrl` in `@emojisense/platform`). The API Worker's daily cron deletes rows 12 months after the first date. |
| Culture page | `/internal/culture`, shown only when `GET /api/admin` says `admin: true` (verified email in `ADMIN_EMAILS`). Every `/api/admin/culture/*` route answers 404 to anyone else. The API Worker does the work (`packages/worker/src/culture-admin`): drafts from the nightly job, a live preview per trigger, locale and region, edits, approve or reject with a reason, retire, "Publish now" (R2), and the export that `pnpm --filter @emojisense/data culture:import-live` writes to git. Approvals record the account's name as `reviewedBy`, never an email. |
| Account deletion | `DELETE /api/me { confirm }` (`src/worker/account-deletion.ts`). `confirm` is the account email, or `delete my account` without one. R2 images first (503 and no change on failure), then one D1 batch for every owned row, the waitlist entry and legacy session rows. Then the Clerk user: the Worker deletes it when it has `CLERK_SECRET_KEY` (`clerkUserDeleted: true`), else the dialog calls Clerk's `user.delete()`. If Clerk refuses, the dialog says so. The Clerk user id stays in `deleted_clerk_users` for 10 minutes, so a token issued before the deletion (valid up to 60 s) gets 401 instead of a new, empty account. Settings → "Delete account" enables the button only when the typed text matches (`isDeleteAccountConfirmed`), then signs out. |

## Tests

- `test/worker`: route handlers against `FakeD1`, which is real SQLite (`node:sqlite`) with the real
  migrations. Covers Clerk sessions with an injected fake verifier (`clerk-fake.ts`: signed in,
  signed out, wrong authorized party, pending session, first sign-in, claim changes, legacy
  accounts), the real verifier with a key pair made in the test (`clerk.test.ts`, no secret key,
  no network), dev sign-in, the CSP, ownership, the key lifecycle, origin rules, usage math, the
  waitlist, roles on every app and key route (`access.test.ts`), team invites by verified email
  and members (`team.test.ts`), account deletion with and without the secret key, billing, and
  plan gates.
- `test/ui`: the SPA in happy-dom with a fake `fetch`, and `@clerk/react` mocked in
  `clerk.test.tsx` (Clerk's sign-in when signed out, the bearer token on every call, sign-out,
  account deletion through Clerk JS). Also covers the empty state and app creation, the plan
  limit and waitlist, create/reveal/revoke/edit of keys, and usage meters.
