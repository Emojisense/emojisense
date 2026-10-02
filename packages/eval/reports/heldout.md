# Emojisense held-out eval

- Date: 2026-10-02 · pack 0.1.0 · 734 queries in 11 locales · 94 personas
- Queries and labels: `@cf/google/gemma-4-26b-a4b-it`. The aliases are written by Claude, so this set is not graded by the alias author. Disputed labels: [queries/heldout-review.md](../queries/heldout-review.md) (not applied).
- Engine per locale: en + that locale, core + ext (what a client loads). Hit = any label in the top k. MRR over the top 10. Macro = mean of locales.

## Per locale

| Locale | n | alias (core + ext) R@1 | R@5 | MRR | fused embeddinggemma@768 R@1 | R@5 | MRR | Fused − alias R@5 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| en English | 64 | 31.3 | 67.2 | 0.464 | 42.2 | 82.8 | 0.589 | +15.6 |
| zh 中文 | 64 | 37.5 | 59.4 | 0.476 | 43.8 | 71.9 | 0.557 | +12.5 |
| hi हिन्दी | 84 | 31 | 58.3 | 0.431 | 38.1 | 66.7 | 0.51 | +8.4 |
| es Español | 64 | 39.1 | 65.6 | 0.492 | 35.9 | 67.2 | 0.491 | +1.6 |
| ar العربية | 60 | 15 | 30 | 0.211 | 26.7 | 53.3 | 0.36 | +23.3 |
| fr Français | 61 | 37.7 | 60.7 | 0.472 | 42.6 | 70.5 | 0.54 | +9.8 |
| bn বাংলা | 84 | 20.2 | 36.9 | 0.286 | 25 | 41.7 | 0.334 | +4.8 |
| pt Português | 64 | 32.8 | 62.5 | 0.454 | 40.6 | 68.8 | 0.527 | +6.3 |
| ru Русский | 64 | 37.5 | 65.6 | 0.502 | 45.3 | 68.8 | 0.557 | +3.2 |
| id Bahasa Indonesia | 63 | 34.9 | 60.3 | 0.439 | 38.1 | 63.5 | 0.49 | +3.2 |
| tr Türkçe | 62 | 41.9 | 58.1 | 0.491 | 54.8 | 77.4 | 0.638 | +19.3 |
| **All (micro)** | 734 | 32.3 | 56.4 | 0.426 | 39 | 65.9 | 0.504 | +9.5 |
| **Mean of locales (macro)** | 734 | 32.6 | 56.8 | 0.429 | 39.4 | 66.6 | 0.508 | +9.8 |

## Next to the in-house suite

In-house numbers: reports/latest.json (2026-10-02). The in-house set has only en and tr queries; the second row compares like with like.

| Suite | n | Alias R@5 | Alias MRR | Fused R@5 | Fused MRR |
| --- | --: | --: | --: | --: | --: |
| In-house (written by Claude) | 214 | 98.6 | 0.908 | 99.1 | 0.936 |
| Held-out, en + tr | 126 | 62.7 | 0.477 | 80.2 | 0.613 |
| Held-out, all locales | 734 | 56.4 | 0.426 | 65.9 | 0.504 |

## Soft gate

This run wrote `reports/heldout-baseline.json`.

No recall@5 drop beyond tolerance (2 points overall, 5 per locale) against the baseline.

## Worst misses per locale (fused embeddinggemma@768)

A miss has no label in the top 5. Worst first: not in the top 10, then lowest rank; ties go to queries that the other mode also misses, then to the lower id. – = not in the top 10. The full list is in heldout.json.

