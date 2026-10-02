# Entities and the concept tier

- Pack 0.1.0 · bge-m3@1024 (shared + 10 locales) · concept model `@cf/google/gemma-4-26b-a4b-it` (prompt v1)
- unsure = `assessConfidence`: no confident whole-token alias coverage and a flat or low semantic list.
- +concept = concept results (`mergeConcept`) for unsure queries, as the API answers them. gated = the SDK: it asks the API only when `shouldUseSemantic`.

## Recall by set and mode (R@1 / R@5)

| Set | n | unsure | alias | semantic | fused | gated | fused+concept | gated+concept |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| entities-dev | 258 | 37.2% | 40.7 / 60.5 | 25.2 / 47.3 | 44.2 / 64.7 | 43.4 / 64 | 69.8 / 90.7 | 69 / 89.9 |
| queries | 214 | 0.5% | 82.2 / 99.1 | 68.2 / 86.4 | 85.5 / 98.6 | 84.1 / 99.1 | 86 / 99.1 | 84.6 / 99.5 |
| semantic-dev | 180 | 3.9% | 62.8 / 93.9 | 63.9 / 87.2 | 66.1 / 96.1 | 65.6 / 95 | 66.7 / 96.1 | 66.1 / 95 |
| romanized-dev | 116 | 20.7% | 69.8 / 84.5 | 27.6 / 42.2 | 68.1 / 85.3 | 69 / 85.3 | 76.7 / 90.5 | 77.6 / 90.5 |
| sentences-dev | 369 | 15.4% | 54.7 / 85.4 | 56.6 / 85.1 | 61.5 / 90.5 | 61.2 / 90 | 67.8 / 96.5 | 67.5 / 95.9 |

## Entities by locale (R@1 / R@5)

| locale | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| ar | 18 | 33.3% | 50 / 66.7 | 77.8 / 94.4 |
| bn | 18 | 50.0% | 27.8 / 61.1 | 61.1 / 100 |
| en | 72 | 33.3% | 48.6 / 70.8 | 70.8 / 94.4 |
| es | 19 | 47.4% | 57.9 / 63.2 | 89.5 / 100 |
| fr | 18 | 27.8% | 33.3 / 61.1 | 61.1 / 83.3 |
| hi | 19 | 42.1% | 31.6 / 52.6 | 52.6 / 78.9 |
| id | 19 | 31.6% | 52.6 / 78.9 | 73.7 / 89.5 |
| pt | 19 | 52.6% | 21.1 / 42.1 | 47.4 / 68.4 |
| ru | 18 | 33.3% | 38.9 / 61.1 | 61.1 / 83.3 |
| tr | 19 | 36.8% | 57.9 / 63.2 | 84.2 / 94.7 |
| zh | 19 | 31.6% | 52.6 / 73.7 | 84.2 / 100 |

## Entities by category (R@1 / R@5)

| category | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| athlete | 22 | 86.4% | 9.1 / 22.7 | 81.8 / 86.4 |
| brand | 22 | 31.8% | 72.7 / 90.9 | 90.9 / 100 |
| celebrity | 18 | 94.4% | 5.6 / 11.1 | 72.2 / 94.4 |
| character | 21 | 9.5% | 57.1 / 76.2 | 66.7 / 85.7 |
| film | 23 | 26.1% | 13 / 47.8 | 21.7 / 65.2 |
| game | 9 | 0.0% | 66.7 / 100 | 66.7 / 100 |
| holiday | 25 | 8.0% | 72 / 92 | 80 / 96 |
| idiom | 15 | 40.0% | 46.7 / 73.3 | 60 / 93.3 |
| meme | 12 | 33.3% | 50 / 83.3 | 41.7 / 83.3 |
| musician | 28 | 96.4% | 3.6 / 14.3 | 85.7 / 100 |
| place | 18 | 5.6% | 83.3 / 94.4 | 88.9 / 100 |
| series | 15 | 6.7% | 53.3 / 86.7 | 53.3 / 86.7 |
| song | 11 | 9.1% | 63.6 / 72.7 | 63.6 / 81.8 |
| team | 19 | 15.8% | 63.2 / 94.7 | 78.9 / 94.7 |

## Concept answers, cost and latency

