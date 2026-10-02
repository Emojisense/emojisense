import { fireEvent, render, screen } from "@testing-library/react";
import { createEngine } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { createEmojisenseResolver, EmojisensePicker } from "../src/frimousse.js";
import { en, tr } from "./fixture.js";

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
