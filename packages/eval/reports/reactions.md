# Message → reaction eval (live API)

- 44 chat messages (en, tr, es, fr, de, pt) in `queries/reactions.jsonl`, each with the reactions people would use.
- Each run sends every message to `POST /v1/suggest-reactions` with `limit: 8`. Stored runs are scored against the current labels.
- **P@1**: the top reaction is acceptable. **P@4**: share of the top 4 that is acceptable. **Hit@4**: any acceptable reaction in the top 4. **Trap@4**: a known literal-noun trap (🚬 for “smoke tests”) is in the top 4; lower is better.
- The labels and the intent cues (packages/worker/src/reaction-intents.ts) were written by the same author: treat the numbers as optimistic until messages written by other people are added.

| Run | Date | Items | P@1 | P@4 | Hit@4 | Trap@4 | P@4 ceiling | Failed |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| before | 2026-10-02 | 44 | 45.5 | 31.3 | 63.6 | 6.8 | 100 | 0 |
| after | 2026-10-02 | 44 | 97.7 | 86.4 | 100 | 0 | 100 | 0 |

## Per Message

✓ = acceptable, ✗ = known trap.

| Message | Acceptable | before (top 4) | after (top 4) |
| --- | --- | --- | --- |
| en-shipped | 🎉🙌👏🚀🙏❤️🥳 | 👋✗ 📦️✗ 📬️✗ 🐣✗ | 🎉✓ 🙌✓ 🙏✓ ❤️✓ |
| en-smoke-tests | 😩😬🤦😭😤🫠😫 | 🚬✗ 🧪 🚭️ 🫁 | 🤦✓ 😤✓ 😬✓ 😩✓ |
| en-10k | 🎉🚀🥳🙌📈🔥💯👏 | 👥 🔟 🐙 👍️ | 🙌✓ 🎉✓ 👏✓ 🥳✓ |
| en-loss | 😢❤️🫂🙏💔😭🤍 | 😢✓ 😿 🙇 🙇‍♂️ | 😢✓ 🫂✓ 💔✓ 😭✓ |
| en-shift | 🙏❤️🙌🤗🫶💕🥹 | 💁 🧑‍⚕️ 🫡 💁‍♂️ | 🙏✓ ❤️✓ 🤗✓ 🫶✓ |
| en-meeting | 😂🤣💀😆💯🙃 | 📨✗ ✉️✗ 📩✗ 📧✗ | 😂✓ 🤣✓ 💀✓ 😆✓ |
| en-agree | 👍💯🙌✅👌🤝🚀💪 | 🙂‍↕️ 🙆 🔛 🙆‍♀️ | 👍️✓ 🙌✓ ✅️✓ 💯✓ |
| en-birthday | 🎂🎉🥳🎈🎁❤️🎊 | 🎂✓ 🥳✓ 🎉✓ 🤶 | 🎂✓ 🥳✓ 🎈✓ 🎉✓ |
| en-flight | 😩😭😤😡🤦😫😞😢 | 🛄 ✈️ 🛫 😞✓ | 🤦✓ 😩✓ 😫✓ 😤✓ |
| en-engaged | 💍🎉🥳😍❤️🥂🥰🎊 | 💍✓ 👰 👰‍♀️ 💒 | 💍✓ 🙌 🎉✓ 👰 |
| en-exam | 🍀🤞💪🙏✨📚 | 🍀✓ 🤞✓ 🕣️ 🕝️ | 🍀✓ 🤞✓ 💪✓ 🙏✓ |
| en-build-green | 🚀✅🎉🙌💚🟢 | 💚✓ 🚢 ♻️ 🌱 | 🚀✓ 🚢 ✅️✓ 💚✓ |
| en-job | 🎉🥳🙌👏🎊💪🔥🍾 | 💼 🧑‍💼 👨‍💼 👩‍💼 | 🎉✓ 🙌✓ 👏✓ 🧑‍💼 |
| en-pizza | 🍕🙋👍😋🙌🙋‍♂️🙋‍♀️ | 🥪 🍴 🍕✓ 🍄‍🟫 | 🍕✓ 😋✓ 🙋✓ 🫂 |
| en-mondays | 😩😫🙄😴😤☕🥱 | 🙍 😓 🙄✓ 😒 | 🤦 😬 😩✓ 😫✓ |
| en-review | 👀👍✅👌🫡 | 🤦 💇 🤦‍♂️ 🤳 | 👀✓ ✅️✓ 🫡✓ 👍️✓ |
| en-cat-coffee | 😂🤣🤦😱🙀😹💀😭 | 🎹 ⌨️ 🐈️ 🐸 | 🤦✓ 🥺 ☕️ 🙈 |
| en-final | 😢😭💔😞🫂😩 | 😵 😞✓ 🥀 🏁 | 😢✓ ❤️ 🫂✓ 😞✓ |
| en-welcome | 👋🎉🙌🤗❤️🥳 | 👐 🦁 💙 🔛 | 👋✓ 🤗✓ 🎉✓ 🤝 |
| en-outage | 🚨🔥😱👀🫡😬🆘 | 🫳 🤦 ⏬️ 🎮️ | 🫡✓ 🚨✓ 🆘✓ 👀✓ |
| en-hilarious | 😂🤣💀😆 | 💀✓ 🤣✓ 😆✓ 😂✓ | 😂✓ 🤣✓ 😆✓ 💀✓ |
| en-running-late | 👍👌🏃⏰🙏🆗 | 🏃✓ 🏃‍♂️ 🏃‍➡️ 🏃‍♀️ | 🏃✓ 🚨 🫡 😅 |
| en-snowing | ❄️☃️😍🥶⛄🌨️🎉 | 🌨️✓ 🛷 ☃️✓ 🏂️ | 🌨️✓ 🤦 😅 😴 |
| en-coffee | ☕😴🥱😩😅 | ☕️✓ 🕤️ 🇨🇦 🍵 | ☕️✓ 🥱✓ 😴✓ 😩✓ |
| en-typo | 🤦😂🤣😅🐛🙃💀 | 🐛✓ 🪲 🤦✓ 🧩 | 🤦✓ 🐛✓ ✅️ 🪲 |
| en-prod-fire | 😱🚨🔥😬🫠💀 | 🔥✓ ❤️‍🔥 🚒 🧑‍🚒 | 🔥✓ 🚨✓ 👀 😱✓ |
| tr-congrats | 🎉👏🙌👍🥳🔥💯 | 🌟 🙌✓ 🎉✓ 👏✓ | 🎉✓ 🙌✓ 👏✓ 🥳✓ |
| tr-thanks | 🙏❤️🤗🙌🫶🥹 | 🙏✓ 😊 🫶✓ 🙇 | 🙏✓ 🫶✓ 🥹✓ ❤️✓ |
| tr-condolence | 😢🙏❤️🫂💔🤲🤍 | 🖤 🙁 🙇 🙇‍♂️ | 🫂✓ 😢✓ ❤️✓ 🫡 |
| tr-agree | 👍💯🙌✅👌🤝 | 💯✓ 🙂‍↕️ 👍️✓ 👆️ | 💯✓ 👍️✓ 🙌✓ ✅️✓ |
| tr-birthday | 🎂🎉🥳🎈🎁❤️ | 🥳✓ 🎂✓ 🎈✓ 🎉✓ | 🎂✓ 🥳✓ 🎈✓ 🎉✓ |
| tr-funny | 😂🤣😆💀 | 😆✓ 🤣✓ 😂✓ 😛 | 😂✓ 🤣✓ 😆✓ 💀✓ |
| es-new-job | 🎉🥳👏🙌🎊💪 | 💼 🎉✓ 🧑‍⚕️ 👋 | 🎉✓ 👏✓ 🙌✓ 🥳✓ |
| es-thanks | 🙏❤️🤗🫶🙌🥹 | 😊 🙏✓ 🫂 🫶✓ | 🙏✓ 🫶✓ 🙌✓ 🤗✓ |
| es-lol | 😂🤣💀😆 | 🤹 🦈 🤹‍♀️ 🇳🇬 | 🤣✓ 😂✓ 💀✓ 😆✓ |
| es-sorry | 😢🫂❤️🙏💔🤗 | 🫂✓ 🤗✓ 🙇 🙇‍♂️ | 🫂✓ 🙏✓ 😢✓ 😭 |
| fr-congrats | 🎉👏🙌🥳🍾🎊 | 🙌✓ 🏅 👏✓ 🎉✓ | 🙌✓ 🎉✓ 👏✓ 🎊✓ |
| fr-thanks | 🙏❤️🤗🙌🫶 | 🙏✓ 🛟 🤗✓ 👏 | 🙏✓ 🤗✓ 🫶✓ ❤️✓ |
| fr-agree | 👍💯🙌✅👌🚀💪 | 🙆 🙆‍♀️ 🔛 🙆‍♂️ | 👍️✓ 🙌✓ 👌✓ ✅️✓ |
| de-birthday | 🎂🎉🥳🎈🎁🎊 | 🎂✓ 🎉✓ 🥳✓ 🎈✓ | 🎉✓ 🥳✓ 🎂✓ 🎈✓ |
| de-thanks | 🙏❤️🤗🫶🙌💪🥰 | 🐐 🌟 🥇 🔝 | 🙏✓ 🙌✓ ❤️✓ 🫶✓ |
| de-sorry | 😢🫂❤️😞🙏💔 | 🙈 🙇‍♂️ 🙇 🤦‍♂️ | 😢✓ 😭 ❤️✓ 🫂✓ |
| pt-lol | 😂🤣😆💀 | 😜 😆✓ 😉 😛 | 😆✓ 😂✓ 🤣✓ 💀✓ |
| pt-launch | 🎉🚀👏🙌🥳🔥 | 🎉✓ 👏✓ 🙌✓ ㊗️ | 🚀✓ 🎉✓ 🙌✓ 👏✓ |

