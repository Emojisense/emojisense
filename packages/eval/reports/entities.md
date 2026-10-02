# Entities and the concept tier

- Pack 0.1.0 · embeddinggemma@768 (shared + 10 locales) · concept model `@cf/google/gemma-4-26b-a4b-it` (prompt v1)
- unsure = `assessConfidence`: no confident whole-token alias coverage and a flat or low semantic list.
- +concept = concept results (`mergeConcept`) for unsure queries, as the API answers them. gated = the SDK: it asks the API only when `shouldUseSemantic`.

## Recall by set and mode (R@1 / R@5)

| Set | n | unsure | alias | semantic | fused | gated | fused+concept | gated+concept |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| entities-dev | 258 | 39.5% | 43.4 / 62 | 41.5 / 65.5 | 49.2 / 73.6 | 48.8 / 74.8 | 70.9 / 90.7 | 70.5 / 91.9 |
| queries | 214 | 0.5% | 85 / 98.6 | 79 / 92.1 | 89.3 / 99.1 | 86.4 / 98.6 | 89.7 / 99.5 | 86.9 / 99.1 |
| semantic-dev | 180 | 3.9% | 69.4 / 94.4 | 73.9 / 90 | 77.8 / 98.3 | 74.4 / 95.6 | 78.3 / 98.9 | 75 / 96.1 |
| romanized-dev | 116 | 14.7% | 71.6 / 87.9 | 50 / 63.8 | 77.6 / 93.1 | 74.1 / 92.2 | 81 / 94 | 77.6 / 93.1 |
| sentences-dev | 369 | 19.0% | 56.6 / 85.6 | 66.1 / 86.7 | 70.7 / 92.1 | 70.5 / 91.9 | 77.5 / 96.5 | 77.2 / 96.2 |

## Entities by locale (R@1 / R@5)

| locale | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| ar | 18 | 33.3% | 55.6 / 72.2 | 77.8 / 94.4 |
| bn | 18 | 50.0% | 38.9 / 61.1 | 61.1 / 100 |
| en | 72 | 37.5% | 59.7 / 84.7 | 76.4 / 94.4 |
| es | 19 | 47.4% | 47.4 / 73.7 | 73.7 / 94.7 |
| fr | 18 | 27.8% | 27.8 / 61.1 | 55.6 / 77.8 |
| hi | 19 | 47.4% | 36.8 / 57.9 | 73.7 / 84.2 |
| id | 19 | 36.8% | 57.9 / 84.2 | 84.2 / 100 |
| pt | 19 | 57.9% | 42.1 / 68.4 | 52.6 / 68.4 |
| ru | 18 | 33.3% | 33.3 / 66.7 | 55.6 / 83.3 |
| tr | 19 | 26.3% | 42.1 / 63.2 | 63.2 / 89.5 |
| zh | 19 | 42.1% | 68.4 / 84.2 | 89.5 / 100 |

## Entities by category (R@1 / R@5)

| category | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| athlete | 22 | 86.4% | 27.3 / 59.1 | 81.8 / 90.9 |
| brand | 22 | 36.4% | 72.7 / 90.9 | 90.9 / 100 |
| celebrity | 18 | 94.4% | 11.1 / 55.6 | 72.2 / 94.4 |
| character | 21 | 14.3% | 61.9 / 85.7 | 71.4 / 90.5 |
| film | 23 | 30.4% | 30.4 / 52.2 | 39.1 / 73.9 |
| game | 9 | 0.0% | 66.7 / 88.9 | 66.7 / 88.9 |
| holiday | 25 | 12.0% | 68 / 96 | 76 / 100 |
| idiom | 15 | 46.7% | 66.7 / 86.7 | 80 / 93.3 |
| meme | 12 | 50.0% | 33.3 / 75 | 33.3 / 75 |
| musician | 28 | 92.9% | 17.9 / 32.1 | 85.7 / 96.4 |
| place | 18 | 5.6% | 61.1 / 83.3 | 66.7 / 88.9 |
| series | 15 | 0.0% | 53.3 / 86.7 | 53.3 / 86.7 |
| song | 11 | 18.2% | 81.8 / 90.9 | 72.7 / 90.9 |
| team | 19 | 15.8% | 68.4 / 84.2 | 78.9 / 89.5 |

## Concept answers, cost and latency

