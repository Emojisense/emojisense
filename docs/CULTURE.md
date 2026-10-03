# Culture layer, Phase 2: keep up with culture, editors approve every entry

Phase 1 (docs/ARCHITECTURE.md, "Culture layer") is editorial: AI drafts entries on a laptop
(`culture:propose`), a person reviews them (`culture:review`), and a deploy ships them. Phase 2
keeps the person and removes the laptop: the API Worker drafts entries every night, an editor
reviews them in the dashboard, and an approval goes live within minutes without a deploy. Git
stays the long-term record through an export.

**Rule (unchanged):** nothing is served that an editor did not approve. AI drafts are stored as
`draft` and are never in a culture file. The website says "editors, helped by AI"; that stays
true.

## Where culture applies (2026-10-03: on by default)

| Surface | Default | Region | Day |
| --- | --- | --- | --- |
| SDK (core, React, web component, editors) | on: the culture file next to the packs; `cultureUrl: false` turns it off | the device's: language region, else time zone (`zones` in the file); `""` none | the device's local day |
| `GET /v1/search` | on; `culture=0` turns it off (the SDK client sends it) | `region=XX`, else the region of `locale` (`pt-BR`), else none; `auto` = IP country | `day=`, else the local day of the caller's time zone, else UTC |
| `POST /v1/suggest-reactions` | on; `"culture": false` turns it off | as search, in the body | as search, in the body |
| Kotlin, Swift | on with the culture file loaded | the device's (`Locale`, else `TimeZone`) | the device's local day (Gregorian) |

Culture is applied after every cache: shard files, the search edge cache and the R2 answer store
hold canonical answers only. Developer setup: packages/core/README.md ("Culture"), docs/API.md.

## Flow

```
03:17 UTC  trends_daily (regional trends step): k-anonymous rising queries per locale and country
             │
04:41 UTC  ▼ nightly proposal job (packages/worker/src/culture-admin/propose.ts)
             candidates: rising queries (score ≥ 2, top 3 per locale × country)
                         + holidays and events that start in the next 45 days (culture/sources)
             drop: phrases in exclusions.txt or the blocklist (never sent to the model),
                   ids and triggers that a deployed, live or earlier proposed entry has
             ▼ Workers AI (@cf/google/gemma-4-26b-a4b-it, prompt propose.v2, JSON schema),
               ≤ CULTURE_PROPOSE_BUDGET calls (default 12); emoji only from a candidate list
             ▼ validateRecord (the rules of culture:check) → culture gate on the in-house suite
             ▼ D1 culture_proposals: status draft, with evidence (trend counts or calendar source)
dashboard  ▼ Internal → Culture (ADMIN_EMAILS only): evidence, edit, live preview per trigger,
             locale and region → approve (reason optional) or reject (reason required)
             ▼ D1 culture_entries_live (approved; validated and gated again)
publish    ▼ deployed culture files (git entries, built at deploy) + approved live entries
             → R2 SHARDS culture/<packVersion>/<build>/… + current.json (the pointer)
             on "Publish now", the nightly job, and every 10 minutes when a deploy or an
             approval changed something
serve      ▼ GET /v1/culture/<v>/<file>: the R2 build when its pointer names this deployment's
             files, else the deployed files (ASSETS); search and reactions read the same
export     ▼ "Export to git" → culture:import-live → packages/data/culture/entries/<id>.json → commit
             after the next deploy the git entry wins; its live copy is history
```

## Data

| Table (migration 0005) | Holds | Written by |
| --- | --- | --- |
| `culture_proposals` | One AI draft per entry id: `record` (entry JSON), `evidence`, status `draft`/`approved`/`rejected`, reviewer and reason. Rejected rows stay so the idea is not proposed again. | nightly job (insert), dashboard via the API Worker (edit, decide) |
| `culture_entries_live` | Approved entries served without a deploy; `retired` takes one out; `exported_at` marks an export. | dashboard via the API Worker |

Evidence holds aggregates only: per country the normalized phrase, its rising score and the
searches of the 7-day window (rows of `trends_daily`, which are k-anonymous: ≥ 3 accounts and ≥ 10
searches), or the calendar source. The nightly job empties the trend rows of proposals older than
`TRENDS_KEEP_DAYS` (90), so the evidence lives no longer than `trends_daily`; the entry stays, so a
decided idea is not proposed again. Reviewers are stored by account id (`ON DELETE SET NULL`) and
display name; entries record the name as `reviewedBy`, never an email address.

