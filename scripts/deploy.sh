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
    PUBLISHABLE_KEY="${PUBLIC_PUBLISHABLE_KEY:-pk_demo}"
    ;;
  production)
    DOMAIN="emojisense.com"
    INDEXABLE="true"
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
pnpm -C "$ROOT" --filter @emojisense/worker sync

echo "→ API Worker ($API_URL)"
cd "$ROOT/packages/worker"
pnpm exec wrangler d1 migrations apply DB --remote --env "$ENVIRONMENT"
pnpm exec wrangler deploy --env "$ENVIRONMENT"

echo "→ Dashboard ($DASHBOARD_URL)"
cd "$ROOT/apps/dashboard"
VITE_API_URL="$API_URL" pnpm exec vite build
[ "$INDEXABLE" = "false" ] && no_index dist/client
pnpm exec wrangler deploy --env "$ENVIRONMENT"

echo "→ Website ($SITE_URL)"
cd "$ROOT/apps/web"
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
