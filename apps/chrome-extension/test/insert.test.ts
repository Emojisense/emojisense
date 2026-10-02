import { afterEach, describe, expect, it } from "vitest";
import { insertText, restoreTarget } from "../src/content/insert";
import { captureTarget } from "../src/content/target";
import { removeExecCommand, stubExecCommand } from "./fixture";

afterEach(() => {
  document.body.replaceChildren();
  removeExecCommand(document);
});

function textarea(value: string, start: number, end = start): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  field.value = value;
  document.body.append(field);
  field.focus();
  field.setSelectionRange(start, end);
  return field;
}

/** Record beforeinput/input events in order, with their inputType and data. */
function recordInputEvents(target: EventTarget): string[] {
  const log: string[] = [];
  for (const type of ["beforeinput", "input"]) {
    target.addEventListener(type, (event) => {
      const input = event as InputEvent;
      log.push(`${type}:${input.inputType}:${input.data}`);
    });
  }
  return log;
}

/** Stand-in for Chrome's native insertText: edit at the selection and fire a trusted-style input. */
function nativeInsertText(): void {
  stubExecCommand(document, (command, _ui, value) => {
    const active = document.activeElement as HTMLTextAreaElement | null;
    if (command !== "insertText" || !active || !("setRangeText" in active)) return false;
    active.setRangeText(value ?? "", active.selectionStart ?? 0, active.selectionEnd ?? 0, "end");
    active.dispatchEvent(
      new InputEvent("input", { inputType: "insertText", data: value ?? "", bubbles: true }),
    );
    return true;
  });
}

describe("insertText into <textarea> and <input>", () => {
  it("inserts at the saved caret and puts the caret after the emoji", () => {
    const field = textarea("ship it", 4);
    const target = captureTarget(document);
    field.blur();
    field.setSelectionRange(0, 0);

    const result = insertText(target, "🚀");

    expect(result).toEqual({ ok: true, strategy: "setRangeText" });
    expect(field.value).toBe("ship🚀 it");
    expect(field.selectionStart).toBe(4 + "🚀".length);
    expect(field.selectionEnd).toBe(4 + "🚀".length);
    expect(document.activeElement).toBe(field);
  });

  it("replaces the selected text", () => {
    const field = document.createElement("input");
    field.value = "good job team";
    document.body.append(field);
    field.focus();
    field.setSelectionRange(5, 8);

    insertText(captureTarget(document), "👏");

    expect(field.value).toBe("good 👏 team");
  });

  it("fires beforeinput, then input, like typing (React and Vue listen to input)", () => {
    const field = textarea("", 0);
    const log = recordInputEvents(field);
    const seen: string[] = [];
    field.addEventListener("input", () => seen.push(field.value));

    insertText(captureTarget(document), "🦖");

    expect(log).toEqual(["beforeinput:insertText:🦖", "input:insertText:🦖"]);
    expect(seen).toEqual(["🦖"]);
  });

  it("prefers native editing (undo stack, trusted events) when the browser supports it", () => {
    const field = textarea("lgtm ", 5);
    const log = recordInputEvents(field);
    nativeInsertText();

    const result = insertText(captureTarget(document), "✅");

    expect(result).toEqual({ ok: true, strategy: "execCommand" });
    expect(field.value).toBe("lgtm ✅");
    // Exactly one input event: ours is not added on top of the native one.
    expect(log).toEqual(["beforeinput:insertText:✅", "input:insertText:✅"]);
  });

  it("falls back to setRangeText when execCommand reports success but changes nothing", () => {
    const field = textarea("a", 1);
    stubExecCommand(document, () => true);

    expect(insertText(captureTarget(document), "🎉")).toEqual({ ok: true, strategy: "setRangeText" });
    expect(field.value).toBe("a🎉");
  });

  it("leaves the edit to a framework that cancels beforeinput", () => {
    const field = textarea("x", 1);
    field.addEventListener("beforeinput", (event) => {
      event.preventDefault();
      field.value += (event as InputEvent).data ?? "";
    });

    expect(insertText(captureTarget(document), "🔥")).toEqual({ ok: true, strategy: "beforeinput" });
    expect(field.value).toBe("x🔥");
  });

  it("appends for input types without a selection API (email)", () => {
    const field = document.createElement("input");
    field.type = "email";
    field.value = "hi@example.com";
    document.body.append(field);
    field.focus();
    const target = captureTarget(document);
    expect(target).toMatchObject({ kind: "text-control", start: null, end: null });

    expect(insertText(target, "👋")).toEqual({ ok: true, strategy: "append" });
    expect(field.value).toBe("hi@example.com👋");
  });

  it("refuses read-only and removed fields", () => {
    const field = textarea("read me", 0);
    const target = captureTarget(document);
    field.readOnly = true;
    expect(insertText(target, "📖")).toEqual({ ok: false, reason: "read-only" });

    field.remove();
    expect(insertText(target, "📖")).toEqual({ ok: false, reason: "detached" });
  });
});

