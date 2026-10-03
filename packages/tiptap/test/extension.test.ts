import { type AnyExtension, Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { BulletList, ListItem, TaskItem, TaskList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { TextSelection } from "@tiptap/pm/state";
import type { AliasEngine } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojiAutocomplete, type EmojiAutocompleteOptions } from "../src/index.js";
import { createEngineLoader } from "emojisense/autocomplete";
import { en, engine, stubSemantic } from "./fixture.js";

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function createEditor(options: Partial<EmojiAutocompleteOptions> = {}): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, EmojiAutocomplete.configure({ engine, ...options })],
  });
  return editor;
}

/**
 * Type like a user: each character goes through ProseMirror's text input handlers (input
 * rules), then only microtasks run. Tiptap fetches items in a microtask, so anything that
 * needed a timer or a later frame would fail here.
 */
async function type(target: Editor, text: string) {
  for (const char of text) {
    const { view } = target;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, char, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
}

function press(target: Editor, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.view.dom.dispatchEvent(event);
  return event;
}

function listItemTexts(target: Editor): string[] {
  const texts: string[] = [];
  target.state.doc.firstChild?.forEach((item) => {
    texts.push(item.textContent);
  });
  return texts;
}

const ROW = 40;

/**
 * happy-dom has no layout. Give the listbox room for `rows` options of 40 px, 100 px below the
 * viewport top, drawn at `scale` (a CSS transform on a host frame scales the rects only).
 */
function stubMenuLayout(rows: number, scale = 1) {
  const isListbox = (element: Element) => element.getAttribute("role") === "listbox";
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isListbox(this) ? rows * ROW : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isListbox(this) ? rows * ROW : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (isListbox(this)) return new DOMRect(0, 100, 200, rows * ROW * scale);
    const list = this.parentElement;
    if (this.getAttribute("role") !== "option" || !list) return new DOMRect();
    const top = Number(this.getAttribute("data-index")) * ROW - list.scrollTop;
    return new DOMRect(0, 100 + top * scale, 200, ROW * scale);
  });
}

/** Everything that would move the page or the host's containers instead of the menu. */
function spyOnPageScroll() {
  return [
    vi.spyOn(Element.prototype, "scrollIntoView"),
    vi.spyOn(window, "scrollTo"),
    vi.spyOn(window, "scrollBy"),
  ];
}

const menu = () => document.querySelector<HTMLElement>("[role=listbox]");
const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const shown = () => options().map((option) => option.querySelector(".emojisense-menu__emoji")?.textContent);
const selected = () => options().find((option) => option.getAttribute("aria-selected") === "true");

