# Emojisense held-out eval

- Date: 2026-10-02 · pack 0.1.0 · 734 queries in 11 locales · 94 personas
- Queries and labels: `@cf/google/gemma-4-26b-a4b-it`. The aliases are written by Claude, so this set is not graded by the alias author. Disputed labels: [queries/heldout-review.md](../queries/heldout-review.md) (not applied).
- Engine per locale: en + that locale, core + ext (what a client loads). Hit = any label in the top k. MRR over the top 10. Macro = mean of locales.

## Per locale

| Locale | n | alias (core + ext) R@1 | R@5 | MRR | fused bge-m3@1024 R@1 | R@5 | MRR | Fused − alias R@5 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| en English | 64 | 26.6 | 57.8 | 0.407 | 34.4 | 62.5 | 0.478 | +4.7 |
| zh 中文 | 64 | 28.1 | 50 | 0.375 | 34.4 | 62.5 | 0.46 | +12.5 |
| hi हिन्दी | 84 | 17.9 | 44 | 0.289 | 25 | 50 | 0.347 | +6.0 |
| es Español | 64 | 35.9 | 67.2 | 0.48 | 31.3 | 68.8 | 0.452 | +1.6 |
| ar العربية | 60 | 5 | 25 | 0.135 | 6.7 | 26.7 | 0.163 | +1.7 |
| fr Français | 61 | 27.9 | 50.8 | 0.381 | 36.1 | 52.5 | 0.431 | +1.7 |
| bn বাংলা | 84 | 14.3 | 28.6 | 0.213 | 19 | 36.9 | 0.267 | +8.3 |
| pt Português | 64 | 29.7 | 59.4 | 0.421 | 28.1 | 60.9 | 0.414 | +1.5 |
| ru Русский | 64 | 18.8 | 53.1 | 0.323 | 26.6 | 67.2 | 0.428 | +14.1 |
| id Bahasa Indonesia | 63 | 27 | 57.1 | 0.376 | 25.4 | 55.6 | 0.378 | -1.5 |
| tr Türkçe | 62 | 25.8 | 54.8 | 0.385 | 35.5 | 59.7 | 0.464 | +4.9 |
| **All (micro)** | 734 | 23 | 49.2 | 0.34 | 27.2 | 54.4 | 0.386 | +5.2 |
| **Mean of locales (macro)** | 734 | 23.4 | 49.8 | 0.344 | 27.5 | 54.8 | 0.389 | +5.0 |

## Next to the in-house suite

In-house numbers: this run. The in-house set has only en and tr queries; the second row compares like with like.

| Suite | n | Alias R@5 | Alias MRR | Fused R@5 | Fused MRR |
| --- | --: | --: | --: | --: | --: |
| In-house (written by Claude) | 214 | 97.7 | 0.872 | 96.7 | 0.892 |
| Held-out, en + tr | 126 | 56.3 | 0.396 | 61.1 | 0.471 |
| Held-out, all locales | 734 | 49.2 | 0.34 | 54.4 | 0.386 |

## Soft gate

This run wrote `reports/heldout-baseline.json`.

No recall@5 drop beyond tolerance (2 points overall, 5 per locale) against the baseline.

## Worst misses per locale (fused bge-m3@1024)

A miss has no label in the top 5. Worst first: not in the top 10, then lowest rank; ties go to queries that the other mode also misses, then to the lower id. – = not in the top 10. The full list is in heldout.json.

