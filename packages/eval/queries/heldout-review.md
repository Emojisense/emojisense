# Held-out label review

Labels in [heldout.jsonl](heldout.jsonl) that look wrong or ambiguous. **Nothing in this file is
applied.** The labels in heldout.jsonl are still the generator's own
(`@cf/google/gemma-4-26b-a4b-it`).

- **Reviewer:** Claude, 2026-10-02, all 734 queries. Claude also wrote the aliases. If Claude's
  fixes go in unchecked, the held-out set gets the bias that it must remove. A human (best: a
  native speaker of the locale) must accept or reject each row first.
- **To apply a row:** edit the line in heldout.jsonl, then write a new baseline with
  `pnpm --filter @emojisense/eval eval:heldout -- --write-baseline`.
- **Kind:** _wrong_ = a label does not match the query. _missing_ = the obvious answer is not a
  label. _ambiguous_ = the query has two common meanings and the labels cover one. _query_ = the
  query text itself is the problem.
- **Proposed labels** are the full new list, best first.

## Patterns

These patterns repeat. The per-locale tables below list the queries again with a fix.

| Pattern | Queries | Proposed fix | Reason |
| --- | --- | --- | --- |
| 🔋 for low energy | held-en-030, held-es-134, held-es-144, held-bn-193, held-bn-255, held-pt-240, held-pt-280, held-ru-279 | Replace 🔋 with 🪫 (or remove it) | 🔋 is a full battery. 🪫 is the low battery. |
| Emoji in the query text | held-ar-006 to held-ar-011, held-ar-030 to held-ar-035 (12) | Remove the emoji from `q` ("ya lahwy 😱" → "ya lahwy") | People do not type the answer into the search box. The alias engine drops the emoji, but bge-m3 sees it, so these queries make the fused score too high. The generator now rejects such queries. |
| One label only | 48 queries from 8 generator calls: held-zh-068 to 073, held-es-116 to 121, held-es-163 to 167, held-ar-018 to 023, held-fr-206 to 211, held-pt-248 to 252, held-id-320 to 329 (also held-en-000, held-en-002, held-fr-165, held-ru-245) | Add the obvious second and third answers (see the tables) | In each of these calls, every query got one label. One label makes recall@5 harder than for the rest of the set. held-en-002, held-fr-165 and held-ru-245 are correct with one label. |
| Gendered variant only | 58 queries, e.g. held-en-065 🤦‍♀️, held-hi-085 🤦‍♂️, held-es-138 🤷‍♂️🤷‍♀️, held-tr-349 🏃‍♂️ | Decide one rule: accept the gender-neutral base (🤦, 🤷, 🏃, 💆, 🧘, 🙋, 🙅, 🏋️, 👯) whenever a gendered variant is a label. This can be a rule in `judge()` (like U+FE0F) instead of 58 edits. | The generator picks a gendered variant at random. A picker shows the neutral one first. |
| 🤰 for a full stomach | held-en-033, held-es-145, held-hi-097, held-hi-124, held-hi-135, held-ar-028, held-bn-220 | Decide one rule: also accept 🫃 and 🫄, or remove 🤰 | The generator uses the "food baby" joke. The engine returns 🫃 and 🫄 for the same idea, and those are not labels. |

## Per locale

### en

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-en-000 | dead | 💀 | missing | 💀😂 | In teen chat "dead" means "I am dying of laughter". 😂 is the usual answer. |
| held-en-030 | running on empty | 🪫🔋🫠 | wrong | 🪫🫠😩 | 🔋 is a full battery. |
| held-en-033 | food coma | 😴💤🥘🤰 | ambiguous | 😴💤🥘🤤 | "Food coma" is the sleepy feeling after a meal. 🤰 is the "food baby" joke (see Patterns). |
| held-en-062 | what a relief | 😌🙏💨 | missing | 😮‍💨😌🙏 | 😮‍💨 (face exhaling) is the standard relief emoji. |

