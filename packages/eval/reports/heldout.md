# Emojisense held-out eval

- Date: 2026-10-02 · pack 0.1.0 · 734 queries in 11 locales · 94 personas
- Queries and labels: `@cf/google/gemma-4-26b-a4b-it`. The aliases are written by Claude, so this set is not graded by the alias author. Disputed labels: [queries/heldout-review.md](../queries/heldout-review.md) (not applied).
- Engine per locale: en + that locale, core + ext (what a client loads). Hit = any label in the top k. MRR over the top 10. Macro = mean of locales.

## Per locale

| Locale | n | alias (core + ext) R@1 | R@5 | MRR | fused bge-m3@1024 R@1 | R@5 | MRR | Fused − alias R@5 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| en English | 64 | 26.6 | 59.4 | 0.41 | 34.4 | 62.5 | 0.48 | +3.1 |
| zh 中文 | 64 | 18.8 | 39.1 | 0.275 | 32.8 | 64.1 | 0.461 | +25.0 |
| hi हिन्दी | 84 | 16.7 | 44 | 0.282 | 21.4 | 36.9 | 0.284 | -7.1 |
| es Español | 64 | 35.9 | 64.1 | 0.471 | 29.7 | 64.1 | 0.432 | +0.0 |
| ar العربية | 60 | 5 | 26.7 | 0.137 | 10 | 25 | 0.162 | -1.7 |
| fr Français | 61 | 26.2 | 50.8 | 0.371 | 34.4 | 49.2 | 0.413 | -1.6 |
| bn বাংলা | 84 | 15.5 | 29.8 | 0.225 | 15.5 | 25 | 0.206 | -4.8 |
| pt Português | 64 | 29.7 | 57.8 | 0.412 | 26.6 | 53.1 | 0.377 | -4.7 |
| ru Русский | 64 | 20.3 | 51.6 | 0.329 | 28.1 | 65.6 | 0.434 | +14.0 |
| id Bahasa Indonesia | 63 | 23.8 | 54 | 0.352 | 22.2 | 46 | 0.315 | -8.0 |
| tr Türkçe | 62 | 25.8 | 53.2 | 0.38 | 37.1 | 59.7 | 0.475 | +6.5 |
| **All (micro)** | 734 | 21.9 | 47.7 | 0.328 | 26.2 | 49.2 | 0.361 | +1.5 |
| **Mean of locales (macro)** | 734 | 22.2 | 48.2 | 0.331 | 26.6 | 50.1 | 0.367 | +1.9 |

## Next to the in-house suite

In-house numbers: reports/latest.json (2026-10-02). The in-house set has only en and tr queries; the second row compares like with like.

| Suite | n | Alias R@5 | Alias MRR | Fused R@5 | Fused MRR |
| --- | --: | --: | --: | --: | --: |
| In-house (written by Claude) | 214 | 96.7 | 0.85 | 94.9 | 0.885 |
| Held-out, en + tr | 126 | 56.3 | 0.395 | 61.1 | 0.478 |
| Held-out, all locales | 734 | 47.7 | 0.328 | 49.2 | 0.361 |

## Soft gate

No recall@5 drop beyond tolerance (2 points overall, 5 per locale) against the baseline.

## Worst misses per locale (fused bge-m3@1024)

A miss has no label in the top 5. Worst first: not in the top 10, then lowest rank; ties go to queries that the other mode also misses, then to the lower id. – = not in the top 10. The full list is in heldout.json.

