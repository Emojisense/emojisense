# Emojisense held-out eval

- Date: 2026-10-02 · pack 0.1.0 · 734 queries in 11 locales · 94 personas
- Queries and labels: `@cf/google/gemma-4-26b-a4b-it`. The aliases are written by Claude, so this set is not graded by the alias author. Disputed labels: [queries/heldout-review.md](../queries/heldout-review.md) (not applied).
- Engine per locale: en + that locale, core + ext (what a client loads). Hit = any label in the top k. MRR over the top 10. Macro = mean of locales.

## Per locale

| Locale | n | alias (core + ext) R@1 | R@5 | MRR | fused bge-m3@1024 R@1 | R@5 | MRR | Fused − alias R@5 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| en English | 64 | 31.3 | 64.1 | 0.455 | 35.9 | 70.3 | 0.51 | +6.2 |
| zh 中文 | 64 | 39.1 | 59.4 | 0.473 | 39.1 | 68.8 | 0.524 | +9.4 |
| hi हिन्दी | 84 | 19 | 45.2 | 0.3 | 23.8 | 51.2 | 0.351 | +6.0 |
| es Español | 64 | 35.9 | 65.6 | 0.481 | 39.1 | 68.8 | 0.506 | +3.2 |
| ar العربية | 60 | 5 | 25 | 0.135 | 8.3 | 33.3 | 0.197 | +8.3 |
| fr Français | 61 | 34.4 | 60.7 | 0.464 | 34.4 | 57.4 | 0.443 | -3.3 |
| bn বাংলা | 84 | 14.3 | 28.6 | 0.213 | 23.8 | 34.5 | 0.29 | +5.9 |
| pt Português | 64 | 29.7 | 64.1 | 0.433 | 28.1 | 67.2 | 0.44 | +3.1 |
| ru Русский | 64 | 34.4 | 57.8 | 0.443 | 43.8 | 67.2 | 0.545 | +9.4 |
| id Bahasa Indonesia | 63 | 28.6 | 60.3 | 0.4 | 31.7 | 65.1 | 0.446 | +4.8 |
| tr Türkçe | 62 | 32.3 | 59.7 | 0.445 | 37.1 | 64.5 | 0.51 | +4.8 |
| **All (micro)** | 734 | 27.1 | 52.9 | 0.379 | 31.1 | 58.2 | 0.428 | +5.3 |
| **Mean of locales (macro)** | 734 | 27.6 | 53.7 | 0.386 | 31.4 | 58.9 | 0.433 | +5.2 |

## Next to the in-house suite

In-house numbers: this run. The in-house set has only en and tr queries; the second row compares like with like.

| Suite | n | Alias R@5 | Alias MRR | Fused R@5 | Fused MRR |
| --- | --: | --: | --: | --: | --: |
| In-house (written by Claude) | 214 | 99.1 | 0.888 | 98.6 | 0.91 |
| Held-out, en + tr | 126 | 61.9 | 0.45 | 67.5 | 0.51 |
| Held-out, all locales | 734 | 52.9 | 0.379 | 58.2 | 0.428 |

## Soft gate

This run wrote `reports/heldout-baseline.json`.

No recall@5 drop beyond tolerance (2 points overall, 5 per locale) against the baseline.

## Worst misses per locale (fused bge-m3@1024)

A miss has no label in the top 5. Worst first: not in the top 10, then lowest rank; ties go to queries that the other mode also misses, then to the lower id. – = not in the top 10. The full list is in heldout.json.

