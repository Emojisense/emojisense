# Emojisense eval report

- Date: 2026-10-02 · pack 0.1.0 · 214 scored queries (+3 noise) · 46 labels marked for human review
- Hit = any acceptable emoji in the top k. MRR over the top 10. forbid@3 = a forbidden emoji in the top 3 (hard negatives).

## Engines

| Engine | R@1 | R@5 | R@10 | MRR | forbid@3 | Tier 1 calls | Note |
| --- | --: | --: | --: | --: | --: | --: | --- |
| **alias (full pack)** | 63.6 | 84.1 | 86 | 0.719 | 1.4 | 0% |  |
| alias (min coverage 0.5) | 61.7 | 79.9 | 81.3 | 0.689 | 0.9 | 0% |  |
| alias (min coverage 0.6) | 57.9 | 73.4 | 74.8 | 0.643 | 0.5 | 0% |  |

## Recall@5 by category

| Engine | exact (26) | typo (24) | slang (33) | pop (35) | idiom (21) | intent (32) | tr (33) | negative (10) |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| alias (full pack) | 100 | 91.7 | 84.8 | 68.6 | 61.9 | 81.3 | 93.9 | 100 |
| alias (min coverage 0.5) | 100 | 87.5 | 81.8 | 65.7 | 38.1 | 78.1 | 93.9 | 100 |
| alias (min coverage 0.6) | 100 | 87.5 | 75.8 | 60 | 23.8 | 62.5 | 93.9 | 80 |

## Latency

| Measure | p50 | p95 | max | n |
| --- | --: | --: | --: | --: |
| Tier 0 per keystroke (Node, this machine) | 0.22 ms | 2.32 ms | 9.97 ms | 6234 |
| Tier 0 index build (en + tr) | 69 ms |  |  | 1 |

Noise queries with a confident (≥ 0.6) alias result: 0/3.

## Sizes

| Client pack | en gz | tr gz |
| --- | --: | --: |
| full | 163.1 KB | 109.5 KB |

| Server file | raw | gz |
| --- | --: | --: |

## Misses of the best engine (alias (full pack))

| Query | Category | Expected | Got (top 5) |
| --- | --- | --- | --- |
| hallowelen | typo | 🎃 | 🧛 👻 🧛‍♂️ 🧛‍♀️ 🧟 |
| chrismas tree | typo | 🎄 | 🎅 🤶 🧑‍🎄 🌲 🌳 |
| hotfix ⓡ | slang | 🔥🚑🩹🛠️ | 🦸 |
| deploy | slang | 🚀🚢 | 🙌 😰 🤞 💨 🪊 |
| merge conflict ⓡ | slang | ⚔️💥😱🤼 | 😰 🫯 🙍 🤦 🤺 |
| stonks | slang | 📈💹 | 💩 👃 |
| this is fine ⓡ | slang | 🔥🙃🫠🙂 | 😐️ 😑 😒 👌 😤 |
| jurassic park | pop | 🦖🦕 | 🏞️ 🛝 🎡 🎢 ⛲️ |
| finding nemo | pop | 🐠🐟 | 🏊️ 💙 🏊‍♂️ 🏊‍♀️ 🇦🇺 |
| game of thrones ⓡ | pop | 🐉⚔️👑❄️ | 🫅 🏰 👾 🏏 🎮️ |
| pokemon ⓡ | pop | ⚡🐭🎮🔴 | 🍛 📱 🍙 |
| batman | pop | 🦇 | 🖤 🦸 🦸‍♂️ 💥 |
| spiderman | pop | 🕷️🕸️ | 🤟 🦸 🦸‍♂️ |
| the matrix ⓡ | pop | 💊🕶️💻🟩 | 🕴️ 🤖 🧑‍💻 ☎️ |
| toy story ⓡ | pop | 🤠🚀🧸🦖 | 🥔 🍕 😭 👽️ 🪀 |
| world cup | pop | ⚽🏆 | 🇦🇷 🇧🇷 🥤 💘 🍵 |
| new years eve | pop | 🎆🎇🥂🎉 | 🍇 🇧🇱 💋 🇦🇹 🏋️ |
| among us ⓡ | pop | 📮🔪🚀🤨 | 🫘 👽️ 🧑‍🚀 👨‍🚀 👩‍🚀 |
| when pigs fly | idiom | 🐷🐖🐽🪽 | 🧱 🛖 |
| raining cats and dogs | idiom | 🌧️☔⛈️🐱 | 🌮 💦 |
| hit the sack | idiom | 😴🛌💤🥱 | 🇨🇶 🔙 🥹 👱 🛖 |
| under the weather | idiom | 🤒🤧😷🤢 | 🌡️ ☀️ 🌞 ☁️ ⛅️ |
| bite the bullet ⓡ | idiom | 😬💪😤 | 🚅 🫦 🦟 🚄 😥 |
| ball is in your court ⓡ | idiom | 🎾🏀👉🫵 | ⛹️ ⛹️‍♂️ ⛹️‍♀️ 🧑‍⚖️ 👨‍⚖️ |
| let the cat out of the bag ⓡ | idiom | 🐈🙀🤫🐱 | – |
| butterflies in my stomach | idiom | 🦋😳🥰😬 | 💗 😟 🫚 |
| greatest of all time | intent | 🐐 | 🧔‍♀️ 🍞 |
| none of my business ⓡ | intent | 🐸☕🍵👀 | 🕴️ 💼 🈺 🧑‍💼 👨‍💼 |
| payday | intent | 💰💸🤑💵 | 🏦 |
| hang in there ⓡ | intent | 💪🙏🫂❤️ | 😣 🧗 ✊️ 🧗‍♂️ 🧗‍♀️ |
| on my way | intent | 🏃🚗🚶🔜 | 🌌 🤯 😲 🏠️ 🧑‍🦯 |
| weekend vibes ⓡ | intent | 😎🏖️🍹🥳 | 🙌 👕 👖 🕺 💃 |
| eline sağlık ⓡ | tr | 👏😋🙏🤤 | 🍴 🤌 🧑‍🍳 👨‍🍳 👩‍🍳 |
| hayırlı olsun ⓡ | tr | 🙏🎉🤲👏 | 🤝 🏠️ 💼 ❤️ 🧑‍🎓 |

ⓡ = label marked for human review in queries.jsonl.