### en — English (24 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| feeling so achy | held-en-026 | 😫🤕😣 | – | – | 🤧 😖 🤤 😭 😩 |
| food coma | held-en-033 | 😴💤🥘🤰 | – | – | 🍴 🫃 🫄 🕜️ 🌯 |
| treat yourself | held-en-034 | 💅✨️🍰🥂 | – | – | 🧁 💆 💆‍♂️ 💆‍♀️ 🎁 |
| hangry | held-en-035 | 😡😤🤬🍔 | – | – | 🍽️ 🍴 👹 😾 🐻 |
| this looks elite | held-en-036 | 🤩🔥✨️🍱 | – | – | 🧐 🕴️ 😎 🤵 🦅 |
| pure chaos | held-en-042 | 💀🤣🌀 | – | – | 🪿 🌪️ 🤪 🤍 🦝 |
| absolute washout | held-en-044 | 🌧️☔️⛈️🌊 | – | – | 🗑️ 🎬️ 🐋 🔥 🚮 |
| another long shift from hell | held-en-050 | 😩💀🫠 | – | – | 🫩 ⏰️ 😓 ⚒️ 🕒️ |
| finally off duty | held-en-054 | 💃🥂✌️ | – | – | 😮‍💨 🌆 ⌛️ 😌 ⛓️‍💥 |
| no wayyy | held-en-055 | 😱🤯😲 | – | – | ⛔️ 🙅‍♀️ 🙂‍↔️ 🙅‍♂️ 🚷 |

### zh — Chinese (Simplified) (24 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| 好可爱 | held-zh-033 | 🥰😍🥺 | – | – | 🐤 🐥 🐷 🐳 🐶 |
| 下班 | held-zh-045 | 🏃💨🥳 | – | – | 🌆 🕠️ 🕔️ 🕕️ 😙 |
| 心疼 | held-zh-055 | 🥺❤️🩹 | – | – | 💔 😿 🫂 🕯️ 😢 |
| 这天气没谁了 | held-zh-060 | 🙄☁️🌫️ | – | – | ☔️ 🌥️ 🌧️ 🌨️ 🌦️ |
| 人山人海 | held-zh-063 | 👨‍👩‍👧‍👦👣🌊 | – | – | 🚵 🏄‍♂️ 🚵‍♂️ 🧗 🌄 |
| 赶不上车 | held-zh-065 | 🏃😰🚄 | – | – | 🚐 🚏 🚘️ 🚍️ 🛄 |
| 这也太远了 | held-zh-067 | 😱🗺️🚶 | – | – | 🔥 🇹🇦 🏝️ 👽️ 🫸 |
| 进球了 | held-zh-068 | 🙌 | – | – | ⚽️ 🥅 ⚾️ 🏆️ 🏈 |
| 绝杀 | held-zh-069 | 🔥 | – | – | ⚽️ 🏑 🥅 ⛹️ 🏹 |
| 太菜了 | held-zh-070 | 🤮 | – | – | 🥔 🤦 🥡 🧂 🫙 |

### hi — Hindi (42 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| hasna | held-hi-071 | 😂🤣 | – | – | 😀 🕍 🇸🇭 🧕 🍯 |
| kitna lamba safar hai | held-hi-076 | 😫😴🛤️⏳️ | – | – | 🇮🇩 🇳🇦 🇫🇯 🏝️ 🇰🇪 |
| paisa khatam ho gaya | held-hi-078 | 💸😭📉👛 | – | – | ✅️ 🪊 😝 😮‍💨 ☑️ |
| bheed bohot zyada hai | held-hi-079 | 😵🫂🚉🤯 | – | – | 🇧🇿 🤖 🇿🇼 🇧🇦 🇧🇯 |
| pahunche kya? | held-hi-081 | 📍🚗🏠️❓️ | – | – | 🛬 🥘 🐣 ♟️ 🪳 |
| bas nikal gaya | held-hi-083 | 🏃‍♂️💨😰 | – | – | 🚍️ 🛫 😩 ⏹️ 🔜 |
| bhagwan bachaye | held-hi-086 | 🙏🙌😰 | – | – | ☝️ 🛕 🛐 🤞 🤦 |
| gaana ekdum soulful hai | held-hi-088 | 🎶✨️🎧️ | – | – | 🔂 🌙 🕉️ 🌝 😋 |
| kya acting thi yaar | held-hi-089 | 😱👏🔥 | – | – | 🙄 🤌 🤦 🤦‍♂️ 🤦‍♀️ |
| vibe hi alag hai | held-hi-090 | ✨️🌈🌊 | – | – | 🦔 🌺 😎 🐝 🕴️ |