- Unsure: 37.2% of the entity queries, 10.1% of the control queries (185 of 1137). Answers: 185 ok, 0 none (the model did not know it, or a blocked word), 0 missing (offline or failed).
- One model call: 224 tokens in, 55 out, 3.53 neurons → $0.0388 per 1,000 unsure queries that miss every cache; plus one bge-m3 embedding of the terms (≈ 15 tokens, $0.012 per M tokens).
- Model call from this machine (Workers AI round trip, cold; n = 447): p50 1463 ms, p95 7923 ms. Embedding of the terms (uncached this run; n = 0): p50 – ms.
- This run: 0 new model calls, 0 failed.

## Entity misses after the concept tier (fused+concept, not in the top 5)

| Query | Locale | Category | unsure | concept | Expected | Got (top 5) |
| --- | --- | --- | --- | --- | --- | --- |
| bohemian rhapsody | en | song | no | – | 🎤🎹🎸🎭 | 🪉 🪕 🧚 👯 🪘 |
| kill bill | en | film | no | – | ⚔️🗡️💛🩸 | 👰 💵 🎱 🛑 ➗️ |
| avatar | en | film | no | – | 🔵🌳👽🏹 | 🧑 👤 💙 🍃 🖼️ |
| bridgerton | en | series | no | – | 👑💃💐🐝 | 🫅 🪭 👒 👗 💂 |
| intouchables | fr | film | no | – | ♿🤝😂🇫🇷 | 🦽 🧑‍🤝‍🧑 👬 🦼 🧑‍🦼 |
| tintin | fr | character | no | – | 🐕🔍🚀📰 | 👦 🪷 ⚓️ 🧨 🏴‍☠️ |
| le petit prince | fr | character | no | – | 🤴🌹🦊⭐ | 🛩️ 🖍️ 👨‍✈️ 👩‍✈️ 🥀 |
| ирония судьбы | ru | film | no | – | 🎄🛁🥂❄️ | 💘 💓 🤶 🧑‍🎄 🧖 |
| зенит | ru | team | no | – | ⚽🔵⚪🇷🇺 | 📷️ 💙 🌕️ 🆚 🪖 |
| ждун | ru | meme | no | – | ⏳😐🕰️🫠 | 🧍 🧍‍♂️ 🧍‍♀️ 🤰 🧞 |
| धोनी | hi | athlete | no | – | 🏏🚁🧤🇮🇳 | 🧽 🧴 🦘 🧼 🧺 |
| शोले | hi | film | no | – | 🔫🐴🏍️🎬 | 🤠 👿 🦹 🦹‍♂️ 🦹‍♀️ |
| दिलवाले दुल्हनिया ले जायेंगे | hi | film | no | – | 🚂🌻💑❤️ | 💕 👩‍❤️‍👨 👨‍❤️‍👨 👰‍♂️ 👩‍❤️‍👩 |
| रक्षाबंधन | hi | holiday | no | – | 🎀👫🎁🤝 | ❤️ 🧵 🌕️ 💝 🧧 |
| ميسي | ar | athlete | no | – | ⚽🐐🇦🇷🏆 | 🐭 🎰 🙏 🧑‍🎄 🍦 |
| pele | pt | athlete | no | – | ⚽👑🇧🇷🐐 | 💆 🧴 🐆 🇵🇼 🦡 |
| chaves | pt | series | no | – | 🛢️🥪📺😢 | 🔑 🧒 👦 🏫 🇲🇽 |
| turma da monica | pt | character | no | – | 🐰👧🦷🐇 | 🧒 🐮 🐄 🧅 🏫 |
| xuxa | pt | celebrity | yes | ok (singer) | 👱‍♀️📺🚀💋 | 🎤 🇧🇷 👧 🧑‍🎤 👑 |
| nazaré confusa | pt | meme | yes | ok (legend, supernatural) | 🤔🧮😵‍💫❓ | 👵 🌀 🔮 🇵🇹 ✨️ |
| quem não tem cão caça com gato | pt | idiom | yes | ok (conflict) | 🐱🐶🤷💡 | 🗣️ 🗯️ 🐕️ 🐈️ 🫯 |
| pengabdi setan | id | film | yes | ok (supernatural) | 👻😱🔔🧕 | 🧟 🩸 🏚️ 🧛‍♂️ 🕯️ |
| kkn di desa penari | id | film | no | – | 👻💃🌳😱 | 🧵 👯 🧷 🧶 🛶 |
| şımarık | tr | song | no | – | 💋😘🎶 | 🐩 🤴 👸 🐿️ 📃 |