describe("insertText into contenteditable", () => {
  function editor(html: string): HTMLDivElement {
    const element = document.createElement("div");
    element.contentEditable = "true";
    element.innerHTML = html;
    document.body.append(element);
    element.focus();
    return element;
  }

  it("inserts at the saved caret and leaves the caret after the emoji", () => {
    const element = editor("<p>ship it</p>");
    const text = element.querySelector("p")?.firstChild as Text;
    document.getSelection()?.collapse(text, 4);
    const target = captureTarget(document);
    expect(target.kind).toBe("contenteditable");
    // Focus moves to the picker; the page selection is lost meanwhile.
    document.getSelection()?.removeAllRanges();

    const result = insertText(target, "🚀");

    expect(result).toEqual({ ok: true, strategy: "range" });
    expect(element.textContent).toBe("ship🚀 it");
    const selection = document.getSelection();
    expect(selection?.isCollapsed).toBe(true);
    const beforeCaret = selection?.anchorNode?.childNodes[(selection?.anchorOffset ?? 0) - 1];
    expect(beforeCaret?.textContent).toBe("🚀");
  });

  it("replaces a selected word", () => {
    const element = editor("hello world");
    const text = element.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 11);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    insertText(captureTarget(document), "🌍");

    expect(element.textContent).toBe("hello 🌍");
  });

  it("announces beforeinput with target ranges and input to editors", () => {
    const element = editor("hi");
    document.getSelection()?.collapse(element.firstChild as Text, 2);
    const log = recordInputEvents(element);
    let ranges = -1;
    element.addEventListener("beforeinput", (event) => {
      ranges = (event as InputEvent).getTargetRanges?.().length ?? 0;
    });

    insertText(captureTarget(document), "👋");

    expect(log).toEqual(["beforeinput:insertText:👋", "input:insertText:👋"]);
    expect(ranges).toBeGreaterThanOrEqual(0);
  });

  it("lets a model-first editor (Lexical, Slate) insert on beforeinput", () => {
    const element = editor("hi");
    document.getSelection()?.collapse(element.firstChild as Text, 2);
    element.addEventListener("beforeinput", (event) => event.preventDefault());

    expect(insertText(captureTarget(document), "✨")).toEqual({ ok: true, strategy: "beforeinput" });
    expect(element.textContent).toBe("hi");
  });

  it("uses native editing when available", () => {
    const element = editor("ok");
    document.getSelection()?.collapse(element.firstChild as Text, 2);
    stubExecCommand(document, (_command, _ui, value) => {
      element.append(value ?? "");
      return true;
    });

    expect(insertText(captureTarget(document), "👌")).toEqual({ ok: true, strategy: "execCommand" });
    expect(element.textContent).toBe("ok👌");
  });

  it("inserts at the end when no caret was saved", () => {
    const element = editor("end");
    document.getSelection()?.removeAllRanges();
    const target = captureTarget(document);

    insertText(target, "🏁");

    expect(element.textContent).toBe("end🏁");
  });
});

describe("restoreTarget", () => {
  it("returns focus and the selection to a text field", () => {
    const field = textarea("pick an emoji", 5, 7);
    const target = captureTarget(document);
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();

    restoreTarget(target);

    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([5, 7]);
  });

  it("returns focus and the caret to a contenteditable", () => {
    const element = document.createElement("div");
    element.contentEditable = "true";
    element.textContent = "caret here";
    document.body.append(element);
    element.focus();
    document.getSelection()?.collapse(element.firstChild as Text, 5);
    const target = captureTarget(document);
    document.getSelection()?.removeAllRanges();

    restoreTarget(target);

    expect(document.getSelection()?.anchorOffset).toBe(5);
  });
});