- Unsure: 39.5% of the entity queries, 10.8% of the control queries (197 of 1137). Answers: 197 ok, 0 none (the model did not know it, or a blocked word), 0 missing (offline or failed).
- One model call: 223 tokens in, 55 out, 3.53 neurons → $0.0388 per 1,000 unsure queries that miss every cache; plus one embeddinggemma embedding of the terms (≈ 15 tokens).
- Model call from this machine (Workers AI round trip, cold; n = 203): p50 1541 ms, p95 6361 ms. Embedding of the terms (uncached this run; n = 0): p50 – ms.
- This run: 0 new model calls, 0 failed.

## Entity misses after the concept tier (fused+concept, not in the top 5)

| Query | Locale | Category | unsure | concept | Expected | Got (top 5) |
| --- | --- | --- | --- | --- | --- | --- |
| kill bill | en | film | no | – | ⚔️🗡️💛🩸 | 🔪 👰 💀 💵 💸 |
| avatar | en | film | no | – | 🔵🌳👽🏹 | 🧑 👤 💧 💙 🍃 |
| top gun | en | film | no | – | ✈️🛩️🕶️🏍️ | 🔝 🧑‍✈️ 😎 👨‍✈️ 👩‍✈️ |
| bridgerton | en | series | no | – | 👑💃💐🐝 | 👒 🪭 🫅 🧐 🤎 |
| la sagrada familia | es | place | no | – | ⛪🏗️🇪🇸🏛️ | 👪️ 👨‍👩‍👧 👨‍👩‍👧‍👧 👨‍👩‍👦 👨‍👩‍👧‍👦 |
| intouchables | fr | film | no | – | ♿🤝😂🇫🇷 | 🦽 👬 🧑‍🤝‍🧑 🤷‍♀️ 🤷‍♂️ |
| amélie poulain | fr | film | no | – | 🍮📸😊🇫🇷 | 🪗 🐩 🙋‍♀️ 🐴 🐥 |
| tintin | fr | character | no | – | 🐕🔍🚀📰 | ⚓️ 👦 🧨 🌻 🤏 |
| psg | fr | team | no | – | ⚽🗼🔴🔵 | 💙 🏟️ ✌️ ✨️ 💜 |
| тетрис | ru | game | no | – | 🧱🟦🟥🎮 | 🤫 👾 🧩 🤏 🤭 |
| зенит | ru | team | no | – | ⚽🔵⚪🇷🇺 | 📷️ 💙 🌕️ 🥱 💤 |
| ждун | ru | meme | no | – | ⏳😐🕰️🫠 | 🧍 🧍‍♂️ 🤰 🥱 🐩 |
| धोनी | hi | athlete | no | – | 🏏🚁🧤🇮🇳 | 😭 🍀 💪 💙 🍩 |
| शोले | hi | film | no | – | 🔫🐴🏍️🎬 | 🤠 👿 👬 🧑‍🤝‍🧑 🖐️ |
| मोगैम्बो खुश हुआ | hi | meme | no | – | 😈😆🦹🎬 | 😃 😀 😄 ☺️ 👿 |
| البتراء | ar | place | no | – | 🏜️🏛️🇯🇴🐫 | 🥾 👰‍♀️ 👰‍♂️ 🦋 🐧 |
| pele | pt | athlete | no | – | ⚽👑🇧🇷🐐 | 💆 😱 🤎 🥶 🧴 |
| chaves | pt | series | no | – | 🛢️🥪📺😢 | 🔑 🔐 🧒 🔒️ 👦 |
| turma da monica | pt | character | no | – | 🐰👧🦷🐇 | 🧒 🐄 🐮 🏫 🧅 |
| xuxa | pt | celebrity | yes | ok (singer) | 👱‍♀️📺🚀💋 | 🎤 🇧🇷 👧 🧑‍🎤 👑 |
| nazaré confusa | pt | meme | yes | ok | 🤔🧮😵‍💫❓ | 🇵🇹 💃 🎵 🎶 🎤 |
| quem não tem cão caça com gato | pt | idiom | yes | ok (conflict, disagreement) | 🐱🐶🤷💡 | 🫯 🗣️ 🗯️ 🎭️ 🤷‍♂️ |
| şımarık | tr | song | no | – | 💋😘🎶 | 🐩 😏 😉 🤷 🤪 |
| barış manço | tr | musician | no | – | 🎸🎤💍🇹🇷 | ✌️ ☮️ 🕊️ 😌 🥭 |
