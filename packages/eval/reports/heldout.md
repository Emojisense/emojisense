# Emojisense held-out eval

- Date: 2026-10-03 · pack 0.1.0 · 734 queries in 11 locales · 94 personas
- Queries and labels: `@cf/google/gemma-4-26b-a4b-it`. The aliases are written by Claude, so this set is not graded by the alias author. Disputed labels: [queries/heldout-review.md](../queries/heldout-review.md) (not applied).
- Engine per locale: en + that locale, core + ext (what a client loads). Hit = any label in the top k. MRR over the top 10. Macro = mean of locales.

## Per locale

| Locale | n | alias (core + ext) R@1 | R@5 | MRR | fused embeddinggemma@768 R@1 | R@5 | MRR | Fused − alias R@5 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| en English | 64 | 29.7 | 68.8 | 0.457 | 37.5 | 82.8 | 0.567 | +14.0 |
| zh 中文 | 64 | 37.5 | 59.4 | 0.476 | 40.6 | 64.1 | 0.518 | +4.7 |
| hi हिन्दी | 84 | 31 | 58.3 | 0.43 | 35.7 | 61.9 | 0.483 | +3.6 |
| es Español | 64 | 37.5 | 65.6 | 0.485 | 37.5 | 68.8 | 0.508 | +3.2 |
| ar العربية | 60 | 15 | 33.3 | 0.215 | 21.7 | 53.3 | 0.331 | +20.0 |
| fr Français | 61 | 37.7 | 60.7 | 0.474 | 36.1 | 68.9 | 0.486 | +8.2 |
| bn বাংলা | 84 | 21.4 | 38.1 | 0.297 | 25 | 46.4 | 0.34 | +8.3 |
| pt Português | 64 | 32.8 | 62.5 | 0.454 | 37.5 | 71.9 | 0.51 | +9.4 |
| ru Русский | 64 | 37.5 | 67.2 | 0.503 | 45.3 | 67.2 | 0.555 | +0.0 |
| id Bahasa Indonesia | 63 | 34.9 | 58.7 | 0.44 | 38.1 | 65.1 | 0.501 | +6.4 |
| tr Türkçe | 62 | 41.9 | 59.7 | 0.493 | 48.4 | 69.4 | 0.586 | +9.7 |
| **All (micro)** | 734 | 32.2 | 57.1 | 0.427 | 36.4 | 64.9 | 0.486 | +7.8 |
| **Mean of locales (macro)** | 734 | 32.4 | 57.5 | 0.429 | 36.7 | 65.4 | 0.49 | +7.9 |

## Next to the in-house suite

In-house numbers: this run. The in-house set has only en and tr queries; the second row compares like with like.

| Suite | n | Alias R@5 | Alias MRR | Fused R@5 | Fused MRR |
| --- | --: | --: | --: | --: | --: |
| In-house (written by Claude) | 214 | 98.6 | 0.909 | 98.6 | 0.932 |
| Held-out, en + tr | 126 | 64.3 | 0.475 | 76.2 | 0.576 |
| Held-out, all locales | 734 | 57.1 | 0.427 | 64.9 | 0.486 |

## Soft gate

Warnings only; the held-out gate does not fail the build.

- held-out fused embeddinggemma@768 [zh]: recall@5 64.1 < baseline 71.9 − 5 (n=64)
- held-out fused embeddinggemma@768 [tr]: recall@5 69.4 < baseline 77.4 − 5 (n=62)

## Worst misses per locale (fused embeddinggemma@768)

A miss has no label in the top 5. Worst first: not in the top 10, then lowest rank; ties go to queries that the other mode also misses, then to the lower id. – = not in the top 10. The full list is in heldout.json.

