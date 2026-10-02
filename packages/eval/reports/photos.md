# Photo → emoji eval (live API)

- 31 photos in `photos/` (CC0, credits in `photos/CREDITS.md`), 2–4 acceptable emoji each in `photos/labels.jsonl`.
- Each run sends every photo to `POST /v1/classify-image?limit=8&locale=en` without `X-Image-Hash`.
- **P@1**: the top result is acceptable. **P@4**: share of the top 4 that is acceptable. Its ceiling is below 100 because some photos have fewer than 4 acceptable emoji. **Hit@4**: any acceptable emoji in the top 4.
- The vision model is not deterministic: a rerun can move single photos.

| Run | Date | Items | P@1 | P@4 | Hit@4 | Trap@4 | P@4 ceiling | Failed |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| before | 2026-10-02 | 31 | 67.7 | 42.7 | 93.5 | 0 | 82.3 | 0 |
| after | 2026-10-02 | 31 | 93.5 | 54 | 96.8 | 0 | 82.3 | 0 |
| before-rerun | 2026-10-02 | 31 | 74.2 | 42.7 | 90.3 | 0 | 82.3 | 0 |
| after-rerun | 2026-10-02 | 31 | 93.5 | 55.6 | 96.8 | 0 | 82.3 | 0 |

## Per Photo

✓ = acceptable, ✗ = known trap.