### zh

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-zh-063 | 人山人海 | 👨‍👩‍👧‍👦👣🌊 | wrong | 👥🧑‍🤝‍🧑😵‍💫🌊 | "A sea of people" (a crowd). 👨‍👩‍👧‍👦 is one family. |
| held-zh-068 | 进球了 | 🙌 | missing | ⚽🙌🥳🎉 | "Goal!" One label. |
| held-zh-069 | 绝杀 | 🔥 | missing | 🔥🤯⚽🏆 | "Winner in the last second". One label. |
| held-zh-070 | 太菜了 | 🤮 | missing | 🤡👎🙄🤮 | "So bad (a noob)". Mild mockery; 🤮 alone is too strong. |
| held-zh-071 | 又是这种球 | 💀 | missing | 💀🤦😩 | "This kind of play again". One label. |
| held-zh-072 | 唉 | 🥀 | missing | 😮‍💨😔🥀 | "Sigh". 😮‍💨 and 😔 are the usual answers. |
| held-zh-073 | 寄了 | 🏳️ | missing | 💀🪦🏳️ | Slang "it is over / done for". One label. |

### hi

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-hi-097 | pet bhar gaya | 🤰🈵😵‍💫 | wrong | 😌😋🤰 | 🈵 is the Japanese sign "full (no vacancy)". It is a pun, not a search answer. |
| held-hi-105 | scene kya hai | 🧐🎬️👀 | ambiguous | 🧐🤔👀 | Slang "what is the plan / what is going on". 🎬 is the literal film scene. |

### es

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-es-104 | estoy muerto | 😴😫😵‍💫 | ambiguous | 😴😫😵‍💫💀 | Means "I am exhausted" and also "I am dying (of laughter)". |
| held-es-116 | qué temazo | 🎵 | missing | 🎵🎶🔥 | "What a great song". One label. |
| held-es-117 | una locura | 😵‍💫 | missing | 🤯😵‍💫🤪 | "Madness". One label. |
| held-es-118 | me muero de risa | 😆 | missing | 😂🤣😆💀 | "I am dying of laughter". 😂 is the usual answer and is not a label. |
| held-es-119 | está de película | 🎞️ | ambiguous | 🤩🎬🎞️ | Idiom for "amazing", not only a film. |
| held-es-120 | qué fuerte | 😧 | missing | 😱😮😧 | "Wow, that is intense". One label. |
| held-es-121 | un sueño | 🤩 | missing | 🤩😍✨ | "A dream (wonderful)". One label. |
| held-es-134 | no doy más | 😩😵‍💫🔋 | wrong | 😩😵‍💫🪫 | 🔋 is a full battery. |
| held-es-144 | con la energía baja | 🪫🔋📉 | wrong | 🪫📉 | 🔋 is a full battery. |
| held-es-163 | qué viaje | 🗺️ | ambiguous | ✈️🧳🗺️🤯 | A literal trip, or "what a trip" (a crazy experience). One label. |
| held-es-164 | a pie hasta casa | 👟 | missing | 🚶👟🏠 | "Walking home". One label. |
| held-es-165 | qué odisea | 🚉 | missing | 😩😮‍💨🚉 | "What an ordeal". One label. |
| held-es-166 | ya casi llego | 📍 | missing | 🏃📍🚗 | "I am almost there". One label. |
| held-es-167 | la maleta no cierra | 📦️ | wrong | 🧳😩 | The query is about a suitcase. 📦 is a parcel. |

