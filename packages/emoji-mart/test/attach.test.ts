import { afterEach, describe, expect, it, vi } from "vitest";
import { attachEmojisense } from "../src/attach.js";
import { createEmojiMartSearch } from "../src/search.js";
import { emojiMartData, engine } from "./fixture.js";

afterEach(() => document.body.replaceChildren());

function setup(skin = 1) {
  // A stand-in for emoji-mart's <em-emoji-picker>: the controller only shows and hides it.
  const picker = document.createElement("div");
  const input = document.createElement("input");
  const results = document.createElement("div");
  document.body.append(input, picker, results);
  const onEmojiSelect = vi.fn();
  const attached = attachEmojisense({
    picker,
    input,
    results,
    data: emojiMartData,
    engine,
    columns: 2,
    skin: () => skin,
    onEmojiSelect,
  });
  const type = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    input.dispatchEvent(event);
    return event;
  };
  const options = () => [...results.querySelectorAll<HTMLElement>("[role=option]")];
  return { picker, input, results, onEmojiSelect, attached, type, press, options };
}

describe("attachEmojisense", () => {
  it("swaps emoji-mart's picker for the ranked results while typing", () => {
    const { picker, input, results, type, options } = setup();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe(results.id);
    expect(results.getAttribute("role")).toBe("listbox");
    type("jurassic");
    expect(picker.style.display).toBe("none");
    expect(results.style.display).toBe("grid");
    expect(options().map((o) => o.textContent)).toEqual(["🦖"]);
    expect(options()[0]?.getAttribute("aria-label")).toBe("T-Rex");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    type("");
    expect(picker.style.display).toBe("");
    expect(results.style.display).toBe("none");
  });

  it("selects with the keyboard and passes emoji-mart's payload with the skin", () => {
    const { onEmojiSelect, type, press, options } = setup(3);
    type("lgtm");
    expect(options()[0]?.textContent).toBe("👍🏼");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(onEmojiSelect.mock.calls[0]?.[0]).toMatchObject({ id: "+1", native: "👍🏼", skin: 3 });
  });

  it("moves through the results with arrow keys and selects with the pointer", () => {
    const { onEmojiSelect, input, type, press, options } = setup();
    type("l");
    expect(options().length).toBeGreaterThan(2);
    press("ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[2]?.id);
    press("ArrowLeft");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    options()[0]?.click();
    expect(onEmojiSelect).toHaveBeenCalledTimes(1);
  });

  it("marks an empty result list and clears the query with Escape", () => {
    const { picker, input, results, type, press } = setup();
    type("exhausted"); // only an Emoji 16 face matches, and emoji-mart's data has none
    expect(results.hasAttribute("data-empty")).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(picker.style.display).toBe("");
  });

  it("restores the page on dispose", () => {
    const { picker, results, type, attached } = setup();
    type("rocket");
    attached.dispose();
    expect(picker.style.display).toBe("");
    expect(results.childElementCount).toBe(0);
  });
});

describe("createEmojiMartSearch", () => {
  it("delivers alias results at once and fuses semantic results later", async () => {
    const onResults = vi.fn();
    const search = createEmojiMartSearch({
      data: emojiMartData,
      engine,
      semantic: {
        search: async () => ({
          results: [{ emoji: "🚀", id: "1F680", score: 0.8, source: "semantic" as const }],
          packVersion: "test",
          cached: false,
          layer: "api" as const,
        }),
      },
      debounceMs: 0,
      onResults,
    });
    search.update("to the stars");
    expect(onResults).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onResults).toHaveBeenCalledTimes(2));
    const [emojis, state] = onResults.mock.calls[1] ?? [];
    expect(emojis.map((e: { id: string }) => e.id)).toEqual(["rocket"]);
    expect(state.layer).toBe("api");
    search.dispose();
  });
});