| Photo | Acceptable | before (top 4) | after (top 4) | before-rerun (top 4) | after-rerun (top 4) |
| --- | --- | --- | --- | --- | --- |
| puppy | 🐶🐕🥰😍 | 😸 🐶✓ 🐕️✓ 🐩 | 🐕️✓ 🐶✓ 🐾 🌳 | 🐶✓ 🐕️✓ 🐩 🦔 | 🐕️✓ 🐶✓ 🐾 🌳 |
| cake | 🎂🍰🥳🎉 | 🎂✓ 🎇 🧁 🥳✓ | 🎂✓ 🥳✓ 🕯️ 🎉✓ | 🎂✓ 🎇 🧁 🥳✓ | 🎂✓ 🥳✓ 🕯️ 🍰✓ |
| sunset | 🌅🏖️🌊🙌 | 🌅✓ 😌 🌞 🏖️✓ | 🌅✓ 🏖️✓ 🌇 🌊✓ | 🌅✓ 🏖️✓ 🌞 😌 | 🌅✓ 🏖️✓ 🌇 🌊✓ |
| pizza | 🍕🍄‍🟫🍄😋 | 🍕✓ 🍄‍🟫✓ 🧀 🍽️ | 🍕✓ 🧀 🍄✓ 🍄‍🟫✓ | 🍕✓ 🍄‍🟫✓ 🧀 🍽️ | 🍕✓ 🧀 🍄✓ 🍄‍🟫✓ |
| cat | 🐱🐈😴⌨️ | 🐈️✓ 🐱✓ ⌨️✓ 🐼 | 🐈️✓ 💻️ ⌨️✓ 🐱✓ | 🐈️✓ 😹 🐱✓ ⌨️✓ | 🐈️✓ ⌨️✓ 💻️ 🐱✓ |
| hike | ⛰️🏔️🥾🏞️ | 🚵‍♀️ ⛰️✓ 🌄 🚵‍♂️ | ⛰️✓ 🏔️✓ ☁️ 🚶 | ⛰️✓ 🏞️✓ 🌄 🏔️✓ | ⛰️✓ 🏔️✓ ☁️ 🥾✓ |
| robin | 🐦🌿🍃🌳 | 🐦️✓ 🐤 🪶 🕊️ | 🐦️✓ 🌳✓ 🎶 ✨️ | 🐦️✓ 😁 🐤 🐓 | 🐦️✓ 🌳✓ 🎶 🍃✓ |
| horse | 🐴🐎🌾 | 🦬 🐎✓ 🐴✓ 🏇 | 🐎✓ 🐴✓ 🌾✓ 🏇 | 🦬 🐎✓ 🐴✓ 🏇 | 🐎✓ 🌾✓ 🐴✓ 🏇 |
| goldfish | 🐠🐟 | 🐠✓ 🐬 🐟️✓ 🦦 | 🐟️✓ 🐠✓ 🐡 🧡 | 🐠✓ 🐬 🦩 🐟️✓ | 🐟️✓ 🐠✓ 🐡 🪼 |
| butterfly | 🦋🪻🌸 | 🦋✓ 🦩 🪻✓ 🌼 | 🦋✓ 🌸✓ 🌿 🐌 | 🦋✓ 🦩 🪻✓ 🌼 | 🦋✓ 🌸✓ 🌿 🐌 |
| latte | ☕🤎❤️ | 🤍 🤎✓ 💟 🌼 | ☕️✓ ❤️✓ 😋 😍 | 🤍 🤎✓ 💟 🌼 | ☕️✓ ❤️✓ 😋 🤎✓ |
| burger | 🍔🍟😋 | 🍟✓ 🍔✓ 🧀 🍽️ | 🍔✓ 🍟✓ 😋✓ 🤤 | 🍟✓ 🍔✓ 🧀 🍽️ | 🍔✓ 🍟✓ 🍽️ 😋✓ |
| sushi | 🍣🐟🦐😋 | 🍣✓ 😋✓ 🍽️ 🥢 | 🍣✓ 🍱 🥢 🍤 | 🍣✓ 🥢 😋✓ 🍽️ | 🍣✓ 🍱 🥢 🐟️✓ |
| strawberries | 🍓😋 | 🍓✓ 🍊 🫐 😋✓ | 🍓✓ 😋✓ ❤️ 🫐 | 🍓✓ 🫐 🍊 🍎 | 🍓✓ 😋✓ ❤️ 🫐 |
| fireworks | 🎆🎇🎉🥳 | 🎆✓ 🌃 🌆 🌠 | 🎆✓ 🌃 🎇✓ ✨️ | 🎆✓ 🌃 🌆 🌠 | 🎆✓ 🌃 🎇✓ ✨️ |
| balloons | 🎈🥳🎉🎂 | 🎈✓ 🎂✓ 🥳✓ 🎉✓ | 🥳✓ 🎈✓ 🎂✓ 🎉✓ | 🎈✓ 🎂✓ 🥳✓ 🎉✓ | 🎈✓ 🎂✓ 🥳✓ 🎊 |
| christmas-tree | 🎄✨🎁 | 🎄✓ 🌲 🤶 🪴 | 🎄✓ ✨️✓ 🌲 🎁✓ | 🎄✓ 🤶 🌲 🪴 | 🎄✓ 🎁✓ ✨️✓ 🌲 |
| snowman | ☃️⛄ | ⛄️✓ ☃️✓ 🦬 🦌 | ⛄️✓ ☃️✓ 🌾 🏙️ | ⛄️✓ ☃️✓ 🦬 🇬🇱 | ☃️✓ ⛄️✓ 🌾 🏙️ |
| umbrella | 💧☔🌧️ | 💧✓ 💦 🫧 🩵 | 💧✓ 💦 ☔️✓ 🌊 | 💦 💧✓ 🫧 🩵 | 💧✓ 💦 ☔️✓ 🌊 |
| rainbow | 🌈🌦️☁️ | 🌄 🏡 🌈✓ 🇱🇦 | 🌈✓ 🌤️ 🌳 🏘️ | 🌄 🏡 🌈✓ 🇱🇦 | 🌈✓ 🌤️ 🌳 🏘️ |
| snow-forest | 🌲❄️🌨️🥶 | 🌲✓ 🏔️ 🏞️ ⛰️ | 🌲✓ 🏔️ 🛣️ ❄️✓ | 🌲✓ 🌨️✓ 🍃 🏔️ | 🌲✓ 🏔️ 🛣️ ❄️✓ |
| soccer-ball | ⚽🥅 | ⚽️✓ 🥏 ⚪️ 🤽 | ⚽️✓ 🏟️ 🏈 🏃 | ⚽️✓ 🥏 ⚪️ 🤽 | ⚽️✓ 🏟️ 🏈 🏃 |
| dumbbells | 🏋️💪🏋️‍♂️🏋️‍♀️ | 🏋️‍♂️✓ 🏋️✓ 🏋️‍♀️✓ 💪✓ | 🏋️✓ 💪✓ 🖤 ⚙️ | 🏋️‍♂️✓ 🏋️✓ 🏋️‍♀️✓ 🦍 | 🏋️✓ 💪✓ ⚙️ 🔥 |
| bicycle | 🚲🚴 | 🚳 🚵 🚲️✓ 🚵‍♂️ | 🚲️✓ 🏚️ 🛠️ 😔 | 🚳 🚵 🕰️ 🚵‍♀️ | 🚲️✓ 🏚️ ☀️ 🏙️ |
| code | 🧑‍💻💻🖥️👨‍💻 | 👩‍💻 👨‍💻✓ 🧑‍💻✓ 💻️✓ | 💻️✓ 👨‍💻✓ ⌨️ 🚀 | 💻️✓ 🖥️✓ 🧑‍💻✓ 👩‍💻 | 👨‍💻✓ 💻️✓ ⌨️ ✨️ |
| heart-hands | 🫶❤️🌅🥰 | 🫶✓ 😍 🥰✓ 🌅✓ | 🫶✓ 🌅✓ 😍 🥰✓ | 🫶✓ 😍 🥰✓ 🌅✓ | 🫶✓ 😍 🌅✓ 🌊 |
| broken-phone | 📱😱😭💔 | 😲 📱✓ 🫨 🤦 | 📱✓ 💙 💔✓ 😱✓ | 🤦 🤦‍♂️ 🫨 📱✓ | 📱✓ 💙 💔✓ 😱✓ |
| keys | 🔑🗝️🏨 | 📑 🔦 🩶 🕰️ | 🌈 🔑✓ 🏷️ 🏢 | 📑 🔦 🩶 🕰️ | 🏷️ 🌈 🔑✓ 🏢 |
| roses | 🌹💐❤️😍 | 🌹✓ 🌼 🏵️ 🎀 | 💐✓ 🌹✓ 🥰 😍✓ | 🌹✓ 🌼 🏵️ 🎀 | 💐✓ 🌹✓ 🥰 😍✓ |
| beer | 🍺🍻 | 🍻✓ 🍷 🍺✓ 🍾 | 🍺✓ 🍻✓ 🍷 🇨🇿 | 🍻✓ 🍷 🍺✓ 🍾 | 🍺✓ 🍻✓ 🍷 🇨🇿 |
| rocket | 🚀🌠 | 🕴️ 🌌 🛸 🧚 | ☁️ 🌌 ✈️ 😶‍🌫️ | 🕴️ 🌌 🛸 🧚 | ✈️ 🌌 ☁️ ✨️ |

