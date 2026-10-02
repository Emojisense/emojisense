/**
 * Chat message → reaction eval against a running API (POST /v1/suggest-reactions).
 *
 *   pnpm --filter @emojisense/eval reactions [-- --api http://localhost:8788 --key pk_demo --label after]
 *   pnpm --filter @emojisense/eval reactions -- --render-only
 *
 * Sends every message in queries/reactions.jsonl, scores the top 4 against the acceptable
 * reactions and the known traps, and stores the run as reports/reactions.<label>.json.
 * reports/reactions.md compares all stored runs ("before" and "after" first), scored against
 * the current labels; --render-only only rewrites it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EVAL_ROOT } from "./cost-inputs.ts";
import { type LiveTarget, suggestReactions } from "./live/api.ts";
import { type LabelledMessage, loadMessages } from "./live/messages.ts";
import { judgeRanking, summarizePrecision } from "./live/precision.ts";
import { type LiveItem, type LiveRun, loadRuns, rejudge, renderComparison, saveRun } from "./live/runs.ts";

const REPORTS = join(EVAL_ROOT, "reports");
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    messages: { type: "string", default: join(EVAL_ROOT, "queries", "reactions.jsonl") },
    api: { type: "string", default: "http://localhost:8788" },
    key: { type: "string", default: "pk_demo" },
    label: { type: "string", default: "latest" },
    limit: { type: "string", default: "8" },
    "render-only": { type: "boolean", default: false },
  },
});

async function runMessages(messages: LabelledMessage[], target: LiveTarget, limit: number) {
  const items: LiveItem[] = [];
  for (const message of messages) {
    const base = {
      id: message.id,
      input: message.text,
      answers: message.answers,
      ...(message.forbid ? { forbid: message.forbid } : {}),
    };
    try {
      const { body, ms } = await suggestReactions(target, message.text, message.locale, limit);
      if (body.overLimit) throw new Error("over the plan limit: use a key with a larger plan (--key)");
      items.push({
        ...base,
        judged: judgeRanking(
          body.results.map((r) => r.emoji),
          message.answers,
          message.forbid,
        ),
        results: body.results.map(({ emoji, source }) => ({ emoji, source })),
        ms,
        ...(body.degraded ? { error: "degraded (Workers AI unavailable)" } : {}),
      });
      process.stdout.write(".");
    } catch (error) {
      items.push({
        ...base,
        judged: judgeRanking([], message.answers, message.forbid),
        results: [],
        error: (error as Error).message,
      });
      process.stdout.write("x");
    }
  }
  process.stdout.write("\n");
  return items;
}

const messages = loadMessages(args.messages as string);
if (!args["render-only"]) {
  const target = { api: (args.api as string).replace(/\/$/, ""), key: args.key as string };
  const items = await runMessages(messages, target, Number(args.limit));
  const run: LiveRun = {
    kind: "reactions",
    label: args.label as string,
    date: new Date().toISOString(),
    api: target.api,
    summary: summarizePrecision(items.map((item) => item.judged)),
    failed: items.filter((item) => item.error).length,
    items,
  };
  const saved = saveRun(REPORTS, run);
  const s = run.summary;
  console.log(
    `reactions ${run.label}: P@1 ${s.p1} · P@4 ${s.p4} · Hit@4 ${s.hit4} · Trap@4 ${s.trap4} · failed ${run.failed}/${s.n}`,
  );
  console.log(`wrote ${saved}`);
}

const languages = [...new Set(messages.map((m) => m.locale))].join(", ");
const runs = rejudge(loadRuns(REPORTS, "reactions"), new Map(messages.map((m) => [m.id, m])));
writeFileSync(
  join(REPORTS, "reactions.md"),
  renderComparison(runs, {
    title: "Message → reaction eval (live API)",
    intro: [
      `- ${messages.length} chat messages (${languages}) in \`queries/reactions.jsonl\`, each with the reactions people would use.`,
      "- Each run sends every message to `POST /v1/suggest-reactions` with `limit: 8`. Stored runs are scored against the current labels.",
      "- **P@1**: the top reaction is acceptable. **P@4**: share of the top 4 that is acceptable. **Hit@4**: any acceptable reaction in the top 4. **Trap@4**: a known literal-noun trap (🚬 for “smoke tests”) is in the top 4; lower is better.",
      "- The labels and the intent cues (packages/worker/src/reaction-intents.ts) were written by the same author: treat the numbers as optimistic until messages written by other people are added.",
    ],
    itemName: "Message",
  }),
);
console.log("wrote reports/reactions.md");