### en — English (19 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| feeling so achy | held-en-026 | 😫🤕😣 | – | – | 🤧 😖 😭 🫪 😥 |
| treat yourself | held-en-034 | 💅✨️🍰🥂 | – | – | 🧁 💆 💆‍♂️ 💆‍♀️ 🎁 |
| pure chaos | held-en-042 | 💀🤣🌀 | – | – | 🌪️ 🪿 🤪 🤍 🦝 |
| absolute washout | held-en-044 | 🌧️☔️⛈️🌊 | – | – | 🗑️ 🐋 🔥 🎬️ 🚮 |
| another long shift from hell | held-en-050 | 😩💀🫠 | – | – | 🧑‍🏭 👨‍🏭 🫩 ⏰️ 👩‍🏭 |
| finally off duty | held-en-054 | 💃🥂✌️ | – | – | 😮‍💨 😌 ⌛️ 🌆 ⛓️‍💥 |
| no wayyy | held-en-055 | 😱🤯😲 | – | – | ⛔️ 🙅‍♀️ 🙅‍♂️ 🙂‍↔️ 🚷 |
| we lost | held-en-058 | 💀📉😞 | – | – | 😔 😶‍🌫️ 🥀 🧭 😕 |
| thinking of you | held-en-064 | 🥰🫂💌 | – | – | 💭 💐 💕 🕯️ 🤔 |
| it is roasting | held-en-072 | 🥵☀️🌡️ | – | – | 🌰 🍳 🦞 🍽️ 🍗 |

### zh — Chinese (Simplified) (20 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| 下班 | held-zh-045 | 🏃💨🥳 | – | – | 🌆 🕔️ 🕠️ 🕕️ 🧑‍🏭 |
| 这天气没谁了 | held-zh-060 | 🙄☁️🌫️ | – | – | 🌤️ ⛅️ 🌧️ 🌨️ 🌁 |
| 人山人海 | held-zh-063 | 👨‍👩‍👧‍👦👣🌊 | – | – | 🤽 ⛰️ 🚵‍♂️ 🚵 🏄‍♂️ |
| 这也太远了 | held-zh-067 | 😱🗺️🚶 | – | – | 🔥 🫤 👽️ 🌵 🛸 |
| 进球了 | held-zh-068 | 🙌 | – | – | ⚽️ 🥅 🤾 🤾‍♂️ 🏌️ |
| 绝杀 | held-zh-069 | 🔥 | – | – | ⚽️ 🏑 ⛹️ 🥅 ⚔️ |
| 太菜了 | held-zh-070 | 🤮 | – | – | 🔪 🥔 🌶️ 😞 💸 |
| 又是这种球 | held-zh-071 | 💀 | – | – | 🤾 🪀 ⚽️ 🤾‍♂️ 🤾‍♀️ |
| 唉 | held-zh-072 | 🥀 | – | – | 😮‍💨 😦 🪊 🙍‍♂️ 🫤 |
| 寄了 | held-zh-073 | 🏳️ | – | – | 💀 😵 😦 ☠️ 🦤 |

### hi — Hindi (41 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| hasna | held-hi-071 | 😂🤣 | – | – | 😀 🦢 🍯 👭 🧕 |
| kitna lamba safar hai | held-hi-076 | 😫😴🛤️⏳️ | – | – | 🦙 🚊 🦞 🧳 🚋 |
| paisa khatam ho gaya | held-hi-078 | 💸😭📉👛 | – | – | ✅️ 🪊 😝 😮‍💨 ☑️ |
| bheed bohot zyada hai | held-hi-079 | 😵🫂🚉🤯 | – | – | ☣️ 🦡 ❕️ 🐯 ☸️ |
| pahunche kya? | held-hi-081 | 📍🚗🏠️❓️ | – | – | 🛬 🥘 👝 🐾 🪈 |
| bas nikal gaya | held-hi-083 | 🏃‍♂️💨😰 | – | – | ⏏️ 🛑 🚌 🛫 😩 |
| bhagwan bachaye | held-hi-086 | 🙏🙌😰 | – | – | 🤷‍♂️ ☝️ 🛕 🛐 🤞 |
| kya acting thi yaar | held-hi-089 | 😱👏🔥 | – | – | 🙄 🤌 🤦 🤦‍♂️ 🤦‍♀️ |
| vibe hi alag hai | held-hi-090 | ✨️🌈🌊 | – | – | 🌺 🦩 🦔 😎 🥑 |
| isne toh aag laga di | held-hi-091 | 🔥🥵💥 | – | – | ❤️‍🔥 😣 🧞‍♂️ 😤 🤷‍♀️ |