### en — English (11 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| pure chaos | held-en-042 | 💀🤣🌀 | – | – | 🤪 🌪️ 😇 🤍 🎪 |
| absolute washout | held-en-044 | 🌧️☔️⛈️🌊 | – | – | 🔥 😓 💨 😭 🤮 |
| sending so much strength | held-en-051 | 🤍🫂🙏 | – | – | 💪 ✊️ 🤗 🏋️‍♀️ 👊 |
| summer is coming | held-en-048 | ☀️🏖️🕶️ | – | 3 | 🥵 🍉 👙 🌞 🌺 |
| treat yourself | held-en-034 | 💅✨️🍰🥂 | 10 | – | 🧁 💆 💸 🎁 💆‍♀️ |
| where is the sun | held-en-075 | 🌤️😒❓️ | 8 | 9 | 🌥️ 🌞 🌅 ☀️ ⛅️ |
| oh dear | held-en-065 | 🤦‍♀️😟😰 | 7 | – | 🦌 😧 🙀 😮 😦 |
| huge win for the ward | held-en-049 | 🥳🙌✨️ | 6 | – | 🤯 🎉 🎊 👏 🤩 |
| finally off duty | held-en-054 | 💃🥂✌️ | 6 | – | 😌 🙌 🌆 😥 😮‍💨 |
| no wayyy | held-en-055 | 😱🤯😲 | 6 | – | 🙅‍♀️ 🙀 🙅‍♂️ 🙅 😮 |

### zh — Chinese (Simplified) (18 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| 下班 | held-zh-045 | 🏃💨🥳 | – | – | 🌆 🕔️ 😙 🥱 😌 |
| 这天气没谁了 | held-zh-060 | 🙄☁️🌫️ | – | – | ⛅️ ☔️ 🌥️ 🥶 🌂 |
| 想念夏天 | held-zh-061 | 🏖️🍦🌊 | – | – | 😓 🌻 😔 🌺 💛 |
| 挤不动了 | held-zh-062 | 😫😵‍💫🚋 | – | – | 😪 😌 😐️ 😑 😩 |
| 出发啦 | held-zh-066 | ✈️🥳🗺️ | – | – | 🤠 🛫 🎉 🚶 💨 |
| 绝杀 | held-zh-069 | 🔥 | – | – | ⚽️ 🔪 🥀 ⛹️ 😱 |
| 太菜了 | held-zh-070 | 🤮 | – | – | 🔪 😭 😋 😧 🤤 |
| 又是这种球 | held-zh-071 | 💀 | – | – | ⚽️ 🎊 ⛹️ 🎳 ⛹️‍♀️ |
| 唉 | held-zh-072 | 🥀 | – | – | 😢 😭 🙁 😩 😮‍💨 |
| 寄了 | held-zh-073 | 🏳️ | – | – | 💀 😦 📤️ 🎁 📩 |

### hi — Hindi (28 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| kitna lamba safar hai | held-hi-076 | 😫😴🛤️⏳️ | – | – | 🌸 💘 🌊 🍀 🌙 |
| bheed bohot zyada hai | held-hi-079 | 😵🫂🚉🤯 | – | – | 👻 🐻 🌝 🤦 🙎‍♀️ |
| bas nikal gaya | held-hi-083 | 🏃‍♂️💨😰 | – | – | 😩 💪 😫 😐️ 🙄 |
| kya acting thi yaar | held-hi-089 | 😱👏🔥 | – | – | 🙄 🤦 🎭️ 🤦‍♀️ 🤦‍♂️ |
| kya swaad hai | held-hi-095 | 👌😋✨️🥘 | – | – | 👅 😴 🤷 🤷‍♀️ 🤦 |
| pet bhar gaya | held-hi-097 | 🤰🈵😵‍💫 | – | – | 🫃 🫄 🐾 🐶 🐕️ |
| itna sannata kyun hai | held-hi-103 | 🦗😶❓️ | – | – | 💁 😉 🙃 😓 😦 |
| acha bey | held-hi-104 | 🤨😏 | – | – | 😮 🙁 😍 🙂 😑 |
| sharam ki baat hai | held-hi-116 | 🤦‍♂️🙄 | – | – | 😳 🙈 😬 🤫 😦 |
| chutti chahiye yaar | held-hi-120 | 🏖️😴🥳 | – | – | 🎄 👯‍♂️ 👯‍♀️ 🥺 😋 |

