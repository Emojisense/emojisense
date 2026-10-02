/**
 * The nightly proposal job (culture Phase 2): rising searches (trends_daily) and upcoming
 * holidays and events (culture/sources) → Workers AI drafts → the same validation as
 * culture:check, dedupe against every known entry, the culture gate → `culture_proposals` as
 * drafts with their evidence. Nothing here approves or publishes: an editor does, in the
 * dashboard. Excluded phrases are never sent to the model. Logs counts only, never query text.
 */
import {
  answerSchema,
  type CultureRecord,
  candidateEmoji,
  type DatedCandidate,
  type DraftAnswer,
  type DraftCandidate,
  datedCandidates,
  fillPrompt,
  findExcluded,
  formatEmojiOptions,
  gateFailed,
  parseModelAnswer,
  TriggerIndex,
  toDraftRecord,
  withoutTakenTriggers,
} from "@emojisense/data/culture-core";
import { LOCALE_CODES } from "@emojisense/data/locales";
import { addDays, type CultureProposalEvidence, dayOf } from "@emojisense/platform";
import type { Env } from "../env.ts";
import {
  CULTURE_CALENDAR_DAYS,
  CULTURE_CALENDAR_LEAD_DAYS,
  CULTURE_DEFAULT_BUDGET,
  CULTURE_MAX_BUDGET,
  CULTURE_PROMPT_VERSION,
  CULTURE_PROPOSE_BASE_TOKENS,
  CULTURE_PROPOSE_MODEL,
  CULTURE_PROPOSE_TOKENS_PER_LOCALE,
  CULTURE_TREND_EVENT_DAYS,
  CULTURE_TRENDS_PER_GROUP,
} from "./config.ts";
import { type CultureRuntime, runGateEach, validate } from "./runtime.ts";
import { readDeployedCulture } from "./storage.ts";
import { createCultureStore } from "./store.ts";
import { type RisingQuery, readRisingQueries, trendRegions } from "./trends-input.ts";

export interface ProposalRunReport {
  status: "done" | "skipped";
  reason?: string;
  candidates: { trend: number; calendar: number };
  /** Workers AI calls made (≤ the budget) and the ones that failed. */
  calls: number;
  failedCalls: number;
  /** The model said skip (politics, unsure, not a cultural moment…). */
  declined: number;
  invalid: number;
  gated: number;
  duplicates: number;
  stored: number;
}

type Candidate = { origin: "calendar"; dated: DatedCandidate } | { origin: "trend"; trend: RisingQuery };

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The night's Workers AI call cap: CULTURE_PROPOSE_BUDGET, else the default, never above the max. */
export function proposalBudget(env: Env): number {
  const raw = Number.parseInt(env.CULTURE_PROPOSE_BUDGET ?? "", 10);
  const budget = Number.isFinite(raw) && raw >= 0 ? raw : CULTURE_DEFAULT_BUDGET;
  return Math.min(budget, CULTURE_MAX_BUDGET);
}

/** Calendar first, then trends, taking turns, so neither source can use the whole budget. */
function interleave<A, B>(a: readonly A[], b: readonly B[]): (A | B)[] {
  const out: (A | B)[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i] as A);
    if (i < b.length) out.push(b[i] as B);
  }
  return out;
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 3)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The draft's fixed fields for a trend: the model picks the id and kind, the evidence the regions. */
async function trendDraft(trend: RisingQuery, answer: DraftAnswer, today: string): Promise<DraftCandidate> {
  const suggested = typeof answer.id === "string" ? answer.id.trim().toLowerCase().slice(0, 48) : "";
  const id = ID.test(suggested) ? suggested : `trend-${trend.locale}-${await shortHash(trend.query)}`;
  const event = answer.kind === "event";
  const { min, max } = CULTURE_TREND_EVENT_DAYS;
  const days = Math.min(max, Math.max(min, Math.round(Number(answer.days) || min)));
  return {
    id,
    kind: event ? "event" : "lasting",
    when: event ? { from: today, to: addDays(today, days - 1) } : null,
    regions: trendRegions(trend),
    locales: [trend.locale],
    featured: false,
    source: "ai-proposed",
  };
}