### en — English (11 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| treat yourself | held-en-034 | 💅✨️🍰🥂 | – | – | 🧁 💆 💸 🎁 💆‍♀️ |
| absolute washout | held-en-044 | 🌧️☔️⛈️🌊 | – | – | 🗑️ 🔥 🌪️ 🎬️ 🫥 |
| another long shift from hell | held-en-050 | 😩💀🫠 | – | – | 🫩 👨‍🏭 👩‍🏭 😮‍💨 😫 |
| finally off duty | held-en-054 | 💃🥂✌️ | – | – | 😮‍💨 🌆 😌 🫡 ⌛️ |
| no wayyy | held-en-055 | 😱🤯😲 | – | – | 🙅‍♀️ 🙅‍♂️ ⛔️ 🙀 🙂‍↔️ |
| it is roasting | held-en-072 | 🥵☀️🌡️ | – | – | 🌰 🏕️ 🔥 🍠 👨‍🍳 |
| thinking of you | held-en-064 | 🥰🫂💌 | 10 | – | 💭 💕 🤔 💐 🕯️ |
| food coma | held-en-033 | 😴💤🥘🤰 | 10 | 5 | 🍴 🫃 🫄 🍽️ 🦃 |
| huge win for the ward | held-en-049 | 🥳🙌✨️ | 7 | – | 🛘 🏥 🏆️ 🥇 🟩 |
| pure chaos | held-en-042 | 💀🤣🌀 | 6 | – | 🌪️ 🪿 🤪 🎪 😇 |

### zh — Chinese (Simplified) (23 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| 下班 | held-zh-045 | 🏃💨🥳 | – | – | 🌆 🕔️ 🧑‍🏭 🕠️ 🕕️ |
| 这天气没谁了 | held-zh-060 | 🙄☁️🌫️ | – | – | 🌥️ 🌦️ 🌤️ ⛅️ 🌧️ |
| 挤不动了 | held-zh-062 | 😫😵‍💫🚋 | – | – | 🗜️ 🔇 😪 🧍 😐️ |
| 人山人海 | held-zh-063 | 👨‍👩‍👧‍👦👣🌊 | – | – | ⛰️ 🤦 🧜 🧗 🧌 |
| 赶不上车 | held-zh-065 | 🏃😰🚄 | – | – | 🚘️ 🚍️ 🚗 🔑 🚔️ |
| 这也太远了 | held-zh-067 | 😱🗺️🚶 | – | – | 😭 😦 😧 🫤 🫣 |
| 进球了 | held-zh-068 | 🙌 | – | – | 🥅 ⚽️ 🤾 🤾‍♂️ 🏌️ |
| 绝杀 | held-zh-069 | 🔥 | – | – | ⚽️ 🏑 🗡️ 🔪 ⛹️ |
| 太菜了 | held-zh-070 | 🤮 | – | – | 🔪 🌮 🧑‍🍳 😭 🍴 |
| 又是这种球 | held-zh-071 | 💀 | – | – | 🎳 ⚽️ 🤾 ⛹️ ⛹️‍♂️ |

### hi — Hindi (32 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| kitna lamba safar hai | held-hi-076 | 😫😴🛤️⏳️ | – | – | 🛣️ 🛋️ 🐫 🐪 🪁 |
| bheed bohot zyada hai | held-hi-079 | 😵🫂🚉🤯 | – | – | 🫥 🅱️ 🍞 🐻 🌽 |
| bas nikal gaya | held-hi-083 | 🏃‍♂️💨😰 | – | – | 🔜 😩 🚌 🩼 🚍️ |
| bhagwan bachaye | held-hi-086 | 🙏🙌😰 | – | – | 🛐 ☝️ 🛕 😇 🤦 |
| kya acting thi yaar | held-hi-089 | 😱👏🔥 | – | – | 🎭️ 🙄 🤦 🤹‍♀️ 🤹 |
| kya swaad hai | held-hi-095 | 👌😋✨️🥘 | – | – | 🤌 👅 ❔️ 🪡 🦢 |
| pet bhar gaya | held-hi-097 | 🤰🈵😵‍💫 | – | – | 🫃 🫄 🐾 🐶 🐕️ |
| treat chahiye yaar | held-hi-098 | 🥳🍕🍦🍻 | – | – | 🧁 👬 🎉 🍭 👸 |
| itna sannata kyun hai | held-hi-103 | 🦗😶❓️ | – | – | 🪞 💁 🪅 ❔️ 🙃 |
| acha bey | held-hi-104 | 🤨😏 | – | – | 🙁 😮 🙂 😑 🙆‍♀️ |