### es — Spanish (21 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| qué bien | held-es-101 | 🙌🎉✨️ | – | – | 👌 😃 👍️ 🙆 🙆‍♂️ |
| una locura | held-es-117 | 😵‍💫 | – | – | 🤪 😜 🤯 😮 😱 |
| qué fuerte | held-es-120 | 😧 | – | – | 😲 😮 😱 🤯 🫢 |
| un sueño | held-es-121 | 🤩 | – | – | 😴 😪 💤 🥱 🛌 |
| estamos limpios | held-es-131 | 💸💀🌵 | – | – | 🤍 ✨️ 🧹 😇 🚿 |
| qué ganas de verlos | held-es-152 | 🫂🥺✨️ | – | – | 🤩 😃 🤤 👀 😋 |
| mi familia es un lío | held-es-153 | 🤦‍♂️🤪💥🤯 | – | – | 👨‍👩‍👧 👨‍👩‍👧‍👧 👪️ 👨‍👩‍👦‍👦 👨‍👩‍👧‍👦 |
| literalmente yo | held-es-157 | 🤡🫠💀 | – | – | 😏 🙂 🙋 🙁 🤷 |
| a pie hasta casa | held-es-164 | 👟 | – | – | 🚶 🏠️ 🚶‍♀️ 🚶‍♂️ 👣 |
| qué odisea | held-es-165 | 🚉 | – | – | 💿️ 🌊 😧 🏺 🔱 |

### ar — Arabic (28 misses of 60)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| جلد | held-ar-001 | ⚔️💪🔥😤 | – | – | 🧤 👞 🤎 🧼 👜 |
| لا لا لا | held-ar-002 | 🤦‍♂️🚫❌️😩 | – | – | 🤷‍♀️ 🤷‍♂️ 🤷 🙊 🚯 |
| مش طبيعي | held-ar-014 | 🤯🔥😱 | – | – | 🤪 😲 🥵 😮 😦 |
| eid mubarak ya habibi | held-ar-018 | 🍬 | – | – | 🌙 ☪️ 🕋 🕌 🤲 |
| el jaw helw awy | held-ar-021 | 🌟 | – | – | 😍 👋 😮 👌 😦 |
| ya rab kollo tamam | held-ar-022 | 🤍 | – | – | 🙂 🤲 🤦 🤦‍♀️ 👍️ |
| fari7a kbira | held-ar-023 | 🥳 | – | – | 😕 🍻 📚️ 💇‍♀️ 🐁 |
| akla tayeret el 3a2l | held-ar-024 | 😋🤤🥘👌 | – | – | 😥 😅 🕒️ 👪️ 🌜️ |
| teslam el eed | held-ar-026 | 🙏❤️👌🍽️ | – | – | 👏 😊 👋 🤲 😋 |
| da3a el rishm | held-ar-027 | 💸😩💰️ | – | – | 💊 😥 🤲 😌 🙌 |

### fr — French (18 misses of 61)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| n'importe quoi | held-fr-153 | 🙄🤦 | – | – | 🤨 🤡 💩 🤷 🙃 |
| quel enfer | held-fr-184 | 🤦‍♂️🙄😩 | – | – | 👿 😈 🤘 💀 😱 |
| trop de dossier | held-fr-186 | 🤭🙊📸 | – | – | 📁 🗃️ 🗄️ 📂 😫 |
| je suis trop refait | held-fr-196 | 🥳😎✨️ | – | – | 😫 🥴 😓 💄 😩 |
| dans le jus | held-fr-200 | 🌊🏃‍♂️😰 | – | – | 🧃 🥤 🍉 ☕️ 🍊 |
| une pépite | held-fr-206 | 🎶 | – | – | 💎 🍪 🐤 🐥 🐣 |
| j'ai les boules | held-fr-207 | 😢 | – | – | 😟 🙍 😰 😨 🙍‍♂️ |
| une légende | held-fr-210 | 🌟 | – | – | 🐲 🧌 🤥 😓 😛 |
| ça me fume | held-fr-211 | 😭 | – | – | 🚬 😤 💨 🚭️ 🥴 |
| quel skill | held-fr-213 | 🐐🎯👑 | – | – | 🤹 🤓 👩‍🍳 🙄 🧑‍🍳 |

