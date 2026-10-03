import { type Culture, createEngine, type Pack, type SemanticProvider } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowContext,
  type CompletionItem,
  createItemSearch,
  isSearchable,
  MAX_OPTIONS,
} from "../../src/lib/completer.js";
import { pack, readCulture } from "./fixtures.js";

const engine = createEngine([pack("en"), pack("tr")]);

function search(query: string, options: { locale?: string; semantic?: SemanticProvider } = {}) {
  let last: CompletionItem[] = [];
  const session = createItemSearch({
    engine,
    locale: options.locale ?? "en",
    debounceMs: 0,
    ...(options.semantic ? { semantic: options.semantic } : {}),
    onItems: (items) => {
      last = items;
    },
  });
  session.update(query);
  return { items: () => last, session };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("allowContext", () => {
  it.each([
    ["", "", true],
    ["I want ", "", true],
    ["(", "", true],
    ["“", "", true],
    ["line one\n", "", true],
    ["12", "", false],
    ["https", "", false],
    ["a", "", false],
    ["note ", "rest", false],
    ["note ", " rest", true],
  ])("before %j, after %j → %s", (before, after, expected) => {
    expect(allowContext(before, after)).toBe(expected);
  });
});

describe("isSearchable", () => {
  it("needs two characters, so :) and :D stay emoticons", () => {
    expect(isSearchable(")")).toBe(false);
    expect(isSearchable("D")).toBe(false);
    expect(isSearchable(" p ")).toBe(false);
    expect(isSearchable("pi")).toBe(true);
    expect(isSearchable("🍕x")).toBe(true);
  });
});

describe("createItemSearch", () => {
  it("suggests 🍕 first for :pizza, on the same keystroke", () => {
    const { items } = search("pizza");
    expect(items()[0]).toMatchObject({ emoji: "🍕", label: "pizza", source: "alias" });
  });

  it("finds by meaning words, not only names", () => {
    expect(
      search("ship it")
        .items()
        .map((item) => item.emoji),
    ).toContain("🚀");
  });

  it("understands phrases and the second language (the readme examples)", () => {
    expect(search("ship it").items()[0]?.emoji).toBe("🚀");
    expect(search("mind blown").items()[0]?.emoji).toBe("🤯");
    expect(search("kolay gelsin", { locale: "tr" }).items()[0]?.emoji).toBe("💪");
  });

  it("adds culture emoji after the best result (the readme example)", () => {
    const culture = readCulture("en") as Culture;
    let items: CompletionItem[] = [];
    createItemSearch({
      engine: createEngine([pack("en")], { culture }),
      locale: "en",
      onItems: (next) => {
        items = next;
      },
    }).update("goat");
    const emoji = items.map((item) => item.emoji.replace("️", ""));
    expect(emoji[0]).toBe("🐐");
    expect(emoji).toContain("⚽");
    expect(items.find((item) => item.source === "culture")?.context).toBeTruthy();
  });

  it("names the emoji in the configured locale", () => {
    const [first] = search("pizza", { locale: "tr" }).items();
    expect(first?.emoji).toBe("🍕");
    expect(first?.label).not.toBe("");
    expect(first?.label).toBe(engine.get(first?.id ?? "")?.labels.tr);
  });

  it("shows nothing for short queries and caps the list", () => {
    expect(search("p").items()).toEqual([]);
    expect(search("face").items().length).toBeLessThanOrEqual(MAX_OPTIONS);
  });

  it("fuses meaning results from the API when the dictionary is unsure", async () => {
    vi.useFakeTimers();
    const semantic: SemanticProvider = {
      search: vi.fn(async () => ({
        results: [{ emoji: "🦄", id: "1F984", score: 0.9, source: "semantic" as const }],
        packVersion: engine.packVersion,
        model: "test",
        cached: false,
        degraded: false,
        overLimit: false,
      })),
    };
    const { items } = search("zzqx unicornish", { semantic });
    await vi.runAllTimersAsync();
    expect(semantic.search).toHaveBeenCalledTimes(1);
    expect(items().map((item) => item.emoji)).toContain("🦄");
  });

  it("does not ask the API when the dictionary is sure", async () => {
    vi.useFakeTimers();
    const semantic: SemanticProvider = { search: vi.fn(async () => undefined) };
    search("pizza", { semantic });
    await vi.runAllTimersAsync();
    expect(semantic.search).not.toHaveBeenCalled();
  });
});

describe("custom emoji", () => {
  it("are left out: the editors insert text only", () => {
    const custom = {
      ...pack("en"),
      locale: "und",
      part: "custom" as const,
      groups: ["custom"],
      emoji: [[":pizza_cat:", "C-1", 0, 0, 0, "pizza_cat", "pizza cat", "", "pizza", "", ""]],
      images: { "C-1": "https://example.com/pizza_cat.png" },
    } as Pack;
    let items: CompletionItem[] = [];
    createItemSearch({
      engine: createEngine([pack("en"), custom]),
      locale: "en",
      onItems: (next) => {
        items = next;
      },
    }).update("pizza");
    expect(items[0]?.emoji).toBe("🍕");
    expect(items.some((item) => item.source === "custom")).toBe(false);
  });
});
