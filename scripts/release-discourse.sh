#!/usr/bin/env bash
# Publish the Discourse theme component (apps/discourse/dist/theme) as its own repository:
# Discourse installs a theme from the root of a git repository. Only the owner runs this; it pushes
# to the theme repository.
#
#   scripts/release-discourse.sh <version> [repository-url]
#   scripts/release-discourse.sh 0.1.0 git@github.com:emojisense/discourse-emojisense.git
#
# It builds the theme, replaces the repository's files with the build, commits and tags <version>.
# Sites that installed the component from git get the update with Discourse's daily check.
set -euo pipefail

version="${1:?usage: scripts/release-discourse.sh <version> [repository-url]}"
mirror="${2:-git@github.com:emojisense/discourse-emojisense.git}"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release-discourse: '$version' is not a semantic version like 0.1.0" >&2
  exit 1
fi
cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain -- apps/discourse)" ]]; then
  echo "release-discourse: apps/discourse has uncommitted changes" >&2
  exit 1
fi
if ! grep -q "\"theme_version\": \"$version\"" apps/discourse/theme/about.json; then
  echo "release-discourse: set \"theme_version\": \"$version\" in apps/discourse/theme/about.json first" >&2
  exit 1
fi
if git ls-remote --exit-code --tags "$mirror" "refs/tags/$version" >/dev/null 2>&1; then
  echo "release-discourse: $mirror already has the tag $version" >&2
  exit 1
fi

pnpm --filter @emojisense/discourse build

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
if git ls-remote --exit-code --heads "$mirror" main >/dev/null 2>&1; then
  git clone --quiet --depth 1 "$mirror" "$work"
else
  git init --quiet -b main "$work"
  git -C "$work" remote add origin "$mirror"
fi
find "$work" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R apps/discourse/dist/theme/. "$work/"
git -C "$work" add -A
git -C "$work" commit --quiet -m "Emojisense $version (emojisense $(git rev-parse --short HEAD))"
git -C "$work" tag "$version"
git -C "$work" push origin main "refs/tags/$version"
echo "release-discourse: pushed $version to $mirror"