## Checks before anything is stored or served

| Check | Where |
| --- | --- |
| Schema, catalog hexcodes, windows (events ≤ 60 days), neutral context, exclusions.txt, alias blocklist | `validateRecord` in `@emojisense/data/culture-core`, the same code as `culture:check` |
| Excluded phrases never reach the model | `findExcluded` before the Workers AI call |
| Emoji only from the candidate list (source hints + what the alias engine finds) | `candidateEmoji`, `toDraftRecord` |
| No trigger another entry owns; no id another entry has | `TriggerIndex`, the id checks of the job and the admin service |
| Culture gate: no canonical top-1 answer of the in-house suite changes; each trigger brings the strongest emoji into the top 3; regional senses keep their rules | `runCultureGateWith` (shared with `culture:gate`), per record, one locale engine at a time |
| Again at approval, and at every publish (a deploy can bring new packs or rules): an entry that fails is left out and listed as skipped | admin service, `runCulturePublish` |
| Published file ≤ 6 KB gzip per locale (`CULTURE_GZIP_BUDGET`) | `runCulturePublish` |

## Publishing and serving

- **Store:** the `culture/` prefix of the API Worker's `SHARDS` bucket (the shard store uses
  `shards/` only). No new bucket: both are nightly public files that only the API Worker writes.
- **Build:** a hash of the files, so a publish with no change writes only the pointer. The
  previous build stays one more publish (isolates trust a pointer for 5 minutes).
- **Deploys:** the pointer records a hash of the deployed `index.json` (`base`). After a deploy
  the route serves the new deployed files until the 10-minute sync publishes the live entries
  into them again, so a deploy never brings back an older copy of a git entry.
- **Format:** unchanged (`formatVersion: 1`, 12 months, `relevantNow: []`); `index.json` of a build
  adds `build` and `live` (ids). Headers: `Cache-Control: public, max-age=3600`, CORS `*`, an ETag.
- **Cost of serving:** `/v1/culture/*` now runs the Worker (like `/p/*`), so a culture file
  request is a Worker request; the edge cache keeps R2 reads to one per colo and build.

## Cost per night

| Item | Amount | Cost |
| --- | --- | --- |
| Workers AI drafts | ≤ 12 calls × ≈ 1,500 input + ≈ 400 output tokens (a holiday for 11 locales ≈ 2,000 output) | ≈ $0.0003 per call at $0.10 / $0.30 per M tokens; ≤ $0.005 per night (≈ 300 neurons, inside the free 10,000 per day) |
| D1 | one trends query, a few reads and ≤ 12 inserts | negligible |
| R2 | per publish ≤ 13 writes (11 locales + index + pointer), 1 list, a few deletes | < $0.0001 |
| Sync cron | 144 runs per day, each 1 R2 read + 1 D1 read + 1 asset read when nothing changed | < $0.001 per day |
| CPU | the gate builds each needed locale engine once per run (13–18 MB packs) | a few CPU seconds |

## Configuration

| Name | Worker | Purpose |
| --- | --- | --- |
| `CULTURE_CRON_ENABLED` | API (var) | `"true"` runs the nightly proposals. Publishing runs either way. |
| `CULTURE_PROPOSE_BUDGET` | API (var) | Workers AI calls per night (default 12, at most 100). |
| `SHARDS` | API (R2) | Also holds the culture builds (`culture/` prefix). |
| crons `41 4 * * *`, `*/10 * * * *` | API | Nightly proposals + publish; the 10-minute sync. |
| `ADMIN_EMAILS` | dashboard (secret) | Who sees the Culture page (verified email claim). |
| `CULTURE_ADMIN` | dashboard (service binding) | The API Worker's `CultureAdmin` RPC entrypoint. |

## Commands

```
pnpm --filter @emojisense/data culture:import-live --file culture-live-export.json   # the dashboard's export
pnpm --filter @emojisense/data culture:import-live --d1 remote --env production      # read-only D1 query
pnpm --filter @emojisense/data culture:check                                         # then review and commit
```

## Not in Phase 2

Learning from picks or misses without an editor; proposals in a locale without a pack; editing
git entries in the dashboard (change them in git); a public list of proposals.