### en — English (24 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| feeling so achy | held-en-026 | 😫🤕😣 | – | – | 🤧 😖 🤤 😭 😩 |
| food coma | held-en-033 | 😴💤🥘🤰 | – | – | 🍴 🫄 🫃 🕜️ 🌯 |
| hangry | held-en-035 | 😡😤🤬🍔 | – | – | 🍽️ 🍴 👹 😾 🐻 |
| this looks elite | held-en-036 | 🤩🔥✨️🍱 | – | – | 🧐 🕴️ 😎 🤵 🦅 |
| pure chaos | held-en-042 | 💀🤣🌀 | – | – | 🌪️ 🪿 🤪 🤍 🦝 |
| absolute washout | held-en-044 | 🌧️☔️⛈️🌊 | – | – | 🗑️ 🎬️ 🌪️ 😳 😲 |
| another long shift from hell | held-en-050 | 😩💀🫠 | – | – | ⏰️ 😓 ⚒️ 🕒️ 🧑‍🏭 |
| rip to my social life | held-en-053 | 🤡🥀📉 | – | – | 🪦 🤳 🐀 🖕 🛒 |
| finally off duty | held-en-054 | 💃🥂✌️ | – | – | 😮‍💨 🌆 ⌛️ ⛓️‍💥 😌 |
| clutch | held-en-056 | 🔥🎯🙌 | – | – | 👝 🦸 🦸‍♂️ 🏆️ 🪺 |

### zh — Chinese (Simplified) (23 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| 好可爱 | held-zh-033 | 🥰😍🥺 | – | – | 🐤 🐥 🐷 🐳 🐶 |
| 下班 | held-zh-045 | 🏃💨🥳 | – | – | 🌆 🕠️ 🕔️ 🕕️ 😙 |
| 心疼 | held-zh-055 | 🥺❤️🩹 | – | – | 💔 😿 🫂 🕯️ 😢 |
| 这天气没谁了 | held-zh-060 | 🙄☁️🌫️ | – | – | ☔️ 🌥️ 🌧️ 🌨️ 🌦️ |
| 人山人海 | held-zh-063 | 👨‍👩‍👧‍👦👣🌊 | – | – | 🚵 🏄‍♂️ 🚵‍♂️ 🧗 🌄 |
| 赶不上车 | held-zh-065 | 🏃😰🚄 | – | – | 🚏 🚘️ 🚍️ 🛄 🚌 |
| 这也太远了 | held-zh-067 | 😱🗺️🚶 | – | – | 🇹🇦 🏝️ 🔥 👽️ 🫸 |
| 进球了 | held-zh-068 | 🙌 | – | – | ⚽️ 🥅 ⚾️ 🏆️ 🏈 |
| 绝杀 | held-zh-069 | 🔥 | – | – | ⚽️ 🏑 🥅 ⛹️ 🏹 |
| 太菜了 | held-zh-070 | 🤮 | – | – | 🥔 🤦 🥡 🧂 🫙 |

### hi — Hindi (53 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| hasna | held-hi-071 | 😂🤣 | – | – | 😀 🕍 🇸🇭 🧕 🍯 |
| kitna lamba safar hai | held-hi-076 | 😫😴🛤️⏳️ | – | – | 🇮🇩 🇳🇦 🇫🇯 🏝️ 🇰🇪 |
| paisa khatam ho gaya | held-hi-078 | 💸😭📉👛 | – | – | 🥔 🐏 🕥️ 🦚 🤦 |
| bheed bohot zyada hai | held-hi-079 | 😵🫂🚉🤯 | – | – | 🇧🇿 🤖 🇿🇼 🇧🇦 🇧🇯 |
| pahunche kya? | held-hi-081 | 📍🚗🏠️❓️ | – | – | 🥘 🐣 ♟️ 🪳 🤌 |
| bas nikal gaya | held-hi-083 | 🏃‍♂️💨😰 | – | – | 🚍️ 🕤️ 🚳 🚖 🕠️ |
| bhagwan bachaye | held-hi-086 | 🙏🙌😰 | – | – | 🇧🇼 🇧🇩 👯‍♂️ 🪲 👯 |
| gaana ekdum soulful hai | held-hi-088 | 🎶✨️🎧️ | – | – | 🌙 🕉️ 🌝 😋 😎 |
| kya acting thi yaar | held-hi-089 | 😱👏🔥 | – | – | 🙄 🎭️ 😭 🐯 😩 |
| vibe hi alag hai | held-hi-090 | ✨️🌈🌊 | – | – | 🦔 🌺 😎 🐝 🕴️ |

