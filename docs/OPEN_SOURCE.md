# Open-source strategy

Open core. Everything a developer needs to search emoji, on-device or self-hosted, is MIT. The
hosted service adds freshness and operations. The miss-mining pipeline stays closed: it is the moat.

## What is open, what is closed

| Component | License | Notes |
|---|---|---|
| `packages/core`, SDKs, adapters, web component, editor extensions, Chrome/Raycast/MCP | MIT | `core` stays dependency-free (browsers, Node, Bun, Deno, Workers, React Native, extensions) |
| Data pack: aliases, descriptions, packs, vectors | MIT data + upstream attribution (Emojibase MIT, Unicode CLDR License v3) | refreshed **quarterly** in open source |
| Eval harness + labelled queries | MIT | published on GitHub and Hugging Face; contributions welcome |
| Worker (search API) and dashboard | MIT | self-hosters run them on their own Cloudflare account (FSL was considered; MIT wins for adoption) |
| Miss mining + live alias updates | **closed** | the hosted service gets **daily** alias updates |
| Billing integration | closed | |

**Hosted value:** zero ops, daily alias freshness, image classification, custom emoji hosting
with auto-description, analytics, hosted emoji sets.

## Models: used by reference, never redistributed

We call models by ID (Workers AI) and never ship weights. The pack ships **precomputed emoji
vectors**, which are model outputs.

| Model | License | Output vectors in the open pack |
|---|---|---|
| EmbeddingGemma 300m | Gemma Terms of Use | §3.3: Google claims no rights in Outputs, and Outputs are not Model Derivatives. **Caveat:** a model trained on these outputs to behave like Gemma counts as a Model Derivative. Users of the vectors must follow the Gemma Prohibited Use Policy. Ship a notice with the vector file. |
| bge-m3, bge-small-en-v1.5 | MIT | no restrictions |
| Qwen3-Embedding-0.6B | Apache-2.0 | no restrictions |
| Granite embedding R2 (not adopted) | Apache-2.0; the 311m tokenizer is derived from Gemma 3 (Gemma ToU) | not used; not hosted on Workers AI |
| jina-embeddings v5 | CC BY-NC | excluded |

Self-hosters call the same models under each model's own license.

## Data and art attribution

- `packages/data/licenses/`: Emojibase MIT text, Unicode License v3 text. Ship these with any
  redistribution of the packs.
- Emoji render with the system font by default. Hosted emoji sets: see PRICING.md (Twemoji
  CC BY 4.0 attribution, Fluent MIT, Noto Apache/OFL, no OpenMoji without share-alike, never Apple).

## Repository hygiene before the first public push

1. Move `packages/eval/src/mine.ts` (miss mining) to the private repo `emojisense-cloud`. It is in
   this repo's history, so **start the public repo from a fresh history**, or rewrite history to
   remove it.
2. Add `CONTRIBUTING.md`, a self-host guide (Worker + dashboard on your own account, D1
   migrations, Workers AI model choice) and `NOTICE`.
3. No secrets in the repo: `.dev.vars` and `.env*` are gitignored; examples only.
4. Keep the eval set honest: add the held-out queries before you publish benchmark numbers.
