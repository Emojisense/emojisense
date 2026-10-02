import { act, fireEvent, render, screen } from "@testing-library/react";
import { createEngine } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { createEmojisenseResolver, EmojisensePicker } from "../src/frimousse.js";
import { culture, en, tr } from "./fixture.js";

describe("createEmojisenseResolver", () => {
  it("maps packs to Frimousse data with localized labels and skin tones", async () => {
    const data = await createEmojisenseResolver([en, tr])("tr", {});
    expect(data.categories[0]?.label).toBe("İfadeler ve duygular");
    expect(data.emojis[0]).toMatchObject({ emoji: "👍", label: "baş parmak yukarıda", tags: ["tamam"] });
    expect(data.emojis[0]?.skins?.dark).toBe("👍🏿");
    expect(data.emojis[1]?.skins).toBeUndefined();
  });
});

describe("EmojisensePicker", () => {
  const emojisense = {
    engine: createEngine([en, tr]),
    semantic: undefined,
    packs: [en, tr],
    locale: "en",
    status: "ready" as const,
    extended: false,
  };

  it("shows ranked results as a listbox and selects with Enter", async () => {
    const onEmojiSelect = vi.fn();
    render(<EmojisensePicker emojisense={emojisense} onEmojiSelect={onEmojiSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "jurassic" } });
    const options = await screen.findAllByRole("option");
    expect(options[0]?.textContent).toBe("🦖");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEmojiSelect).toHaveBeenCalledWith({ emoji: "🦖", label: "T-Rex" });
  });

  it("browses the packs once they arrive after mount", async () => {
    const loading = { ...emojisense, engine: undefined, packs: [], status: "loading" as const };
    const view = render(<EmojisensePicker emojisense={loading} onEmojiSelect={() => {}} />);
    // Frimousse asks for data once per mount; the packs arrive later.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    view.rerender(<EmojisensePicker emojisense={emojisense} onEmojiSelect={() => {}} />);
    expect(await screen.findByRole("gridcell", { name: "thumbs up" })).toBeTruthy();
  });

  it("moves the active option with arrow keys", async () => {
    render(<EmojisensePicker emojisense={emojisense} onEmojiSelect={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "t" } });
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("EmojisensePicker culture layer", () => {
  const sense = {
    engine: createEngine([en, tr]).withCulture(culture),
    semantic: undefined,
    packs: [en, tr],
    locale: "en",
    status: "ready" as const,
    extended: false,
    culture,
  };

  it("has no relevant-now row by default", () => {
    render(<EmojisensePicker emojisense={sense} onEmojiSelect={() => {}} />);
    expect(screen.queryByText("Relevant now")).toBeNull();
  });

  it("shows featured emoji with their reason and selects them", () => {
    const onEmojiSelect = vi.fn();
    render(<EmojisensePicker emojisense={sense} onEmojiSelect={onEmojiSelect} showRelevantNow />);
    const row = screen.getByRole("group", { name: "Relevant now" });
    const buttons = [...row.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["👍", "🚀"]);
    expect(buttons[0]?.title).toBe("thumbs up · A season");
    fireEvent.click(buttons[0] as HTMLButtonElement);
    expect(onEmojiSelect).toHaveBeenCalledWith({ emoji: "👍", label: "thumbs up" });
  });

  it("marks culture results with their reason", async () => {
    render(<EmojisensePicker emojisense={sense} onEmojiSelect={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "jurassic park" } });
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["🦖", "🚀"]);
    expect(options[1]?.getAttribute("data-source")).toBe("culture");
    expect(options[1]?.title).toBe("rocket · The dinosaur film series");
  });
});
