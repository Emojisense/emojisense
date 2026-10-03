import { createEngine, type SemanticProvider } from "emojisense";
import { createSuggestionSource } from "emojisense/autocomplete";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachEmojiAutocomplete, type TextareaAutocompleteOptions } from "../src/textarea.js";
import { en } from "./fixture.js";

const engine = createEngine(en);
const source = () => createSuggestionSource({ engine, minQueryLength: 2, includeCustom: false });

afterEach(() => {
  document.body.replaceChildren();
});

function setUp(options: Partial<TextareaAutocompleteOptions> = {}) {
  const field = document.createElement("textarea");
  document.body.append(field);
  const autocomplete = attachEmojiAutocomplete(field, { source: source(), ...options });
  const type = (text: string) => {
    for (const char of text) {
      field.setRangeText(char, field.selectionStart, field.selectionEnd, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  const key = (name: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    field.dispatchEvent(event);
    return event;
  };
  const menu = () => document.querySelector<HTMLElement>(".emojisense-textarea-menu");
  const rows = () =>
    Array.from(menu()?.querySelectorAll<HTMLElement>("[role=option]") ?? []).map((o) => o.textContent);
  const isOpen = () => menu()?.style.display !== "none" && menu() !== null;
  return { field, autocomplete, type, key, menu, rows, isOpen };
}

describe("attachEmojiAutocomplete", () => {
  it("opens a listbox for :query and inserts the chosen emoji with Enter", () => {
    const { field, type, key, menu, rows, isOpen } = setUp();
    type("Ready to :ship it");
    expect(isOpen()).toBe(true);
    expect(menu()?.getAttribute("role")).toBe("listbox");
    expect(rows()[0]).toBe("🚀rocket");
    expect(field.getAttribute("aria-activedescendant")).toBe(menu()?.querySelector("[role=option]")?.id);

    const enter = key("Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(field.value).toBe("Ready to 🚀");
    expect(field.selectionStart).toBe(field.value.length);
    expect(isOpen()).toBe(false);
  });

  it("moves with the arrow keys, wraps, and inserts with Tab", () => {
    const { field, type, key, rows } = setUp();
    type(":go");
    const listed = rows();
    expect(listed.length).toBeGreaterThan(1);
    key("ArrowDown");
    key("ArrowUp");
    key("ArrowUp");
    const last = listed.length - 1;
    expect(document.querySelector("[aria-selected=true]")?.getAttribute("data-index")).toBe(String(last));
    key("Tab");
    expect(field.value).toBe(Array.from(listed[last] ?? "")[0]);
  });

  it("starts every new query at its first row", () => {
    const { type, key, rows } = setUp();
    type(":go");
    key("ArrowDown");
    type("a");
    expect(document.querySelector("[aria-selected=true]")?.getAttribute("data-index")).toBe("0");
    expect(rows()[0]).toBe("🐐goat");
  });

  it("stays closed for times, URLs and short queries", () => {
    const { type, isOpen, field } = setUp();
    type("at 12:30");
    expect(isOpen()).toBe(false);
    field.value = "";
    type("see https://x");
    expect(isOpen()).toBe(false);
    field.value = "";
    type(":)");
    expect(isOpen()).toBe(false);
  });

  it("keeps the text on Escape and stays closed for that word", () => {
    const { field, type, key, isOpen } = setUp();
    type(":rock");
    expect(isOpen()).toBe(true);
    const escapeKey = key("Escape");
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(isOpen()).toBe(false);
    type("e");
    expect(isOpen()).toBe(false);
    expect(field.value).toBe(":rocke");
    type(" :ship");
    expect(isOpen()).toBe(true);
  });

  it("leaves keys to the field while the menu is closed", () => {
    const { key } = setUp();
    expect(key("Enter").defaultPrevented).toBe(false);
    expect(key("ArrowDown").defaultPrevented).toBe(false);
  });

  it("applies the skin tone to the row and the inserted emoji", () => {
    const { field, type, key, rows } = setUp({ skinTone: () => "dark" });
    type(":thumbs");
    expect(rows()[0]).toBe("👍🏿thumbs up");
    key("Enter");
    expect(field.value).toBe("👍🏿");
  });

  it("inserts with a click and keeps the focus in the field", () => {
    const onInsert = vi.fn();
    const { field, type, menu } = setUp({ onInsert });
    field.focus();
    type(":dino");
    const option = menu()?.querySelector<HTMLElement>("[role=option]");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    option?.click();
    expect(field.value).toBe("🦖");
    expect(onInsert).toHaveBeenCalledWith("🦖");
  });

  it("shows fused semantic rows when they arrive", async () => {
    const semantic: SemanticProvider = {
      search: async (query) =>
        query.startsWith("blastoff")
          ? {
              results: [{ emoji: "🚀", id: "1F680", score: 0.8, source: "semantic" }],
              packVersion: "test",
              cached: false,
            }
          : undefined,
    };
    const { type, rows } = setUp({
      source: createSuggestionSource({ engine, semantic, debounceMs: 1, minQueryLength: 2 }),
    });
    type(":blastoff");
    expect(rows()).toEqual([]);
    await vi.waitFor(() => expect(rows()[0]).toBe("🚀rocket"));
  });

  it("waits for a source that loads later", () => {
    let ready: ReturnType<typeof source> | undefined;
    const { type, isOpen, autocomplete } = setUp({ source: () => ready });
    type(":rock");
    expect(isOpen()).toBe(false);
    ready = source();
    autocomplete.refresh();
    expect(isOpen()).toBe(true);
  });

  it("cleans up on destroy", () => {
    const { field, type, autocomplete, menu } = setUp();
    type(":rock");
    autocomplete.destroy();
    expect(menu()).toBeNull();
    expect(field.hasAttribute("aria-autocomplete")).toBe(false);
    type("et");
    expect(menu()).toBeNull();
  });
});
