import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLUMNS, createPicker, type Picker, type PickerOptions } from "../src/content/overlay";
import { STRINGS } from "../src/shared/strings";
import { ITEMS, key } from "./fixture";

let picker: Picker;
let callbacks: Pick<PickerOptions, "onQuery" | "onPick" | "onDismiss">;

function open(overrides: Partial<PickerOptions> = {}): Picker {
  callbacks = { onQuery: vi.fn(), onPick: vi.fn(), onDismiss: vi.fn() };
  picker = createPicker({
    document,
    mount: document.documentElement,
    strings: STRINGS.en,
    mode: "insert",
    pasteKey: "⌘V",
    ...callbacks,
    ...overrides,
  });
  picker.focus();
  return picker;
}

const $ = <T extends Element>(selector: string) => picker.root.querySelector(selector) as T;
const input = () => $<HTMLInputElement>("input");
const options = () => [...picker.root.querySelectorAll('[role="option"]')];
const activeLabel = () => picker.root.querySelector('[aria-selected="true"]')?.getAttribute("aria-label");

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  picker?.destroy();
});

describe("picker overlay: structure and isolation", () => {
  it("lives in a closed shadow root with its own stylesheet", () => {
    open();
    expect(picker.host.isConnected).toBe(true);
    expect(picker.host.shadowRoot).toBeNull();
    const adopted = picker.root.adoptedStyleSheets?.length ?? 0;
    const inline = picker.root.querySelectorAll("style").length;
    expect(adopted + inline).toBe(1);
    // Nothing is added to the page's own stylesheets.
    expect(document.querySelectorAll("style, link[rel=stylesheet]")).toHaveLength(0);
  });

  it("is an ARIA combobox that controls a listbox, and takes focus", () => {
    open();
    const combobox = input();
    expect(combobox.getAttribute("role")).toBe("combobox");
    expect(combobox.getAttribute("aria-expanded")).toBe("true");
    const list = picker.root.getElementById(combobox.getAttribute("aria-controls") ?? "");
    expect(list?.getAttribute("role")).toBe("listbox");
    expect(combobox.getAttribute("aria-label")).toBe("Search emoji");
    expect($('[role="dialog"]').getAttribute("aria-label")).toBe("Emoji picker");
    expect(picker.root.activeElement).toBe(combobox);
  });

  it("uses the Turkish strings when asked", () => {
    open({ strings: STRINGS.tr });
    expect(input().getAttribute("aria-label")).toBe("Emoji ara");
  });

  it("shows a loading pill until the first answer", () => {
    open();
    expect($(".pill").getAttribute("data-state")).toBe("loading");
  });
});

describe("picker overlay: results", () => {
  it("renders options and makes the first one active", () => {
    open();
    picker.setResults("", "recent", ITEMS);
    expect(options()).toHaveLength(ITEMS.length);
    expect(activeLabel()).toBe("rocket");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    expect($(".pill").getAttribute("data-state")).toBe("recent");
    expect($(".pill").textContent).toContain("Recently used");
    expect($(".preview").textContent).toContain("1F680");
  });

  it("marks semantic matches for screen readers and sighted users", () => {
    open();
    picker.setResults("", "fused", ITEMS);
    const semantic = options()[3];
    expect(semantic?.getAttribute("data-source")).toBe("semantic");
    expect(semantic?.getAttribute("aria-label")).toBe("red heart, semantic match");
  });

  it("drops answers for a query the user has already changed", () => {
    open();
    input().value = "rock";
    picker.setResults("roc", "alias", ITEMS);
    expect(options()).toHaveLength(0);
    picker.setResults("rock", "alias", ITEMS.slice(0, 1));
    expect(options()).toHaveLength(1);
  });

  it("announces the result count, the semantic wait and an empty result", () => {
    open();
    const live = $('[role="status"]');
    input().value = "ship";
    picker.setResults("ship", "loading", ITEMS.slice(0, 2));
    expect(live.textContent).toBe("2 results");
    expect($(".pill").getAttribute("data-state")).toBe("searching");

    input().value = "zzzz";
    picker.setResults("zzzz", "alias", []);
    expect(live.textContent).toBe("No match");
    expect($(".pill").getAttribute("data-state")).toBe("empty");
    expect($<HTMLElement>(".empty").hidden).toBe(false);
  });

  it("shows a reconnect hint when the search connection is gone", () => {
    open();
    picker.setUnavailable();
    expect($(".pill").getAttribute("data-state")).toBe("offline");
    expect($('[role="status"]').textContent).toContain("Press the shortcut again");
  });

  it("reports typing through onQuery", () => {
    open();
    input().value = "lgtm";
    input().dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    expect(callbacks.onQuery).toHaveBeenCalledWith("lgtm");
  });
});

