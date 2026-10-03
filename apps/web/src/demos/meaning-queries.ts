/**
 * Every English query a demo uses to show meaning search. The claims test checks that the
 * dictionary alone does not answer them, and that the recorded API answer (meaning-fixtures.json,
 * `pnpm --filter @emojisense/web record:meaning`) has the demo's emoji in its top 3.
 */
import en from "../i18n/en.json";
import { STATUS_QUERY } from "./assistant/scenarios";
import { MEANING_QUERY } from "./chat/content";
import { MEANING_LINE } from "./doc/content";
import { MEANING_PRESET } from "./workspaces/data";

export interface MeaningQuery {
  demo: "chat" | "docs" | "workspaces" | "assistant";
  query: string;
  /** Emojibase id of the emoji the demo shows for the query. */
  target: string;
}

export const MEANING_QUERIES: readonly MeaningQuery[] = [
  { demo: "chat", ...MEANING_QUERY },
  { demo: "docs", query: MEANING_LINE.query, target: MEANING_LINE.target },
  { demo: "docs", query: en.demos.doc.picker.hintWords.third, target: "1F6DC" },
  { demo: "workspaces", ...MEANING_PRESET },
  { demo: "assistant", ...STATUS_QUERY },
];