### es — Spanish (20 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| qué bien | held-es-101 | 🙌🎉✨️ | – | – | 😌 😎 ❤️‍🩹 😁 🙆 |
| estoy muerto | held-es-104 | 😴😫😵‍💫 | – | – | 💀 🧟 🧟‍♂️ 🧟‍♀️ 😵 |
| una locura | held-es-117 | 😵‍💫 | – | – | 🤯 😜 🤪 😮 🐐 |
| qué fuerte | held-es-120 | 😧 | – | – | 🫢 🤯 😮 😲 🦍 |
| un sueño | held-es-121 | 🤩 | – | – | 😴 💤 🌛 🌜️ 🫩 |
| qué robo | held-es-129 | 🤡💸😡 | – | – | 👮 🤖 🦾 🦿 👮‍♂️ |
| estamos limpios | held-es-131 | 💸💀🌵 | – | – | 🪥 🙆 🙆‍♀️ 🙆‍♂️ 🤍 |
| un gustito | held-es-133 | 🍷🍰💅✨️ | – | – | 😌 🫦 🤏 🤭 🤢 |
| estoy de milagro | held-es-137 | 🙏✨️🤕 | – | – | 🌟 😅 🟣 🟪 🏒 |
| no tengo más plata | held-es-149 | 💸💀📉 | – | – | 🪙 💰️ 💲 🤑 😫 |

### ar — Arabic (44 misses of 60)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| جلد | held-ar-001 | ⚔️💪🔥😤 | – | – | 🐊 🧼 👞 👢 🦏 |
| لا لا لا | held-ar-002 | 🤦‍♂️🚫❌️😩 | – | – | 🤷‍♂️ 🤷‍♀️ 🙊 🤷 🚯 |
| mish momken 😂😂😂 | held-ar-006 | 😂🤣🤦‍♂️ | – | – | 🤷‍♂️ 🤷 🤷‍♀️ 🦛 🐤 |
| el haysat keteer 💸 | held-ar-007 | 💸💰️📉 | – | – | 🇰🇼 🇶🇦 🇯🇴 🇸🇻 🧉 |
| akher sa3d 🥲 | held-ar-010 | 🥲💔🥀 | – | – | 🇦🇲 👾 🇳🇪 🖤 📟️ |
| yalla bina 🚀 | held-ar-011 | 🚀🏃‍♂️✨️ | – | – | 🏗️ 👷 👷‍♂️ 👷‍♀️ 📣 |
| مش طبيعي | held-ar-014 | 🤯🔥😱 | – | – | 🤪 🏞️ 🕵️ 🕵️‍♂️ 🕵️‍♀️ |
| يا عيني | held-ar-016 | 😍🥺✨️ | – | – | 👀 👁️‍🗨️ 🙈 🥹 🙄 |
| eid mubarak ya habibi | held-ar-018 | 🍬 | – | – | 🧕 🕋 🕌 🤲 🇦🇪 |
| mabrouk el eid | held-ar-019 | 🎊 | – | – | 🕋 🧕 🧑‍🎓 👨‍🎓 👩‍🎓 |

### fr — French (29 misses of 61)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| n'importe quoi | held-fr-153 | 🙄🤦 | – | – | 🧑 👕 🤬 🤨 🙃 |
| enfin le weekend | held-fr-164 | 🥳🥂💃 | – | – | 🙌 😮‍💨 🕺 😌 🕠️ |
| un pur délice | held-fr-178 | ✨️🤤🍰😍 | – | – | 🤌 🤍 😇 ⚪️ 🏇 |
| l'apéro m'attend | held-fr-181 | 🍷🍸️🍹🥂 | – | – | 🕕️ 🕡️ 🍘 🍻 🫤 |
| je craque | held-fr-183 | 😂🤣💀 | – | – | 🙃 🫠 😖 😻 💘 |
| quel enfer | held-fr-184 | 🤦‍♂️🙄😩 | – | – | 🔑 👹 ☣️ ⚰️ 🪳 |
| trop de dossier | held-fr-186 | 🤭🙊📸 | – | – | 📂 🗂️ 🛸 🗃️ 🗄️ |
| on va geler | held-fr-189 | 🥶❄️🧊 | – | – | ⏸️ 👀 🧎 📟️ 🔛 |
| ça va chauffer | held-fr-192 | 🥵🔥🌡️ | – | – | 🫯 ⚔️ ❤️‍🔥 ⛈️ 😏 |
| je suis trop refait | held-fr-196 | 🥳😎✨️ | – | – | 💄 🤩 😏 🫨 🥹 |

