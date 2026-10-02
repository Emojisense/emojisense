import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createEngine, type EmojiSet } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojisensePicker } from "../src/frimousse.js";
import { EmojiGlyph } from "../src/glyph.js";
import { useEmojisense } from "../src/hooks.js";
import { en, packFetch, tr } from "./fixture.js";

const API = "https://api.test";

afterEach(() => vi.unstubAllGlobals());

const images = () => [...document.querySelectorAll<HTMLImageElement>("img[data-emojisense-image]")];

describe("EmojiGlyph", () => {
  it("draws a hosted set as a lazy image with the emoji as alt text", () => {
    render(<EmojiGlyph emoji="👍🏽" emojiSet="twemoji" endpoint={`${API}/`} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe(`${API}/v1/sets/twemoji/1F44D-1F3FD.svg`);
    expect(img.getAttribute("alt")).toBe("👍🏽");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it.each([
    ["native", API],
    [undefined, API],
    ["noto", undefined],
  ] as const)("draws text for set %s and endpoint %s", (emojiSet, endpoint) => {
    const { container } = render(<EmojiGlyph emoji="🦖" emojiSet={emojiSet} endpoint={endpoint} />);
    expect(container.innerHTML).toBe("🦖");
  });

  it("falls back to the text when the image fails", () => {
    const { container } = render(<EmojiGlyph emoji="🇺🇸" emojiSet="fluent" endpoint={API} />);
    fireEvent.error(screen.getByRole("img"));
    expect(container.innerHTML).toBe("🇺🇸");
  });
});

describe("useEmojisense emojiSet", () => {
  it("passes the set and the endpoint to the pickers", async () => {
    vi.stubGlobal("fetch", packFetch());
    const { result } = renderHook(() =>
      useEmojisense({ packBaseUrl: "https://x.test", endpoint: API, emojiSet: "noto", extended: false }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ emojiSet: "noto", endpoint: API });
  });

  it("defaults to native", () => {
    vi.stubGlobal("fetch", packFetch());
    const { result } = renderHook(() => useEmojisense({ packBaseUrl: "https://x.test" }));
    expect(result.current.emojiSet).toBe("native");
  });
});

const sense = (emojiSet: EmojiSet) => ({
  engine: createEngine([en, tr]),
  semantic: undefined,
  packs: [en, tr],
  locale: "en",
  status: "ready" as const,
  extended: false,
  emojiSet,
  endpoint: API,
});

describe("EmojisensePicker with a hosted set", () => {
  it("draws the browse list and the results as images", async () => {
    render(<EmojisensePicker emojisense={sense("fluent")} onEmojiSelect={() => {}} />);
    const cell = await screen.findByRole("gridcell", { name: "thumbs up" });
    expect(cell.querySelector("img")?.getAttribute("src")).toBe(`${API}/v1/sets/fluent/1F44D.svg`);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "jurassic" } });
    const [option] = await screen.findAllByRole("option");
    expect(option?.querySelector("img")?.getAttribute("src")).toBe(`${API}/v1/sets/fluent/1F996.svg`);
    expect(option?.getAttribute("aria-label")).toBe("T-Rex");
  });

  it("keeps text for the native set", async () => {
    render(<EmojisensePicker emojisense={sense("native")} onEmojiSelect={() => {}} />);
    expect((await screen.findByRole("gridcell", { name: "thumbs up" })).textContent).toBe("👍");
    expect(images()).toEqual([]);
  });
});
