import { privacyReason } from "@emojisense/data/shards";
import { normalize } from "emojisense";
import { EVENTS_MAX_BYTES, EVENTS_MAX_PICKS, EVENTS_MIN_SAMPLE } from "./config.ts";
import type { Handler } from "./context.ts";
import { corsHeaders, errorResponse, readBodyCapped } from "./http.ts";

/** The outcomes a client counts (emojisense/stats, SearchOutcome), in the order of the doubles. */
export const OUTCOMES = ["device", "memory", "shard", "api", "none", "error", "cancelled"] as const;

interface Report {
  v: 1;
  sample: number;
  locale?: string;
  counts: Partial<Record<(typeof OUTCOMES)[number], number>>;
  picks: [string, string][];
}

const isCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1e6;
const EMOJI_ID = /^[0-9A-F]{2,6}(?:-[0-9A-F]{2,6}){0,8}$|^custom:[\w-]{1,64}$/;

function parseReport(text: string): Report | undefined {
  let body: Partial<Report>;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  const { v, sample, locale, counts, picks } = body;
  if (v !== 1 || typeof sample !== "number" || !(sample >= EVENTS_MIN_SAMPLE && sample <= 1))
    return undefined;
  if (
    locale !== undefined &&
    (typeof locale !== "string" || !/^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(locale))
  )
    return undefined;
  if (typeof counts !== "object" || counts === null || !Object.values(counts).every(isCount))
    return undefined;
  if (!Array.isArray(picks) || picks.length > EVENTS_MAX_PICKS) return undefined;
  const valid = picks.every(
    (p) =>
      Array.isArray(p) &&
      typeof p[0] === "string" &&
      p[0].length <= 256 &&
      typeof p[1] === "string" &&
      EMOJI_ID.test(p[1]),
  );
  return valid ? (body as Report) : undefined;
}

/**
 * POST /v1/events (docs/API.md, "Events"): a client's report of how its searches ended and which
 * emoji people picked, one per page view, from a sample of sessions. Free and not metered. One
 * Analytics Engine point for the counts and one per pick, indexed by app ("anon" without a key),
 * each weighted by 1 / sample. Pick text goes through the shard privacy filter; text it refuses
 * is dropped, the emoji is kept. No IP, key or user id is written.
 */
export const handleEvents: Handler = async (request, env, _ctx, _deps, _metering, principal) => {
  const bytes = await readBodyCapped(request, EVENTS_MAX_BYTES);
  if (!bytes) return errorResponse(413, `a report is at most ${EVENTS_MAX_BYTES} bytes`);
  const report = parseReport(new TextDecoder().decode(bytes));
  if (!report) return errorResponse(400, "not an emojisense events report (v 1)");

  const app = principal.kind === "key" ? principal.key.appId : "anon";
  const locale = (report.locale ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  const weight = 1 / report.sample;
  try {
    env.STATS?.writeDataPoint({
      blobs: ["counts", locale, ""],
      doubles: [weight, ...OUTCOMES.map((o) => report.counts[o] ?? 0)],
      indexes: [app],
    });
    for (const [query, id] of report.picks) {
      const q = normalize(query).slice(0, 64);
      env.STATS?.writeDataPoint({
        blobs: ["pick", locale, q === "" || privacyReason(q) ? "" : q, id],
        doubles: [weight],
        indexes: [app],
      });
    }
  } catch {
    // Stats must never fail a client.
  }
  return new Response(null, { status: 204, headers: corsHeaders });
};