### bn — Bengali (53 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| ki obostha | held-bn-186 | 😂🤣💀 | – | – | 👋 🛵 😧 🕑️ 🥡 |
| amader obostha | held-bn-188 | 🤡🫠🥲 | – | – | 👋 🤲 📩 🧕 🦪 |
| prothom bar dekhlam | held-bn-189 | 👁️👄😲 | – | – | 1️⃣ 🍫 🍸️ 🥨 🦪 |
| beshi kotha bolis na | held-bn-190 | 🤫🤐😑 | – | – | 🤥 😠 😾 🙎 🙎‍♂️ |
| ekdom matha kharap | held-bn-191 | 🤯🥴😵‍💫 | – | – | 🤪 🙂‍↕️ 👌 💯 🤦 |
| ghura ghuri korte hobe | held-bn-192 | 🚗🗺️✈️ | – | – | 🪁 🍦 🟩 🥋 🦍 |
| rasta khub baje | held-bn-194 | 🚧🚗😡 | – | – | 🚷 🇯🇲 🕋 🧕 🇨🇺 |
| ki bhalo jayga | held-bn-196 | 😍🏞️✨️ | – | – | 📍 🅿️ 🇳🇬 🇩🇬 🇯🇲 |
| dekhte hobe | held-bn-197 | 👀🧐🔍️ | – | – | 🏔️ 🏟️ 🎦 🤔 🙂‍↔️ |
| matha thik nai | held-bn-198 | 🤯😵‍💫🧠 | – | – | 💅 🪫 🔨 📪️ ⛔️ |

### pt — Portuguese (Brazil) (25 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| bora | held-pt-223 | 🚀🔥🙌 | – | – | 🇵🇫 🍺 🥳 ✊️ 😃 |
| que coisa linda | held-pt-233 | 😍✨️💖🌹 | – | – | 👧 🫦 💄 🌕️ 🎑 |
| que sufoco | held-pt-238 | 🥵😰🆘 | – | – | 😓 💧 🗜️ 🌁 🧣 |
| tô exausta | held-pt-240 | 😴🔋🫠 | – | – | 😮‍💨 😫 😓 😩 🫩 |
| viva o descanso | held-pt-241 | 🧘‍♀️🍃💆‍♀️ | – | – | 💤 🪼 🛌 🧖 🧖‍♂️ |
| paz | held-pt-246 | 🍃🧘🌊✨️ | – | – | ✌️ 🕊️ 🪷 ☮️ 🏳️ |
| perdi tudo | held-pt-248 | 🫠 | – | – | 😵 🤪 😶‍🌫️ 😩 😡 |
| icônico | held-pt-249 | 🕶️ | – | – | 🤩 🌟 ⭐️ 😼 🙃 |
| zerou a vida | held-pt-251 | 🙌 | – | – | 0️⃣ 🪃 📥️ 🧬 👎️ |
| muito bom | held-pt-252 | 🔝 | – | – | 😄 💮 🆒 😂 💣️ |

