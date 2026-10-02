# Emojisense held-out eval

- Date: 2026-10-02 · pack 0.1.0 · 734 queries in 11 locales · 94 personas
- Queries and labels: `@cf/google/gemma-4-26b-a4b-it`. The aliases are written by Claude, so this set is not graded by the alias author. Disputed labels: [queries/heldout-review.md](../queries/heldout-review.md) (not applied).
- Engine per locale: en + that locale, core + ext (what a client loads). Hit = any label in the top k. MRR over the top 10. Macro = mean of locales.

## Per locale

| Locale | n | alias (core + ext) R@1 | R@5 | MRR | fused bge-m3@1024 R@1 | R@5 | MRR | Fused − alias R@5 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| en English | 64 | 26.6 | 59.4 | 0.41 | 34.4 | 62.5 | 0.48 | +3.1 |
| zh 中文 | 64 | 7.8 | 9.4 | 0.082 | 31.3 | 56.3 | 0.415 | +46.9 |
| hi हिन्दी | 84 | 7.1 | 10.7 | 0.087 | 20.2 | 32.1 | 0.249 | +21.4 |
| es Español | 64 | 10.9 | 21.9 | 0.161 | 21.9 | 37.5 | 0.287 | +15.6 |
| ar العربية | 60 | 5 | 10 | 0.064 | 5 | 15 | 0.103 | +5.0 |
| fr Français | 61 | 13.1 | 21.3 | 0.171 | 29.5 | 39.3 | 0.345 | +18.0 |
| bn বাংলা | 84 | 2.4 | 4.8 | 0.035 | 11.9 | 19 | 0.157 | +14.2 |
| pt Português | 64 | 15.6 | 28.1 | 0.204 | 17.2 | 31.3 | 0.239 | +3.2 |
| ru Русский | 64 | 10.9 | 15.6 | 0.145 | 25 | 53.1 | 0.374 | +37.5 |
| id Bahasa Indonesia | 63 | 7.9 | 19 | 0.12 | 17.5 | 33.3 | 0.244 | +14.3 |
| tr Türkçe | 62 | 25.8 | 53.2 | 0.38 | 37.1 | 59.7 | 0.475 | +6.5 |
| **All (micro)** | 734 | 11.7 | 22.2 | 0.163 | 22.5 | 39.2 | 0.301 | +17.0 |
| **Mean of locales (macro)** | 734 | 12.1 | 23 | 0.169 | 22.8 | 39.9 | 0.306 | +16.9 |

## Next to the in-house suite

In-house numbers: this run. The in-house set has only en and tr queries; the second row compares like with like.

| Suite | n | Alias R@5 | Alias MRR | Fused R@5 | Fused MRR |
| --- | --: | --: | --: | --: | --: |
| In-house (written by Claude) | 214 | 96.3 | 0.849 | 94.9 | 0.883 |
| Held-out, en + tr | 126 | 56.3 | 0.395 | 61.1 | 0.478 |
| Held-out, all locales | 734 | 22.2 | 0.163 | 39.2 | 0.301 |

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

### zh — Chinese (Simplified) (28 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| 好可爱 | held-zh-033 | 🥰😍🥺 | – | – | 🐤 🐷 🐳 🐥 🐶 |
| 加油 | held-zh-041 | 💪🔥 | – | – | ⛽️ 🤸 😤 🎗️ 📣 |
| 收到 | held-zh-044 | 👌✅️👍️ | – | – | 📨 📥️ 🫡 📬️ 📦️ |
| 下班 | held-zh-045 | 🏃💨🥳 | – | – | 🌆 🕠️ 🕟️ 🧑‍💼 💻️ |
| 早安 | held-zh-050 | ☀️🌅🌹 | – | – | 🐓 ⏰️ 🕣️ 🕤️ 🕝️ |
| 太可爱了 | held-zh-051 | 🥰😍👶 | – | – | 🧸 🐤 🐷 🐥 🐳 |
| 心疼 | held-zh-055 | 🥺❤️🩹 | – | – | 😢 🥲 😭 😧 🥹 |
| 这天气没谁了 | held-zh-060 | 🙄☁️🌫️ | – | – | ☔️ 🌥️ 🌧️ 🌨️ 🌦️ |
| 人山人海 | held-zh-063 | 👨‍👩‍👧‍👦👣🌊 | – | – | 🚵 🏄‍♂️ 🚵‍♂️ 🧗 🌄 |
| 晕车 | held-zh-064 | 🤢🤮🚗 | – | – | 🚖 🚘️ 🚌 🚕 🎢 |

