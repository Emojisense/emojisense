# Entities and the concept tier

- Pack 0.1.0 · bge-m3@1024 (shared + 10 locales) · concept model `@cf/google/gemma-4-26b-a4b-it` (prompt v1)
- unsure = `assessConfidence`: no confident whole-token alias coverage and a flat or low semantic list.
- +concept = concept results (`mergeConcept`) for unsure queries, as the API answers them. gated = the SDK: it asks the API only when `shouldUseSemantic`.

## Recall by set and mode (R@1 / R@5)

| Set | n | unsure | alias | semantic | fused | gated | fused+concept | gated+concept |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| entities-dev | 258 | 37.2% | 43.4 / 62 | 28.3 / 46.9 | 44.6 / 65.1 | 44.6 / 65.5 | 69.8 / 89.9 | 69.8 / 90.3 |
| queries | 214 | 0.0% | 85 / 98.6 | 75.2 / 90.2 | 88.3 / 99.1 | 86.4 / 99.1 | 88.3 / 99.1 | 86.4 / 99.1 |
| semantic-dev | 180 | 2.8% | 69.4 / 94.4 | 71.1 / 91.1 | 75.6 / 97.2 | 73.3 / 95 | 77.2 / 98.3 | 75 / 96.1 |
| romanized-dev | 116 | 12.1% | 71.6 / 87.9 | 35.3 / 55.2 | 74.1 / 90.5 | 73.3 / 90.5 | 77.6 / 91.4 | 76.7 / 91.4 |
| sentences-dev | 369 | 11.9% | 56.6 / 85.6 | 62.3 / 90 | 70.2 / 91.9 | 69.9 / 91.3 | 74 / 95.7 | 73.7 / 95.1 |

## Entities by locale (R@1 / R@5)

| locale | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| ar | 18 | 33.3% | 55.6 / 77.8 | 77.8 / 100 |
| bn | 18 | 50.0% | 38.9 / 55.6 | 66.7 / 100 |
| en | 72 | 33.3% | 55.6 / 70.8 | 75 / 90.3 |
| es | 19 | 47.4% | 31.6 / 57.9 | 68.4 / 94.7 |
| fr | 18 | 27.8% | 22.2 / 55.6 | 50 / 83.3 |
| hi | 19 | 42.1% | 31.6 / 52.6 | 68.4 / 84.2 |
| id | 19 | 36.8% | 57.9 / 73.7 | 78.9 / 89.5 |
| pt | 19 | 52.6% | 15.8 / 42.1 | 42.1 / 68.4 |
| ru | 18 | 33.3% | 38.9 / 61.1 | 61.1 / 83.3 |
| tr | 19 | 31.6% | 47.4 / 63.2 | 73.7 / 94.7 |
| zh | 19 | 31.6% | 63.2 / 89.5 | 89.5 / 100 |

## Entities by category (R@1 / R@5)

| category | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| athlete | 22 | 86.4% | 9.1 / 31.8 | 81.8 / 90.9 |
| brand | 22 | 31.8% | 68.2 / 90.9 | 86.4 / 100 |
| celebrity | 18 | 94.4% | 5.6 / 22.2 | 77.8 / 94.4 |
| character | 21 | 9.5% | 57.1 / 76.2 | 66.7 / 85.7 |
| film | 23 | 26.1% | 26.1 / 43.5 | 34.8 / 60.9 |
| game | 9 | 0.0% | 77.8 / 88.9 | 77.8 / 88.9 |
| holiday | 25 | 8.0% | 64 / 96 | 72 / 100 |
| idiom | 15 | 26.7% | 60 / 80 | 66.7 / 86.7 |
| meme | 12 | 41.7% | 58.3 / 75 | 50 / 83.3 |
| musician | 28 | 96.4% | 7.1 / 10.7 | 85.7 / 100 |
| place | 18 | 5.6% | 61.1 / 88.9 | 66.7 / 94.4 |
| series | 15 | 6.7% | 46.7 / 80 | 53.3 / 80 |
| song | 11 | 18.2% | 72.7 / 81.8 | 72.7 / 90.9 |
| team | 19 | 15.8% | 63.2 / 94.7 | 73.7 / 94.7 |

## Concept answers, cost and latency

- Unsure: 37.2% of the entity queries, 7.2% of the control queries (159 of 1137). Answers: 159 ok, 0 none (the model did not know it, or a blocked word), 0 missing (offline or failed).
- One model call: 224 tokens in, 55 out, 3.53 neurons → $0.0388 per 1,000 unsure queries that miss every cache; plus one bge-m3 embedding of the terms (≈ 15 tokens, $0.012 per M tokens).
- Model call from this machine (Workers AI round trip, cold; n = 463): p50 1469 ms, p95 8105 ms. Embedding of the terms (uncached this run; n = 0): p50 – ms.
- This run: 0 new model calls, 0 failed.