### ru — Russian (21 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| жиза | held-ru-241 | 🤝🫠😩 | – | – | 💯 🙃 🥲 😬 🦓 |
| фейл | held-ru-251 | 🤦‍♂️🤦‍♀️🤡 | – | – | ❌️ 🆖 🪊 📁 📥️ |
| что происходит | held-ru-254 | 🤔🤨❓️ | – | – | 😵‍💫 🫨 🫪 ⁉️ 👀 |
| люблю не могу | held-ru-269 | 🥰❤️🥺 | – | – | 😭 🥹 😂 🤣 📖 |
| душевно | held-ru-273 | 🙏🕯️😌 | – | – | 🥲 ☺️ 🪗 🧡 🤪 |
| святая еда | held-ru-275 | 🥧🍞🍯 | – | – | 🍽️ 🫔 🧆 🦑 🥑 |
| спина отваливается | held-ru-278 | 😫😖🤕🦴 | – | – | 🙂‍↔️ 😓 🧎 🧎‍➡️ 🧎‍♀️ |
| мама дорогая | held-ru-280 | 🤦‍♀️🙏😱😰 | – | – | 😨 👩‍🍼 🤱 👩‍👧 👩‍👧‍👧 |
| всем здоровья | held-ru-282 | 🙏❤️🍀✨️ | – | – | 📢 🌍️ 🧑‍⚕️ ⚕️ 🫁 |
| о боже мой | held-ru-286 | 😱🤤🍕 | – | – | 🤦‍♂️ 🫢 🤦 🤦‍♀️ 🧞 |

### id — Indonesian (28 misses of 63)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| seru banget | held-id-296 | 🥳🎉✨️ | – | – | 😄 ❣️ ‼️ ❕️ ❗️ |
| ramai pol | held-id-298 | 🎎🏮🎊 | – | – | 🚓 👮 🎆 🎪 ☀️ |
| meriah parah | held-id-300 | 🎆🎇🎈 | – | – | 😭 🤣 🪅 👏 🉐 |
| lemes bgt asli | held-id-304 | 😩😫🤒🤕 | – | – | 🍋‍🟩 🍯 🍃 🫀 💎 |
| sehat selalu ya | held-id-306 | 💪✨️🙏 | – | – | 🥗 🎂 ❤️‍🩹 ❤️ 🤲 |
| diet mulai besok | held-id-313 | 🤣🍕🍟🙈 | – | – | 🥗 🥩 🥬 🍏 🎬️ |
| riil no fek | held-id-315 | 💯📠✅️ | – | – | ⛔️ 🤣 ®️ 🚯 🚳 |
| agak laen emang | held-id-316 | 🤨🤡🙃 | – | – | 🫤 🤷‍♂️ 🕜️ 🕦️ 🐐 |
| capek bgt luv | held-id-319 | 💀🤡🫠 | – | – | 😫 😩 🥱 😓 😮‍💨 |
| panas pol | held-id-320 | 🌡️ | – | – | ☀️ 🥵 ♨️ 🇵🇱 🪭 |

### tr — Turkish (25 misses of 62)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| pazartesi | held-tr-310 | 😴☕️😫 | – | – | 🙍 🪫 😐️ 😩 🧑‍💼 |
| çok yoğun | held-tr-312 | 🤯🏃‍♂️💻️ | – | – | 🤹 🤹‍♂️ 🤹‍♀️ 🗓️ 🚥 |
| ay çok tatlı | held-tr-328 | 😻✨️🍭 | – | – | 🌒 🌔 🌕️ 🌓 🌛 |
| kafa gidik | held-tr-333 | 🥴😵‍💫🤪 | – | – | 🪶 🦶 💁 💁‍♀️ 🕣️ |
| asla inanmadım | held-tr-334 | 🤨🧐😒 | – | – | 🐘 🙅 ❌️ 🙂‍↔️ ⛔️ |
| hayatım kaydı | held-tr-336 | 🫠📉🆘 | – | – | 📹️ ⏺️ 🎥 🎙️ 👫 |
| bitti bittim | held-tr-348 | 😫😵‍💫🆘 | – | – | 🪫 😩 😵 ⚰️ 😂 |
| delireceğim | held-tr-352 | 🫠🤪💢 | – | – | 😩 😖 🙎 🥴 🤤 |
| doğa harika | held-tr-357 | 🌿🍃🌳✨️ | – | – | 🏞️ ⛰️ 🪸 🌲 🥾 |
| canım yanıyor | held-tr-364 | 🤕🩹😫 | – | – | ❤️‍🔥 🥵 🔥 🧯 🤤 |
