import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createEngine } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojisensePicker } from "../src/frimousse.js";
import { EmojiGlyph } from "../src/glyph.js";
import { useEmojiSearch, useEmojisense } from "../src/hooks.js";
import { custom, en, PARROT_URL, packFetch, tr } from "./fixture.js";

const API = "https://api.test";

afterEach(() => vi.unstubAllGlobals());

const sense = {
  engine: createEngine([en, tr, custom]),
  semantic: undefined,
  packs: [en, tr],
  customPack: custom,
  locale: "en",
  status: "ready" as const,
  extended: false,
};

const PARROT = {
  emoji: ":party_parrot:",
  label: ":party_parrot:",
  imageUrl: PARROT_URL,
  shortcode: "party_parrot",
};

describe("EmojiGlyph with a custom emoji", () => {
  it("draws imageUrl with the shortcode as alt text, whatever the emoji set", () => {
    render(<EmojiGlyph emoji=":party_parrot:" imageUrl={PARROT_URL} emojiSet="twemoji" endpoint={API} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe(PARROT_URL);
    expect(img.getAttribute("alt")).toBe(":party_parrot:");
    expect(img.hasAttribute("data-emojisense-custom")).toBe(true);
  });

  it("falls back to the shortcode text when the image fails", () => {
    const { container } = render(<EmojiGlyph emoji=":party_parrot:" imageUrl={PARROT_URL} />);
    fireEvent.error(screen.getByRole("img"));
    expect(container.innerHTML).toBe(":party_parrot:");
  });
});

describe("EmojisensePicker with custom emoji", () => {
  it("draws custom results as images and selects them with imageUrl and shortcode", async () => {
    const onEmojiSelect = vi.fn();
    render(<EmojisensePicker emojisense={sense} onEmojiSelect={onEmojiSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "party parrot" } });
    const [option] = await screen.findAllByRole("option");
    const img = option?.querySelector("img");
    expect(img?.getAttribute("src")).toBe(PARROT_URL);
    expect(img?.getAttribute("alt")).toBe(":party_parrot:");
    expect(option?.getAttribute("aria-label")).toBe(":party_parrot:");
    expect(option?.getAttribute("data-source")).toBe("custom");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEmojiSelect).toHaveBeenCalledWith(PARROT);
    fireEvent.click(option as HTMLElement);
    expect(onEmojiSelect).toHaveBeenLastCalledWith(PARROT);
  });

  it("keeps catalog selections as { emoji, label }", async () => {
    const onEmojiSelect = vi.fn();
    render(<EmojisensePicker emojisense={sense} onEmojiSelect={onEmojiSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "jurassic" } });
    await screen.findAllByRole("option");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEmojiSelect.mock.calls[0]?.[0]).toStrictEqual({ emoji: "🦖", label: "T-Rex" });
  });
});

describe("useEmojisense customEmoji", () => {
  it("loads the key's custom pack into the engine", async () => {
    const packs = packFetch();
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/v1/custom-pack") ? new Response(JSON.stringify(custom)) : packs(url),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useEmojisense({
        packBaseUrl: "https://x.test",
        endpoint: API,
        publishableKey: "pk_live_x",
        customEmoji: true,
        tenant: "acme",
        extended: false,
      }),
    );
    await waitFor(() => expect(result.current.customPack).toEqual(custom));
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(
      `${API}/v1/custom-pack?key=pk_live_x&tenant=acme`,
    );
    expect(result.current.packs).toEqual([en]);
    const { result: search } = renderHook(() => useEmojiSearch("party parrot", result.current));
    await waitFor(() =>
      expect(search.current.results[0]).toMatchObject({ id: "C-e1", imageUrl: PARROT_URL }),
    );
  });

  it("loads nothing without the option, and keeps working when the request fails", async () => {
    const packs = packFetch();
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/v1/custom-pack") ? new Response("{}", { status: 401 }) : packs(url),
    );
    vi.stubGlobal("fetch", fetch);
    const options = { packBaseUrl: "https://x.test", endpoint: API, publishableKey: "pk", extended: false };
    const plain = renderHook(() => useEmojisense(options));
    await waitFor(() => expect(plain.result.current.status).toBe("ready"));
    expect(fetch.mock.calls.some(([url]) => String(url).includes("custom-pack"))).toBe(false);

    const failing = renderHook(() => useEmojisense({ ...options, customEmoji: true }));
    await waitFor(() => expect(failing.result.current.status).toBe("ready"));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).includes("custom-pack"))).toBe(true),
    );
    expect(failing.result.current.customPack).toBeUndefined();
  });
});
