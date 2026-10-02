#!/usr/bin/env bash
# Deploys the API Worker, the dashboard and the website to one environment.
#   pnpm deploy:dev          → emojisense.dev (internal, noindex)
#   pnpm deploy:production   → emojisense.com (needs the site key: scripts/create-site-key.mjs)
# Each Worker reads its bindings from the matching `env.<name>` block of its wrangler.jsonc.
set -euo pipefail

ENVIRONMENT="${1:?usage: scripts/deploy.sh dev|production}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Per-environment settings that are not in git (.deploy/<env>.env, see scripts/create-site-key.mjs).
if [ -f "$ROOT/.deploy/$ENVIRONMENT.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT/.deploy/$ENVIRONMENT.env"
  set +a
fi
case "$ENVIRONMENT" in
  dev)
    DOMAIN="emojisense.dev"
    INDEXABLE="false"
    CLERK_PUBLISHABLE_KEY="pk_test_ZmVhc2libGUtYmxvd2Zpc2gtOTY4MC5jbGVyay5hY2NvdW50cy5kZXYk"
    PUBLISHABLE_KEY="${PUBLIC_PUBLISHABLE_KEY:-pk_demo}"
    ;;
  production)
    DOMAIN="emojisense.com"
    INDEXABLE="true"
    CLERK_PUBLISHABLE_KEY="pk_live_Y2xlcmsuZW1vamlzZW5zZS5jb20k"
    PUBLISHABLE_KEY="${PUBLIC_PUBLISHABLE_KEY:?run node scripts/create-site-key.mjs production first}"
    ;;
  *)
    echo "Unknown environment \"$ENVIRONMENT\". Use dev or production." >&2
    exit 1
    ;;
esac

SITE_URL="https://$DOMAIN"
API_URL="https://api.$DOMAIN"
DASHBOARD_URL="https://app.$DOMAIN"

# Internal environments must never be indexed: header on every response, next to robots.txt.
no_index() {
  printf '\n/*\n  X-Robots-Tag: noindex, nofollow\n' >>"$1/_headers"
}

echo "→ Build packages and data"
pnpm -C "$ROOT" exec turbo run build --filter=emojisense --filter=@emojisense/platform --filter=@emojisense/data
# Vectors come from the embedding cache; only changed documents call Workers AI.
pnpm -C "$ROOT" --filter @emojisense/data embed -- --models bge-m3 --dims 1024
pnpm -C "$ROOT" --filter @emojisense/data embed:glyph
pnpm -C "$ROOT" --filter @emojisense/worker sync

echo "→ API Worker ($API_URL)"
cd "$ROOT/packages/worker"
# The D1 API sometimes fails for a moment; migrations are idempotent, so retry.
for attempt in 1 2 3; do
  pnpm exec wrangler d1 migrations apply DB --remote --env "$ENVIRONMENT" && break
  [ "$attempt" = 3 ] && exit 1
  echo "D1 migrations failed (attempt $attempt), retrying in 10 s…" >&2
  sleep 10
done
pnpm exec wrangler deploy --env "$ENVIRONMENT"

echo "→ Dashboard ($DASHBOARD_URL)"
cd "$ROOT/apps/dashboard"
VITE_API_URL="$API_URL" VITE_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY" pnpm exec vite build
[ "$INDEXABLE" = "false" ] && no_index dist/client
# Whop billing: public settings as vars and secrets as Worker secrets, both from .deploy/<env>.env
# (scripts/whop-setup.mjs writes them). Values are never echoed.
whop_vars=()
for name in WHOP_API_BASE WHOP_COMPANY_ID WHOP_PLAN_IDS; do
  if [ -n "${!name:-}" ]; then whop_vars+=(--var "$name:${!name}"); fi
done
for name in WHOP_API_KEY WHOP_WEBHOOK_SECRET; do
  if [ -n "${!name:-}" ]; then
    printf '%s' "${!name}" | pnpm exec wrangler secret put "$name" --env "$ENVIRONMENT" >/dev/null
  fi
done
pnpm exec wrangler deploy --env "$ENVIRONMENT" ${whop_vars[@]+"${whop_vars[@]}"}

echo "→ Website ($SITE_URL)"
cd "$ROOT/apps/web"
# Local preview pages (gitignored) must never ship.
if [ -d src/pages/dev ]; then
  echo "apps/web/src/pages/dev exists (local preview pages). Move it out before deploying." >&2
  exit 1
fi
PUBLIC_SITE_URL="$SITE_URL" \
  PUBLIC_API_URL="$API_URL" \
  PUBLIC_DASHBOARD_URL="$DASHBOARD_URL" \
  PUBLIC_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" \
  PUBLIC_INDEXABLE="$INDEXABLE" \
  pnpm exec astro build
[ "$INDEXABLE" = "false" ] && no_index dist
pnpm exec wrangler deploy --env "$ENVIRONMENT"

echo "✓ Deployed $ENVIRONMENT: $SITE_URL · $API_URL · $DASHBOARD_URL"

# Read-only checks of what is now live (scripts/smoke.mjs). The deploy is done either way; a
# failed check only makes this command exit non-zero.
echo "→ Smoke test ($ENVIRONMENT)"
if ! node "$ROOT/scripts/smoke.mjs" "$ENVIRONMENT"; then
  echo "✘ $ENVIRONMENT is deployed, but the smoke test failed. See the FAIL lines above." >&2
  exit 1
fi
