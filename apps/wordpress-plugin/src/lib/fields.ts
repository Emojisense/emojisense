import { attachEmojiAutocomplete, type TextareaAutocomplete } from "@emojisense/web-component/textarea";
import { createSuggestionSource, type SuggestionSource } from "emojisense/autocomplete";
import { openPickerPopover, type PickerPopover } from "../shared/popover.js";
import { MAX_OPTIONS, MIN_QUERY_LENGTH } from "./completer.js";
import type { ClientConfig } from "./config.js";
import { createEngineLoader, semanticProvider } from "./engine.js";
import { observeMatches } from "./observe.js";
import { insertAtCaret } from "./text.js";

type Field = HTMLTextAreaElement | HTMLInputElement;

/** `window.emojisenseConfig` of the field script (Emojisense_Fields::enqueue). */
export interface FieldsConfig extends ClientConfig {
  fields?: { selectors?: string[] };
}

export interface FieldsOptions {
  /** Packs for the colon search; tests pass their own. */
  fetch?: typeof fetch;
  whenIdle?: (task: () => void) => void;
}

/**
 * An "Emoji" button with the picker after every field that matches the configured selectors,
 * and colon search while typing in it. Fields that appear later get them too. The packs load
 * the first time one of the fields gets the focus. Returns a function that stops watching.
 */
export function setUpFields(doc: Document, config: FieldsConfig, options: FieldsOptions = {}): () => void {
  const selectors = config.fields?.selectors ?? [];
  if (selectors.length === 0) return () => {};
  const strings = config.strings ?? {};
  const loader = createEngineLoader({
    config,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.whenIdle ? { whenIdle: options.whenIdle } : {}),
  });
  const autocompletes = new Map<Field, TextareaAutocomplete>();
  let source: SuggestionSource | undefined;

  loader.subscribe((engine) => {
    source?.dispose();
    source = createSuggestionSource({
      engine,
      locale: config.locale,
      semantic: semanticProvider(config, engine.packVersion, options.fetch),
      limit: MAX_OPTIONS,
      debounceMs: 250,
      minQueryLength: MIN_QUERY_LENGTH,
      includeCustom: false,
      region: "device",
    });
    // Someone may have typed ":pizza" while the packs loaded.
    const active = doc.activeElement;
    for (const [field, autocomplete] of autocompletes) if (field === active) autocomplete.refresh();
  });
  const load = () => {
    loader.load().catch(() => {
      // The packs did not load: the button's picker still works, the colon search stays off.
    });
  };

  return observeMatches<HTMLElement>(doc, selectors.join(","), (element) => {
    if (!isTextField(element) || autocompletes.has(element)) return;
    element.addEventListener("focus", load, { once: true });
    if (doc.activeElement === element) load();
    autocompletes.set(
      element,
      attachEmojiAutocomplete(element, {
        source: () => source,
        ariaLabel: strings.menu ?? "Emoji suggestions",
      }),
    );
    addPickerButton(element, config, load);
  });
}

function isTextField(element: Element): element is Field {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  if (element instanceof view.HTMLTextAreaElement) return true;
  return element instanceof view.HTMLInputElement && ["text", "search", ""].includes(element.type);
}

/**
 * The "Emoji" button after the field; the picker inserts at the remembered caret. `warm` starts the
 * pack download when the pointer moves onto or focus enters the button.
 */
function addPickerButton(field: Field, config: FieldsConfig, warm: () => void) {
  const doc = field.ownerDocument;
  const strings = config.strings ?? {};
  const tools = doc.createElement("p");
  tools.className = "emojisense-field-tools";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "emojisense-field-button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-haspopup", "dialog");
  const icon = doc.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "🙂";
  button.append(icon, ` ${strings.button ?? "Emoji"}`);
  tools.append(button);
  field.insertAdjacentElement("afterend", tools);
  // The picker shares the page's pack download with the colon search.
  button.addEventListener("pointerenter", warm, { once: true });
  button.addEventListener("focus", warm, { once: true });

  let popover: PickerPopover | undefined;
  let caret = { start: field.value.length, end: field.value.length };
  // Remember the caret: the field loses it when the picker takes focus.
  const remember = () => {
    caret = {
      start: field.selectionStart ?? field.value.length,
      end: field.selectionEnd ?? field.value.length,
    };
  };
  field.addEventListener("keyup", remember);
  field.addEventListener("pointerup", remember);
  field.addEventListener("blur", remember);

  button.addEventListener("click", () => {
    if (popover) {
      popover.close(true);
      return;
    }
    button.setAttribute("aria-expanded", "true");
    popover = openPickerPopover({
      anchor: button,
      config,
      label: strings.dialog ?? "Emoji picker",
      placeholder: strings.placeholder ?? "Search emoji…",
      onSelect(emoji) {
        caret = insertAtCaret(field, emoji, caret);
      },
      onClose(restoreFocus) {
        popover = undefined;
        button.setAttribute("aria-expanded", "false");
        if (restoreFocus) button.focus();
      },
    });
  });
}
