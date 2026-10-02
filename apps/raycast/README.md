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
| Language | English | Labels and ranking. English and Turkish are always both searched. |
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
| `scripts/bundle-packs.mts` | Copies the current pack version from `packages/data/dist/packs/` |

`assets/packs/` and `raycast-env.d.ts` are generated and not committed.

## Before a Store submission

The Raycast Store builds each extension as a standalone npm project. Before a submission:

1. Replace `"emojisense": "workspace:*"` with a published version and add a `package-lock.json`.
2. Commit `assets/packs/` (the Store does not run `bundle-packs`).
3. Set `author` to the owner's Raycast handle and pick the final `name` (`emojisense-search` here,
   because the monorepo already has a package called `emojisense`).
4. Add the Raycast ESLint config if the Store review requires `ray lint`. This repository lints with
   Biome.