### es — Spanish (23 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| qué bien | held-es-101 | 🙌🎉✨️ | – | – | 😌 😎 😁 ❤️‍🩹 🙆 |
| estoy muerto | held-es-104 | 😴😫😵‍💫 | – | – | 💀 🧟 🧟‍♂️ 😵 ⚰️ |
| dale | held-es-105 | 👍️👌✅️ | – | – | 👇️ 👨‍🦯 🖱️ 🧛‍♂️ 🔃 |
| una locura | held-es-117 | 😵‍💫 | – | – | 🤯 😜 🤪 😮 💡 |
| qué fuerte | held-es-120 | 😧 | – | – | 🫢 🤯 😮 😲 🦍 |
| un sueño | held-es-121 | 🤩 | – | – | 🌛 🌜️ 😴 💤 🌙 |
| qué robo | held-es-129 | 🤡💸😡 | – | – | 👮 🤖 🦾 🦿 👮‍♂️ |
| estamos limpios | held-es-131 | 💸💀🌵 | – | – | 🪥 🙆 🤍 🙆‍♀️ 🙆‍♂️ |
| un gustito | held-es-133 | 🍷🍰💅✨️ | – | – | 🫦 🤏 🤭 🤢 😋 |
| estoy de milagro | held-es-137 | 🙏✨️🤕 | – | – | 🌟 💫 🦋 🕺 😅 |

### ar — Arabic (45 misses of 60)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| جلد | held-ar-001 | ⚔️💪🔥😤 | – | – | 🐊 🧼 👞 👢 🦏 |
| لا لا لا | held-ar-002 | 🤦‍♂️🚫❌️😩 | – | – | 🤷‍♂️ 🤷‍♀️ 🙊 🤷 🚯 |
| mish momken 😂😂😂 | held-ar-006 | 😂🤣🤦‍♂️ | – | – | 🤷‍♂️ 🤷 🤷‍♀️ 🦛 🐤 |
| el haysat keteer 💸 | held-ar-007 | 💸💰️📉 | – | – | 🇰🇼 🇶🇦 🇯🇴 🇸🇻 🧉 |
| akher sa3d 🥲 | held-ar-010 | 🥲💔🥀 | – | – | 👾 🇳🇪 🖤 📟️ 🤟 |
| yalla bina 🚀 | held-ar-011 | 🚀🏃‍♂️✨️ | – | – | 🏗️ 🔔 🙌 🧞 🪦 |
| مش طبيعي | held-ar-014 | 🤯🔥😱 | – | – | 🤪 🏞️ 🕵️ 🤷‍♂️ 🕵️‍♂️ |
| يا عيني | held-ar-016 | 😍🥺✨️ | – | – | 👀 👁️‍🗨️ 🙈 🥹 🙄 |
| eid mubarak ya habibi | held-ar-018 | 🍬 | – | – | 🧕 🕋 🕌 🤲 🇦🇪 |
| mabrouk el eid | held-ar-019 | 🎊 | – | – | 🕋 🧕 🇮🇶 🇲🇦 🇱🇧 |

### fr — French (31 misses of 61)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| n'importe quoi | held-fr-153 | 🙄🤦 | – | – | 🧑 👕 🤬 🤨 🤷‍♂️ |
| enfin le weekend | held-fr-164 | 🥳🥂💃 | – | – | 🙌 🕺 😮‍💨 😌 🕠️ |
| un pur délice | held-fr-178 | ✨️🤤🍰😍 | – | – | 🤌 🤍 😋 🦪 👄 |
| l'apéro m'attend | held-fr-181 | 🍷🍸️🍹🥂 | – | – | 🧍 🧉 🧍‍♂️ 🇪🇹 🚘️ |
| je craque | held-fr-183 | 😂🤣💀 | – | – | 🙃 🫠 😖 😻 💘 |
| quel enfer | held-fr-184 | 🤦‍♂️🙄😩 | – | – | 👹 ☣️ ⚰️ 🪳 🐦‍🔥 |
| on va geler | held-fr-189 | 🥶❄️🧊 | – | – | 👀 🧎 📟️ 🔛 🤣 |
| ça va chauffer | held-fr-192 | 🥵🔥🌡️ | – | – | 🫯 ⚔️ ❤️‍🔥 ⛈️ 😏 |
| je suis trop refait | held-fr-196 | 🥳😎✨️ | – | – | 🤦 🐀 😫 🙊 🫪 |
| j'ai le seum | held-fr-198 | 😤😒😡 | – | – | 🙍 🙍‍♂️ 🙍‍♀️ 😞 🇰🇷 |

