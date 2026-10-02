import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Controller, createController, type SearchChannel } from "../src/content/controller";
import { DOCS_EVENT_FRAME_CLASS } from "../src/content/docs";
import type { ClientMessage, ServerMessage } from "../src/shared/messages";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";
import { flush, ITEMS, key, removeExecCommand, stubExecCommand } from "./fixture";

const attachShadow = HTMLElement.prototype.attachShadow;

beforeEach(() => {
  document.body.replaceChildren();
  // The picker uses a closed shadow root; open it so the test can look inside.
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (this: HTMLElement, init) {
    return attachShadow.call(this, { ...init, mode: "open" });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  removeExecCommand(document);
  for (const host of document.querySelectorAll("emojisense-ui")) host.remove();
});

function harness(settings: Partial<Settings> = {}, uiLanguage = "en-US") {
  const sent: ClientMessage[] = [];
  let deliver: (message: ServerMessage) => void = () => undefined;
  let drop: () => void = () => undefined;
  const openChannel = vi.fn(
    (onMessage: (message: ServerMessage) => void, onDisconnect: () => void): SearchChannel => {
      deliver = onMessage;
      drop = onDisconnect;
      return { send: (message) => sent.push(message), close: vi.fn() };
    },
  );
  const controller: Controller = createController({
    window,
    openChannel,
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
    uiLanguage,
    platform: "MacIntel",
  });
  return {
    controller,
    sent,
    openChannel,
    reply: (message: ServerMessage) => deliver(message),
    disconnect: () => drop(),
  };
}

function hosts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("emojisense-ui")];
}

function pickerRoot(): ShadowRoot {
  const root = hosts()[0]?.shadowRoot;
  if (!root) throw new Error("picker is not open");
  return root;
}

function searchBox(): HTMLInputElement {
  return pickerRoot().querySelector("input") as HTMLInputElement;
}

function type(text: string): void {
  searchBox().value = text;
  searchBox().dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
}

function focusedTextarea(value: string, caret: number): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  field.value = value;
  document.body.append(field);
  field.focus();
  field.setSelectionRange(caret, caret);
  return field;
}

/** execCommand("copy") stand-in: fires the copy event the way Chrome does, records the result. */
function stubCopy(): { text: () => string } {
  let copied = "";
  stubExecCommand(document, (command) => {
    if (command !== "copy") return false;
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", {
      clipboardData,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    (document.activeElement ?? document.body).dispatchEvent(event);
    copied = clipboardData.getData("text/plain");
    return true;
  });
  return { text: () => copied };
}

describe("controller: insert into the focused field", () => {
  it("opens, shows recent emoji, and inserts the pick at the caret", async () => {
    const field = focusedTextarea("ship it", 4);
    const { controller, sent, reply } = harness();

    await controller.toggle();
    expect(controller.isOpen()).toBe(true);
    expect(sent).toEqual([{ type: "query", query: "" }]);

    reply({ type: "results", query: "", status: "recent", items: ITEMS });
    type("rocket");
    expect(sent.at(-1)).toEqual({ type: "query", query: "rocket" });
    reply({ type: "results", query: "rocket", status: "alias", items: ITEMS.slice(0, 1) });
    key(searchBox(), "Enter");

    expect(field.value).toBe("ship🚀 it");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(4 + "🚀".length);
    expect(sent.at(-1)).toEqual({ type: "picked", id: "1F680" });
    expect(hosts()).toHaveLength(0);
    expect(controller.isOpen()).toBe(false);
  });

  it("returns focus and the caret to the field on Escape", async () => {
    const field = focusedTextarea("hello world", 5);
    field.setSelectionRange(0, 5);
    const { controller } = harness();
    await controller.toggle();
    expect(document.activeElement).not.toBe(field);

    key(searchBox(), "Escape");

    expect(hosts()).toHaveLength(0);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
  });

  it("closes when the shortcut is pressed again", async () => {
    const field = focusedTextarea("", 0);
    const { controller } = harness();
    await controller.toggle();
    await controller.toggle();
    expect(hosts()).toHaveLength(0);
    expect(document.activeElement).toBe(field);
  });

  it("copies instead when the field disappeared before the pick", async () => {
    const field = focusedTextarea("", 0);
    const clipboard = stubCopy();
    const { controller, reply } = harness();
    await controller.toggle();
    reply({ type: "results", query: "", status: "recent", items: ITEMS });
    field.remove();

    key(searchBox(), "Enter");
    await flush();

    expect(clipboard.text()).toBe("🚀");
    expect(hosts()[0]?.shadowRoot?.textContent).toContain("Copied — press ⌘V to paste");
  });

  it("mounts inside a dialog so the dialog's focus trap lets focus in", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    const field = document.createElement("input");
    dialog.append(field);
    field.focus();
    const { controller } = harness();

    await controller.toggle();

    expect(hosts()[0]?.parentElement).toBe(dialog);
  });

  it("follows the language setting, or Chrome's language on auto", async () => {
    focusedTextarea("", 0);
    const turkish = harness({ locale: "auto" }, "tr-TR");
    await turkish.controller.toggle();
    expect(searchBox().getAttribute("aria-label")).toBe("Emoji ara");
    await turkish.controller.toggle();

    const english = harness({ locale: "en" }, "tr-TR");
    await english.controller.toggle();
    expect(searchBox().getAttribute("aria-label")).toBe("Search emoji");
  });
});

