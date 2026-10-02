import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../../src/lib/config.js";
import { insertAtCaret } from "../../src/lib/text.js";
import { isOnDarkBackground, openPickerPopover } from "../../src/shared/popover.js";

const config = readConfig({ packUrl: "https://site.test/packs/0.1.0", locale: "en" });

function anchor() {
  const button = document.createElement("button");
  button.textContent = "Emoji";
  document.body.append(button);
  return button;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

describe("openPickerPopover", () => {
  it("opens a named dialog with an offline picker", () => {
    const popover = openPickerPopover({
      anchor: anchor(),
      config,
      label: "Emoji picker",
      placeholder: "Search emoji…",
      onSelect: () => {},
    });
    expect(popover.element.getAttribute("role")).toBe("dialog");
    expect(popover.element.getAttribute("aria-label")).toBe("Emoji picker");
    const picker = popover.element.querySelector("emojisense-picker");
    expect(picker?.getAttribute("pack-url")).toBe("https://site.test/packs/0.1.0");
    expect(picker?.hasAttribute("endpoint")).toBe(false);
    popover.close();
    expect(document.querySelector(".emojisense-popover")).toBeNull();
  });

  it("passes the chosen emoji on and closes", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const popover = openPickerPopover({
      anchor: anchor(),
      config,
      label: "x",
      placeholder: "x",
      onSelect,
      onClose,
    });
    popover.element
      .querySelector("emojisense-picker")
      ?.dispatchEvent(new CustomEvent("emoji-select", { detail: { emoji: "🍕" }, bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("🍕");
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("closes on Escape (focus back) and on a click outside (focus stays)", () => {
    const onClose = vi.fn();
    const first = openPickerPopover({
      anchor: anchor(),
      config,
      label: "x",
      placeholder: "x",
      onSelect: () => {},
      onClose,
    });
    first.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenLastCalledWith(true);

    openPickerPopover({
      anchor: anchor(),
      config,
      label: "x",
      placeholder: "x",
      onSelect: () => {},
      onClose,
    });
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenLastCalledWith(false);
    expect(document.querySelector(".emojisense-popover")).toBeNull();
  });
});

describe("isOnDarkBackground", () => {
  it("reads the first opaque background behind the button", () => {
    const button = anchor();
    expect(isOnDarkBackground(button)).toBe(false);
    document.body.style.backgroundColor = "rgb(20, 20, 25)";
    expect(isOnDarkBackground(button)).toBe(true);
  });
});

describe("insertAtCaret", () => {
  it("replaces the selection, moves the caret and fires input", () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.value = "I love  so much";
    const onInput = vi.fn();
    field.addEventListener("input", onInput);
    const caret = insertAtCaret(field, "🍕", { start: 7, end: 7 });
    expect(field.value).toBe("I love 🍕 so much");
    expect(caret).toEqual({ start: 9, end: 9 });
    expect(onInput).toHaveBeenCalledTimes(1);
  });
});