### hi — Hindi (57 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| thak gaya | held-hi-070 | 😫😴 | – | – | 🙏 🇹🇭 🦚 🙈 🛺 |
| hasna | held-hi-071 | 😂🤣 | – | – | 🕍 🇸🇭 🧕 🍯 🕎 |
| mast hai | held-hi-073 | 👌🔥 | – | – | 🇲🇴 🗿 🇲🇭 🐝 🇭🇲 |
| theek hai | held-hi-075 | 👍️✅️ | – | – | 🇭🇹 🇰🇷 🇭🇰 🖖 🇹🇭 |
| kitna lamba safar hai | held-hi-076 | 😫😴🛤️⏳️ | – | – | 🇮🇩 🇳🇦 🇫🇯 🏝️ 🇰🇪 |
| rasta bhatak gaya | held-hi-077 | 😵‍💫🗺️❓️🧭 | – | – | 🇧🇩 🐀 🦚 🇬🇹 👩‍🦯‍➡️ |
| paisa khatam ho gaya | held-hi-078 | 💸😭📉👛 | – | – | 🥔 🐏 🕥️ 🦚 🤦 |
| bheed bohot zyada hai | held-hi-079 | 😵🫂🚉🤯 | – | – | 🇧🇿 🤖 🇿🇼 🇧🇦 🇧🇯 |
| view ekdum kadak | held-hi-080 | 🤩🏔️✨️😍 | – | – | 🪟 🙈 🌆 👓️ 👀 |
| pahunche kya? | held-hi-081 | 📍🚗🏠️❓️ | – | – | 🥘 🐣 ♟️ 🪳 🤌 |

### es — Spanish (40 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| qué bien | held-es-101 | 🙌🎉✨️ | – | – | ❤️‍🩹 🌛 🌜️ 😄 😁 |
| no puede ser | held-es-102 | 😱😲🤨 | – | – | 🤷‍♂️ 🤷‍♀️ 🙉 🙈 🚱 |
| estoy muerto | held-es-104 | 😴😫😵‍💫 | – | – | 💀 🪦 🧟 🧟‍♂️ 🇲🇽 |
| dale | held-es-105 | 👍️👌✅️ | – | – | 👨‍🦯 🧛‍♂️ 🐋 ✡️ 🦖 |
| te quiero | held-es-110 | ❤️🥰😘 | – | – | 🤟 🍵 🧋 ☕️ 🫖 |
| me encanta | held-es-114 | 😍💖❤️ | – | – | 🦋 🇦🇷 🇵🇪 🪭 🇦🇴 |
| ay no | held-es-115 | 🤦‍♀️😩😱 | – | – | 🙅‍♀️ 🙅‍♂️ 🙅 🙂‍↔️ 🤷‍♂️ |
| qué temazo | held-es-116 | 🎵 | – | – | 🌮 #️⃣ 🦙 🐧 🥔 |
| una locura | held-es-117 | 😵‍💫 | – | – | 🕜️ 🤸‍♀️ 🤯 💡 🤦‍♀️ |
| qué fuerte | held-es-120 | 😧 | – | – | 💪 🦍 🏋️‍♀️ 🇰🇼 🫸 |