describe("picker overlay: keyboard", () => {
  beforeEach(() => {
    open();
    picker.setResults("", "recent", ITEMS);
  });

  it("moves through the grid with the arrow keys", () => {
    key(input(), "ArrowRight");
    expect(activeLabel()).toBe("T-Rex");
    key(input(), "ArrowDown");
    expect(options()[1 + COLUMNS]?.getAttribute("aria-selected")).toBe("true");
    key(input(), "ArrowUp");
    key(input(), "ArrowLeft");
    expect(activeLabel()).toBe("rocket");
    key(input(), "ArrowLeft");
    expect(activeLabel()).toBe("rocket");
  });

  it("lands on the last tile when moving down onto a shorter last row", () => {
    key(input(), "ArrowRight");
    key(input(), "ArrowRight");
    key(input(), "ArrowRight");
    key(input(), "ArrowRight");
    key(input(), "ArrowDown");
    expect(activeLabel()).toBe("star 7");
    key(input(), "ArrowDown");
    expect(activeLabel()).toBe("star 7");
  });

  it("picks the active emoji with Enter, and asks for a copy with Shift+Enter", () => {
    key(input(), "ArrowRight");
    const enter = key(input(), "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(callbacks.onPick).toHaveBeenLastCalledWith(ITEMS[1], { copy: false });
    key(input(), "Enter", { shiftKey: true });
    expect(callbacks.onPick).toHaveBeenLastCalledWith(ITEMS[1], { copy: true });
  });

  it("closes with Escape and with Tab", () => {
    key(input(), "Escape");
    key(input(), "Tab");
    expect(callbacks.onDismiss).toHaveBeenCalledTimes(2);
    expect(callbacks.onDismiss).toHaveBeenCalledWith("escape");
  });

  it("leaves keys alone while an input method is composing", () => {
    key(input(), "Enter", { isComposing: true });
    expect(callbacks.onPick).not.toHaveBeenCalled();
  });

  it("keeps keystrokes away from page shortcut handlers", () => {
    const pageShortcut = vi.fn();
    document.addEventListener("keydown", pageShortcut);
    document.body.addEventListener("keydown", pageShortcut, true);
    key(input(), "s");
    key(input(), "Enter");
    expect(pageShortcut).not.toHaveBeenCalled();
    document.removeEventListener("keydown", pageShortcut);
    document.body.removeEventListener("keydown", pageShortcut, true);
  });

  it("does not take arrow keys when there is nothing to move through", () => {
    picker.setResults("", "recent", []);
    expect(key(input(), "ArrowLeft").defaultPrevented).toBe(false);
  });
});

describe("picker overlay: pointer", () => {
  beforeEach(() => {
    open();
    picker.setResults("", "recent", ITEMS);
  });

  it("picks a clicked tile without moving focus out of the search box", () => {
    const tile = options()[2] as HTMLElement;
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true });
    tile.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    tile.querySelector("span")?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(callbacks.onPick).toHaveBeenCalledWith(ITEMS[2], { copy: false });
  });

  it("keeps clicks inside the picker away from page handlers", () => {
    const pageClick = vi.fn();
    document.addEventListener("click", pageClick);
    options()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(pageClick).not.toHaveBeenCalled();
    document.removeEventListener("click", pageClick);
  });

  it("closes on a pointer press outside", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    expect(callbacks.onDismiss).toHaveBeenCalledWith("outside");
  });
});

describe("picker overlay: focus", () => {
  function pageField(): HTMLInputElement {
    const field = document.createElement("input");
    document.body.append(field);
    return field;
  }

  it("takes focus back when the page grabs it right after opening", async () => {
    const field = pageField();
    open();
    field.focus();
    await Promise.resolve();
    expect(callbacks.onDismiss).not.toHaveBeenCalled();
    expect(picker.root.activeElement).toBe(input());
  });

  it("closes when focus moves elsewhere later", () => {
    const now = performance.now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(now);
    const field = pageField();
    open();
    clock.mockReturnValue(now + 2000);
    field.focus();
    expect(callbacks.onDismiss).toHaveBeenCalledWith("outside");
  });
});

describe("picker overlay: modes and teardown", () => {
  it("explains copy mode in the footer", () => {
    open({ mode: "copy", pasteKey: "Ctrl+V" });
    expect($(".hint").textContent).toContain("copy");
    expect($(".hint").textContent).toContain("Ctrl+V");
  });

  it("removes the host and its window listeners on destroy", () => {
    open();
    const host = picker.host;
    picker.destroy();
    expect(host.isConnected).toBe(false);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    expect(callbacks.onDismiss).not.toHaveBeenCalled();
  });

  it("stays inside the viewport", () => {
    open();
    picker.position({ top: 760, bottom: 780, left: 1000, right: 1001 });
    const top = Number.parseFloat(picker.host.style.getPropertyValue("top"));
    const left = Number.parseFloat(picker.host.style.getPropertyValue("left"));
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThan(780);
    expect(left).toBeLessThanOrEqual(window.innerWidth);
  });
});