## Entity misses after the concept tier (fused+concept, not in the top 5)

| Query | Locale | Category | unsure | concept | Expected | Got (top 5) |
| --- | --- | --- | --- | --- | --- | --- |
| kill bill | en | film | no | – | ⚔️🗡️💛🩸 | 👰 💸 💵 💀 😲 |
| avatar | en | film | no | – | 🔵🌳👽🏹 | 🧑 👤 💙 🍃 👾 |
| top gun | en | film | no | – | ✈️🛩️🕶️🏍️ | 🔝 🧑‍✈️ 🔫 😎 👨‍✈️ |
| bridgerton | en | series | no | – | 👑💃💐🐝 | 👒 🫅 🪭 👗 💂 |
| breaking bad | en | series | no | – | 🧪⚗️💎🔵 | 💔 🧑‍🔬 ⛓️‍💥 👎️ 👨‍🔬 |
| may the force be with you | en | idiom | no | – | ⭐⚔️🌌✨ | 🍀 💪 ✌️ 🤲 🙌 |
| grinch | en | character | no | – | 💚🎄🎅😈 | 😬 💗 😅 😝 😆 |
| la sagrada familia | es | place | no | – | ⛪🏗️🇪🇸🏛️ | 👨‍👩‍👧 👨‍👩‍👧‍👧 👪️ 👨‍👩‍👧‍👦 👨‍👩‍👦‍👦 |
| intouchables | fr | film | no | – | ♿🤝😂🇫🇷 | 🦽 👬 🧑‍🤝‍🧑 🦼 🤷 |
| amélie poulain | fr | film | no | – | 🍮📸😊🇫🇷 | 🪗 🐴 🤦‍♀️ 😭 💜 |
| tintin | fr | character | no | – | 🐕🔍🚀📰 | ⚓️ 👦 🧨 🌻 🐧 |
| тетрис | ru | game | no | – | 🧱🟦🟥🎮 | 👾 🧩 🖲️ 🤫 💁‍♀️ |
| зенит | ru | team | no | – | ⚽🔵⚪🇷🇺 | 📷️ 💙 🌕️ ☔️ 🥱 |
| ждун | ru | meme | no | – | ⏳😐🕰️🫠 | 🧍 🧍‍♂️ 🤰 🧍‍♀️ 🥱 |
| धोनी | hi | athlete | no | – | 🏏🚁🧤🇮🇳 | 🧽 😭 ⚽️ 🍀 🧴 |
| शोले | hi | film | no | – | 🔫🐴🏍️🎬 | 🤠 👿 👬 🧑‍🤝‍🧑 🏇 |
| दिलवाले दुल्हनिया ले जायेंगे | hi | film | no | – | 🚂🌻💑❤️ | 💕 👩‍❤️‍👨 👩‍❤️‍👩 👨‍❤️‍👨 👰‍♂️ |
| pele | pt | athlete | no | – | ⚽👑🇧🇷🐐 | 💆 😱 🧴 🤎 🥺 |
| chaves | pt | series | no | – | 🛢️🥪📺😢 | 🔑 🔐 🧒 🔒️ 👦 |
| turma da monica | pt | character | no | – | 🐰👧🦷🐇 | 🧒 🐄 🐮 🏫 🧅 |
| xuxa | pt | celebrity | yes | ok (singer) | 👱‍♀️📺🚀💋 | 🎤 🇧🇷 👧 🧑‍🎤 👑 |
| nazaré confusa | pt | meme | yes | ok (legend, supernatural) | 🤔🧮😵‍💫❓ | 👵 🌀 🔮 🇵🇹 ✨️ |
| quem não tem cão caça com gato | pt | idiom | yes | ok (conflict) | 🐱🐶🤷💡 | 🗣️ 🗯️ 🐕️ 🐈️ ⚖️ |
| pengabdi setan | id | film | yes | ok (supernatural) | 👻😱🔔🧕 | 🧟 🩸 🧛‍♂️ 🏚️ 🕯️ |
| kkn di desa penari | id | film | no | – | 👻💃🌳😱 | 🧵 👯 🍰 👯‍♀️ 🌵 |
| şımarık | tr | song | no | – | 💋😘🎶 | 🐩 🤦 😴 🤴 🥴 |