### ar — Arabic (51 misses of 60)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| جلد | held-ar-001 | ⚔️💪🔥😤 | – | – | 🐊 🧼 🧢 🧔 💄 |
| لا لا لا | held-ar-002 | 🤦‍♂️🚫❌️😩 | – | – | 🤷‍♂️ 🤷‍♀️ 🚯 🙊 🤷 |
| والله حظ | held-ar-003 | 🤡🎲😭🫠 | – | – | 🧿 🍀 🤞 🪬 🥠 |
| el haysat keteer 💸 | held-ar-007 | 💸💰️📉 | – | – | 🇰🇼 🇶🇦 🇯🇴 🇸🇻 🧉 |
| ya lahwy 😱 | held-ar-008 | 😱😰🤦‍♀️ | – | – | 🦥 🦈 🤣 🥴 🤦 |
| akher sa3d 🥲 | held-ar-010 | 🥲💔🥀 | – | – | 👾 🇳🇪 🖤 📟️ 🤟 |
| yalla bina 🚀 | held-ar-011 | 🚀🏃‍♂️✨️ | – | – | 🏗️ 🔔 🙌 🧞 🪦 |
| يا ساتر | held-ar-012 | 😰😨🫣 | – | – | 👀 🦦 🦌 🫟 🔜 |
| مش طبيعي | held-ar-014 | 🤯🔥😱 | – | – | 🤷‍♂️ 👽️ 🌵 🚱 🙉 |
| على أعصابي | held-ar-015 | 😬😰📈 | – | – | 🦔 😠 🕝️ 🤦 😶‍🌫️ |

### fr — French (37 misses of 61)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| n'importe quoi | held-fr-153 | 🙄🤦 | – | – | 🤷‍♂️ 🪼 🧑 🍵 🤏 |
| je suis crevé | held-fr-154 | 😫😴🥱 | – | – | 🥐 🌝 🐤 🦋 🇨🇭 |
| trop mignon | held-fr-155 | 🥺🥰 | – | – | 🥩 🎾 🏈 🍹 🇹🇹 |
| trop bien | held-fr-161 | 🙌✨️🤩 | – | – | 👌 🥵 🙊 🤯 👯 |
| enfin le weekend | held-fr-164 | 🥳🥂💃 | – | – | 🕺 🙌 🌆 ⚒️ 🏖️ |
| une petite mousse | held-fr-177 | 🍺🍻 | – | – | 🤏 🫎 🐭 🐤 🫧 |
| un pur délice | held-fr-178 | ✨️🤤🍰😍 | – | – | 😋 🦪 👄 🤌 🍴 |
| l'apéro m'attend | held-fr-181 | 🍷🍸️🍹🥂 | – | – | 🧍 🧉 🧍‍♂️ 🇪🇹 🚘️ |
| quel enfer | held-fr-184 | 🤦‍♂️🙄😩 | – | – | 🐉 👹 ☣️ ⚰️ 🪳 |
| quel temps de chien | held-fr-188 | 🌧️☔️🌩️☁️ | – | – | 🐶 🕙️ 🐓 🕦️ 🦔 |

### bn — Bengali (68 misses of 84)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| haste haste | held-bn-180 | 😂🤣 | – | – | 💨 🏃 ⏩️ 🚤 🍔 |
| kanna | held-bn-181 | 😭😢 | – | – | 🇨🇦 🫓 🍌 👯 🪞 |
| pagol | held-bn-182 | 🤪🤡 | – | – | 🐧 🇵🇱 🐾 🐌 🦜 |
| ghum | held-bn-184 | 😴💤🥱 | – | – | 🇬🇺 🕋 🕍 ☁️ 🕉️ |
| sesh | held-bn-185 | 💀🫠 | – | – | 🤫 👳‍♀️ 🪯 🎽 🐚 |
| ki obostha | held-bn-186 | 😂🤣💀 | – | – | 🛵 😧 🕑️ 🥡 👹 |
| vab dekh | held-bn-187 | 🙄🤨😏 | – | – | 📼 📀 🇧🇩 🧪 🆚 |
| amader obostha | held-bn-188 | 🤡🫠🥲 | – | – | 🤲 📩 🧕 🦪 🇪🇹 |
| prothom bar dekhlam | held-bn-189 | 👁️👄😲 | – | – | 🍫 🍸️ 🥨 🦪 🇭🇰 |
| beshi kotha bolis na | held-bn-190 | 🤫🤐😑 | – | – | 🎱 🇧🇴 🇧🇦 🇧🇬 🥊 |

