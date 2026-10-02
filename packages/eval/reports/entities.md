# Entities and the concept tier

- Pack 0.1.0 · bge-m3@1024 (shared + 10 locales) · concept model `@cf/google/gemma-4-26b-a4b-it` (prompt v1)
- unsure = `assessConfidence`: no confident whole-token alias coverage and a flat or low semantic list.
- +concept = concept results (`mergeConcept`) for unsure queries, as the API answers them. gated = the SDK: it asks the API only when `shouldUseSemantic`.

## Recall by set and mode (R@1 / R@5)

| Set | n | unsure | alias | semantic | fused | gated | fused+concept | gated+concept |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| entities-dev | 258 | 82.6% | 40.7 / 60.5 | 25.2 / 47.3 | 43.4 / 64 | 42.6 / 63.2 | 69.8 / 90.7 | 69 / 89.9 |
| queries | 214 | 33.2% | 81.8 / 99.1 | 68.2 / 86.4 | 85.5 / 98.6 | 83.6 / 99.1 | 86 / 99.1 | 84.1 / 99.5 |
| semantic-dev | 180 | 32.8% | 62.8 / 93.9 | 63.9 / 87.2 | 66.1 / 96.1 | 65.6 / 95 | 66.7 / 96.1 | 66.1 / 95 |
| romanized-dev | 116 | 78.4% | 69.8 / 83.6 | 27.6 / 42.2 | 68.1 / 85.3 | 69 / 85.3 | 76.7 / 90.5 | 77.6 / 90.5 |
| sentences-dev | 369 | 39.0% | 55 / 85.4 | 56.6 / 85.1 | 61.8 / 90.8 | 61.5 / 90.2 | 67.8 / 96.5 | 67.5 / 95.9 |

## Entities by locale (R@1 / R@5)

| locale | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| ar | 18 | 94.4% | 50 / 66.7 | 77.8 / 94.4 |
| bn | 18 | 100.0% | 27.8 / 61.1 | 61.1 / 100 |
| en | 72 | 72.2% | 48.6 / 70.8 | 70.8 / 94.4 |
| es | 19 | 84.2% | 57.9 / 63.2 | 89.5 / 100 |
| fr | 18 | 72.2% | 33.3 / 61.1 | 61.1 / 83.3 |
| hi | 19 | 89.5% | 21.1 / 47.4 | 52.6 / 78.9 |
| id | 19 | 94.7% | 52.6 / 78.9 | 73.7 / 89.5 |
| pt | 19 | 89.5% | 21.1 / 42.1 | 47.4 / 68.4 |
| ru | 18 | 77.8% | 38.9 / 61.1 | 61.1 / 83.3 |
| tr | 19 | 89.5% | 57.9 / 63.2 | 84.2 / 94.7 |
| zh | 19 | 73.7% | 52.6 / 68.4 | 84.2 / 100 |

## Entities by category (R@1 / R@5)

| category | n | unsure | fused | fused+concept |
| --- | --: | --: | --: | --: |
| athlete | 22 | 100.0% | 0 / 18.2 | 81.8 / 86.4 |
| brand | 22 | 81.8% | 72.7 / 90.9 | 90.9 / 100 |
| celebrity | 18 | 94.4% | 5.6 / 5.6 | 72.2 / 94.4 |
| character | 21 | 76.2% | 57.1 / 76.2 | 66.7 / 85.7 |
| film | 23 | 87.0% | 13 / 47.8 | 21.7 / 65.2 |
| game | 9 | 77.8% | 66.7 / 100 | 66.7 / 100 |
| holiday | 25 | 64.0% | 72 / 92 | 80 / 96 |
| idiom | 15 | 60.0% | 46.7 / 73.3 | 60 / 93.3 |
| meme | 12 | 75.0% | 50 / 83.3 | 41.7 / 83.3 |
| musician | 28 | 100.0% | 3.6 / 14.3 | 85.7 / 100 |
| place | 18 | 88.9% | 83.3 / 94.4 | 88.9 / 100 |
| series | 15 | 73.3% | 53.3 / 86.7 | 53.3 / 86.7 |
| song | 11 | 72.7% | 63.6 / 72.7 | 63.6 / 81.8 |
| team | 19 | 84.2% | 63.2 / 94.7 | 78.9 / 94.7 |

## Concept answers, cost and latency

