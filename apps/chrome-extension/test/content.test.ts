import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../src/content/clipboard";
import { DOCS_EVENT_FRAME_CLASS, isDocsEventFrame, pasteIntoDocs } from "../src/content/docs";
import { placeOverlay } from "../src/content/position";
import { probeFrame } from "../src/content/probe";
import { captureTarget, deepActiveElement } from "../src/content/target";
import { removeExecCommand, stubExecCommand } from "./fixture";

afterEach(() => {
  document.body.replaceChildren();
  removeExecCommand(document);
  vi.restoreAllMocks();
});

function focus<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  element.focus();
  return element;
}

function input(type: string): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  return element;
}

describe("captureTarget", () => {
  it("recognizes text inputs and textareas, with the caret", () => {
    const field = focus(document.createElement("textarea"));
    field.value = "hello";
    field.setSelectionRange(2, 4);
    expect(captureTarget(document)).toMatchObject({ kind: "text-control", element: field, start: 2, end: 4 });
    for (const type of ["text", "search", "url", "tel", "email"]) {
      focus(input(type));
      expect(captureTarget(document).kind).toBe("text-control");
    }
  });

  it("never treats password, number or disabled fields as text targets", () => {
    focus(input("password"));
    expect(captureTarget(document).kind).toBe("none");
    focus(input("number"));
    expect(captureTarget(document).kind).toBe("none");
    const field = focus(input("text"));
    field.readOnly = true;
    expect(captureTarget(document).kind).toBe("none");
  });

  it("recognizes contenteditable editors and saves the caret range", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "draft";
    focus(editor);
    document.getSelection()?.collapse(editor.firstChild as Text, 3);
    const target = captureTarget(document);
    expect(target.kind).toBe("contenteditable");
    expect(target.kind === "contenteditable" && target.range?.startOffset).toBe(3);
  });

  it("follows focus into open shadow roots (web components)", () => {
    const host = document.createElement("x-editor");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const field = document.createElement("textarea");
    shadow.append(field);
    field.focus();
    expect(deepActiveElement(document)).toBe(field);
    expect(captureTarget(document)).toMatchObject({ kind: "text-control", element: field });
  });

  it("recognizes the Google Docs keystroke frame", () => {
    const frame = document.createElement("iframe");
    frame.className = DOCS_EVENT_FRAME_CLASS;
    document.body.append(frame);
    vi.spyOn(document, "activeElement", "get").mockReturnValue(frame);
    expect(captureTarget(document)).toEqual({ kind: "google-docs", frame });
    expect(isDocsEventFrame(frame)).toBe(true);
    expect(isDocsEventFrame(document.createElement("iframe"))).toBe(false);
  });

  it("reports nothing editable on a plain page", () => {
    expect(captureTarget(document)).toEqual({ kind: "none", element: null });
  });
});

describe("probeFrame", () => {
  it("describes the top frame for the service worker", () => {
    focus(document.createElement("textarea"));
    expect(probeFrame(window, document)).toEqual({
      top: true,
      focused: document.hasFocus(),
      activeIsFrame: false,
      editable: true,
      docs: false,
      docsEventFrame: false,
    });
  });
});

describe("pasteIntoDocs (experimental)", () => {
  function docsFrame() {
    const frame = document.createElement("iframe");
    frame.className = DOCS_EVENT_FRAME_CLASS;
    document.body.append(frame);
    const target = (frame.contentDocument as Document).createElement("div");
    target.setAttribute("contenteditable", "true");
    frame.contentDocument?.body.append(target);
    return { frame, target };
  }

  it("reports success only when Docs' handler took the paste", () => {
    const { frame, target } = docsFrame();
    expect(pasteIntoDocs(frame, "🚀")).toBe(false);
    target.addEventListener("paste", (event) => event.preventDefault());
    expect(pasteIntoDocs(frame, "🚀")).toBe(true);
  });
});

describe("copyText", () => {
  it("fills the copy event itself and keeps page copy listeners out", async () => {
    let copied = "";
    const pageListener = vi.fn();
    document.addEventListener("copy", pageListener);
    stubExecCommand(document, (command) => {
      if (command !== "copy") return false;
      const clipboardData = new DataTransfer();
      document.body.dispatchEvent(
        new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }),
      );
      copied = clipboardData.getData("text/plain");
      return true;
    });

    await expect(copyText(document, "🦖")).resolves.toBe(true);
    expect(copied).toBe("🦖");
    expect(pageListener).not.toHaveBeenCalled();
    document.removeEventListener("copy", pageListener);
  });

  it("falls back to the async Clipboard API", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
    await expect(copyText(document, "🎉")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("🎉");
  });

  it("reports failure when the frame blocks the clipboard", async () => {
    const writeText = vi.fn(async () => Promise.reject(new DOMException("blocked", "NotAllowedError")));
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
    await expect(copyText(document, "🎉")).resolves.toBe(false);
  });
});

describe("placeOverlay", () => {
  const size = { width: 300, height: 200 };
  const viewport = { width: 1000, height: 800 };

  it("sits under the anchor when there is room", () => {
    expect(placeOverlay({ top: 100, bottom: 120, left: 50, right: 51 }, size, viewport)).toEqual({
      top: 126,
      left: 50,
      side: "below",
    });
  });

  it("flips above near the bottom of the viewport", () => {
    expect(placeOverlay({ top: 700, bottom: 720, left: 50, right: 51 }, size, viewport)).toEqual({
      top: 494,
      left: 50,
      side: "above",
    });
  });

  it("stays inside the viewport horizontally and vertically", () => {
    const placement = placeOverlay({ top: 90, bottom: 790, left: 950, right: 951 }, size, viewport);
    expect(placement.left).toBe(1000 - 300 - 8);
    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.top + size.height).toBeLessThanOrEqual(800 - 8);
  });

  it("keeps an earlier side while it fits, so the panel does not jump as results change", () => {
    const anchor = { top: 500, bottom: 520, left: 50, right: 51 };
    expect(placeOverlay(anchor, { width: 300, height: 100 }, viewport).side).toBe("below");
    expect(placeOverlay(anchor, { width: 300, height: 100 }, viewport, "above").side).toBe("above");
    expect(placeOverlay({ ...anchor, top: 60, bottom: 80 }, size, viewport, "above").side).toBe("below");
  });

  it("centres near the top when there is no caret to follow", () => {
    expect(placeOverlay(null, size, viewport)).toEqual({ top: 144, left: 350, side: "below" });
  });
});