### ar

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-ar-006 to held-ar-011, held-ar-030 to held-ar-035 | e.g. ya lahwy 😱 | — | query | (labels unchanged) | Remove the emoji from `q` (see Patterns). |
| held-ar-015 | على أعصابي | 😬😰📈 | wrong | 😬😰 | "On edge". 📈 (chart up) has no link to the feeling. |
| held-ar-018 | eid mubarak ya habibi | 🍬 | wrong | 🌙🎉🕌🍬 | "Happy Eid, dear". 🍬 alone misses the obvious Eid answers. |
| held-ar-019 | mabrouk el eid | 🎊 | missing | 🌙🎊🎉 | "Happy Eid". One label. |
| held-ar-020 | ramadan karim | 🌙 | missing | 🌙🕌🤲✨ | Ramadan greeting. One label. |
| held-ar-021 | el jaw helw awy | 🌟 | wrong | ☀️😎🌤️ | "The weather is very nice". 🌟 is a star. |
| held-ar-022 | ya rab kollo tamam | 🤍 | missing | 🤲🙏🤍 | "God, let all be well" (a prayer). One label. |
| held-ar-023 | fari7a kbira | 🥳 | missing | 🥳🎉😁 | "Great joy". One label. |
| held-ar-027 | da3a el rishm | 💸😩💰️ | query | drop, or 😩🍩🍔 | The text is unclear. It is probably "ضاع الرجيم" ("the diet is ruined", topic: food). The money labels do not match. |

### fr

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-fr-183 | je craque | 😂🤣💀 | ambiguous | 😂🤣💀😩 | "I crack up" or "I give in / I break down". |
| held-fr-185 | c'est n'importe quoi | 🤡🤪🙃 | missing | 🙄🤦🤡🙃 | Same phrase as held-fr-153 "n'importe quoi" (🙄🤦). The labels must agree. |
| held-fr-206 | une pépite | 🎶 | missing | 💎✨🎶 | "A gem". One label. |
| held-fr-207 | j'ai les boules | 😢 | missing | 😢😞😤 | "I am gutted / upset". One label. |
| held-fr-208 | quel banger | 🎵 | missing | 🔥🎵🎶 | "What a banger". One label. |
| held-fr-209 | je suis sous le choc | ‼️ | missing | 😱😲‼️ | "I am in shock". The shock faces are not labels. |
| held-fr-210 | une légende | 🌟 | missing | 🐐👑🌟 | "A legend". One label. |
| held-fr-211 | ça me fume | 😭 | ambiguous | 😭😂💀 | Slang "that kills me (it is so funny)". One label. |

### bn

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-bn-186 | ki obostha | 😂🤣💀 | ambiguous | 😂🤦😩💀 | "What a state!" can be amused or fed up. |
| held-bn-193 | khub klanto lagche | 😫😴🔋 | wrong | 😫😴🪫 | 🔋 is a full battery. |
| held-bn-205 | atpoure | 🎭️✨️🌟 | wrong | drop, or 🏠👗 | আটপৌরে means "everyday, homely, plain". The labels mean theatre and stars. |
| held-bn-255 | ভীষণ ক্লান্ত | 😫😪🔋 | wrong | 😫😪🪫 | 🔋 is a full battery. |
| held-bn-258 | পেট একদম ফাঁপা | 🤤😋🍽️ | ambiguous | 😣🤢🤤 | "পেট ফাঁপা" usually means a bloated stomach, not hunger. |

### pt

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-pt-240 | tô exausta | 😴🔋🫠 | wrong | 😴🪫🫠 | 🔋 is a full battery. |
| held-pt-246 | paz | 🍃🧘🌊✨️ | missing | ☮️🕊️🍃🧘 | "Peace". ☮️ and 🕊️ are the standard peace emoji. |
| held-pt-248 | perdi tudo | 🫠 | ambiguous | 🫠😭😂💀 | "I lost everything", or slang "I lost it (laughing)". One label. |
| held-pt-249 | icônico | 🕶️ | missing | 💅👑✨🕶️ | "Iconic". One label. |
| held-pt-250 | babado | 👀 | missing | 👀🍵🤭 | "Gossip / drama". One label. |
| held-pt-251 | zerou a vida | 🙌 | missing | 🙌🏆🤩 | "Won at life". One label. |
| held-pt-252 | muito bom | 🔝 | missing | 👍👏🔥🔝 | "Very good". One label. |
| held-pt-280 | que cansaço | 😪😩🔋 | wrong | 😪😩🪫 | 🔋 is a full battery. |