### es — Spanish (20 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| qué bien | held-es-101 | 🙌🎉✨️ | – | – | 👌 😃 🆗 🙆 👍️ |
| estoy muerto | held-es-104 | 😴😫😵‍💫 | – | – | 💀 🧟 🧟‍♀️ 🧟‍♂️ 😵 |
| qué fuerte | held-es-120 | 😧 | – | – | 😲 😮 😱 🤯 🫢 |
| un sueño | held-es-121 | 🤩 | – | – | 😴 😪 💤 🛌 🥱 |
| estamos limpios | held-es-131 | 💸💀🌵 | – | – | 🧹 🪥 🤍 ✨️ 🆑 |
| un gustito | held-es-133 | 🍷🍰💅✨️ | – | – | 😌 🤏 😋 🍭 🎀 |
| estoy de milagro | held-es-137 | 🙏✨️🤕 | – | – | 😅 😇 🌟 🏒 😲 |
| qué ganas de verlos | held-es-152 | 🫂🥺✨️ | – | – | 🫦 😃 🤩 👀 🤤 |
| mi familia es un lío | held-es-153 | 🤦‍♂️🤪💥🤯 | – | – | 👨‍👩‍👧 👨‍👩‍👧‍👧 👨‍👩‍👦‍👦 👨‍👨‍👧‍👦 👪️ |
| literalmente yo | held-es-157 | 🤡🫠💀 | – | – | ↔️ 🙂 🙋 👁️‍🗨️ 🙁 |

### ar — Arabic (28 misses of 60)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| جلد | held-ar-001 | ⚔️💪🔥😤 | – | – | 👞 🧼 🧥 👜 👢 |
| لا لا لا | held-ar-002 | 🤦‍♂️🚫❌️😩 | – | – | 🤷‍♀️ 🤷‍♂️ 🤷 🙊 🚯 |
| والله حظ | held-ar-003 | 🤡🎲😭🫠 | – | – | 🍀 🤞 🥠 🪬 🐞 |
| مش طبيعي | held-ar-014 | 🤯🔥😱 | – | – | 🤪 😲 🫤 🥵 🫚 |
| eid mubarak ya habibi | held-ar-018 | 🍬 | – | – | ☪️ 🕋 🕌 🌙 🧕 |
| mabrouk el eid | held-ar-019 | 🎊 | – | – | 🕋 🌙 ㊗️ ☪️ 🥳 |
| el jaw helw awy | held-ar-021 | 🌟 | – | – | 😍 👋 👌 😮 😲 |
| ya rab kollo tamam | held-ar-022 | 🤍 | – | – | 🙂 🤲 🕋 🙏 🫡 |
| fari7a kbira | held-ar-023 | 🥳 | – | – | 🫎 👩‍✈️ 🦀 🍤 🕋 |
| akla tayeret el 3a2l | held-ar-024 | 😋🤤🥘👌 | – | – | 🕒️ 3️⃣ ✒️ 🕞️ 🩼 |

### fr — French (19 misses of 61)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| n'importe quoi | held-fr-153 | 🙄🤦 | – | – | 🤨 🤡 💩 🤷 🤬 |
| enfin le weekend | held-fr-164 | 🥳🥂💃 | – | – | 😮‍💨 🙌 😌 ☀️ 🚵‍♀️ |
| je craque | held-fr-183 | 😂🤣💀 | – | – | 😖 🙃 😻 🫠 🛍️ |
| quel enfer | held-fr-184 | 🤦‍♂️🙄😩 | – | – | 🔑 👿 🤘 🦂 😈 |
| trop de dossier | held-fr-186 | 🤭🙊📸 | – | – | 📁 🗃️ 🗄️ 📂 🗂️ |
| je suis trop refait | held-fr-196 | 🥳😎✨️ | – | – | 😫 💄 🥴 😩 😓 |
| dans le jus | held-fr-200 | 🌊🏃‍♂️😰 | – | – | 🧃 🥤 🍊 🍋 🍋‍🟩 |
| une pépite | held-fr-206 | 🎶 | – | – | 💎 🐤 🍪 🐣 🐦️ |
| j'ai les boules | held-fr-207 | 😢 | – | – | 😟 🙍 🎳 🎱 😰 |
| une légende | held-fr-210 | 🌟 | – | – | 🧌 🐲 🐦‍🔥 🫈 🦵 |

