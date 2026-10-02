# Integrations

Every integration is a thin wrapper over the same pack + `core` + API. A platform is worth an
integration only if **all three** are true:

1. people type short messages or react often there,
2. it has a custom-emoji culture,
3. it offers an editor or picker hook.

## Roadmap and status

Every integration below reads the hosted API at `https://api.emojisense.com` by default. "Built"
means the code, tests and docs page are on `main`; npm, store and registry listings come with the
first release (none is published yet on 2026-10-02).

| Priority | Integration | Package / app | Status (2026-10-02) | Notes |
|---|---|---|---|---|
| 1 | React hooks + Frimousse adapter | `@emojisense/react` | built | hybrid adapter: Frimousse browse view, Emojisense ranking while typing; custom emoji, culture layer, relevant-now shelf |
| 1 | shadcn registry item | `packages/react/registry` | built, not hosted | `registry.json` + `shadcn build` → `npx shadcn add <url>/r/emoji-picker.json`; listing in the public index needs an open-source, flat registry |
| 2 | Tiptap `:` autocomplete | `@emojisense/tiptap` | built | on `@tiptap/suggestion` with `char: ':'`; the official `@tiptap/extension-emoji` has no skin tones |
| 2 | Lexical `:` autocomplete | `@emojisense/lexical` | built | `LexicalTypeaheadMenuPlugin` + `useBasicTypeaheadTriggerMatch(':')` |
| 3 | Chrome extension (MV3) | `apps/chrome-extension` | built, not in the Chrome Web Store | packs bundled once for every site; see Google Docs below |
| 4 | Raycast | `apps/raycast` | built, not in the Raycast Store | store rules: MIT license, public PR to `raycast/extensions`, review, no external analytics |
| 5 | MCP server | `@emojisense/mcp` | built | tools `search_emoji`, `emoji_for_text`, `suggest_reactions`; packs of all 11 locales bundled; SDK v2 `@modelcontextprotocol/server` |
| next | Web component | `@emojisense/web-component` | built | `<emojisense-picker>` for Vue, Svelte, Angular, vanilla; custom emoji and culture attributes |
| next | emoji-mart adapter | `@emojisense/emoji-mart` | built | emoji-mart has no search hook; the adapter drives an external result list |
| next | React Native / Expo, Slack app, Discourse plugin, Discord bot, VS Code/Cursor, Figma, Obsidian | — | open | |
| later | Swift SDK | `sdks/swift` | built | conformance-tested against the TS engine (golden file) |
| later | Kotlin SDK, Mac menubar app (Tadamoji), chat UI kits, Mattermost/Rocket.Chat/Matrix, WordPress block | — | open | Kotlin needs a JDK 17 toolchain on the build machine |

**Skip unless asked:** Shopify, iOS/Android keyboards, Flutter, Teams, Windows-native, Ghost,
Notion (no editor API; the Chrome extension covers it).

## Google Docs (Chrome extension)

Docs draws text on a canvas (since 2021). Options:

| Method | Reliability | Cost |
|---|---|---|
| Copy to clipboard + "press ⌘V" hint | most reliable | one extra keystroke; `clipboardWrite` permission warning |
| `chrome.debugger` + CDP `Input.insertText` (built for "an emoji keyboard or an IME") | works as real input | "Read and change all your data" warning + "started debugging this browser" banner; experimental API |
| Synthetic events into the Docs text-event iframe | fragile | community libraries break with Docs changes |
| Annotated canvas (`_docs_annotate_canvas_by_ext`) | read-only, allowlisted extensions | cannot insert |
| Docs API / Apps Script | no access to the user's cursor from an extension | Google points to Workspace Add-ons instead |

**Decision:** the default is clipboard + hint. CDP insertion is an opt-in setting, maybe later.
Gmail (contenteditable, `execCommand('insertText')` keeps undo) and GitHub (`<textarea>`,
`setRangeText`) are straightforward.

## Slack and Discourse (Phase 3)

- Slack `emoji.list` (scope `emoji:read`, Tier 2) returns a workspace's custom emoji, so semantic
  search over them is possible. Public distribution without a listing needs no review. A
  **commercial** app must go through the Marketplace (Slack API terms, May 2025).
- Discourse: self-hosted sites install plugins from a git URL. Managed hosting allows only the
  plugins the host offers.