### pt — Portuguese (Brazil) (44 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| amei | held-pt-214 | 😍✨️❤️ | – | – | 🥰 🫶 🇼🇸 🇦🇮 🐝 |
| deboche | held-pt-215 | 😏🙃💅 | – | – | 🪳 🚧 🥂 🪩 🗑️ |
| bora | held-pt-223 | 🚀🔥🙌 | – | – | 🇵🇫 🇧🇦 🇰🇿 🧋 💜 |
| sextou | held-pt-225 | 🍻🥳🎉 | – | – | 6️⃣ 🎷 🕡️ 🍑 🐙 |
| bom dia | held-pt-230 | ☀️🙏☕️ | – | – | 🇧🇷 🎂 🍅 🍩 🇧🇧 |
| que coisa linda | held-pt-233 | 😍✨️💖🌹 | – | – | 🦙 🦩 💃 🫦 🤸‍♀️ |
| saudade | held-pt-234 | 🥺🫂❤️ | – | – | 🇧🇷 🕴️ 🕝️ 😶‍🌫️ 📼 |
| que sufoco | held-pt-238 | 🥵😰🆘 | – | – | 🌁 🧣 🤮 😤 🇦🇸 |
| tô exausta | held-pt-240 | 😴🔋🫠 | – | – | 😮‍💨 🫩 😫 😰 😓 |
| viva o descanso | held-pt-241 | 🧘‍♀️🍃💆‍♀️ | – | – | 🪼 🏖️ 🌴 😌 ⏸️ |

### ru — Russian (30 misses of 64)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| ору | held-ru-240 | 😂🤣💀 | – | – | 🏹 🗡️ 🔜 ⚔️ 🐂 |
| жиза | held-ru-241 | 🤝🫠😩 | – | – | 🦓 🇿🇼 🤗 🇨🇭 🥩 |
| бесит | held-ru-243 | 😤🤬😡 | – | – | 🏃 🏃‍♀️ 🪲 🏃‍➡️ 🐝 |
| фейл | held-ru-251 | 🤦‍♂️🤦‍♀️🤡 | – | – | 📁 📂 📥️ 🐥 🐘 |
| кринж | held-ru-253 | 😬🫠🤡 | – | – | 😖 🧶 ⛏️ 🇰🇷 🍻 |
| что происходит | held-ru-254 | 🤔🤨❓️ | – | – | ☔️ 🌪️ 🪃 😦 🍿 |
| целую | held-ru-260 | 😘💋❤️ | – | – | 🈵 😽 🐖 🌝 🔋 |
| молодец | held-ru-261 | 👏👍️🥳 | – | – | ⛹️‍♂️ 🤸‍♂️ 🧙‍♂️ 🏌️‍♂️ 🐧 |
| ахахахаха | held-ru-266 | 😂🤣💀 | – | – | 😯 🐙 😲 😮 🪄 |
| люблю не могу | held-ru-269 | 🥰❤️🥺 | – | – | 👎️ 🙉 🙈 🥹 🙊 |

### id — Indonesian (42 misses of 63)

| Query | id | Labels | fused rank | alias rank | Got (top 5) |
| --- | --- | --- | --: | --: | --- |
| gemes | held-id-274 | 🥰🥺💖 | – | – | 💎 🙋 🦎 🧬 🤼 |
| mager | held-id-275 | 🥱😴🛌 | – | – | 🧙‍♂️ 🧙 🧙‍♀️ 🧑‍💼 👨‍💼 |
| wkwkwk | held-id-281 | 😂🤣😆 | – | – | 🇮🇩 🦉 📚️ 📖 🐧 |
| hadeh | held-id-282 | 🤦‍♂️🤦‍♀️😮‍💨🙄 | – | – | 🕋 🕎 🇸🇦 🇾🇪 ✡️ |
| semangat | held-id-283 | 💪🔥✨️ | – | – | 💗 😤 💚 🕺 💛 |
| seru banget | held-id-296 | 🥳🎉✨️ | – | – | 🤸‍♂️ 🤸‍♀️ 🤸 🕺 ⛹️‍♂️ |
| ramai pol | held-id-298 | 🎎🏮🎊 | – | – | 🤽 🤽‍♂️ 🤽‍♀️ 🇵🇱 🗳️ |
| asli cakep | held-id-299 | 😍🌅🏝️ | – | – | 🥞 🧁 🧢 🍘 🧮 |
| meriah parah | held-id-300 | 🎆🎇🎈 | – | – | 🤦‍♀️ 🎉 🧚 🤦 💰️ |
| lemes bgt asli | held-id-304 | 😩😫🤒🤕 | – | – | 🥯 🇧🇿 🇧🇱 🪲 🇲🇬 |

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
