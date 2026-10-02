import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReactedStore,
  effectiveReactions,
  emojiFromHex,
  formatCount,
  withoutReaction,
  withReaction,
} from "../../src/lib/reactions.js";
import {
  mountReactionBar,
  type Reaction,
  ReactionError,
  type ReactionsApi,
} from "../../src/lib/reactions-client.js";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("reaction lists", () => {
  it("prefers the author's choice, then the suggestion, then the defaults", () => {
    expect(effectiveReactions(["🎉"], ["🍕"], ["👍"])).toEqual({ list: ["🎉"], source: "chosen" });
    expect(effectiveReactions([], ["🍕"], ["👍"])).toEqual({ list: ["🍕"], source: "suggested" });
    expect(effectiveReactions(undefined, undefined, ["👍"])).toEqual({ list: ["👍"], source: "defaults" });
  });

  it("adds once, up to the limit, and removes", () => {
    expect(withReaction(["👍"], "👍", 8)).toEqual(["👍"]);
    expect(withReaction(["👍", "❤️"], "🎉", 2)).toEqual(["👍", "❤️"]);
    expect(withReaction(["👍"], "🎉", 8)).toEqual(["👍", "🎉"]);
    expect(withoutReaction(["👍", "🎉"], "👍")).toEqual(["🎉"]);
  });

  it("reads emoji from the code points on the buttons", () => {
    expect(emojiFromHex("2764-FE0F")).toBe("❤️");
    expect(emojiFromHex("1F44D-1F3FD")).toBe("👍🏽");
    expect(emojiFromHex("nope")).toBe("");
    expect(emojiFromHex("110000")).toBe("");
  });

  it("formats counts in the page language, and survives a bad lang attribute", () => {
    expect(formatCount(1204, "en")).toBe("1,204");
    expect(formatCount(3, "ar-EG")).toBe("٣");
    expect(formatCount(-2, "en")).toBe("0");
    expect(formatCount(5, "en_US")).toBe(new Intl.NumberFormat().format(5));
  });
});

describe("createReactedStore", () => {
  it("remembers reactions per post and survives broken storage", () => {
    const storage = memoryStorage();
    const store = createReactedStore(storage);
    store.toggle(7, "👍", true);
    store.toggle(7, "🎉", true);
    store.toggle(7, "👍", false);
    expect([...store.get(7)]).toEqual(["🎉"]);
    expect([...store.get(8)]).toEqual([]);

    storage.setItem("emojisense:reactions", "{not json");
    expect([...createReactedStore(storage).get(7)]).toEqual([]);
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => createReactedStore(throwing).toggle(1, "👍", true)).not.toThrow();
  });

  it("keeps the most recent 200 posts", () => {
    const storage = memoryStorage();
    const store = createReactedStore(storage);
    for (let post = 1; post <= 205; post++) store.toggle(post, "👍", true);
    expect(store.get(1).size).toBe(0);
    expect(store.get(205).has("👍")).toBe(true);
    expect(Object.keys(JSON.parse(storage.getItem("emojisense:reactions") ?? "{}"))).toHaveLength(200);
  });
});

/** The markup of Emojisense_Reactions::render() for two reactions. */
function renderBar(post = 42) {
  document.body.innerHTML = `
    <div class="emojisense-reactions" data-emojisense-post="${post}">
      <div class="emojisense-reactions__list" role="group" aria-label="React to this post">
        <button type="button" class="emojisense-reaction" data-emoji-hex="1F44D" aria-pressed="false" disabled><span class="emojisense-reaction__emoji">👍</span> <span class="emojisense-reaction__count">1</span></button>
        <button type="button" class="emojisense-reaction" data-emoji-hex="2764-FE0F" aria-pressed="false" disabled><span class="emojisense-reaction__emoji">❤️</span> <span class="emojisense-reaction__count">0</span></button>
      </div>
      <p class="emojisense-reactions__status" role="status"></p>
    </div>`;
  return document.querySelector<HTMLElement>(".emojisense-reactions") as HTMLElement;
}

