# Enrichment review notes

The generation agents flagged these items for a human check. Aliases that the agents were unsure
about are already in `low` (weakest field). `build/review.csv` lists all low-confidence, collided
and moderated aliases.

## Sensitive or possibly offensive

| Emoji | Note |
| ----- | ---- |
| 👲 | Can read as a stereotype. Aliases stay on the hat, Chinese culture and Lunar New Year. Region words are in `low`. |
| 👳 🧕 | sheikh, imam, niqab, nine (tr "grandma") can read as stereotypes. All are in `low`. |
| 😶‍🌫️ | "high" and "stoned" (vape/smoke) are in `low`. |
| 🫦 | Flirt terms (daddy, zaddy, fifty shades) are in `low`. |
| 🖕 | "f u" is in `slang`; "stfu" is in `low`. |
| 🍆 🍑 💦 😩 | Innuendo is in `low`. "nsfw" is blocked. |
| 🐸 | "pepe" is in `low`, because some uses of the meme are hateful. Consider removing it. |
| 💜 🤎 🖤 | Fandom (bts, army) and cause aliases (black lives matter, blm). |
| 🥥 | "fell out of a coconut tree" is a political meme (no person named). |
| 🍎 (tr) | "kızılelma" is a political/nationalist term. It is in `low`. |
| 👱 👨‍🦲 (tr) | "dazlak" can also mean skinhead. |
| 🐺 (tr) | "bozkurt" is the grey wolf, and also a nationalist symbol. It is in `low`. |
| 🇨🇾 (tr) | Republic of Cyprus flag. Uses "güney kıbrıs", "kıbrıs rum kesimi". "kktc" and north-only places are left out (political). |
| 🇧🇦 (tr) | "srebrenitsa" is in `low` (remembrance posts). |
| 🇪🇭 🇫🇰 | Disputed territories. Both names are given (Falklands / Malvinas), with neutral wording. |
| 🇮🇱 | "jerusalem"/"kudüs" and "holy land" are in `low`. The desc is neutral. |
| 🇳🇪 | No typo aliases, so that no misspelling looks like a slur. Tags overlap with Nigeria. |
| 🇰🇵 | "best korea" and "supreme leader" are in `low`. |
| 🇰🇿 | "borat" (fictional) and catchphrases. A reviewer may see a stereotype. |
| 🔱 | "slava ukraini" and "har har mahadev" (national/religious) are in `low`. |
| ♂️ | "alpha male" and "sigma male" are in `low`. |
| ☪️ (tr) | Heavy bayram/kandil coverage. "türk bayrağı" is in `low` (collides with 🇹🇷). |
| 🦯 | Joking "i can't see" uses are in `low`. |
| 🗜️ (tr) | "işkence" is the carpenters' word for a clamp, but also means "torture". It is in `low`. |
| 🌈 | Identity slang such as "fruity" is in `low` (can read as an insult). |
| 🔫 | Water-gun play only; "james bond" and "sniper" may pull in real-gun searches. |
| 🧩 | "autism awareness" kept; the autistic community disputes the puzzle-piece symbol. |
| ⛑️ (tr) | Earthquake terms ("6 şubat", "deprem", AFAD/AKUT). Broad ones are in `low`. |
| 🥛 (tr) | "aslan sütü" and "rakı" (regional use) are in `low`. |
| 🏟️ (tr) | Club names are in `low`. Stadium names that contain a person's name are left out. |
| 🇵🇸 🇺🇦 🇸🇾 | Solidarity intents ("free palestine", "pray for gaza", "slava ukraini"): political but common. |
| 🇹🇩 | "gigachad" / "chad energy" meme slang is in `low`. |
| 🫏 🐘 | US party symbols ("democratic party", "republican party") are in `low`. |

## Accuracy unsure

| Emoji | Note |
| ----- | ---- |
| 🫈 🫯 🫜 🫔 🫆 🫪 🛘 | New emoji (Emoji 16/17) with little real usage. Many aliases are inferred from the image. |
| 👁️‍🗨️ | English "I am a witness" anti-bullying meaning vs Turkish CLDR "nazar". |
| 🦃 | No alias for the country Türkiye. Check that "turkey" also surfaces 🇹🇷. |
| 🦞 | "openclaw" (AI agent mascot) is recent and may not last. Older names are in `low`. |
| 👷 (tr) | "bob usta" may not be the Turkish title of Bob the Builder. |
| 🐛 🐞 (tr) | Dev loanwords ("bug var", "buga girdim") instead of native Turkish terms. |
| Turkish TV titles | "kafadar ayılar", "kızgın kunduzlar", "beyaz lotus" were not confirmed. They are in `low`. |
| ❤️ colours | Football club colours (fenerbahçe, galatasaray, beşiktaş, trabzonspor, …) are partly guessed. |
| 🙆 | The Japanese "maru" (OK) meaning is niche. Most people search 👌 for "ok". |
| 🙍‍♂️ 🙍‍♀️ 🙎 | The aliases overlap heavily (e.g. "bummed", "not happy"). |
| 🤾 | "throw exception" (dev) is a stretch. It is in `low`. |
| 🕴️ 💂 🛀 | Reaction meanings are niche or guessed. |
| 😇 (tr) | Condolence phrases ("rahmetli", "nur içinde yatsın") are in `low`. They fit 🤲 better. |
| 🤑 🤗 | "unicorn" collides with 🦄. "hugging face" (AI company) is in `dev`. |
| ☸️ | Kubernetes/helm aliases (from the logo) next to the Buddhist meaning. |
| 🗿 🔑 | Short-lived meme slang (sigma, aura, mog; lowkey/highkey). |
| 🇬🇪 | Aliases cover the country only, not the US state. |
| 🪊 🪎 | Emoji 17; usage guessed ("sad trombone", "loot"). |
| 📘 💴 🎷 | "facebook" (low), yuan via ¥, "epic sax guy" (meme nickname of a real performer). |
| 🎍 🎏 🎋 | Niche Japanese terms and Turkish cultural stretches ("23 nisan", "hıdırellez") are in `low`. |
| 🔥 (tr) | Source of the meme "yanıyorsun fuat abi" is unclear. It is in `low`. |
| 🈂️ (tr) | "sa" / "selamün aleyküm" (from the `sa` shortcode) are in `low`. |
| 6️⃣ 7️⃣ | The "six seven" / "67" meme is trend-dependent. |
| 🔵 🟡 🟦 🟨 (tr) | Football club colour combinations are partly in `low`. |
| ◽️ ▫️ | "gray square" depends on the platform rendering. |
| 🗼 | "eiffel tower" and "paris" are figurative matches (people use 🗼 for Paris). |
| 🎡 🎢 (tr) | It is not clear that people search for the theme parks "isfanbul" and "vialand" by name. |
| 🕋 🕌 | General religious phrases ("inshallah", "allah kabul etsin") are in `low`. |
| 🚑 | The "emotional damage" and "you got roasted" meme meanings are a judgement call. |

## Thin coverage

- Family variants (24): built from shared base aliases plus specific ones for each parent and child mix. They overlap a lot.
- Facing-right person variants: few own aliases, filled with "moving forward", "next step".
- 🧔‍♀️ (en), 🤽 (tr), 🧑‍🌾 and 🧑‍🍳 (tr typos).