### es — Spanish (20 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| qué bien | held-es-101 | 🙌🎉✨️ | – | – | 😃 😌 😎 🙆 🙆‍♀️ |
| una locura | held-es-117 | 😵‍💫 | – | – | 😜 🤪 🤯 🤩 😮 |
| qué fuerte | held-es-120 | 😧 | – | – | 😲 🫢 🤯 😮 😱 |
| un sueño | held-es-121 | 🤩 | – | – | 😪 💤 😴 🛌 🫩 |
| qué robo | held-es-129 | 🤡💸😡 | – | – | 🤖 👮 🏦 🦾 🦿 |
| estamos limpios | held-es-131 | 💸💀🌵 | – | – | 🪥 🙆‍♂️ 🙆 🙆‍♀️ 🤍 |
| un gustito | held-es-133 | 🍷🍰💅✨️ | – | – | 😌 😉 😋 😜 🍋‍🟩 |
| estoy de milagro | held-es-137 | 🙏✨️🤕 | – | – | 😅 🟣 🟪 🏒 🕎 |
| qué ganas de verlos | held-es-152 | 🫂🥺✨️ | – | – | 🤩 😃 🥰 😋 🤤 |
| mi familia es un lío | held-es-153 | 🤦‍♂️🤪💥🤯 | – | – | 👩‍👩‍👧‍👦 👨‍👨‍👧‍👦 👪️ 👨‍👩‍👦‍👦 👩‍👩‍👧 |

### ar — Arabic (40 misses of 60)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| جلد | held-ar-001 | ⚔️💪🔥😤 | – | – | 🧼 👞 🦏 🧥 🐊 |
| لا لا لا | held-ar-002 | 🤦‍♂️🚫❌️😩 | – | – | 🤷‍♂️ 🤷‍♀️ 🙊 🤷 🚯 |
| mish momken 😂😂😂 | held-ar-006 | 😂🤣🤦‍♂️ | – | – | 🤷 🤷‍♂️ 🍜 🦛 🥟 |
| el haysat keteer 💸 | held-ar-007 | 💸💰️📉 | – | – | 🔐 🛄 🧉 ⛓️‍💥 🕔️ |
| akher sa3d 🥲 | held-ar-010 | 🥲💔🥀 | – | – | 🇦🇲 🛠️ 🌃 📤️ 🦯 |
| yalla bina 🚀 | held-ar-011 | 🚀🏃‍♂️✨️ | – | – | 🏗️ 👷 📣 👷‍♀️ 👷‍♂️ |
| مش طبيعي | held-ar-014 | 🤯🔥😱 | – | – | 🤪 🕵️ 🕵️‍♂️ 🕵️‍♀️ 😲 |
| eid mubarak ya habibi | held-ar-018 | 🍬 | – | – | 🧕 🕋 🕌 🌙 🤲 |
| mabrouk el eid | held-ar-019 | 🎊 | – | – | 🕌 🕋 🧕 🧑‍🎓 👨‍🎓 |
| el jaw helw awy | held-ar-021 | 🌟 | – | – | 🧝 🧝‍♂️ 🐺 🧝‍♀️ 🤦‍♂️ |

### fr — French (26 misses of 61)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| n'importe quoi | held-fr-153 | 🙄🤦 | – | – | 🤨 🤡 🧑 👕 🤬 |
| enfin le weekend | held-fr-164 | 🥳🥂💃 | – | – | 🙌 ⛱️ 🕺 👖 😮‍💨 |
| un pur délice | held-fr-178 | ✨️🤤🍰😍 | – | – | 🤍 🤌 😇 ⚪️ 🏇 |
| je craque | held-fr-183 | 😂🤣💀 | – | – | 🙃 🫠 😖 😻 🛍️ |
| quel enfer | held-fr-184 | 🤦‍♂️🙄😩 | – | – | 🔑 🌋 ☣️ 🤮 ⚰️ |
| trop de dossier | held-fr-186 | 🤭🙊📸 | – | – | 🗄️ 📁 📂 🗂️ 🥴 |
| ça va chauffer | held-fr-192 | 🥵🔥🌡️ | – | – | 🫯 ⚔️ ❤️‍🔥 🧨 ⛈️ |
| je suis trop refait | held-fr-196 | 🥳😎✨️ | – | – | 💄 😫 🤩 🥴 😏 |
| dans le jus | held-fr-200 | 🌊🏃‍♂️😰 | – | – | 🧃 🥤 🍊 🧑‍⚖️ 👨‍⚖️ |
| une pépite | held-fr-206 | 🎶 | – | – | 🍪 💎 🐤 🦄 👧 |