### bn — Bengali (45 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| ki obostha | held-bn-186 | 😂🤣💀 | – | – | 👋 😬 8️⃣ 🌫️ 🌰 |
| vab dekh | held-bn-187 | 🙄🤨😏 | – | – | 😎 📬️ 🆚 🙈 👁️‍🗨️ |
| amader obostha | held-bn-188 | 🤡🫠🥲 | – | – | 👋 🌑 😬 🙋‍♀️ 🥭 |
| prothom bar dekhlam | held-bn-189 | 👁️👄😲 | – | – | 1️⃣ 📺️ 🥇 🔰 📽️ |
| beshi kotha bolis na | held-bn-190 | 🤫🤐😑 | – | – | 🤥 🦂 ㊙️ 🫘 😠 |
| ghura ghuri korte hobe | held-bn-192 | 🚗🗺️✈️ | – | – | 🪁 🕳️ 🎠 🚋 🐮 |
| shob thik thak | held-bn-195 | 👍️✅️👌 | – | – | 🙆‍♂️ 🙆‍♀️ 🙆 ✔️ 🙃 |
| ki bhalo jayga | held-bn-196 | 😍🏞️✨️ | – | – | 📍 🌺 🅿️ 🙌 🈁 |
| dekhte hobe | held-bn-197 | 👀🧐🔍️ | – | – | 🎪 🎦 ⛲️ 🏔️ 🍺 |
| matha thik nai | held-bn-198 | 🤯😵‍💫🧠 | – | – | 📶 👩‍🦲 🧑‍🦲 👨‍🦲 🌐 |

### pt — Portuguese (Brazil) (18 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| bora | held-pt-223 | 🚀🔥🙌 | – | – | 🥳 🇵🇫 ✊️ 🚶 😃 |
| tô exausta | held-pt-240 | 😴🔋🫠 | – | – | 😮‍💨 😫 🫩 😓 😩 |
| viva o descanso | held-pt-241 | 🧘‍♀️🍃💆‍♀️ | – | – | 🛌 💤 😴 🪼 😮‍💨 |
| perdi tudo | held-pt-248 | 🫠 | – | – | 😩 💔 📉 🧭 🥀 |
| icônico | held-pt-249 | 🕶️ | – | – | 😼 🙃 💁 💁‍♂️ 🤩 |
| zerou a vida | held-pt-251 | 🙌 | – | – | 0️⃣ 🦓 🧟‍♀️ 🥀 🧟 |
| muito bom | held-pt-252 | 🔝 | – | – | 😄 💮 🆒 🙂 👏 |
| tá impossível | held-pt-256 | 💀🤡🫠 | – | – | 😲 🙅 🎋 🚫 🤦‍♂️ |
| o pai tá on | held-pt-257 | 😎🔥🤙 | – | – | 👨‍👧‍👦 👨‍🍼 👨‍👦 👨‍👧 👨‍👦‍👦 |
| tá muito difícil | held-pt-258 | 😩🆘📉 | – | – | ☹️ 😣 😫 😮‍💨 🍍 |

