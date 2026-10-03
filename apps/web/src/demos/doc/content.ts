/** The sample document: a realistic team retro. Only the emoji typed by the autoplay are search results. */
import type { DemoMessages } from "../../i18n/demos";

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
  /** No alias covers the query: wait for meaning search to reorder the menu before choosing. */
  meaning?: boolean;
}

/** The line that shows meaning search; the other one is answered on the device. */
export const MEANING_LINE = { query: "everything_broke", target: "1F494", emoji: "💔" } as const;

/** The document's words in the page's language. */
export interface DocCopy {
  pageTitle: string;
  summary: string;
  body: DemoMessages["doc"]["body"];
  script: readonly ScriptLine[];
}

/**
 * What the teammate types at the end of the doc. The `:codes` are English, the same in every
 * language. Picked by running the real engine on the served packs (pack 0.1.0) and the API:
 * - ":nailed_it" → 🎯 first on the device: an idiom the alias pack knows, no request.
 * - ":everything_broke" → on the device 💸 👛 first ("broke" as in money). Meaning search moves
 *   💔 to the top.
 */
export function docCopy(doc: DemoMessages["doc"]): DocCopy {
  const { body } = doc;
  return {
    pageTitle: doc.pageTitle,
    summary: body.summary,
    body,
    script: [
      { text: `${body.win} `, query: "nailed_it", target: "1F3AF", emoji: "🎯" },
      { text: `${body.miss} `, ...MEANING_LINE, meaning: true },
    ],
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function bodyHtml(copy: DocCopy): string {
  const b = Object.fromEntries(
    Object.entries(copy.body).map(([key, value]) => [key, escapeHtml(value)]),
  ) as Record<keyof DocCopy["body"], string>;
  return `
<aside data-type="callout" data-emoji="💡">
  <p>${b.callout}</p>
</aside>
<h2>${b.wentWell}</h2>
<ul>
  <li><p>${b.well1}</p></li>
  <li><p>${b.well2}</p></li>
</ul>
<h2>${b.change}</h2>
<p>${b.changeBody}</p>
<h2>${b.actions}</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>${b.action1}</p></li>
  <li data-type="taskItem" data-checked="false"><p>${b.action2}</p></li>
  <li data-type="taskItem" data-checked="false"><p>${b.action3}</p></li>
</ul>
<h2>${b.summary}</h2>
`;
}

/** The finished summary lines, as the autoplay leaves them. */
export function finalLines(copy: DocCopy): string[] {
  return copy.script.map((line) => `${line.text}${line.emoji}`);
}

/** Initial HTML. `finished` shows the final state (reduced motion, or no autoplay). */
export function documentHtml(copy: DocCopy, finished: boolean): string {
  const lines = finished ? finalLines(copy).map((line) => `<p>${escapeHtml(line)}</p>`) : [];
  return `${bodyHtml(copy)}${lines.join("")}<p></p>`;
}