## Inputs (after)

| Message | Input | Keywords |
| --- | --- | --- |
| en-shipped | shipped the new onboarding 🎉 thanks team | – |
| en-smoke-tests | smoke tests are failing again | – |
| en-10k | we just hit 10k users! | – |
| en-loss | I'm so sorry for your loss | – |
| en-shift | thank you so much for covering my shift | – |
| en-meeting | lol that meeting could have been an email | – |
| en-agree | totally agree, let's do it | – |
| en-birthday | happy birthday Sarah! | – |
| en-flight | my flight got cancelled again | – |
| en-engaged | she said yes!! we're engaged 💍 | – |
| en-exam | good luck on your exam tomorrow | – |
| en-build-green | the build is green, ship it | – |
| en-job | I got the job!!! | – |
| en-pizza | anyone want to grab pizza for lunch? | – |
| en-mondays | ugh, mondays | – |
| en-review | can you review my PR when you have a sec? | – |
| en-cat-coffee | my cat knocked my coffee all over the keyboard | – |
| en-final | we lost the final 2-1, gutted | – |
| en-welcome | welcome to the team, Alex! | – |
| en-outage | server is down, all hands on deck | – |
| en-hilarious | this is hilarious 😂 | – |
| en-running-late | running late, be there in 10 | – |
| en-snowing | it's snowing!! | – |
| en-coffee | need coffee before this standup | – |
| en-typo | found the bug, it was a typo the whole time | – |
| en-prod-fire | prod is on fire 🔥 | – |
| tr-congrats | tebrikler, harika iş çıkardınız! | – |
| tr-thanks | çok teşekkür ederim 🙏 | – |
| tr-condolence | başınız sağ olsun | – |
| tr-agree | kesinlikle katılıyorum | – |
| tr-birthday | doğum günün kutlu olsun! | – |
| tr-funny | hahaha çok komik | – |
| es-new-job | ¡felicidades por el nuevo trabajo! | – |
| es-thanks | muchas gracias por todo | – |
| es-lol | jajaja no puedo más | – |
| es-sorry | lo siento mucho, un abrazo | – |
| fr-congrats | félicitations à toute l'équipe ! | – |
| fr-thanks | merci beaucoup pour ton aide | – |
| fr-agree | je suis d'accord, on y va | – |
| de-birthday | herzlichen Glückwunsch zum Geburtstag! | – |
| de-thanks | danke dir, du bist der Beste | – |
| de-sorry | oh nein, das tut mir leid | – |
| pt-lol | kkkkk que engraçado | – |
| pt-launch | parabéns pelo lançamento! 🚀 | – |
