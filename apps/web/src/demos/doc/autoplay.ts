import { EmojiAutocompletePluginKey } from "@emojisense/tiptap";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { AliasEngine } from "emojisense";
import { finalLines, type ScriptLine } from "./content";
import type { DocEditor } from "./editor";
import { presenceKey } from "./presence";
import { sleep } from "./sleep";

/** Human rhythm: quick inside words, a beat between words, slower and careful on a `:query`. */
function keyDelay(char: string, previous: string, inQuery: boolean): number {
  const jitter = Math.random();
  if (inQuery) return 95 + jitter * 70;
  let ms = 45 + jitter * 65;
  if (previous === " ") ms += 45;
  if (/[,.:]/.test(previous)) ms += 140;
  if (char === " " && jitter > 0.85) ms += 160;
  return ms;
}

function quietly(view: EditorView, update: (view: EditorView) => void) {
  if (!view.isDestroyed) update(view);
}

/**
 * Keep the teammate's caret in view by scrolling the doc pane only. ProseMirror's own
 * scrollIntoView would also scroll the landing page, so the autoplay never asks for it.
 */
function follow(view: EditorView, scroller: HTMLElement) {
  const caret = view.coordsAtPos(view.state.selection.head);
  const box = scroller.getBoundingClientRect();
  const max = scroller.scrollHeight - scroller.clientHeight;
  const top = Math.max(0, Math.min(max, scroller.scrollTop + caret.top - box.top - box.height * 0.3));
  if (Math.abs(top - scroller.scrollTop) > 6) scroller.scrollTo({ top, behavior: "smooth" });
}

async function type(
  view: EditorView,
  scroller: HTMLElement,
  text: string,
  signal: AbortSignal,
  inQuery = false,
) {
  let previous = "";
  let line = Number.NaN;
  for (const char of text) {
    await sleep(keyDelay(char, previous, inQuery), signal);
    quietly(view, (v) => v.dispatch(v.state.tr.insertText(char).setMeta("addToHistory", false)));
    const top = view.coordsAtPos(view.state.selection.head).top;
    if (top !== line) {
      line = top;
      follow(view, scroller);
    }
    previous = char;
  }
}

function newLine(view: EditorView) {
  quietly(view, (v) => {
    const at = v.state.selection.from;
    const tr = v.state.tr.split(at);
    v.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).setMeta("addToHistory", false));
  });
}

/** The menu was dismissed (a click elsewhere on the page): take the engine's pick directly. */
function insertWithoutMenu(view: EditorView, line: ScriptLine, engine: AliasEngine | undefined) {
  const results = engine?.search(line.query, { limit: 8, locale: "en" }).results ?? [];
  const emoji = results.find((result) => result.id === line.target)?.emoji ?? results[0]?.emoji ?? line.emoji;
  quietly(view, (v) => {
    const to = v.state.selection.head;
    v.dispatch(v.state.tr.insertText(emoji, to - line.query.length - 1, to).setMeta("addToHistory", false));
  });
}

/**
 * A teammate types the summary at the end of the doc. Every menu on screen is the real
 * engine's answer; the emoji is chosen from it like a person would, with ↓ and Enter.
 */
export async function playScript(doc: DocEditor, scroller: HTMLElement, name: string, signal: AbortSignal) {
  const { view } = doc.editor;
  const end = view.state.doc.content.size - 1;
  quietly(view, (v) => {
    v.dispatch(
      v.state.tr
        .setSelection(TextSelection.create(v.state.doc, end))
        .setMeta(presenceKey, { ghost: name, hint: false })
        .setMeta("addToHistory", false),
    );
  });
  follow(view, scroller);
  await sleep(900, signal);

  for (const [index, line] of doc.copy.script.entries()) {
    if (index > 0) {
      newLine(view);
      follow(view, scroller);
      await sleep(450, signal);
    }
    await type(view, scroller, line.text, signal);
    await sleep(380, signal);
    await type(view, scroller, `:${line.query}`, signal, true);
    // Let the menu settle (and be read) before choosing.
    await sleep(1100, signal);
    let target = doc.menu.indexOf(line.target);
    if (target < 0) target = 0;
    for (let steps = 0; doc.menu.isOpen() && doc.menu.activeIndex() !== target && steps < 8; steps++) {
      doc.menu.move(1);
      await sleep(300, signal);
    }
    await sleep(350, signal);
    if (!doc.menu.insertActive()) insertWithoutMenu(view, line, doc.engine());
    await sleep(900, signal);
  }

  newLine(view);
  await sleep(700, signal);
  doc.setPresence({ ghost: null, hint: true });
}

/** Jump to the finished summary, e.g. when the visitor takes over mid-sentence. */
export function finishScript(doc: DocEditor) {
  const { view } = doc.editor;
  if (view.isDestroyed) return;
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return;
  let start = -1;
  state.doc.forEach((node, offset) => {
    if (node.type.name === "heading" && node.textContent === doc.copy.summary) start = offset + node.nodeSize;
  });
  if (start < 0) return;
  const lines = [
    ...finalLines(doc.copy).map((text) => paragraph.create(null, state.schema.text(text))),
    paragraph.create(),
  ];
  view.dispatch(
    state.tr
      .replaceWith(start, state.doc.content.size, lines)
      .setMeta(EmojiAutocompletePluginKey, { exit: true })
      .setMeta(presenceKey, { ghost: null, hint: true })
      .setMeta("addToHistory", false),
  );
}
