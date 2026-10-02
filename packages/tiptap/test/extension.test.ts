import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { AliasEngine } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojiAutocomplete, type EmojiAutocompleteOptions } from "../src/index.js";
import { engine, stubSemantic } from "./fixture.js";

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  document.body.replaceChildren();
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