### bn — Bengali (55 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| ki obostha | held-bn-186 | 😂🤣💀 | – | – | 👋 🥱 😔 😩 🌑 |
| amader obostha | held-bn-188 | 🤡🫠🥲 | – | – | 👋 🥑 🌑 🫙 🥺 |
| prothom bar dekhlam | held-bn-189 | 👁️👄😲 | – | – | 1️⃣ 🛢️ 🍫 🪩 💂‍♂️ |
| beshi kotha bolis na | held-bn-190 | 🤫🤐😑 | – | – | 🤥 😠 😾 🙎 🙎‍♂️ |
| ekdom matha kharap | held-bn-191 | 🤯🥴😵‍💫 | – | – | 🤪 🙂‍↕️ 👌 💯 ♠️ |
| ghura ghuri korte hobe | held-bn-192 | 🚗🗺️✈️ | – | – | 🪁 🧉 🍻 ⛳️ 🔍️ |
| rasta khub baje | held-bn-194 | 🚧🚗😡 | – | – | 🚷 🇯🇲 🥙 🕋 🧕 |
| ki bhalo jayga | held-bn-196 | 😍🏞️✨️ | – | – | 📍 🅿️ 🕚️ 🤹 🥋 |
| dekhte hobe | held-bn-197 | 👀🧐🔍️ | – | – | 🎦 🤔 🏔️ 🏟️ 🙂‍↔️ |
| matha thik nai | held-bn-198 | 🤯😵‍💫🧠 | – | – | 💅 🪫 🔨 📪️ ⛔️ |

### pt — Portuguese (Brazil) (21 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| bora | held-pt-223 | 🚀🔥🙌 | – | – | 🥳 ✊️ 🚶 😃 🚶‍♂️ |
| tô exausta | held-pt-240 | 😴🔋🫠 | – | – | 😮‍💨 🫩 😫 😓 😩 |
| viva o descanso | held-pt-241 | 🧘‍♀️🍃💆‍♀️ | – | – | 💤 🛌 🧖‍♀️ 🛏️ 🪼 |
| paz | held-pt-246 | 🍃🧘🌊✨️ | – | – | ✌️ 🕊️ 🪷 ☮️ 🏳️ |
| perdi tudo | held-pt-248 | 🫠 | – | – | 😩 😵 🧭 😶‍🌫️ 🚆 |
| icônico | held-pt-249 | 🕶️ | – | – | 😼 🙃 💁 💁‍♂️ 🤩 |
| zerou a vida | held-pt-251 | 🙌 | – | – | 0️⃣ 👎️ 🙃 📥️ 🥰 |
| muito bom | held-pt-252 | 🔝 | – | – | 😄 💮 🆒 😂 💣️ |
| tá impossível | held-pt-256 | 💀🤡🫠 | – | – | 😲 🎋 😩 😑 🤦‍♂️ |
| o pai tá on | held-pt-257 | 😎🔥🤙 | – | – | 👨‍🍼 👨‍👦 🧑‍🍼 👨‍👦‍👦 👨‍👧 |

