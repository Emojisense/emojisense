#!/usr/bin/env bash
# Publish sdks/swift as the Swift package repository (Swift Package Manager needs Package.swift at
# the root of a repository). Only the owner runs this; it pushes to the mirror repository.
#
#   scripts/release-swift.sh <version> [mirror-url]
#   scripts/release-swift.sh 0.1.0 git@github.com:emojisense/emojisense-swift.git
#
# It splits the history of sdks/swift into its own commits (git subtree split; no local branch is
# created), pushes them to the mirror's main branch and tags that commit with <version>. SwiftPM
# resolves `from: "0.1.0"` against these tags. A tag is never moved: release a new version instead.
set -euo pipefail

version="${1:?usage: scripts/release-swift.sh <version> [mirror-url]}"
mirror="${2:-git@github.com:emojisense/emojisense-swift.git}"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release-swift: '$version' is not a semantic version like 0.1.0 (SwiftPM tags have no v prefix)" >&2
  exit 1
fi
cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain -- sdks/swift)" ]]; then
  echo "release-swift: sdks/swift has uncommitted changes" >&2
  exit 1
fi
if git ls-remote --exit-code --tags "$mirror" "refs/tags/$version" >/dev/null 2>&1; then
  echo "release-swift: $mirror already has the tag $version" >&2
  exit 1
fi

commit="$(git subtree split --prefix=sdks/swift HEAD)"
echo "release-swift: sdks/swift at $(git rev-parse --short HEAD) is $commit in the mirror"
git push "$mirror" "$commit:refs/heads/main"
git push "$mirror" "$commit:refs/tags/$version"
echo "release-swift: pushed $version to $mirror"
