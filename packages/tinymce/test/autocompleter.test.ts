import { createSuggestionSource } from "emojisense/autocomplete";
import { describe, expect, it, vi } from "vitest";
import { createAutocompleter, escapeHtml } from "../src/autocompleter.js";
import { engine, stubSemantic } from "./fixture.js";

/** The range TinyMCE passes to `matches`: from the colon to the caret, in one text node. */
function rangeIn(text: string, caret = text.length): Range {
  const node = document.createTextNode(text);
  document.body.append(node);
  const range = document.createRange();
  range.setStart(node, text.lastIndexOf(":", caret - 1));
  range.setEnd(node, caret);
  return range;
}

function spec(options: Partial<Parameters<typeof createAutocompleter>[0]> = {}) {
  const source = createSuggestionSource({ engine, minQueryLength: 2, includeCustom: false });
  return createAutocompleter({ source: () => source, insert: vi.fn(), ...options });
}

const queryOf = (text: string) => text.slice(text.lastIndexOf(":") + 1);

describe("createAutocompleter", () => {
  it("opens on : after a space, with two characters (:) stays an emoticon)", () => {
    const autocompleter = spec();
    expect(autocompleter).toMatchObject({ trigger: ":", minChars: 2, columns: 1, maxResults: 8 });
    expect(autocompleter.matches?.(rangeIn("I want :pizza"), "", "pizza")).toBe(true);
    expect(autocompleter.matches?.(rangeIn(":ship it"), "", "ship it")).toBe(true);
  });

  it.each(["at 12:30", "https://example", "a:b", ":one two three four five"])(
    "stays closed for %j",
    (text) => {
      expect(spec().matches?.(rangeIn(text), "", queryOf(text))).toBe(false);
    },
  );

  it("stays closed when a word follows the caret", () => {
    const text = "x :pizzeria";
    expect(spec().matches?.(rangeIn(text, 7), "", "pi")).toBe(false);
  });

  it("lists the emoji with its label, ranked by meaning", async () => {
    const items = await spec().fetch("ship it", 8, {});
    expect(items[0]).toEqual({ type: "autocompleteitem", value: "🚀", text: "rocket", icon: "🚀" });
  });

  it("applies the skin tone", async () => {
    const items = await spec({ skinTone: () => "medium" }).fetch("thumbs", 8, {});
    expect(items[0]).toMatchObject({ value: "👍🏽" });
  });

  it("returns nothing while the packs load", async () => {
    await expect(spec({ source: () => undefined }).fetch("pizza", 8, {})).resolves.toEqual([]);
  });

  it("waits for semantic results when the dictionary is unsure", async () => {
    const source = createSuggestionSource({
      engine,
      semantic: stubSemantic(),
      debounceMs: 1,
      minQueryLength: 2,
    });
    const items = await createAutocompleter({ source: () => source, insert: vi.fn() }).fetch(
      "blastoff",
      8,
      {},
    );
    expect(items.map((item) => "value" in item && item.value)).toEqual(["🚀"]);
  });

  it("answers every query with the newest results", async () => {
    const source = createSuggestionSource({
      engine,
      semantic: stubSemantic(20),
      debounceMs: 1,
      minQueryLength: 2,
    });
    const autocompleter = createAutocompleter({ source: () => source, insert: vi.fn() });
    const older = autocompleter.fetch("blastoff", 8, {});
    const newer = autocompleter.fetch("pizza", 8, {});
    const [a, b] = await Promise.all([older, newer]);
    expect(a).toEqual(b);
    expect(b[0]).toMatchObject({ value: "🍕" });
  });

  it("inserts the emoji in place of the query and closes the menu", () => {
    const insert = vi.fn();
    const hide = vi.fn();
    const range = rangeIn(":pizza");
    spec({ insert }).onAction({ hide, reload: vi.fn() }, range, "🍕", {});
    expect(insert).toHaveBeenCalledWith(range, "🍕");
    expect(hide).toHaveBeenCalled();
  });
});

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<b>"&'`)).toBe("&#60;b&#62;&#34;&#38;&#39;");
    expect(escapeHtml("🚀")).toBe("🚀");
  });
});