/** The USER part of the prompt for one candidate. Trends are shown as aggregate counts only. */
function userPrompt(
  runtime: CultureRuntime,
  candidate: Candidate,
  today: string,
  locales: readonly string[],
  choices: ReturnType<typeof candidateEmoji>,
): string {
  const source =
    candidate.origin === "calendar"
      ? { kind: candidate.dated.sourceKind, description: candidate.dated.description }
      : {
          kind: "search trend (aggregated, anonymous counts)",
          description: {
            phrase: candidate.trend.query,
            language: candidate.trend.locale,
            countries: candidate.trend.rows.map((r) => r.country),
            risingScore: candidate.trend.score,
          },
        };
  return fillPrompt(runtime.prompt.user, {
    TODAY: today,
    SOURCE_KIND: source.kind,
    SOURCE: JSON.stringify(source.description, null, 1),
    LOCALES: locales.join(", "),
    CANDIDATES: formatEmojiOptions(choices),
  });
}

export async function runCultureProposals(
  env: Env,
  runtime: CultureRuntime,
  options: { now: number },
): Promise<ProposalRunReport> {
  const started = Date.now();
  const report: ProposalRunReport = {
    status: "done",
    candidates: { trend: 0, calendar: 0 },
    calls: 0,
    failedCalls: 0,
    declined: 0,
    invalid: 0,
    gated: 0,
    duplicates: 0,
    stored: 0,
  };
  const skip = (reason: string): ProposalRunReport => {
    console.log(JSON.stringify({ event: "culture_proposals_skipped", reason }));
    return { ...report, status: "skipped", reason };
  };
  if (env.CULTURE_CRON_ENABLED !== "true") return skip("disabled");
  if (!env.DB) return skip("no database");
  if (!env.AI) return skip("no Workers AI");
  const budget = proposalBudget(env);
  if (budget === 0) return skip("no budget");

  const store = createCultureStore(env.DB);
  const today = dayOf(options.now);

  // Everything an id or a trigger may not repeat: deployed (git) entries, live entries, and every
  // proposal, rejected ones too, so a rejected idea does not come back the next night.
  const ids = new Set<string>();
  const taken = new TriggerIndex();
  const deployed = env.ASSETS ? await readDeployedCulture(env, runtime.packVersion) : undefined;
  for (const file of deployed?.files.values() ?? []) {
    taken.addCulture(file);
    for (const entry of file.entries) ids.add(entry.id);
  }
  for (const live of await store.listLive()) {
    ids.add(live.id);
    taken.addRecord(live.record as CultureRecord);
  }
  for (const record of await store.proposalRecords()) {
    ids.add(record.id);
    taken.addRecord(record as CultureRecord);
  }

  const calendar: Candidate[] = runtime.sources
    .flatMap((s) => datedCandidates(s, today, CULTURE_CALENDAR_DAYS, CULTURE_CALENDAR_LEAD_DAYS))
    .filter((c) => !ids.has(c.id))
    .map((dated) => ({ origin: "calendar", dated }));
  const trends: Candidate[] = (
    await readRisingQueries(env.DB, { perGroup: CULTURE_TRENDS_PER_GROUP, locales: LOCALE_CODES })
  )
    .filter(
      (t) =>
        !taken.owner(t.locale, t.query) && findExcluded(t.query, runtime.exclusions, t.locale) === undefined,
    )
    .map((trend) => ({ origin: "trend", trend }));
  report.candidates = { calendar: calendar.length, trend: trends.length };

  const model = CULTURE_PROPOSE_MODEL;
  const createdBy = `workers-ai:${model} prompt:propose.${CULTURE_PROMPT_VERSION} job:nightly`;
  const drafts: { record: CultureRecord; evidence: Omit<CultureProposalEvidence, "gate"> }[] = [];

  // 1. Drafts: one Workers AI call each, up to the budget. Ids and triggers are reserved as they
  //    are drafted, so two drafts of one night never collide.
  for (const candidate of interleave(calendar, trends)) {
    if (report.calls >= budget) break;
    const locale = candidate.origin === "trend" ? candidate.trend.locale : "en";
    const engine = await runtime.engine(locale, env);
    if (!engine) continue;
    const hints = candidate.origin === "calendar" ? candidate.dated.hintEmoji : [];
    const texts = candidate.origin === "calendar" ? candidate.dated.searchTexts : [candidate.trend.query];
    const choices = candidateEmoji(engine, runtime.catalog, hints, texts, locale);
    if (choices.length === 0) continue;
    const locales = candidate.origin === "calendar" ? candidate.dated.locales : [locale];

    report.calls++;
    let answer: DraftAnswer;
    try {
      answer = parseModelAnswer(
        await env.AI.run(model, {
          messages: [
            { role: "system", content: runtime.prompt.system },
            { role: "user", content: userPrompt(runtime, candidate, today, locales, choices) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "culture_draft", strict: true, schema: answerSchema(locales) },
          },
          max_completion_tokens:
            CULTURE_PROPOSE_BASE_TOKENS + CULTURE_PROPOSE_TOKENS_PER_LOCALE * locales.length,
          temperature: 0.2,
          chat_template_kwargs: { enable_thinking: false },
        }),
      );
    } catch (error) {
      report.failedCalls++;
      console.warn(JSON.stringify({ event: "culture_propose_call_failed", error: (error as Error).name }));
      continue;
    }
    if (answer.skip) {
      report.declined++;
      continue;
    }

    const draft: DraftCandidate =
      candidate.origin === "calendar" ? candidate.dated : await trendDraft(candidate.trend, answer, today);
    if (ids.has(draft.id)) {
      report.duplicates++;
      continue;
    }
    const allowed = new Set([...choices.map((c) => c.hexcode), ...hints]);
    const drafted = toDraftRecord(draft, answer, allowed, { createdBy, createdAt: today });
    const { record, dropped } = withoutTakenTriggers(drafted, taken);
    const issues = validate(runtime, record);
    if (issues.some((i) => i.level === "error")) {
      report.invalid++;
      continue;
    }
    ids.add(record.id);
    taken.addRecord(record);
    drafts.push({
      record,
      evidence: {
        origin: candidate.origin,
        ...(candidate.origin === "trend"
          ? { trends: candidate.trend.rows }
          : {
              source: {
                id: candidate.dated.sourceId,
                title: candidate.dated.titles.en ?? candidate.dated.sourceId,
                category: candidate.dated.sourceKind,
                days: `${candidate.dated.occurrence.from} → ${candidate.dated.occurrence.to}`,
                basis: candidate.dated.basis,
              },
            }),
        model,
        prompt: `propose.${CULTURE_PROMPT_VERSION}`,
        droppedTriggers: dropped,
        warnings: issues.map((i) => i.message),
      },
    });
  }

  // 2. The gate on each draft, one locale engine at a time; then store the ones that pass.
  const gates = await runGateEach(
    runtime,
    env,
    drafts.map((d) => d.record),
  );
  for (const { record, evidence } of drafts) {
    const gate = gates.get(record.id);
    if (!gate || gateFailed(gate)) {
      report.gated++;
      continue;
    }
    const stored = await store.insertProposal(
      record,
      { ...evidence, gate: { queries: gate.queries, triggers: gate.triggers } },
      options.now,
    );
    if (stored) report.stored++;
    else report.duplicates++;
  }

  console.log(JSON.stringify({ event: "culture_proposals", ...report, budget, ms: Date.now() - started }));
  return report;
}