### bn — Bengali (63 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| khub cute | held-bn-183 | 🥰😍 | – | – | 🐥 🐤 🩷 🩵 🎀 |
| ki obostha | held-bn-186 | 😂🤣💀 | – | – | 👋 🛵 😧 🕑️ 🥡 |
| amader obostha | held-bn-188 | 🤡🫠🥲 | – | – | 🤲 📩 🧕 🦪 🇪🇹 |
| prothom bar dekhlam | held-bn-189 | 👁️👄😲 | – | – | 🍫 🍸️ 🥨 🦪 🇭🇰 |
| beshi kotha bolis na | held-bn-190 | 🤫🤐😑 | – | – | 🎱 🇧🇴 🇧🇦 🇧🇬 🥊 |
| ekdom matha kharap | held-bn-191 | 🤯🥴😵‍💫 | – | – | 🤦 ♦️ 🤦‍♂️ 🧉 ♠️ |
| ghura ghuri korte hobe | held-bn-192 | 🚗🗺️✈️ | – | – | 🍦 🟩 🥋 🦍 🐐 |
| rasta khub baje | held-bn-194 | 🚧🚗😡 | – | – | 🕋 🧕 🇨🇺 🦀 👳‍♀️ |
| ki bhalo jayga | held-bn-196 | 😍🏞️✨️ | – | – | 🇳🇬 🇩🇬 🇯🇲 🇧🇩 🐌 |
| matha thik nai | held-bn-198 | 🤯😵‍💫🧠 | – | – | 8️⃣ 🎵 🤏 🧋 🐙 |

### pt — Portuguese (Brazil) (30 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| bora | held-pt-223 | 🚀🔥🙌 | – | – | 🇵🇫 🍺 🥳 ✊️ 😃 |
| que coisa linda | held-pt-233 | 😍✨️💖🌹 | – | – | 🫦 👧 💄 🦩 🦙 |
| saudade | held-pt-234 | 🥺🫂❤️ | – | – | 🪦 😔 😥 🇧🇷 😭 |
| que sufoco | held-pt-238 | 🥵😰🆘 | – | – | 😓 💧 🗜️ 🌁 🧣 |
| tô exausta | held-pt-240 | 😴🔋🫠 | – | – | 😮‍💨 😫 😓 😩 🫩 |
| viva o descanso | held-pt-241 | 🧘‍♀️🍃💆‍♀️ | – | – | 🪼 💤 🏖️ 🌴 😌 |
| paz | held-pt-246 | 🍃🧘🌊✨️ | – | – | ✌️ 🕊️ 🪷 ☮️ 🏳️ |
| perdi tudo | held-pt-248 | 🫠 | – | – | 😵 😶‍🌫️ 🤪 🦤 🫗 |
| icônico | held-pt-249 | 🕶️ | – | – | 🤩 🌟 ⭐️ 😼 🙃 |
| zerou a vida | held-pt-251 | 🙌 | – | – | 0️⃣ 🪃 🧟 😵 💤 |