## Inputs (after-rerun)

| Photo | Input | Keywords |
| --- | --- | --- |
| puppy | A happy corgi dog standing on its hind legs outdoors | corgi, dog, standing, happy, outdoors |
| cake | A birthday cake with a lit number three candle and star decorations | birthday cake, number three candle, celebration, star decorations, party |
| sunset | Silhouettes of people celebrating on a beach during a sunset | sunset, beach, silhouette, ocean, celebration |
| pizza | Mushroom and cheese pizza sliced on a wooden cutting board | pizza, mushroom, cheese, wooden board, food |
| cat | A tabby cat lying across a computer keyboard on a desk | cat, keyboard, laptop, desk, tabby |
| hike | A hiker standing on a rocky mountain ridge overlooking misty valleys | mountain, hiker, landscape, mist, ridge |
| robin | A small robin bird singing with its beak wide open in a tree | robin, bird, singing, tree, nature |
| horse | A brown horse standing in a grassy field | horse, field, nature, brown |
| goldfish | Many bright orange goldfish swimming in a clear aquarium | goldfish, aquarium, fish, swimming, orange |
| butterfly | A monarch butterfly resting on purple flowers in a garden | monarch butterfly, purple flowers, garden, nature |
| latte | A white cup of cappuccino with heart latte art on a saucer | cappuccino, latte art, coffee, cup, heart |
| burger | A hamburger in paper and french fries on a white plate | hamburger, french fries, plate, fast food, meal |
| sushi | An assortment of fresh sushi pieces on a black rectangular platter | sushi, nigiri, sashimi, seafood, japanese food |
| strawberries | A clear plastic container filled with fresh red strawberries | strawberries, fruit, container, fresh, berries |
| fireworks | Bright fireworks exploding in the night sky over a dark town | fireworks, night sky, celebration, smoke, town |
| balloons | Colorful balloons and a Happy Birthday banner on a teal wall | balloons, birthday banner, party decorations, celebration |
| christmas-tree | A tall decorated Christmas tree with lights and ornaments in a room. | christmas tree, ornaments, holiday lights, decorations, festive |
| snowman | A large snowman statue standing in front of a grain elevator. | snowman, grain elevator, kenaston, town, statue |
| umbrella | Water droplets on a blue waterproof fabric surface | water droplets, blue fabric, waterproof, texture, moisture |
| rainbow | A vibrant rainbow arches over a green valley and small town. | rainbow, landscape, valley, sky, clouds |
| snow-forest | A snow-covered road winding through a dense pine forest under blue sky | snow, forest, road, winter, trees |
| soccer-ball | A white soccer ball with black and yellow patterns on grass | soccer ball, football, grass, sports, white |
| dumbbells | Two adjustable metal dumbbells and two extra weight plates on floor | dumbbells, weights, fitness, gym, strength |
| bicycle | An old, dusty bicycle parked on a sidewalk near bushes | bicycle, old, sidewalk, dusty, outdoor |
| code | Close up of computer screen displaying colorful programming code | programming, code, software, syntax, developer |
| heart-hands | Hands forming a heart shape around the setting sun | sunset, heart hands, silhouette, ocean, love |
| broken-phone | A blue Samsung smartphone with a severely cracked back glass panel | smartphone, cracked screen, blue phone, samsung, broken glass |
| keys | Many colorful key tags hanging on a gray wall | key tags, identification, colorful, organization, labels |
| roses | A bouquet of vibrant red roses wrapped in clear plastic. | red roses, bouquet, flowers, gift, romance |
| beer | A glass of amber beer next to a Staropramen beer can | beer, can, glass, staropramen, alcohol |
| rocket | A white contrail stretching across a dark blue sky | contrail, sky, vapor trail, airplane, night |
