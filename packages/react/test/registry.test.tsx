import type { Emojisense } from "@emojisense/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createEngine } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "../registry/emoji-picker.js";
import { en, tr } from "./fixture.js";

describe("registry emoji-picker", () => {
  const ready = {
    engine: createEngine([en, tr]),
    semantic: undefined,
    packs: [en, tr],
    locale: "en",
    status: "ready" as const,
    extended: false,
  };

  const Picker = (props: { emojisense: Emojisense; onEmojiSelect?: () => void }) => (
    <EmojiPicker emojisense={props.emojisense} onEmojiSelect={props.onEmojiSelect}>
      <EmojiPickerSearch />
      <EmojiPickerContent />
      <EmojiPickerFooter />
    </EmojiPicker>
  );

  it("ranks with Emojisense and selects with the keyboard", async () => {
    const onEmojiSelect = vi.fn();
    render(<Picker emojisense={ready} onEmojiSelect={onEmojiSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "t" } });
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);

    fireEvent.change(input, { target: { value: "jurassic" } });
    expect((await screen.findAllByRole("option"))[0]?.textContent).toBe("🦖");
    expect(screen.getByText("T-Rex")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEmojiSelect).toHaveBeenCalledWith({ emoji: "🦖", label: "T-Rex" });
  });

  it("shows the empty state for a query without results", async () => {
    render(<Picker emojisense={ready} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz qqqq" } });
    expect(await screen.findByText("No emoji found.")).toBeTruthy();
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
  });

  it("renders while the packs load, then browses them", async () => {
    const loading = { ...ready, engine: undefined, packs: [], status: "loading" as const };
    const view = render(<Picker emojisense={loading as never} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    // Let Frimousse ask for data while the packs are still missing.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    view.rerender(<Picker emojisense={ready} />);
    expect(await screen.findByRole("gridcell", { name: "thumbs up" })).toBeTruthy();
  });

  it("draws the list, the results and the footer preview with a hosted emoji set", async () => {
    const API = "https://api.test";
    const onEmojiSelect = vi.fn();
    render(
      <Picker emojisense={{ ...ready, emojiSet: "twemoji", endpoint: API }} onEmojiSelect={onEmojiSelect} />,
    );
    const cell = await screen.findByRole("gridcell", { name: "rocket" });
    expect(cell.querySelector("img")?.getAttribute("src")).toBe(`${API}/v1/sets/twemoji/1F680.svg`);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "jurassic" } });
    await screen.findAllByRole("option");
    const sources = [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources.filter((src) => src === `${API}/v1/sets/twemoji/1F996.svg`)).toHaveLength(2); // option, footer
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEmojiSelect).toHaveBeenCalledWith({ emoji: "🦖", label: "T-Rex" });
  });
});