### bn — Bengali (49 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| ki obostha | held-bn-186 | 😂🤣💀 | – | – | 👋 😬 😮 🙆‍♀️ 😖 |
| vab dekh | held-bn-187 | 🙄🤨😏 | – | – | 🙈 😎 😝 🧐 👀 |
| amader obostha | held-bn-188 | 🤡🫠🥲 | – | – | 👋 😬 🙋‍♀️ 🌑 🙋‍♂️ |
| prothom bar dekhlam | held-bn-189 | 👁️👄😲 | – | – | 👀 🥇 💘 🌟 🎣 |
| beshi kotha bolis na | held-bn-190 | 🤫🤐😑 | – | – | 🤥 😘 😠 🙊 🙎 |
| ghura ghuri korte hobe | held-bn-192 | 🚗🗺️✈️ | – | – | 🪁 👻 🤤 🐄 💀 |
| ki bhalo jayga | held-bn-196 | 😍🏞️✨️ | – | – | 🌺 📍 🙌 ✌️ 😇 |
| dekhte hobe | held-bn-197 | 👀🧐🔍️ | – | – | 🎪 🍺 🌕️ 🌅 🍿 |
| matha thik nai | held-bn-198 | 🤯😵‍💫🧠 | – | – | 👌 🙏 🤚 👩‍🦲 🤕 |
| khub chap | held-bn-200 | 😫🥵🆘🌋 | – | – | 🤫 🤭 🐾 😰 👊 |

### pt — Portuguese (Brazil) (20 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| bora | held-pt-223 | 🚀🔥🙌 | – | – | 🥳 😃 ✊️ 🚶 🚶‍♀️ |
| tô exausta | held-pt-240 | 😴🔋🫠 | – | – | 😫 😓 😩 😮‍💨 😪 |
| viva o descanso | held-pt-241 | 🧘‍♀️🍃💆‍♀️ | – | – | 💤 😴 🛌 😫 😪 |
| perdi tudo | held-pt-248 | 🫠 | – | – | 😩 💔 😢 😵 😭 |
| icônico | held-pt-249 | 🕶️ | – | – | 😼 🙃 🤩 💁 💁‍♂️ |
| zerou a vida | held-pt-251 | 🙌 | – | – | 😵 💀 🥀 🤣 😫 |
| muito bom | held-pt-252 | 🔝 | – | – | 😄 💮 🙂 👏 👌 |
| tá impossível | held-pt-256 | 💀🤡🫠 | – | – | 😲 🙅 🤦 🤦‍♀️ 🤦‍♂️ |
| o pai tá on | held-pt-257 | 😎🔥🤙 | – | – | 👨‍👧‍👦 👨‍👧‍👧 👨‍👦 👨‍👦‍👦 👨‍👧 |
| tô quebrada | held-pt-262 | 💸🤡🥀📉 | – | – | ⛓️‍💥 💔 🤕 😢 😭 |