describe("EmojiAutocomplete (Tiptap)", () => {
  it("typing :jurassic shows 🦖 first, and Enter inserts it", async () => {
    const ed = createEditor();
    await type(ed, "hi :jurassic");

    expect(shown()[0]).toBe("🦖");
    expect(selected()?.textContent).toContain("T-Rex");
    expect(menu()?.getAttribute("aria-label")).toBe("Emoji suggestions");
    expect(ed.view.dom.getAttribute("aria-controls")).toBe(menu()?.id);
    expect(ed.view.dom.getAttribute("aria-activedescendant")).toBe(selected()?.id);

    expect(press(ed, "Enter").defaultPrevented).toBe(true);
    expect(ed.getText()).toBe("hi 🦖");
    await type(ed, "!");
    expect(ed.getText()).toBe("hi 🦖!");
    expect(menu()).toBeNull();
    expect(ed.view.dom.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("updates the results on every keystroke without timers", async () => {
    const ed = createEditor();
    await type(ed, ":d");
    expect(shown()).toContain("🦕");
    await type(ed, "ino");
    expect(shown().slice(0, 2).sort()).toEqual(["🦕", "🦖"]);
    await type(ed, " :ro");
    expect(shown()).toEqual(["🚀"]);
  });

  it("moves with the arrow keys (wrapping) and inserts with Tab", async () => {
    const ed = createEditor();
    await type(ed, ":jurassic");
    const count = options().length;
    expect(count).toBeGreaterThan(1);
    press(ed, "ArrowUp");
    expect(selected()?.id).toBe(options()[count - 1]?.id);
    press(ed, "ArrowDown");
    press(ed, "ArrowDown");
    expect(selected()?.id).toBe(options()[1]?.id);
    const second = shown()[1];
    press(ed, "Tab");
    expect(ed.getText()).toBe(second);
  });

  it.each([1, 0.5])("scrolls only the menu to the active option (scale %s)", async (scale) => {
    stubMenuLayout(1, scale);
    const pageScroll = spyOnPageScroll();
    const ed = createEditor();
    await type(ed, ":jurassic");
    const list = menu() as HTMLElement;
    const last = options().length - 1;
    expect(last).toBeGreaterThan(0);
    expect(list.scrollTop).toBe(0);

    press(ed, "ArrowDown");
    expect(list.scrollTop).toBe(ROW);
    press(ed, "ArrowUp");
    expect(list.scrollTop).toBe(0);
    press(ed, "ArrowUp");
    expect(list.scrollTop).toBe(last * ROW);
    for (const spy of pageScroll) expect(spy).not.toHaveBeenCalled();
  });

  it("inserts without asking the editor to scroll the page, and keeps focus there", async () => {
    const ed = createEditor();
    await type(ed, ":jurassic");
    const scrolls = vi.fn();
    ed.on("transaction", ({ transaction }) => {
      if (transaction.scrolledIntoView) scrolls();
    });

    press(ed, "Enter");
    // Tiptap focuses the editor in the next animation frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(ed.getText()).toBe("🦖");
    expect(ed.view.hasFocus()).toBe(true);
    expect(scrolls).not.toHaveBeenCalled();
  });

  describe("menuContainer", () => {
    function createFrame() {
      const frame = document.createElement("section");
      document.body.append(frame);
      return frame;
    }

    it("mounts the menu on <body> by default", async () => {
      const ed = createEditor();
      await type(ed, ":jurassic");
      expect(menu()?.parentElement).toBe(document.body);
    });

    it("mounts the menu inside the given element and removes it on close", async () => {
      const frame = createFrame();
      const ed = createEditor({ menuContainer: frame });
      await type(ed, ":jurassic");
      expect(menu()?.parentElement).toBe(frame);
      press(ed, "Enter");
      expect(ed.getText()).toBe("🦖");
      expect(frame.children).toHaveLength(0);
    });

    it("reads a getter each time the menu opens, with <body> while it returns null", async () => {
      let frame: HTMLElement | null = null;
      const ed = createEditor({ menuContainer: () => frame });
      await type(ed, ":jurassic");
      expect(menu()?.parentElement).toBe(document.body);
      press(ed, "Escape");
      frame = createFrame();
      await type(ed, " :fir");
      expect(menu()?.parentElement).toBe(frame);
    });

    it("applies to a custom renderer's props.mount", async () => {
      const frame = createFrame();
      const element = document.createElement("div");
      let unmount: (() => void) | undefined;
      const ed = createEditor({
        menuContainer: frame,
        render: () => ({
          onStart: (props) => {
            unmount = props.mount(element);
          },
          onExit: () => unmount?.(),
        }),
      });
      await type(ed, ":rock");
      expect(element.parentElement).toBe(frame);
      await type(ed, " ");
      expect(element.isConnected).toBe(false);
    });
  });

  it("Escape closes the menu, keeps the typed text and stays closed for that word", async () => {
    const ed = createEditor();
    await type(ed, ":jurassic");
    expect(menu()).not.toBeNull();
    expect(press(ed, "Escape").defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(ed.getText()).toBe(":jurassic");
    await type(ed, "p");
    expect(menu()).toBeNull();
    await type(ed, " :fir");
    expect(shown()[0]).toBe("🔥");
  });

  it("closes when nothing matches and leaves Enter to the editor", async () => {
    const ed = createEditor();
    await type(ed, ":jur");
    expect(menu()).not.toBeNull();
    await type(ed, "zzz");
    expect(menu()).toBeNull();
    press(ed, "Enter");
    expect(ed.state.doc.childCount).toBe(2);
    expect(ed.getText({ blockSeparator: "|" })).toBe(":jurzzz|");
  });

  it("opens only after a space, a parenthesis or the line start", async () => {
    const ed = createEditor();
    await type(ed, "12:fire");
    expect(menu()).toBeNull();
    await type(ed, " (:fire");
    expect(shown()[0]).toBe("🔥");
  });

  it("inserts with the configured skin tone and shows toned emoji", async () => {
    let tone: "dark" | "medium" = "dark";
    const ed = createEditor({ skinTone: () => tone });
    await type(ed, ":lgtm");
    expect(shown()[0]).toBe("👍🏿");
    tone = "medium";
    press(ed, "Enter");
    expect(ed.getText()).toBe("👍🏿");
    await type(ed, " :+1:");
    expect(ed.getText()).toBe("👍🏿 👍🏽");
  });

  it("completes a typed :shortcode: (exact shortcode or name only)", async () => {
    const ed = createEditor();
    await type(ed, ":trex: :fire: :sweat_smile: :jurassic: :nope:");
    expect(ed.getText()).toBe("🦖 🔥 😅 :jurassic: :nope:");
    expect(menu()).toBeNull();
  });

  it("leaves :shortcode: alone when shortcodes are off", async () => {
    const ed = createEditor({ shortcodes: false });
    await type(ed, ":trex:");
    expect(ed.getText()).toBe(":trex:");
  });

  it("inserts the clicked option and keeps focus handling in the editor", async () => {
    const ed = createEditor();
    await type(ed, ":jurassic");
    const target = options()[0] as HTMLElement;
    const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    target.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
    target.click();
    expect(ed.getText()).toBe("🦖");
  });

  it("fuses semantic results into the open menu later", async () => {
    const semantic = stubSemantic();
    const ed = createEditor({ semantic, debounceMs: 5 });
    await type(ed, ":blastoff");
    expect(menu()).toBeNull();
    await vi.waitFor(() => expect(shown()).toEqual(["🚀"]));
    expect(options()[0]?.dataset.source).toBe("semantic");
    press(ed, "Enter");
    expect(ed.getText()).toBe("🚀");
  });

  it("waits for an engine getter, so the editor can start before the packs load", async () => {
    let loaded: AliasEngine | undefined;
    const ed = createEditor({ engine: () => loaded });
    await type(ed, ":fire");
    expect(menu()).toBeNull();
    loaded = engine;
    await type(ed, "s ");
    await type(ed, ":fire");
    expect(shown()[0]).toBe("🔥");
  });

  it("takes a loader: loads on focus, and opens the menu of a : typed before the packs arrived", async () => {
    let answer: () => void = () => {};
    const fetch = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      return new Response(JSON.stringify(en));
    });
    const loader = createEngineLoader({
      packUrl: "https://packs.test/0.1.0",
      cultureUrl: false,
      extended: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const ed = createEditor({ engine: loader });
    ed.commands.focus();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await type(ed, ":fire");
    expect(menu()).toBeNull();
    answer();
    await vi.waitFor(() => expect(shown()[0]).toBe("🔥"));
  });

  it("accepts a custom renderer with Tiptap's suggestion contract", async () => {
    const onUpdate = vi.fn();
    const onExit = vi.fn();
    const ed = createEditor({ render: () => ({ onUpdate, onExit }) });
    await type(ed, ":rock");
    const props = onUpdate.mock.calls.at(-1)?.[0];
    expect(props.query).toBe("rock");
    expect(props.items.map((item: { emoji: string }) => item.emoji)).toEqual(["🚀"]);
    props.command(props.items[0]);
    expect(ed.getText()).toBe("🚀");
    await type(ed, " ");
    expect(onExit).toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  describe.each([
    ["bullet", [BulletList, ListItem], "<ul><li><p>first</p></li><li><p></p></li></ul>"],
    ["task", [TaskList, TaskItem], '<ul data-type="taskList"><li><p>first</p></li><li><p></p></li></ul>'],
  ])("in a %s list", (_kind, lists, content) => {
    // At equal priority the order in `extensions` decides who gets Enter first, so try both.
    it.each(["before", "after"])("the open menu takes Enter and Tab when listed %s", async (order) => {
      const element = document.createElement("div");
      document.body.append(element);
      const emoji = EmojiAutocomplete.configure({ engine });
      const extensions: AnyExtension[] = [Document, Paragraph, Text, ...(lists as AnyExtension[])];
      editor = new Editor({
        element,
        content,
        extensions: order === "before" ? [emoji, ...extensions] : [...extensions, emoji],
      });
      const ed = editor;
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)));

      await type(ed, ":jurassic");
      expect(press(ed, "Enter").defaultPrevented).toBe(true);
      await type(ed, " :fir");
      expect(press(ed, "Tab").defaultPrevented).toBe(true);
      expect(listItemTexts(ed)).toEqual(["first", "🦖 🔥"]);

      // With the menu closed, Enter belongs to the list again.
      press(ed, "Enter");
      expect(listItemTexts(ed)).toEqual(["first", "🦖 🔥", ""]);
    });
  });

  it("stops semantic requests when the editor is destroyed", async () => {
    const semantic = stubSemantic();
    const ed = createEditor({ semantic, debounceMs: 5 });
    await type(ed, ":blastoff");
    ed.destroy();
    editor = undefined;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(semantic.calls).toEqual([]);
  });
});
