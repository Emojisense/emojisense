/** The sample document: a realistic team retro. Only the emoji typed by the autoplay are search results. */

export const PAGE_TITLE = "Q3 launch retro";
export const DEFAULT_ICON = "🧭";
export const TEAMMATE = { name: "Maya", fullName: "Maya Chen", initials: "MC" } as const;

export interface ScriptLine {
  /** Plain text typed before the trigger. */
  text: string;
  /** Typed after ":", one keystroke at a time. */
  query: string;
  /** Hexcode of the emoji to insert. It must be in the menu the real engine shows. */
  target: string;
  /** What the real engine ranks first for `query` (used for the static final state). */
  emoji: string;
}

/**
 * What the teammate types at the end of the doc. Picked by running the real engine on the
 * served packs (pack 0.1.0, English core + extension packs, locale "en"):
 * - ":rocket" → 🚀 first (the list changes on every keystroke: ®️, 🇷🇴, 🪨, then 🚀).
 * - ":dumpster_fire" → 🔥 first, then 🗑️ and 🦝 (from the alias "dumpster diving").
 */
export const SCRIPT: readonly ScriptLine[] = [
  { text: "Biggest win: the new onboarding ", query: "rocket", target: "1F680", emoji: "🚀" },
  { text: "Biggest miss: launch-week deploys were a ", query: "dumpster_fire", target: "1F525", emoji: "🔥" },
];

export const SUMMARY_HEADING = "Summary";

const BODY = `
<aside data-type="callout" data-emoji="💡">
  <p>Blameless format: we talk about systems and decisions, never people.</p>
</aside>
<h2>What went well</h2>
<ul>
  <li><p>Onboarding v2 shipped two weeks early, behind a flag for the first week</p></li>
  <li><p>Setup questions to support dropped once the new checklist went live</p></li>
</ul>
<h2>What we would change</h2>
<p>Two deploys failed in launch week. Both came from the same flaky migration test, and the rollback took longer than it should have.</p>
<h2>Action items</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>Quarantine the flaky migration test (Jonas)</p></li>
  <li data-type="taskItem" data-checked="false"><p>Add a deploy freeze to the launch checklist (Priya)</p></li>
  <li data-type="taskItem" data-checked="false"><p>Share this retro in #product (Maya)</p></li>
</ul>
<h2>${SUMMARY_HEADING}</h2>
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The finished summary lines, as the autoplay leaves them. */
export function finalLines(): string[] {
  return SCRIPT.map((line) => `${line.text}${line.emoji}`);
}

/** Initial HTML. `finished` shows the final state (reduced motion, or no autoplay). */
export function documentHtml(finished: boolean): string {
  const lines = finished ? finalLines().map((line) => `<p>${escapeHtml(line)}</p>`) : [];
  return `${BODY}${lines.join("")}<p></p>`;
}