### ru — Russian (21 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| жиза | held-ru-241 | 🤝🫠😩 | – | – | 💯 🥲 😬 🙃 🪼 |
| фейл | held-ru-251 | 🤦‍♂️🤦‍♀️🤡 | – | – | ❌️ 🆖 🪊 🤦 🐥 |
| что происходит | held-ru-254 | 🤔🤨❓️ | – | – | 😵‍💫 🫪 ⁉️ 🫨 👀 |
| люблю не могу | held-ru-269 | 🥰❤️🥺 | – | – | 😭 🫠 🥹 🫣 🤣 |
| душевно | held-ru-273 | 🙏🕯️😌 | – | – | 🥲 ☺️ 🪗 😔 💜 |
| святая еда | held-ru-275 | 🥧🍞🍯 | – | – | 🫔 ☦️ 🧆 ✡️ 🦑 |
| мама дорогая | held-ru-280 | 🤦‍♀️🙏😱😰 | – | – | 😨 👩‍👧 🤱 👩‍🍼 👩‍👧‍👧 |
| всем здоровья | held-ru-282 | 🙏❤️🍀✨️ | – | – | 📢 🌍️ 👋 🧑‍⚕️ ⚕️ |
| как же это тепло | held-ru-290 | ❤️🥰✨️ | – | – | 🧡 🆒 🤗 ☀️ 🌤️ |
| вместе веселее | held-ru-294 | 🥳👯‍♂️🎮️ | – | – | 🧑‍🤝‍🧑 🎉 🎊 👭 👫 |

### id — Indonesian (22 misses of 63)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| seru banget | held-id-296 | 🥳🎉✨️ | – | – | 😄 ‼️ ❣️ ❕️ ❗️ |
| suasana syahdu | held-id-297 | 🙏✨️🕯️ | – | – | 🌆 💂‍♂️ 🧘 🏟️ 💂‍♀️ |
| ramai pol | held-id-298 | 🎎🏮🎊 | – | – | 🚓 👮 👮‍♂️ 🎆 🎪 |
| meriah parah | held-id-300 | 🎆🎇🎈 | – | – | 🪅 😭 ✨️ 😬 👏 |
| lemes bgt asli | held-id-304 | 😩😫🤒🤕 | – | – | 🍋‍🟩 🍯 🍃 🫀 💎 |
| sehat selalu ya | held-id-306 | 💪✨️🙏 | – | – | ❤️ 🥗 ❤️‍🩹 🤲 🎂 |
| diet mulai besok | held-id-313 | 🤣🍕🍟🙈 | – | – | 🥗 🥩 🥬 🍏 🎬️ |
| riil no fek | held-id-315 | 💯📠✅️ | – | – | 🚯 🪦 🤳 🙂‍↔️ ⛔️ |
| capek bgt luv | held-id-319 | 💀🤡🫠 | – | – | 😩 😫 🥱 😓 😑 |
| panas pol | held-id-320 | 🌡️ | – | – | ☀️ 🥵 🫠 ♨️ 🇵🇱 |

### tr — Turkish (22 misses of 62)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| çok yoğun | held-tr-312 | 🤯🏃‍♂️💻️ | – | – | 🤹 🤹‍♀️ 🤹‍♂️ 🗓️ 🚥 |
| ay çok tatlı | held-tr-328 | 😻✨️🍭 | – | – | 😍 🌕️ 🌒 🌓 🌛 |
| kafa gidik | held-tr-333 | 🥴😵‍💫🤪 | – | – | 🪶 🦶 🥣 💁 🐩 |
| asla inanmadım | held-tr-334 | 🤨🧐😒 | – | – | 🐘 🙅 ❌️ 🙂‍↔️ ⛔️ |
| patladım | held-tr-335 | 💀😂🤣 | – | – | 🫃 🫄 💥 🤯 🛒 |
| hayatım kaydı | held-tr-336 | 🫠📉🆘 | – | – | 📹️ ⏺️ 🎙️ 🎥 👫 |
| bitti bittim | held-tr-348 | 😫😵‍💫🆘 | – | – | 🪫 😩 💀 🔚 😂 |
| doğa harika | held-tr-357 | 🌿🍃🌳✨️ | – | – | 🏞️ 🪸 🌲 ⛰️ 🥾 |
| kafa yerinde değil | held-tr-362 | 😵‍💫🧠🌀 | – | – | 🌫️ 😖 🤯 😕 😶‍🌫️ |
| canım yanıyor | held-tr-364 | 🤕🩹😫 | – | – | 🥵 ❤️‍🔥 🔥 🌡️ 🪭 |