### ru — Russian (21 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| жиза | held-ru-241 | 🤝🫠😩 | – | – | 💯 🥲 🦒 🐐 🙃 |
| фейл | held-ru-251 | 🤦‍♂️🤦‍♀️🤡 | – | – | ❌️ 🆖 🤦 🪊 🧚 |
| что происходит | held-ru-254 | 🤔🤨❓️ | – | – | 😵‍💫 🫪 ⁉️ 🫨 👀 |
| душевно | held-ru-273 | 🙏🕯️😌 | – | – | ☺️ 🥲 🙍 🪗 🙍‍♂️ |
| святая еда | held-ru-275 | 🥧🍞🍯 | – | – | 🫔 🧆 😋 🥞 🥑 |
| наконец-то выходные | held-ru-276 | 🥂💃🕺 | – | – | 🙌 😮‍💨 😌 🎉 👪️ |
| светлый праздник | held-ru-277 | 🌟☀️🕊️ | – | – | 🎆 🎊 🎇 🤍 🥳 |
| мама дорогая | held-ru-280 | 🤦‍♀️🙏😱😰 | – | – | 😨 👩‍👧 👩‍👦 👩 👩‍👧‍👦 |
| всем здоровья | held-ru-282 | 🙏❤️🍀✨️ | – | – | 🥦 👋 👌 ❤️‍🩹 🍯 |
| лучшие люди | held-ru-291 | 🫂🤝💎 | – | – | 🧑‍🤝‍🧑 👯 🔝 🥇 👭 |

### id — Indonesian (22 misses of 63)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| seru banget | held-id-296 | 🥳🎉✨️ | – | – | 😄 😃 ❣️ ‼️ ❕️ |
| suasana syahdu | held-id-297 | 🙏✨️🕯️ | – | – | 🌺 🌥️ 😌 🌴 🌆 |
| ramai pol | held-id-298 | 🎎🏮🎊 | – | – | 🚓 👮 👮‍♂️ 🚔️ 👮‍♀️ |
| meriah parah | held-id-300 | 🎆🎇🎈 | – | – | 🪅 🦚 👏 ✨️ 🉐 |
| lemes bgt asli | held-id-304 | 😩😫🤒🤕 | – | – | 🍯 🍋 💎 🫀 😛 |
| sehat selalu ya | held-id-306 | 💪✨️🙏 | – | – | ❤️ 🤲 🎂 🥗 ❤️‍🩹 |
| diet mulai besok | held-id-313 | 🤣🍕🍟🙈 | – | – | 🥗 🎬️ 🥬 💼 📆 |
| riil no fek | held-id-315 | 💯📠✅️ | – | – | 🍘 🍥 🪶 🍶 🎐 |
| agak laen emang | held-id-316 | 🤨🤡🙃 | – | – | 🐐 🤤 🙆‍♂️ 🪁 😝 |
| capek bgt luv | held-id-319 | 💀🤡🫠 | – | – | 😫 😍 ❤️ 🥰 😩 |

### tr — Turkish (19 misses of 62)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| çok yoğun | held-tr-312 | 🤯🏃‍♂️💻️ | – | – | 🗓️ 🚦 🚥 😩 🏥 |
| başarılar | held-tr-314 | 👏✨️🚀 | – | – | 🏆️ 🍀 💪 🥇 🎉 |
| ay çok tatlı | held-tr-328 | 😻✨️🍭 | – | – | 😍 🌛 🌜️ 🥮 🌙 |
| patladım | held-tr-335 | 💀😂🤣 | – | – | 🫄 🫃 🛼 🧨 🥔 |
| hayatım kaydı | held-tr-336 | 🫠📉🆘 | – | – | 📒 👫 ⏺️ 🎥 📔 |
| bitti bittim | held-tr-348 | 😫😵‍💫🆘 | – | – | 🔚 🪫 😩 💀 🫦 |
| delireceğim | held-tr-352 | 🫠🤪💢 | – | – | 🫖 🕳️ 🖋️ 📝 📤️ |
| canım yanıyor | held-tr-364 | 🤕🩹😫 | – | – | 🔥 ❤️‍🔥 🥵 🧯 🌋 |
| rejim bitti | held-tr-371 | 🍩🍕🍔🫠 | – | – | 🔚 🧑‍🎨 🪫 🎨 🛎️ |
| yine başladık | held-tr-332 | 🤦‍♂️🙄😩 | – | 4 | 🔁 🔄 🙃 ⏮️ 🔙 |
