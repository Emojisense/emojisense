# Releasing

Only the owner publishes. Every command below that publishes or pushes says so. The other commands
build and check artifacts on this machine.

| Artifact | Build and check | Publish | The owner needs |
| -------- | --------------- | ------- | --------------- |
| 9 npm packages: `emojisense`, `@emojisense/{react,web-component,mcp,emoji-mart,lexical,tiptap,ckeditor5,tinymce}` | `pnpm release:check` | `pnpm release:publish` | npm account with 2FA, npm org `emojisense` |
| Chrome extension | `pnpm package:chrome` → `release/chrome/emojisense-chrome-<version>.zip` | Upload in the Chrome Web Store dashboard | Chrome Web Store developer account (one-time fee), screenshots, promo tile |
| Raycast extension | `pnpm package:raycast` → `release/raycast/emojisense/` | `npm run publish` in that folder (opens a pull request on raycast/extensions) | Raycast account, `emojisense` on npm first, screenshots |
| Swift package | `cd sdks/swift && swift build && swift test` | `scripts/release-swift.sh <version>` | GitHub repository `emojisense/emojisense-swift` |
| WordPress plugin | `pnpm --filter @emojisense/wordpress-plugin release` → `apps/wordpress-plugin/release/emojisense-<version>.zip`, then `e2e` and `e2e:forums` | WordPress.org SVN (see `apps/wordpress-plugin/README.md`) | WordPress.org account, plugin slug `emojisense` |
| Discourse theme component | `pnpm --filter @emojisense/discourse build` → `apps/discourse/dist/theme`, then `e2e` on a site with it | `scripts/release-discourse.sh <version>` (PUSHES) | GitHub repository `emojisense/discourse-emojisense`, a Meta topic in Theme component |

`release/` is gitignored.

## npm packages

### Day to day

Each pull request that changes a public package adds a changeset: `pnpm changeset`, choose the
packages and the bump, write one or two sentences for the changelog. The first changesets
(`.changeset/first-release-*.md`) make every package 0.1.0.

### One-time setup

1. Create an npm account and turn on two-factor authentication (security key or authenticator app).
2. Create the free npm organization `emojisense` (npmjs.com → Add Organization). Without it,
   `@emojisense/*` cannot be published.
3. The unscoped name `emojisense`: npm shows it as published in 2018 (0.4.0) and 2023 (0.10.0) by
   someone else and unpublished on 2023-06-06. No one holds it now, and npm frees a fully
   unpublished name after 24 hours, so it can be published again. `changeset publish-plan` lists
   `emojisense@0.1.0` as publishable. npm never allows a version twice, so **0.4.0 and 0.10.0 of
   `emojisense` can never be published**: skip them (for example 0.3.x → 0.5.0). If npm refuses the
   name at the first publish, use the fallback `@emojisense/core`: rename `packages/core` and replace
   the `emojisense` imports and dependencies in the repository, then publish again. Publish soon:
   until then anyone can take the free name.

### First release (from this machine)

npm can trust a CI workflow only for a package that exists, so the first release is manual.

```bash
npm login                       # the session needs 2FA for each publish
pnpm release:version            # 0.0.0 → 0.1.0, writes packages/*/CHANGELOG.md
git commit -am "Version the npm packages: 0.1.0"
pnpm release:publish            # PUBLISHES. Add --otp <code> or answer the 2FA prompt.
git push --follow-tags          # PUSHES the commit and the tags emojisense@0.1.0, @emojisense/…@0.1.0
```

`pnpm release:publish` first runs `scripts/release-check.mjs --build --strict`: it cleans `dist/`,
builds without the turbo cache, typechecks, tests, compiles the README samples
(`pnpm check:readmes`) and packs each package. It stops on source maps, `src/`, tests, fixtures, env
files, a missing README or LICENSE, missing metadata, a `workspace:` range left in a dependency, an
export target outside the tarball, or version 0.0.0. Then `changeset publish` runs `pnpm publish`
for each package that npm does not have yet, and creates the git tags. A local publish has no
provenance statement; the next releases get one from CI.

Tarballs (2026-10-02, packed by `pnpm release:check`):

| Package | Tarball | Unpacked | Files |
| ------- | ------: | -------: | ----: |
| `emojisense` | 37.4 KB | 113.1 KB | 41 |
| `@emojisense/react` | 11.2 KB | 36.7 KB | 11 |
| `@emojisense/web-component` | 29.5 KB | 93.3 KB | 12 |
| `@emojisense/mcp` | 4,105 KB | 14,204 KB | 47 (the packs of 11 languages are 22 of them) |
| `@emojisense/emoji-mart` | 7.7 KB | 24.1 KB | 11 |
| `@emojisense/lexical` | 10.8 KB | 33.4 KB | 16 |
| `@emojisense/tiptap` | 11.2 KB | 36.8 KB | 14 |
| `@emojisense/ckeditor5` | 4.9 KB | 12.4 KB | 9 |
| `@emojisense/tinymce` | 22.9 KB | 58.4 KB | 12 (with `dist/plugin.min.js` for `external_plugins`) |