- Unsure: 82.6% of the entity queries, 41.5% of the control queries (578 of 1137). Answers: 185 ok, 0 none (the model did not know it, or a blocked word), 393 missing (offline or failed).
- One model call: 224 tokens in, 55 out, 3.53 neurons → $0.0388 per 1,000 unsure queries that miss every cache; plus one bge-m3 embedding of the terms (≈ 15 tokens, $0.012 per M tokens).
- Model call from this machine (Workers AI round trip, cold; n = 447): p50 1463 ms, p95 7923 ms. Embedding of the terms (uncached this run; n = 0): p50 – ms.
- This run: 0 new model calls, 0 failed.

## Entity misses after the concept tier (fused+concept, not in the top 5)

| Query | Locale | Category | unsure | concept | Expected | Got (top 5) |
| --- | --- | --- | --- | --- | --- | --- |
| bohemian rhapsody | en | song | no | – | 🎤🎹🎸🎭 | 🪉 🪕 🧚 👯 🪘 |
| kill bill | en | film | yes | missing | ⚔️🗡️💛🩸 | 👰 💵 🎱 🛑 ➗️ |
| avatar | en | film | no | – | 🔵🌳👽🏹 | 🧑 👤 💙 🍃 🖼️ |
| bridgerton | en | series | yes | missing | 👑💃💐🐝 | 🫅 🪭 👒 👗 💂 |
| intouchables | fr | film | yes | missing | ♿🤝😂🇫🇷 | 🦽 🧑‍🤝‍🧑 👬 🦼 🧑‍🦼 |
| tintin | fr | character | yes | missing | 🐕🔍🚀📰 | 👦 🪷 ⚓️ 🧨 🏴‍☠️ |
| le petit prince | fr | character | no | – | 🤴🌹🦊⭐ | 🛩️ 🖍️ 👨‍✈️ 👩‍✈️ 🥀 |
| ирония судьбы | ru | film | yes | missing | 🎄🛁🥂❄️ | 💘 💓 🤶 🧑‍🎄 🧖 |
| зенит | ru | team | yes | missing | ⚽🔵⚪🇷🇺 | 📷️ 💙 🌕️ 🆚 🪖 |
| ждун | ru | meme | yes | missing | ⏳😐🕰️🫠 | 🧍 🧍‍♂️ 🧍‍♀️ 🤰 🧞 |
| धोनी | hi | athlete | yes | missing | 🏏🚁🧤🇮🇳 | 🧽 🧴 🦘 🧼 🧺 |
| शोले | hi | film | yes | missing | 🔫🐴🏍️🎬 | 🤠 👿 🦹 🦹‍♂️ 🦹‍♀️ |
| दिलवाले दुल्हनिया ले जायेंगे | hi | film | no | – | 🚂🌻💑❤️ | 💕 👩‍❤️‍👨 👨‍❤️‍👨 👰‍♂️ 👩‍❤️‍👩 |
| रक्षाबंधन | hi | holiday | yes | missing | 🎀👫🎁🤝 | ❤️ 🧵 🌕️ 💝 🧧 |
| ميسي | ar | athlete | yes | missing | ⚽🐐🇦🇷🏆 | 🐭 🎰 🧑‍🏫 👩‍🏫 🙏 |
| pele | pt | athlete | yes | missing | ⚽👑🇧🇷🐐 | 💆 🧴 🇵🇼 🐆 🦡 |
| chaves | pt | series | yes | missing | 🛢️🥪📺😢 | 🔑 🧒 👦 🏫 🇲🇽 |
| turma da monica | pt | character | yes | missing | 🐰👧🦷🐇 | 🧒 🐮 🐄 🧅 🏫 |
| xuxa | pt | celebrity | yes | ok (singer) | 👱‍♀️📺🚀💋 | 🎤 🇧🇷 👧 🧑‍🎤 👑 |
| nazaré confusa | pt | meme | yes | ok (legend, supernatural) | 🤔🧮😵‍💫❓ | 👵 🌀 🔮 🇵🇹 ✨️ |
| quem não tem cão caça com gato | pt | idiom | yes | ok (conflict) | 🐱🐶🤷💡 | 🗣️ 🗯️ 🐕️ 🐈️ 🫯 |
| pengabdi setan | id | film | yes | ok (supernatural) | 👻😱🔔🧕 | 🧟 🩸 🏚️ 🧛‍♂️ 🕯️ |
| kkn di desa penari | id | film | yes | missing | 👻💃🌳😱 | 🧵 👯 🧷 🧶 🛶 |
| şımarık | tr | song | yes | missing | 💋😘🎶 | 🐩 🤴 👸 🐿️ 📃 |
