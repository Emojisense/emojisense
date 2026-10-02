import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineEmojisensePicker, type EmojiSelectDetail, EmojisensePickerElement } from "../src/index.js";
import { en, PACK_URL, serve } from "./fixture.js";

let fetch: ReturnType<typeof serve>;

beforeEach(() => {
  fetch = serve();
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount(attributes: Record<string, string> = {}, tag = "emojisense-picker") {
  const picker = document.createElement(tag) as EmojisensePickerElement;
  for (const [name, value] of Object.entries({ "pack-url": PACK_URL, ...attributes })) {
    picker.setAttribute(name, value);
  }
  document.body.append(picker);
  await vi.waitFor(() => expect(picker.status).toBe("ready"));
  return picker;
}

const $ = (picker: EmojisensePickerElement, selector: string) =>
  picker.shadowRoot?.querySelector(selector) as HTMLElement;
const $$ = (picker: EmojisensePickerElement, selector: string) => [
  ...(picker.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []),
];
const input = (picker: EmojisensePickerElement) => $(picker, "input") as HTMLInputElement;
const results = (picker: EmojisensePickerElement) => $$(picker, "#results [role=option]");

function type(picker: EmojisensePickerElement, value: string) {
  input(picker).value = value;
  input(picker).dispatchEvent(new Event("input"));
}

function press(picker: EmojisensePickerElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true });
  input(picker).dispatchEvent(event);
  return event;
}

function selections() {
  const details: EmojiSelectDetail[] = [];
  document.addEventListener("emoji-select", (event) => details.push(event.detail));
  return details;
}

