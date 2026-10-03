import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../../src/lib/config.js";
import { type FieldsConfig, setUpFields } from "../../src/lib/fields.js";
import { observeMatches } from "../../src/lib/observe.js";
import { packFetch } from "./fixtures.js";

const config = (selectors: string[]): FieldsConfig => ({
  ...readConfig({ packUrl: "https://site.test/wp-content/plugins/emojisense/packs/0.1.0", locale: "en" }),
  fields: { selectors },
  strings: { button: "Emoji", menu: "Emoji suggestions" },
});

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

function type(field: HTMLTextAreaElement, text: string) {
  for (const char of text) {
    field.setRangeText(char, field.selectionStart, field.selectionEnd, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

const menuRows = () =>
  Array.from(document.querySelectorAll(".emojisense-textarea-menu [role=option]")).map((o) => o.textContent);

describe("setUpFields", () => {
  it("adds the emoji button and colon search to the configured fields only", () => {
    document.body.innerHTML = `
      <form><textarea name="comment"></textarea></form>
      <form><textarea id="bbp_reply_content"></textarea></form>
      <form><textarea name="other"></textarea></form>`;
    stop = setUpFields(document, config(['textarea[name="comment"]', "#bbp_reply_content"]), {
      fetch: packFetch().fetchImpl,
      whenIdle: () => {},
    });
    const buttons = document.querySelectorAll(".emojisense-field-button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toBe("🙂 Emoji");
    expect(document.querySelector('textarea[name="comment"]')?.getAttribute("aria-autocomplete")).toBe(
      "list",
    );
    expect(document.querySelector('textarea[name="other"]')?.hasAttribute("aria-autocomplete")).toBe(false);
  });

  it("loads the packs on focus and completes :pizza with 🍕", async () => {
    document.body.innerHTML = `<textarea id="bbp_topic_content"></textarea>`;
    const { fetchImpl, requests } = packFetch();
    stop = setUpFields(document, config(["#bbp_topic_content"]), { fetch: fetchImpl, whenIdle: () => {} });
    const field = document.querySelector<HTMLTextAreaElement>("#bbp_topic_content") as HTMLTextAreaElement;
    expect(requests).toEqual([]);
    field.focus();
    type(field, "Lunch? :pizza");
    await vi.waitFor(() => expect(menuRows()[0]).toBe("🍕pizza"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(field.value).toBe("Lunch? 🍕");
  });

  it("enhances fields that appear later (BuddyPress forms)", async () => {
    stop = setUpFields(document, config(["#whats-new", "textarea.ac-input"]), {
      fetch: packFetch().fetchImpl,
      whenIdle: () => {},
    });
    const form = document.createElement("form");
    form.innerHTML = `<textarea class="ac-input"></textarea>`;
    document.body.append(form);
    await vi.waitFor(() => expect(form.querySelector(".emojisense-field-button")).not.toBeNull());
  });

  it("does nothing without selectors, and skips non-text inputs", () => {
    document.body.innerHTML = `<input type="checkbox" id="x" /><textarea id="y"></textarea>`;
    stop = setUpFields(document, config([]));
    expect(document.querySelector(".emojisense-field-button")).toBeNull();
    stop = setUpFields(document, config(["#x"]));
    expect(document.querySelector(".emojisense-field-button")).toBeNull();
  });
});

describe("observeMatches", () => {
  it("visits each match once, now and later", async () => {
    document.body.innerHTML = `<div class="bar" id="a"></div>`;
    const seen: string[] = [];
    stop = observeMatches(document, ".bar", (element) => seen.push(element.id));
    const later = document.createElement("section");
    later.innerHTML = `<div class="bar" id="b"></div>`;
    document.body.append(later);
    document.body.append(later);
    await vi.waitFor(() => expect(seen).toEqual(["a", "b"]));
  });
});
