/**
 * Records what meaning search answers for the demos' queries (src/demos/meaning-queries.ts) into
 * src/demos/meaning-fixtures.json, the file the claims test reads. Run it after a change to a demo
 * query, the packs or the embedding model:
 *
 *   EMOJISENSE_KEY=pk_live_… pnpm --filter @emojisense/web record:meaning
 *
 * EMOJISENSE_API_URL defaults to the dev API. A publishable key is checked against its allowed
 * origins: set EMOJISENSE_ORIGIN to one of them, or use the key of a dev app that allows any origin.
 */
import { writeFileSync } from "node:fs";
import { embeddingText } from "emojisense";
import { MEANING_QUERIES } from "../src/demos/meaning-queries";

const api = (process.env.EMOJISENSE_API_URL ?? "https://api.emojisense.dev").replace(/\/+$/, "");
const key = requiredKey();
const origin = process.env.EMOJISENSE_ORIGIN;

function requiredKey(): string {
  const value = process.env.EMOJISENSE_KEY;
  if (!value) throw new Error("Set EMOJISENSE_KEY to a publishable key (pk_live_…).");
  return value;
}

async function semanticIds(query: string): Promise<string[]> {
  // The text the SDKs send: accents and punctuation kept.
  const params = new URLSearchParams({ q: embeddingText(query), mode: "semantic", limit: "6", key });
  const response = await fetch(`${api}/v1/search?${params}`, { headers: origin ? { Origin: origin } : {} });
  if (!response.ok) throw new Error(`HTTP ${response.status} for “${query}”: ${await response.text()}`);
  const body = (await response.json()) as { results?: { id: string }[]; overLimit?: boolean };
  if (body.overLimit) throw new Error(`The key is over its limit: “${query}” got no semantic answer.`);
  return (body.results ?? []).map((result) => result.id);
}

const answers: Record<string, string[]> = {};
for (const { query } of MEANING_QUERIES) answers[query] = await semanticIds(query);

const fixture = { recorded: new Date().toISOString().slice(0, 10), api, answers };
writeFileSync(
  new URL("../src/demos/meaning-fixtures.json", import.meta.url),
  `${JSON.stringify(fixture, null, 2)}\n`,
);
console.log(answers);