### ru — Russian (22 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| жиза | held-ru-241 | 🤝🫠😩 | – | – | 🦓 💯 🇿🇼 🙃 🤗 |
| фейл | held-ru-251 | 🤦‍♂️🤦‍♀️🤡 | – | – | ❌️ 🆖 🪊 📁 📥️ |
| что происходит | held-ru-254 | 🤔🤨❓️ | – | – | 😵‍💫 🫨 🫪 👀 ☔️ |
| люблю не могу | held-ru-269 | 🥰❤️🥺 | – | – | 😭 🥹 🙈 👎️ 🙉 |
| душевно | held-ru-273 | 🙏🕯️😌 | – | – | 🥲 ☺️ 🪗 🧡 🤪 |
| святая еда | held-ru-275 | 🥧🍞🍯 | – | – | ☦️ ✡️ ✝️ 🇪🇸 🕎 |
| спина отваливается | held-ru-278 | 😫😖🤕🦴 | – | – | 🙂‍↔️ 😓 🧎 🧎‍➡️ 🧎‍♀️ |
| мама дорогая | held-ru-280 | 🤦‍♀️🙏😱😰 | – | – | 😨 👩‍🍼 🤱 👩‍👧‍👧 👩‍👧 |
| всем здоровья | held-ru-282 | 🙏❤️🍀✨️ | – | – | 📢 🌍️ 🧑‍⚕️ ⚕️ 🫁 |
| о боже мой | held-ru-286 | 😱🤤🍕 | – | – | 🤦‍♂️ 🫢 🤷‍♂️ 🙇‍♂️ 🌠 |

### id — Indonesian (34 misses of 63)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| seru banget | held-id-296 | 🥳🎉✨️ | – | – | 😄 ❣️ ‼️ ❕️ ❗️ |
| ramai pol | held-id-298 | 🎎🏮🎊 | – | – | 👮 🚓 🇵🇱 🎱 🤽 |
| meriah parah | held-id-300 | 🎆🎇🎈 | – | – | 😭 🤣 🤦‍♀️ 🎉 🧚 |
| lemes bgt asli | held-id-304 | 😩😫🤒🤕 | – | – | 🥯 🇧🇿 🇧🇱 🪲 🇲🇬 |
| sehat selalu ya | held-id-306 | 💪✨️🙏 | – | – | 🥗 🎂 ❤️‍🩹 ❤️ 🤲 |
| diet mulai besok | held-id-313 | 🤣🍕🍟🙈 | – | – | 🥗 🥩 🥬 🍏 🕖️ |
| gabut bgt asli | held-id-314 | 🥱😑🫠 | – | – | 🦇 🌥️ 👾 🗯️ 🇬🇹 |
| riil no fek | held-id-315 | 💯📠✅️ | – | – | ⛔️ 🤣 ®️ 🚯 🚳 |
| agak laen emang | held-id-316 | 🤨🤡🙃 | – | – | 🫤 🤷‍♂️ 🕜️ 🕦️ 🤏 |
| capek bgt luv | held-id-319 | 💀🤡🫠 | – | – | 😪 😫 🫩 💤 🦫 |

### tr — Turkish (25 misses of 62)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| çok yoğun | held-tr-312 | 🤯🏃‍♂️💻️ | – | – | 🤹 🤹‍♀️ 🤹‍♂️ 🗓️ 🚥 |
| ay çok tatlı | held-tr-328 | 😻✨️🍭 | – | – | 🌔 🌒 🌕️ 🌛 🌓 |
| kafa gidik | held-tr-333 | 🥴😵‍💫🤪 | – | – | 💁 💁‍♀️ 🕣️ 🇬🇮 🇫🇯 |
| asla inanmadım | held-tr-334 | 🤨🧐😒 | – | – | 🐘 🤯 🤦 🤦‍♀️ 🫣 |
| hayatım kaydı | held-tr-336 | 🫠📉🆘 | – | – | 📹️ ⏺️ 🎥 🎙️ 📔 |
| bitti bittim | held-tr-348 | 😫😵‍💫🆘 | – | – | 🐤 🤏 🍑 🫦 🐥 |
| delireceğim | held-tr-352 | 🫠🤪💢 | – | – | 😩 😖 🙎 🥴 🤤 |
| doğa harika | held-tr-357 | 🌿🍃🌳✨️ | – | – | 🏞️ ⛰️ 🪸 🌲 🥾 |
| canım yanıyor | held-tr-364 | 🤕🩹😫 | – | – | ❤️‍🔥 🥵 🔥 🧯 🤤 |
| açlıktan ölüyorum | held-tr-366 | 🤤😋🍕🍔 | – | – | 🍴 😩 😫 🍽️ 💀 |