describe("controller: search connection", () => {
  it("reconnects after the service worker went to sleep", async () => {
    focusedTextarea("", 0);
    const { controller, openChannel, disconnect, sent } = harness();
    await controller.toggle();
    expect(openChannel).toHaveBeenCalledTimes(1);

    disconnect();
    type("dino");

    expect(openChannel).toHaveBeenCalledTimes(2);
    expect(sent.at(-1)).toEqual({ type: "query", query: "dino" });
  });

  it("shows the reconnect hint when the extension context is gone", async () => {
    focusedTextarea("", 0);
    const { controller, openChannel } = harness();
    openChannel.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });
    await controller.toggle();
    expect(pickerRoot().querySelector(".pill")?.getAttribute("data-state")).toBe("offline");
  });
});

describe("controller: copy mode", () => {
  it("copies and shows a sticker card when nothing editable has focus", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const clipboard = stubCopy();
    const { controller, reply } = harness();
    await controller.toggle();
    expect(pickerRoot().querySelector(".hint")?.textContent).toContain("⌘V");

    reply({ type: "results", query: "", status: "recent", items: ITEMS });
    key(searchBox(), "ArrowRight");
    key(searchBox(), "Enter");
    await flush();

    expect(clipboard.text()).toBe("🦖");
    expect(document.activeElement).toBe(button);
    const card = hosts()[0]?.shadowRoot;
    expect(card?.querySelector(".sticker")?.textContent).toBe("🦖");
    expect(card?.querySelector('[role="status"]')?.textContent).toContain("press ⌘V");
  });

  it("copies with Shift+Enter even when the field accepts text", async () => {
    const field = focusedTextarea("keep", 4);
    const clipboard = stubCopy();
    const { controller, reply } = harness();
    await controller.toggle();
    reply({ type: "results", query: "", status: "recent", items: ITEMS });

    key(searchBox(), "Enter", { shiftKey: true });
    await flush();

    expect(clipboard.text()).toBe("🚀");
    expect(field.value).toBe("keep");
    expect(document.activeElement).toBe(field);
  });
});

describe("controller: Google Docs", () => {
  function docsPage() {
    const frame = document.createElement("iframe");
    frame.className = DOCS_EVENT_FRAME_CLASS;
    document.body.append(frame);
    const inner = frame.contentDocument as Document;
    const target = inner.createElement("div");
    target.setAttribute("contenteditable", "true");
    inner.body.append(target);
    // Docs keeps focus in the hidden iframe; the top document reports the iframe as active.
    vi.spyOn(document, "activeElement", "get").mockReturnValue(frame);
    const focusTarget = vi.spyOn(target, "focus");
    return { frame, target, focusTarget };
  }

  it("opens in copy mode, copies, and gives the keyboard back to Docs", async () => {
    const { target, focusTarget } = docsPage();
    const clipboard = stubCopy();
    const paste = vi.fn();
    target.addEventListener("paste", paste);
    const { controller, reply } = harness();

    await controller.toggle();
    reply({ type: "results", query: "", status: "recent", items: ITEMS });
    key(searchBox(), "Enter");
    await flush();

    expect(clipboard.text()).toBe("🚀");
    expect(focusTarget).toHaveBeenCalled();
    // Direct insertion is experimental and off by default.
    expect(paste).not.toHaveBeenCalled();
    expect(hosts()[0]?.shadowRoot?.textContent).toContain("Copied — press ⌘V to paste");
  });

  it("with the experiment on, hands the emoji to Docs as a paste event", async () => {
    const { target } = docsPage();
    stubCopy();
    let pasted = "";
    target.addEventListener("paste", (event) => {
      pasted = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
      event.preventDefault();
    });
    const { controller, reply } = harness({ docsDirectInsert: true });

    await controller.toggle();
    reply({ type: "results", query: "", status: "recent", items: ITEMS });
    key(searchBox(), "Enter");
    await flush();

    expect(pasted).toBe("🚀");
    expect(hosts()[0]?.shadowRoot?.textContent).toContain("Inserted — not there? Press ⌘V");
  });
});
