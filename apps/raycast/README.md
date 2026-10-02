# Emojisense for Raycast

One command, **Search Emoji**. Type what you mean ("ship it", "lgtm", "greatest of all time",
"kolay gelsin") and get ranked emoji. Each row shows the emoji, its name and why it matched: the
alias phrase, the shortcode or "similar meaning" for a semantic result.

Search runs on your machine with the Emojisense engine and the data packs that ship in the
extension's `assets/` folder. It needs no network and no account.

| Key | Action |
| --- | ------ |
| `↵` | Paste the emoji into the active app (or copy, see preferences) |
| `⌘ ↵` | Copy the emoji (or paste) |
| `⌘ ⇧ C` | Copy the Emojibase hexcode, e.g. `1F680` |

## Preferences

| Preference | Default | Meaning |
| ---------- | ------- | ------- |
| Language | English | Labels and ranking. Every bundled language is always searched. |
| Primary Action | Paste | What `↵` does. |
| API URL | empty | Optional. With a URL, unsure queries also get semantic results from the Emojisense API. Must be `https://` (or `http://localhost`). |
| API Key | empty | Optional. A secret key (`sk_live_…`) is sent as `Authorization: Bearer`. A publishable key (`pk_live_…`) is sent as `?key=`. |

When the API fails, times out (4 s) or reports `overLimit`, the list keeps the offline results.

## Develop

```bash
pnpm install && pnpm data:build                  # once, from the repository root
pnpm --filter emojisense-search test             # format + API wrapper + pack loading (no network)
pnpm --filter emojisense-search typecheck
pnpm --filter emojisense-search build            # copy packs to assets/packs, then `ray build` to dist/
pnpm --filter emojisense-search dev              # `ray develop`: needs the Raycast app
```

`build`, `typecheck` and `test` do not need the Raycast app. `dev` opens the extension in Raycast
in development mode and rebuilds on save.

| Path | Purpose |
| ---- | ------- |
| `src/search-emoji.tsx` | The command: Raycast `List` and actions |
| `src/lib/use-emoji-search.ts` | React hook around the core search session (debounce, fusion, stale responses) |
| `src/lib/format.ts` | Result → list row: label, "why it matched", match kind |
| `src/lib/semantic.ts` | Optional API provider from the preferences: key handling, timeout |
| `src/lib/packs.ts` | Loads `assets/packs/` and caches the engine |
| `scripts/bundle-packs.mts` | Copies the current pack version from `packages/data/dist/packs/`, with the data license notices |
| `scripts/store-export.mts` | Writes the standalone Store project to `release/raycast/emojisense/` |

`assets/packs/` and `raycast-env.d.ts` are generated and not committed.

## Before a Store submission

The Raycast Store builds each extension as a standalone npm project. `pnpm package:raycast` (at the
repository root) writes that project to `release/raycast/emojisense/`:

- `name` is `emojisense` (here it is `emojisense-search`, because the monorepo already has a package
  called `emojisense`). `author` comes from `RAYCAST_AUTHOR`.
- `emojisense` comes from npm at the version of `packages/core`, so publish the npm packages first.
- `assets/packs/` holds the packs of all 11 languages (14 MB) and their license notices.
- The Raycast ESLint config, a Prettier config, the standard scripts and `CHANGELOG.md` are added.
  Tests and build scripts stay here.

Checked on 2026-10-02 with the core as a local tarball: `npm install`, `npm run fix-lint` (Prettier
lays out one union type differently from Biome), `ray lint` (only the placeholder `author` fails) and
`ray build` pass. The steps for the owner are in [RELEASING.md](../../RELEASING.md).