`pnpm release:check --files` lists every file.

### Later releases: CI with provenance

1. Make the GitHub repository public. npm adds provenance only for public repositories.
2. Trust the release workflow once per package (npm 11.5.1 or later):

   ```bash
   for pkg in emojisense @emojisense/react @emojisense/web-component @emojisense/mcp \
     @emojisense/emoji-mart @emojisense/lexical @emojisense/tiptap @emojisense/ckeditor5 \
     @emojisense/tinymce; do
     npm trust github "$pkg" --repo emojisense/emojisense --file release.yml --env npm
   done
   ```

3. In GitHub, create the environment `npm` (Settings → Environments). Add yourself as a required
   reviewer, so each release waits for your approval.
4. For each release: `pnpm release:version`, commit, merge into `main`, then start the `release`
   workflow (Actions → release → Run workflow). It runs the same `pnpm release:publish` with
   `NPM_CONFIG_PROVENANCE=true`, an OIDC token instead of an npm token, and pushes the tags.
5. After the first CI release, set each package to "Require two-factor authentication and disallow
   tokens" on npmjs.com (Settings → Publishing access). Trusted publishing still works.

## Chrome Web Store

```bash
pnpm data:build          # if packages/data/dist is missing
pnpm package:chrome      # → release/chrome/emojisense-chrome-0.1.0.zip (909 KB, 29 files)
```

The check in `apps/chrome-extension/scripts/package.ts` fails on any permission other than the four
below, on host permissions, content scripts, web-accessible resources, a CSP with remote or eval'd
code, a missing icon, source maps or remote script loads. The version comes from
`apps/chrome-extension/package.json` (bump it for each upload; the store refuses a version twice).

1. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
   (one-time registration fee, 2-step verification on the Google account).
2. New item → upload the zip.
3. Fill in the listing, privacy and distribution tabs with the text below. Submit for review.

### Images

| Image | Requirement | Status |
| ----- | ----------- | ------ |
| Extension icons 16, 32, 48, 128 | PNG, in the zip | Done (drawn by `scripts/icons.ts`) |
| Store icon | 128 × 128 PNG; the guideline is 96 × 96 artwork with 16 px transparent padding | Upload `dist/icons/icon-128.png`. Its artwork fills about 112 px; redraw with more padding if the review asks |
| Screenshots | 1 to 5, 1280 × 800 (or 640 × 400), PNG or JPEG, full bleed | **To do:** the picker on a mail composer, on a comment box, the settings page |
| Small promo tile | 440 × 280 PNG or JPEG | **To do** |
| Marquee promo tile | 1400 × 560, optional | Optional |

### Listing text

**Name:** Emojisense

**Summary** (the manifest `description`, 132 characters at most):

> Type what you mean, get the emoji. A picker for any text field; works offline.

**Category:** Productivity → Tools (or Workflow & Planning). **Language:** English.

**Description:**

> Emojisense is an emoji picker for any text field that understands what you mean.
>
> Put the caret in a text field, press Ctrl+Shift+Space (⌘⇧Space on a Mac) or click the toolbar
> button, and type what you mean: "ship it" gives 🚀, "jurassic park" gives 🦖, "greatest of all
> time" gives 🐐, "kolay gelsin" gives 💪. Press Enter, and the emoji goes in at the caret.
>
> • Search by meaning, slang, names and shortcodes. Small typos are fine.
> • English and Turkish. Search runs on your computer: the engine and its dictionary are inside
>   the extension.
> • Works in text fields and rich editors: mail composers, comment boxes, chat apps. Where an app
>   does not accept inserted text (Google Docs, canvas apps), Emojisense copies the emoji and tells
>   you to paste.
> • Recently used emoji, skin tones, light and dark themes, full keyboard and screen reader support.
> • It runs on a page only after you press the shortcut or click its button. It cannot read your
>   browsing, and it needs no account.
>
> Optional: "Search by meaning" in the settings adds results from the Emojisense API (or your own
> server) for searches the offline dictionary is unsure about. It is off by default.
>
> Open source (MIT): https://github.com/emojisense/emojisense

### Privacy tab

**Single purpose:** Find an emoji by what the user means and insert it into the focused text field.

| Permission | Justification |
| ---------- | ------------- |
| `activeTab` | After the user presses the shortcut or clicks the toolbar button, the extension shows the picker in the current tab and inserts the chosen emoji. It has no host permissions and runs on no page by itself. |
| `scripting` | Injects the picker into the current tab after that shortcut or click (together with activeTab). |
| `storage` | Keeps the user's settings and recently used emoji on the device. |
| `clipboardWrite` | Copies the chosen emoji where a page does not accept inserted text (Google Docs, canvas apps, password fields). |

**Remote code:** No. All code is in the package; the extension pages use `script-src 'self'`.