### ru — Russian (20 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| жиза | held-ru-241 | 🤝🫠😩 | – | – | 💯 🙃 😬 🤐 🐐 |
| что происходит | held-ru-254 | 🤔🤨❓️ | – | – | 😵‍💫 👀 😱 🤯 😲 |
| душевно | held-ru-273 | 🙏🕯️😌 | – | – | ☺️ 😔 🙍 🙍‍♂️ 😢 |
| святая еда | held-ru-275 | 🥧🍞🍯 | – | – | 😋 🥞 🍴 🥑 🫔 |
| наконец-то выходные | held-ru-276 | 🥂💃🕺 | – | – | 🙌 😌 🎉 👪️ 😮‍💨 |
| светлый праздник | held-ru-277 | 🌟☀️🕊️ | – | – | 🤍 🎊 🥳 🎉 😇 |
| мама дорогая | held-ru-280 | 🤦‍♀️🙏😱😰 | – | – | 😨 👩‍👧 👩‍👦 👩 💕 |
| всем здоровья | held-ru-282 | 🙏❤️🍀✨️ | – | – | 👌 👋 😀 ✌️ 🥦 |
| лучшие люди | held-ru-291 | 🫂🤝💎 | – | – | 🧑‍🤝‍🧑 👯 👭 👑 😇 |
| вместе веселее | held-ru-294 | 🥳👯‍♂️🎮️ | – | – | 🎉 😄 🎊 😃 😜 |

### id — Indonesian (23 misses of 63)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| seru banget | held-id-296 | 🥳🎉✨️ | – | – | 😄 😃 😁 🤩 😀 |
| suasana syahdu | held-id-297 | 🙏✨️🕯️ | – | – | 😌 🌺 😓 😥 😔 |
| ramai pol | held-id-298 | 🎎🏮🎊 | – | – | 👮 👮‍♂️ 🚓 🚔️ 🤣 |
| meriah parah | held-id-300 | 🎆🎇🎈 | – | – | ✨️ 👏 😭 🤕 😩 |
| lemes bgt asli | held-id-304 | 😩😫🤒🤕 | – | – | 😛 😝 🍋 😅 👅 |
| sehat selalu ya | held-id-306 | 💪✨️🙏 | – | – | ❤️ 🎂 🤲 🤒 💕 |
| pengen jajan | held-id-309 | 🍦🍩🍡🛍️ | – | – | 😋 🤤 🍴 🍰 💸 |
| diet mulai besok | held-id-313 | 🤣🍕🍟🙈 | – | – | 🥗 🎬️ 🍏 👋 😰 |
| riil no fek | held-id-315 | 💯📠✅️ | – | – | 🤤 🖕 😘 👌 😉 |
| agak laen emang | held-id-316 | 🤨🤡🙃 | – | – | 🤤 😅 😝 🐐 🙆‍♂️ |

### tr — Turkish (14 misses of 62)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| çok yoğun | held-tr-312 | 🤯🏃‍♂️💻️ | – | – | 😩 😖 😓 😰 😣 |
| ay çok tatlı | held-tr-328 | 😻✨️🍭 | – | – | 😍 🌛 🌜️ 🌙 🌝 |
| patladım | held-tr-335 | 💀😂🤣 | – | – | 🫄 🫃 💥 🧨 🤡 |
| hayatım kaydı | held-tr-336 | 🫠📉🆘 | – | – | 📒 👫 🎥 ✍️ 🎬️ |
| hava çok bozdu | held-tr-338 | ☁️🌧️🌫️ | – | – | ⛅️ 💨 🌬️ 😓 🌥️ |
| bitti bittim | held-tr-348 | 😫😵‍💫🆘 | – | – | 😩 🔚 🤏 🪫 😂 |
| delireceğim | held-tr-352 | 🫠🤪💢 | – | – | 😛 🤚 😡 🙋 🤭 |
| canım yanıyor | held-tr-364 | 🤕🩹😫 | – | – | 🔥 🥵 ❤️‍🔥 💨 🤤 |
| rejim bitti | held-tr-371 | 🍩🍕🍔🫠 | – | – | 😩 🔚 👎️ 💪 🧑‍🎨 |
| doğa harika | held-tr-357 | 🌿🍃🌳✨️ | 8 | – | 💚 🏞️ 🌲 👌 🎉 |