function fakeApi(start: Reaction[]) {
  const counts = new Map(start.map((reaction) => [reaction.emoji, reaction.count]));
  const list = () => [...counts].map(([emoji, count]) => ({ emoji, count }));
  let nonce = "n1";
  const api = {
    load: vi.fn(async () => ({ reactions: list(), nonce })),
    react: vi.fn(async (_post: number, emoji: string, action: "add" | "remove", sent: string) => {
      if (sent !== nonce) throw new ReactionError(403, "emojisense_bad_nonce");
      counts.set(emoji, Math.max(0, (counts.get(emoji) ?? 0) + (action === "add" ? 1 : -1)));
      return list();
    }),
    rotateNonce: () => {
      nonce = "n2";
    },
  };
  return api satisfies ReactionsApi & { rotateNonce(): void };
}

describe("mountReactionBar", () => {
  const original = globalThis.IntersectionObserver;
  beforeEach(() => {
    // Mount right away instead of waiting for the bar to scroll into view.
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    delete (window as { IntersectionObserver?: unknown }).IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
    document.body.innerHTML = "";
  });

  const button = (root: HTMLElement, hex: string) =>
    root.querySelector<HTMLButtonElement>(`[data-emoji-hex="${hex}"]`) as HTMLButtonElement;
  const count = (root: HTMLElement, hex: string) =>
    button(root, hex).querySelector(".emojisense-reaction__count")?.textContent;

  it("loads fresh counts, enables the buttons and toggles a reaction", async () => {
    const root = renderBar();
    const api = fakeApi([
      { emoji: "👍", count: 4 },
      { emoji: "❤️", count: 0 },
    ]);
    const store = createReactedStore(memoryStorage());
    const bar = mountReactionBar(root, { api, store, locale: "en" });
    await bar.refresh();
    expect(count(root, "1F44D")).toBe("4");
    expect(button(root, "1F44D").disabled).toBe(false);

    await bar.toggle("❤️");
    expect(api.react).toHaveBeenLastCalledWith(42, "❤️", "add", "n1");
    expect(count(root, "2764-FE0F")).toBe("1");
    expect(button(root, "2764-FE0F").getAttribute("aria-pressed")).toBe("true");
    expect(store.get(42).has("❤️")).toBe(true);

    await bar.toggle("❤️");
    expect(api.react).toHaveBeenLastCalledWith(42, "❤️", "remove", "n1");
    expect(count(root, "2764-FE0F")).toBe("0");
    expect(button(root, "2764-FE0F").getAttribute("aria-pressed")).toBe("false");
  });

  it("gets a fresh nonce once when the page's nonce expired", async () => {
    const root = renderBar();
    const api = fakeApi([{ emoji: "👍", count: 1 }]);
    const bar = mountReactionBar(root, { api, store: createReactedStore(memoryStorage()) });
    await bar.refresh();
    api.rotateNonce();
    await bar.toggle("👍");
    expect(api.react).toHaveBeenCalledTimes(2);
    expect(api.react).toHaveBeenLastCalledWith(42, "👍", "add", "n2");
    expect(count(root, "1F44D")).toBe("2");
  });

  it("rolls back and explains a rate limit", async () => {
    const root = renderBar();
    const api: ReactionsApi = {
      load: async () => ({ reactions: [{ emoji: "👍", count: 1 }], nonce: "n" }),
      react: async () => {
        throw new ReactionError(429, "emojisense_rate_limited");
      },
    };
    const bar = mountReactionBar(root, {
      api,
      store: createReactedStore(memoryStorage()),
      strings: { limited: "Slow down." },
    });
    await bar.refresh();
    await bar.toggle("👍");
    expect(count(root, "1F44D")).toBe("1");
    expect(button(root, "1F44D").getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector(".emojisense-reactions__status")?.textContent).toBe("Slow down.");
  });

  it("keeps the page counts and disabled buttons when the API is down", async () => {
    const root = renderBar();
    const api: ReactionsApi = {
      load: async () => {
        throw new ReactionError(500, "error");
      },
      react: async () => [],
    };
    const bar = mountReactionBar(root, { api, store: createReactedStore(memoryStorage()) });
    await expect(bar.refresh()).rejects.toThrow();
    expect(count(root, "1F44D")).toBe("1");
    expect(button(root, "1F44D").disabled).toBe(true);
  });
});
