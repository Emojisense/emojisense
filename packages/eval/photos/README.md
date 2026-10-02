# Labelled photos (photo → emoji eval)

`pnpm --filter @emojisense/eval photos` sends every photo in this folder to a running API
(`POST /v1/classify-image`) and scores the results. It measures what users get, end to end:
the vision model, the ranking and the catalog together. Credits: [CREDITS.md](CREDITS.md).

## Run

1. Start the API with Workers AI (needs `wrangler login`). Use a dev key on a large plan, so the
   free limit of 100 images per month does not stop the run:

   ```bash
   cd packages/worker
   npx wrangler dev --port 8788 --var "DEV_KEYS:pk_demo,pk_bench:scale" --persist-to ../../.wrangler/state
   ```

2. Run the eval and give the run a label:

   ```bash
   pnpm --filter @emojisense/eval photos -- --key pk_bench --label after
   ```

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `--api` | `http://localhost:8788` | API base URL |
| `--key` | `pk_demo` | Publishable key (`?key=`) |
| `--label` | `latest` | Name of the run. It is stored as `reports/photos.<label>.json`. |
| `--photos` | this folder | Another folder with a `labels.jsonl` |

`reports/photos.md` compares every stored run. `before` and `after` come first. Photos are sent
without `X-Image-Hash`, so the caption cache is not used and each run asks the vision model
again. The vision model is not deterministic: a rerun can move single photos.

| Metric | Meaning |
| ------ | ------- |
| P@1 | The top result is acceptable. |
| P@4 | Share of the top 4 results that is acceptable. A photo with 2 acceptable emoji can reach 50 at most; the report shows the ceiling. |
| Hit@4 | At least one acceptable emoji is in the top 4. |

## Add a photo

### 1. Pick a photo you may commit

The photos go into this MIT repository, so the license must allow redistribution.

| License | Allowed | `"license"` value | Note |
| ------- | ------- | ----------------- | ---- |
| Your own photo | yes | `own` | You release it as CC0. |
| CC0, public domain | yes | `CC0`, `CC0-1.0`, `PDM-1.0` | |
| CC BY, CC BY-SA (2.0, 3.0, 4.0) | yes | e.g. `CC-BY-4.0`, `CC-BY-SA-4.0` | Add `"author"`. Attribution is required. |
| CC BY-NC, CC BY-ND | no | | Not open enough for this repository. |
| Unsplash, Pexels, stock, "free" sites | no | | Their current terms forbid redistribution as a collection. |

Exception: a photo that was CC0 when it was published (Unsplash before June 2017, Pixabay
before January 2019) and that Wikimedia Commons hosts as CC0 is allowed. Use `"license":
"CC0"` and say so in `"note"`.

Good sources: your own phone, [Wikimedia Commons](https://commons.wikimedia.org) (check the
license of each file), [Openverse](https://openverse.org) with the CC0 filter.

Do not use photos with recognizable faces of people who did not agree, license plates, or
private text (screens, letters, messages).

### 2. Prepare the file

- Downscale to at most 384 px on the long edge, like the clients do. Save as JPEG or WebP, at
  most 256 KB (the API limit). macOS: `sips -s format jpeg -s formatOptions 82 -Z 384
  original.jpg --out dog-sofa.jpg`.
- Name: lowercase words with dashes, e.g. `dog-sofa.jpg`.
- Remove the metadata (EXIF, GPS) and keep only the color profile:
  `exiftool -all= -tagsfromfile @ -icc_profile -overwrite_original dog-sofa.jpg`.

### 3. Add one line to `labels.jsonl` and one row to `CREDITS.md`

```json
{"file":"dog-sofa.jpg","answers":["🐶","🛋️","🥰"],"license":"CC0","source":"https://commons.wikimedia.org/wiki/File:…","author":"Jane Doe"}
```

| Field | Required | Meaning |
| ----- | -------- | ------- |
| `file` | yes | File name in this folder |
| `answers` | yes | 2–4 emoji that are a good top result: what the photo shows, and the main reaction if there is a strong one (🥰 for a puppy, 😋 for food). Look at the photo before you write them. |
| `license` | yes | See the table in step 1 |
| `source` | yes | URL of the original, or `own photo` |
| `author` | for CC BY | Name for the attribution (give it for CC0 too) |
| `note` | no | Anything a reviewer should know |

Send photos only to vision APIs whose terms do not allow training on the data (DECISIONS.md,
"Image → emoji is classification").