describe("<emojisense-picker>", () => {
  it("registers once and renders every emoji by category", async () => {
    expect(customElements.get("emojisense-picker")).toBe(EmojisensePickerElement);
    defineEmojisensePicker();
    const picker = await mount();
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(`${PACK_URL}/pack.en.json`);
    expect($$(picker, "#browse [role=group]")).toHaveLength(4);
    expect($(picker, ".group-label").textContent).toBe("Smileys & emotion");
    expect($$(picker, "#browse [role=option]").map((o) => o.textContent)).toEqual(
      en.emoji.map((row) => row[0]),
    );
    expect(input(picker).getAttribute("role")).toBe("combobox");
    expect(input(picker).getAttribute("aria-controls")).toBe("browse");
  });

  it("uses the locale for labels and group names", async () => {
    const picker = await mount({ locale: "tr" });
    expect($(picker, ".group-label").textContent).toBe("İfadeler ve duygular");
    expect($(picker, "#browse [role=option]").getAttribute("aria-label")).toBe("sırıtan yüz");
  });

  it("ranks as the user types and selects the active result with Enter", async () => {
    const picker = await mount();
    const selected = selections();
    type(picker, "jurassic");
    expect(results(picker)[0]?.textContent).toBe("🦖");
    expect(results(picker)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input(picker).getAttribute("aria-controls")).toBe("results");
    expect(input(picker).getAttribute("aria-activedescendant")).toBe(results(picker)[0]?.id);
    expect($(picker, "#browse").hidden).toBe(true);
    expect($(picker, ".pill").textContent).toBe("1 found");
    expect(press(picker, "Enter").defaultPrevented).toBe(true);
    expect(selected).toEqual([{ emoji: "🦖", label: "T-Rex", id: "1F996" }]);
  });

  it("moves through the browse grid by visual rows", async () => {
    const picker = await mount();
    const active = () => input(picker).getAttribute("aria-activedescendant");
    expect(active()).toBeNull();
    press(picker, "ArrowDown");
    expect(active()).toBe("b0");
    press(picker, "ArrowDown");
    expect(active()).toBe("b2"); // the next group starts a new row
    press(picker, "ArrowRight");
    press(picker, "ArrowDown");
    expect(active()).toBe("b5");
    press(picker, "ArrowDown");
    expect(active()).toBe("b6"); // clamps to the one-emoji row
    press(picker, "ArrowUp");
    expect(active()).toBe("b4");
    expect($(picker, "#b4").getAttribute("part")).toBe("option active");
  });

  it("follows the columns attribute", async () => {
    const picker = await mount({ columns: "1" });
    expect($(picker, ".root").style.getPropertyValue("--columns")).toBe("1");
    press(picker, "ArrowDown");
    press(picker, "ArrowDown");
    expect(input(picker).getAttribute("aria-activedescendant")).toBe("b1");
  });

  it("applies the skin tone to emoji that support it", async () => {
    const picker = await mount({ "skin-tone": "medium" });
    const selected = selections();
    expect($(picker, "#b2").textContent).toBe("👍🏽");
    expect($(picker, "#b4").textContent).toBe("🦖");
    picker.setAttribute("skin-tone", "dark");
    expect($(picker, "#b2").textContent).toBe("👍🏿");
    type(picker, "lgtm");
    press(picker, "Enter");
    expect(selected[0]).toEqual({ emoji: "👍🏿", label: "thumbs up", id: "1F44D" });
  });

  it("selects with the pointer", async () => {
    const picker = await mount();
    const selected = selections();
    $(picker, "#b6").dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(input(picker).getAttribute("aria-activedescendant")).toBe("b6");
    $(picker, "#b6").click();
    expect(selected).toEqual([{ emoji: "🚀", label: "rocket", id: "1F680" }]);
  });

  it("clears the query on the first Escape and lets the second one through", async () => {
    const picker = await mount();
    type(picker, "rocket");
    expect(press(picker, "Escape").defaultPrevented).toBe(true);
    expect(input(picker).value).toBe("");
    expect($(picker, "#browse").hidden).toBe(false);
    expect($(picker, ".pill").hidden).toBe(true);
    expect(press(picker, "Escape").defaultPrevented).toBe(false);
  });

  it("shows an empty state for a query without results", async () => {
    const picker = await mount();
    type(picker, "zzzz");
    expect($(picker, ".message-text").textContent).toBe("No emoji found.");
    expect($(picker, ".pill").textContent).toBe("none");
    expect(input(picker).getAttribute("aria-expanded")).toBe("false");
  });

  it("asks the shards before the API", async () => {
    const picker = await mount({ "shards-url": "https://cdn.test/p/test", endpoint: "https://api.test" });
    type(picker, "spaceship launch party");
    await vi.waitFor(() => expect(results(picker).map((o) => o.textContent)).toContain("🚀"));
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/v1/search"))).toBe(false);
  });

  it("sends the publishable key to the API", async () => {
    const picker = await mount({ endpoint: "https://api.test", key: "pk_test_1" });
    type(picker, "tiny horned animal");
    await vi.waitFor(() => expect(results(picker).map((o) => o.textContent)).toContain("🐐"));
    const call = fetch.mock.calls.find(([url]) => String(url).includes("/v1/search"));
    expect(new URL(String(call?.[0])).searchParams.get("key")).toBe("pk_test_1");
    picker.setAttribute("publishable-key", "pk_test_2");
    expect(picker.publishableKey).toBe("pk_test_2");
  });

  it("loads the extension packs when idle", async () => {
    const picker = await mount();
    await vi.waitFor(() => {
      type(picker, "to infinity and beyond");
      expect(results(picker)[0]?.textContent).toBe("🚀");
    });
  });

  it("reports a load error", async () => {
    vi.stubGlobal("fetch", serve({ packs: false }));
    const picker = document.createElement("emojisense-picker");
    picker.setAttribute("pack-url", PACK_URL);
    document.body.append(picker);
    await vi.waitFor(() => expect(picker.status).toBe("error"));
    expect($(picker, ".message-text").textContent).toBe("Could not load emoji.");
  });

  it("uses packs set as a property without fetching, even before the tag is defined", async () => {
    const picker = document.createElement("emojisense-later") as EmojisensePickerElement;
    picker.packs = [en];
    document.body.append(picker);
    defineEmojisensePicker("emojisense-later");
    await vi.waitFor(() => expect(picker.status).toBe("ready"));
    expect(picker instanceof EmojisensePickerElement).toBe(true);
    expect($$(picker, "#browse [role=option]")).toHaveLength(en.emoji.length);
    expect(fetch).not.toHaveBeenCalled();
  });
});
