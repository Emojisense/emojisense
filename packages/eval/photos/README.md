# Labelled photos (image → emoji eval)

`pnpm --filter @emojisense/eval eval:images` reads this folder. It measures image → emoji v1
(a caption and a likely reaction → normal text search). Later, v2 (SigLIP / CLIP) uses the same
photos. With no photos, the command prints a note and exits 0.

Target: about 30 photos. No photos are committed yet.

## 1. Pick a photo you may commit

The photos go into this MIT repository, so the license must allow redistribution.

| License | Allowed | `"license"` value | Note |
| ------- | ------- | ----------------- | ---- |
| Your own photo | yes | `own` | You release it as CC0. |
| CC0, public domain | yes | `CC0`, `CC0-1.0`, `PDM-1.0` | |
| CC BY, CC BY-SA (2.0, 3.0, 4.0) | yes | e.g. `CC-BY-4.0`, `CC-BY-SA-4.0` | Add `"author"`. Attribution is required. |
| CC BY-NC, CC BY-ND | no | | Not open enough for this repository. |
| Unsplash, Pexels, stock, "free" sites | no | | Their terms forbid redistribution as a collection. |

Good sources: your own phone, [Wikimedia Commons](https://commons.wikimedia.org) (check the
license of each file), [Openverse](https://openverse.org) with the CC0 filter.

Do not use photos with recognizable faces of people who did not agree, license plates, or
private text (screens, letters, messages).

## 2. Prepare the file

- Downscale to about 384 px on the long edge. Save as JPEG or WebP, at most 256 KB (the API
  limit). macOS: `sips -Z 384 original.jpg --out dog-sofa.jpg`. ImageMagick:
  `magick original.jpg -resize "384x384>" -quality 80 dog-sofa.jpg`.
- Name: lowercase words with dashes, e.g. `dog-sofa.jpg`. Allowed extensions: `.jpg`, `.jpeg`,
  `.png`, `.webp`.
- Remove location metadata (EXIF GPS). The resize commands above keep it; `exiftool -all= file`
  removes it.

## 3. Add one line to `labels.jsonl`

```json
{"file":"dog-sofa.jpg","answers":["🐶","🥹"],"license":"CC0","source":"https://commons.wikimedia.org/wiki/File:…"}
{"file":"cake.jpg","answers":["🎂","🥳"],"license":"CC-BY-4.0","source":"https://…","author":"Jane Doe"}
{"file":"rainy-window.jpg","answers":["🌧️","☔"],"license":"own","source":"own photo"}
```

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `file` | yes | File name in this folder |
| `answers` | yes | 1–4 emoji. Any of them in the top 5 is a hit. Give what the photo shows and the likely reaction. |
| `license` | yes | See the table in step 1 |
| `source` | yes | URL of the original, or `own photo` |
| `author` | for CC BY | Name for the attribution |
| `note` | no | Anything a reviewer should know |

## 4. Cover a mix

| Kind | Photos | Examples |
| ---- | -----: | -------- |
| Animals and pets | 5 | dog on a sofa, cat in a box, bird |
| Food and drink | 4 | pizza, latte art, birthday cake |
| Celebrations | 4 | fireworks, balloons, graduation cap |
| Places, weather, nature | 5 | beach at sunset, snow, rain on a window |
| Sport and activities | 3 | football, gym, hiking trail |
| Work and tech | 3 | laptop with code, messy desk, coffee cups late at night |
| Moods without faces | 4 | thumbs-up hand, broken phone screen, packed suitcase |
| Objects | 2 | keys, gift box |

## 5. Run

| Command | Captioner |
| ------- | --------- |
| `pnpm --filter @emojisense/eval eval:images -- --captioner workers-ai` | Workers AI vision model (needs `wrangler login`). Change it with `--vision-model`. |
| `… eval:images -- --captioner sidecar --captions photos/captions.json` | Captions you wrote with another model beforehand. |
| `… eval:images -- --captioner filename` | Smoke test only: the file name is the caption. |

A sidecar file maps each photo to a caption and a reaction:

```json
{ "dog-sofa.jpg": { "caption": "a puppy asleep on a sofa", "reaction": "aww so cute" } }
```

Send photos only to vision APIs whose terms do not allow training on the data (DECISIONS.md,
"Image → emoji is classification").

Text search uses the alias engine. When the vectors of the production model exist, it fuses
semantic results too (`--offline` uses cached query embeddings only). The command writes
`reports/images.md` and `reports/images.json`.
