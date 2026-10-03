import type { Culture } from "emojisense";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineEmojisensePicker, type EmojiSelectDetail, EmojisensePickerElement } from "../src/index.js";
import { CULTURE_URL, culture, en, PACK_URL, serve } from "./fixture.js";

let fetch: ReturnType<typeof serve>;

beforeEach(() => {
  fetch = serve();
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it("draws a hosted emoji set as lazy images that follow the skin tone", async () => {
    const picker = await mount({
      "emoji-set": "twemoji",
      endpoint: "https://api.test/",
      "skin-tone": "medium",
    });
    const selected = selections();
    const image = (id: string) => $(picker, `#${id} img`) as HTMLImageElement;
    expect(image("b0").getAttribute("src")).toBe("https://api.test/v1/sets/twemoji/1F600.svg");
    expect(image("b0").alt).toBe("😀");
    expect(image("b0").getAttribute("loading")).toBe("lazy");
    expect(image("b0").getAttribute("part")).toBe("image");
    expect(image("b2").getAttribute("src")).toBe("https://api.test/v1/sets/twemoji/1F44D-1F3FD.svg");
    picker.skinTone = "dark";
    expect(image("b2").getAttribute("src")).toBe("https://api.test/v1/sets/twemoji/1F44D-1F3FF.svg");
    expect($(picker, "#b2").getAttribute("aria-label")).toBe("thumbs up");

    type(picker, "jurassic");
    expect(results(picker)[0]?.querySelector("img")?.alt).toBe("🦖");
    press(picker, "Enter");
    expect(selected).toEqual([{ emoji: "🦖", label: "T-Rex", id: "1F996" }]);
  });

  it("switches sets at runtime and falls back to text when an image fails", async () => {
    const picker = await mount({ "emoji-set": "fluent", endpoint: "https://api.test" });
    const first = $(picker, "#b0 img");
    first.dispatchEvent(new Event("error"));
    expect($(picker, "#b0").textContent).toBe("😀");
    expect($(picker, "#b0 img")).toBeNull();

    picker.emojiSet = "noto";
    expect($(picker, "#b4 img").getAttribute("src")).toBe("https://api.test/v1/sets/noto/1F996.svg");
    picker.setAttribute("emoji-set", "native");
    expect($(picker, "#b4").textContent).toBe("🦖");
    picker.setAttribute("emoji-set", "openmoji");
    expect(picker.emojiSet).toBe("native");
    expect($$(picker, "img")).toEqual([]);
  });

  it("sends the key and the page's origin with hosted set images", async () => {
    const picker = await mount({ "emoji-set": "noto", endpoint: "https://api.test", key: "pk_live_abc" });
    const image = $(picker, "#b0 img");
    expect(image.getAttribute("src")).toBe("https://api.test/v1/sets/noto/1F600.svg?key=pk_live_abc");
    expect(image.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    picker.setAttribute("publishable-key", "pk_live_new");
    expect($(picker, "#b0 img").getAttribute("src")).toBe(
      "https://api.test/v1/sets/noto/1F600.svg?key=pk_live_new",
    );
  });

  it("draws text for a hosted set without an endpoint", async () => {
    const picker = await mount({ "emoji-set": "twemoji" });
    expect($$(picker, "img")).toEqual([]);
    expect($(picker, "#b0").textContent).toBe("😀");
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

  it("reports how searches end and what is picked when stats-url is set", async () => {
    const beacons: [string, string][] = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      sendBeacon: (url: string, body: string) => beacons.push([url, body]) > 0,
    });
    const picker = await mount({ "stats-url": "https://stats.test", "stats-sample": "1", key: "pk_test_1" });
    type(picker, "rocket");
    press(picker, "ArrowDown");
    press(picker, "Enter");
    picker.remove();
    expect(beacons).toHaveLength(1);
    const [url, body] = beacons[0] as [string, string];
    expect(url).toBe("https://stats.test/v1/events?key=pk_test_1");
    expect(JSON.parse(body)).toMatchObject({ counts: { device: 1 }, picks: [["rocket", "1F680"]] });
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

describe("<emojisense-picker> culture layer", () => {
  it("adds culture results after the top result, with their context", async () => {
    const picker = await mount({ "culture-url": CULTURE_URL });
    await vi.waitFor(() => expect(picker.culture?.locale).toBe("en"));
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(`${CULTURE_URL}/culture.en.json`);
    await vi.waitFor(() => {
      type(picker, "goat");
      expect(results(picker).map((o) => o.textContent)).toEqual(["🐐", "🚀"]);
    });
    expect(results(picker)[1]?.title).toBe("rocket · A test association");
    expect(results(picker)[1]?.getAttribute("aria-description")).toBe("A test association");
  });

  it("keeps the canonical ranking without a culture file, and when it cannot load", async () => {
    const plain = await mount();
    type(plain, "goat");
    expect(results(plain).map((o) => o.textContent)).toEqual(["🐐"]);
    const missing = await mount({ "culture-url": "https://cdn.test/v1/culture/none" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    type(missing, "goat");
    expect(results(missing).map((o) => o.textContent)).toEqual(["🐐"]);
  });

  it("shows the relevant-now row only with show-relevant-now", async () => {
    const off = await mount({ "culture-url": CULTURE_URL });
    await vi.waitFor(() => expect(off.culture).toBeDefined());
    expect($$(off, "#browse [role=group]")).toHaveLength(4);

    const on = await mount({ "culture-url": CULTURE_URL, "show-relevant-now": "" });
    await vi.waitFor(() => expect($$(on, "#browse [role=group]")).toHaveLength(5));
    expect($(on, ".group-label").textContent).toBe("Relevant now");
    const row = $$(on, "#browse [role=group]:first-child [role=option]");
    expect(row.map((o) => o.textContent)).toEqual(["😂", "👋"]);
    expect(row[0]?.title).toBe("face with tears of joy · A season");

    on.showRelevantNow = false;
    await vi.waitFor(() => expect($$(on, "#browse [role=group]")).toHaveLength(4));
  });

  it("draws the relevant-now row for the device's new day when it gets focus after midnight", async () => {
    const [season] = culture.entries;
    const oneDay = {
      ...culture,
      entries: [{ ...season, when: { from: "10-31", to: "10-31", recurs: "yearly" } }],
    } as Culture;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 31, 23, 50));
      const picker = await mount({ "show-relevant-now": "" });
      picker.culture = oneDay;
      await vi.waitFor(() => expect($$(picker, "#browse [role=group]")).toHaveLength(5));
      vi.setSystemTime(new Date(2026, 10, 1, 0, 10));
      input(picker).dispatchEvent(new FocusEvent("focus"));
      expect($$(picker, "#browse [role=group]")).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a culture file set as a property", async () => {
    const picker = await mount();
    picker.culture = culture as Culture;
    await vi.waitFor(() => {
      type(picker, "goat");
      expect(results(picker).map((o) => o.textContent)).toEqual(["🐐", "🚀"]);
    });
  });
});

describe("<emojisense-picker> culture region", () => {
  /** "goat" also adds 👋, but only in Brazil. */
  const regional = {
    ...culture,
    entries: [
      ...culture.entries,
      {
        id: "goat-br",
        kind: "lasting",
        context: "A regional association",
        when: null,
        regions: ["BR"],
        triggers: ["goat"],
        emoji: [["👋", "1F44B", 0.9]],
      },
    ],
  } as Culture;

  const speak = (language: string) => vi.spyOn(navigator, "language", "get").mockReturnValue(language);

  async function goat(attributes: Record<string, string> = {}) {
    const picker = await mount(attributes);
    picker.culture = regional;
    let found: (string | null)[] = [];
    await vi.waitFor(() => {
      type(picker, "goat");
      found = results(picker).map((o) => o.textContent);
      expect(found).toContain("🚀");
    });
    return found;
  }

  it("uses the region of the browser's language without a region attribute", async () => {
    speak("pt-BR");
    expect(await goat()).toEqual(["🐐", "👋", "🚀"]);
  });

  it("has no region when the browser's language has no region subtag", async () => {
    speak("pt");
    expect(await goat()).toEqual(["🐐", "🚀"]);
  });

  it('prefers the region attribute, and region="" turns regional entries off', async () => {
    speak("en-US");
    expect(await goat({ region: "BR" })).toEqual(["🐐", "👋", "🚀"]);
    speak("pt-BR");
    expect(await goat({ region: "" })).toEqual(["🐐", "🚀"]);
  });

  it("never sends the region", async () => {
    speak("pt-BR");
    const picker = await mount({
      endpoint: "https://api.test",
      key: "pk_test_1",
      "culture-url": CULTURE_URL,
    });
    type(picker, "tiny horned animal");
    await vi.waitFor(() => expect(results(picker).map((o) => o.textContent)).toContain("🐐"));
    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/v1/search"))).toBe(true);
    for (const url of urls) expect(url).not.toMatch(/BR|region/i);
  });
});
