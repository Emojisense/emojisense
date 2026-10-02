# @emojisense/mcp

An MCP server (stdio) that gives an AI assistant three emoji tools. It works offline: the
Emojisense alias engine and the data packs ship inside the package. With an API key, it also adds
semantic results from the Emojisense API.

| Tool | Input | Use it to |
| ---- | ----- | --------- |
| `search_emoji` | `query`, `locale?`, `limit?` (10) | Find emoji for a keyword, slang, a name or a concept: "lgtm" → 👍, "jurassic park" → 🦖 |
| `emoji_for_text` | `text`, `locale?`, `limit?` (5) | Pick the emoji to add to a sentence the user writes. Also returns the text with the best emoji appended. |
| `suggest_reactions` | `text`, `locale?`, `limit?` (6) | Pick the emoji a reader reacts with: "we launched!" → 🎉 |

`locale` is any bundled pack locale: `en`, `es`, `zh`, `hi`, `ar`, `fr`, `bn`, `pt`, `ru`, `id`, `tr`. Every tool returns a short text and the same data as
structured content (`outputSchema`):

```json
{
  "query": "greatest of all time",
  "locale": "en",
  "semantic": false,
  "results": [{ "emoji": "🐐", "id": "1F410", "label": "goat", "score": 0.86, "source": "alias", "match": "greatest of all time" }]
}
```

`match` is the alias phrase that matched. The text tools also return `window`, the part of the input
that matched. `source` is `alias` (offline), `semantic` (API) or `default` (a generic reaction
such as 👍, or 👀 for a question, that fills a short list). Offline reaction suggestions prefer
the emoji people react with: `COMMON_REACTIONS` from `emojisense`, the list the hosted reaction
ranking uses too.

## Client configuration

Requirements: Node.js 20 or later. `npx` downloads the package on the first start (about 4 MB: the
data packs for 11 languages are inside).

Most MCP clients read a JSON file with an `mcpServers` object. Some clients call the object
`servers` and want `"type": "stdio"` on each entry.

Offline (no account, no network):

```json
{
  "mcpServers": {
    "emojisense": {
      "command": "npx",
      "args": ["-y", "@emojisense/mcp"]
    }
  }
}
```

With semantic results:

```json
{
  "mcpServers": {
    "emojisense": {
      "command": "npx",
      "args": ["-y", "@emojisense/mcp"],
      "env": {
        "EMOJISENSE_API_URL": "https://api.emojisense.com",
        "EMOJISENSE_SECRET_KEY": "sk_live_…"
      }
    }
  }
}
```

From a checkout of this repository (after `pnpm build`):

```json
{
  "mcpServers": {
    "emojisense": {
      "command": "node",
      "args": ["/path/to/emojisense/packages/mcp/dist/cli.js"]
    }
  }
}
```

## How the API is used

| Variable | Value |
| -------- | ----- |
| `EMOJISENSE_API_URL` | API base URL. Must be `https://`, except `http://localhost` for development. |
| `EMOJISENSE_SECRET_KEY` | A secret key (`sk_live_…`). It is sent as `Authorization: Bearer`. Keep it out of browsers and repositories. |

Set both variables or neither. With one of them, the server writes a warning to stderr and runs
offline.

- `search_emoji` asks `GET /v1/search?mode=semantic` only when the offline engine is unsure (the
  same rule as the browser SDK). Confident queries cost nothing.
- `emoji_for_text` and `suggest_reactions` send the text (max. 256 characters) to
  `POST /v1/suggest-reactions`. Message text never goes to `/v1/search`, because the search
  endpoint logs normalized query text and the reactions endpoint never logs or caches text.
- On a network error, a timeout (4 s), an HTTP error or `overLimit: true`, the tool returns the
  offline results. After `overLimit`, the server keeps asking, because the shared edge cache
  still answers popular queries without counting them. Errors go to stderr only.

## Develop

```bash
pnpm --filter @emojisense/mcp build   # tsc + copy packages/data/dist/packs/<version> to dist/packs
pnpm --filter @emojisense/mcp test    # tool handlers, API client, MCP wire protocol (no network)
node packages/mcp/dist/cli.js         # speaks MCP on stdin/stdout
```

The build needs the data packs (`pnpm data:build`). Turborepo builds them first, because
`@emojisense/data` is a dev dependency. To try the tools in a browser UI, run
`npx @modelcontextprotocol/inspector node packages/mcp/dist/cli.js`.

### How `emoji_for_text` works offline

The alias engine is built for short queries. The server cuts the text into word windows of one to
four words and searches each window as a complete query. Then it merges the matches per emoji:

- an alias with more words scores higher ("happy birthday" beats "happy");
- an alias whose words are not all in the text loses most of its score ("order shipped" for
  "we shipped");
- a lone common word ("new", "day") or a two-letter word that names a flag ("pr") scores lower;
- one window cannot fill the whole list.

`suggest_reactions` re-ranks the same matches towards emoji that people commonly react with (🎉 🙏
😂 👀 …), and fills a short list with 👍 and ❤️ (👀 and 🤔 for questions).

## License

MIT. The bundled data packs contain data from [Emojibase](https://emojibase.dev) (MIT) and
[Unicode CLDR](https://cldr.unicode.org) (Unicode License v3). Their license notices ship in
`dist/packs/licenses/`. Docs: [emojisense.com/docs/integrations/mcp](https://emojisense.com/docs/integrations/mcp/).