**Data usage:** In the default setup the extension sends nothing: search, settings and recently used
emoji stay on the device. When the user turns on "Search by meaning" and enters an API address and a
publishable key, the extension sends the search text of unsure searches to that address. Tick no
category for the default setup. The store has no category for search terms; if the review asks,
"User activity" is the closest. Certify: no sale of data, no use unrelated to the single purpose, no
use for creditworthiness or lending.

**Privacy policy URL:** https://emojisense.com/legal/privacy/

The policy covers what the API keeps for a search ("Searches that reach the API": the normalized
text, at most 64 characters, with no IP address, key or user id, for 3 months). It does not name
the extensions yet. Proposed addition for the policy owner (not made here; legal text needs review):

> ### Browser and Raycast extensions
>
> The Emojisense extensions for Chrome and Raycast search on your device. Settings and recently
> used emoji stay on your device. They send a search to the API only when you turn on the optional
> search by meaning and enter an API address; then the rules in "Searches that reach the API"
> apply.

## Raycast Store

```bash
pnpm data:build                              # if packages/data/dist is missing
RAYCAST_AUTHOR=<your-raycast-username> pnpm package:raycast   # → release/raycast/emojisense/
cd release/raycast/emojisense
npm install          # after `emojisense` is on npm; creates package-lock.json
npm run fix-lint     # Prettier lays out one union type differently from Biome
npm run lint && npm run build
npm run dev          # opens it in Raycast; take the screenshots now (below)
npm run publish      # PUBLISHES: forks raycast/extensions and opens a pull request
```

Checked on 2026-10-02 with the core as a local tarball: install, `fix-lint`, `lint` and `build`
pass; only the placeholder author fails `ray lint` (`author` must be a Raycast username).

| Item | Requirement | Status |
| ---- | ----------- | ------ |
| `author` | Your Raycast username | `RAYCAST_AUTHOR` |
| Icon | 512 × 512 PNG, good in light and dark | `assets/extension-icon.png`, 512 × 512 |
| Screenshots | Up to 6 (3 recommended), 2000 × 1250 PNG, in `metadata/` | **To do:** in development mode, use Raycast's Window Capture (it saves to `metadata/`): "ship it", "greatest of all time", the preferences |
| `CHANGELOG.md` | `## [Initial Version] - {PR_MERGE_DATE}` | Done |
| Categories, title, command title | Title Case, `<verb> <noun>` | "Emojisense", "Search Emoji", Productivity + Communication |
| `@raycast/api` | The latest version at submission | 2.5.1 pinned; bump it in `apps/raycast/package.json` before export if the review asks |
| Localization | US English UI only | The UI is English. The Language preference changes emoji labels (data), not the UI; mention it in the pull request |
| Size | No fixed limit; the Store repository reviews large assets | `assets/packs` holds all 11 languages (14 MB raw), because the extension searches every bundled language. **Owner decision:** to ship only English and Turkish (2 MB, the two label languages), filter the files in `apps/raycast/scripts/bundle-packs.mts` |

**Store text:** title "Emojisense", description "Search emoji by meaning, slang and intent: "ship
it" → 🚀, "lgtm" → 👍. Works offline." (from `apps/raycast/package.json`). The export's README is the
Store page; it has a privacy section that matches the policy: nothing leaves the computer without an
API URL, and with one, unsure searches go to that address.

## Swift package

SwiftPM needs `Package.swift` at the root of a repository, so the package lives in a mirror.

1. Create the empty public repository `emojisense/emojisense-swift` on GitHub.
2. `scripts/release-swift.sh 0.1.0` (PUSHES). It splits the history of `sdks/swift`
   (`git subtree split`, no local branch), pushes it to the mirror's `main` and tags it `0.1.0`.
   SwiftPM tags have no `v`. It refuses a dirty `sdks/swift` and a tag that exists.
3. Apps add `.package(url: "https://github.com/emojisense/emojisense-swift.git", from: "0.1.0")`.
4. Optional: submit the mirror at [swiftpackageindex.com/add-a-package](https://swiftpackageindex.com/add-a-package).
   `.spi.yml` asks it to build the DocC documentation.

`Package.swift` needs no change: tools version 6.0, iOS 16 and macOS 13, one library product, no
dependencies. In the mirror the conformance tests skip the search cases, because the packs live in
`packages/data`.

## Discourse theme component

Discourse installs a theme from the root of a git repository, so the build (`apps/discourse/dist/theme`)
is published as its own repository, `emojisense/discourse-emojisense`.

1. Set `"theme_version"` in `apps/discourse/theme/about.json`, commit.
2. Check it on a Discourse site with the component (see `apps/discourse/README.md`):
   `pnpm --filter @emojisense/discourse e2e`.
3. `scripts/release-discourse.sh 0.1.0` (PUSHES). It builds the theme, replaces the repository's files
   with the build, commits and tags the version. Sites that installed the component from git get the
   update with Discourse's daily check.
4. First release only: post a topic in the Theme component category on meta.discourse.org.

The hooks are internal Discourse methods. After a Discourse release that breaks them, add a
`.discourse-compatibility` file to the theme repository that pins older Discourse versions to the last
working commit, then fix the component.