### ru

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-ru-241 | жиза | 🤝🫠😩 | missing | 💯🤝😩 | Slang "so relatable". 💯 is the usual answer. |
| held-ru-271 | лол | 🤡🙃🤣 | missing | 😂🤣🤡 | "lol". 😂 is the usual answer and is not a label. |
| held-ru-279 | сил нет вообще | 😴🥱😩🔋 | wrong | 😴🥱😩🪫 | 🔋 is a full battery. |
| held-ru-295 | ты мой герой | 🛡️👑🌟 | missing | 🦸🛡️👑🌟 | "You are my hero". 🦸 is the hero emoji. |

### id

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-id-291 | lucu | 😂🤣 | ambiguous | 😂🥰🥹🤣 | "Lucu" means both "funny" and "cute". A grandparent often means "cute". |
| held-id-298 | ramai pol | 🎎🏮🎊 | wrong | 🎉🥳👥🎊 | "Very crowded / lively". 🎎 and 🏮 are Japanese festival items. |
| held-id-305 | butuh asupan | 🍔🍕🍜🤤 | ambiguous | 🤤🍔😍👀 | "Asupan" is food, and also slang for eye candy. |
| held-id-315 | riil no fek | 💯📠✅️ | wrong | 💯✅ | "Real, no fake". 📠 is a fax machine. |
| held-id-319 | capek bgt luv | 💀🤡🫠 | missing | 😫😩💀🫠 | Same meaning as held-id-270 "capek bgt" (😫😩😴). |
| held-id-320 | panas pol | 🌡️ | missing | 🥵☀️🔥🌡️ | "Very hot". One label. |
| held-id-321 | mendung terus | 🌫️ | missing | ☁️🌥️🌫️ | "Cloudy all the time". One label. |
| held-id-322 | hujan deres bgt | 💧 | missing | 🌧️☔⛈️ | "Heavy rain". One label. |
| held-id-323 | dingin bgt parah | 🌬️ | missing | 🥶❄️🌬️ | "Very cold". One label. |
| held-id-324 | adem banget ya | 🎐 | missing | 😌🍃🎐 | "Nice and cool". One label. |
| held-id-325 | badai dateng | 💨 | missing | ⛈️🌪️💨 | "A storm is coming". One label. |
| held-id-326 | anjir kok gitu sih | ⁉️ | missing | 😤🤨😱⁉️ | "Damn, why is it like that?". One label. |
| held-id-327 | turut berduka cita ya | 🥀 | missing | 🙏😢🖤🥀 | Condolences. One label. |
| held-id-328 | kok bisa kalah sih | 📉 | missing | 😩🤦😞📉 | "How could we lose?". One label. |
| held-id-329 | info transfer dong | 🔄 | ambiguous | ⚽👀🔄 | Football transfer news. 🔄 alone is weak. |

### tr

| id | Query | Labels now | Kind | Proposed labels | Reason |
| --- | --- | --- | --- | --- | --- |
| held-tr-310 | pazartesi | 😴☕️😫 | ambiguous | 😴☕😫📅🗓️ | The literal meaning is the day (Monday). |
| held-tr-313 | şaka mı | 😂🤦‍♀️🤡 | ambiguous | 😳🤨😂🤡 | "Is this a joke?" usually shows disbelief, not laughter. |
| held-tr-325 | gül | 🌹🌷 | wrong | 🌹🥀 | "Gül" is a rose. 🌷 is a tulip ("lale"). "Gül" is also "laugh!". |
| held-tr-328 | ay çok tatlı | 😻✨️🍭 | missing | 🥰🥺😻✨ | "So cute". 🍭 is the literal "sweet". |
