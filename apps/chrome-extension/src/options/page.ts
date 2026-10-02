import { SKIN_TONES, type SkinTone } from "emojisense";
import {
  checkEndpoint,
  checkKey,
  type LocalePreference,
  type Settings,
  semanticConfig,
} from "../shared/settings";
import { pasteShortcut } from "../shared/strings";

export interface OptionsDeps {
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  /** The current shortcut as Chrome prints it, or "" when none is set. */
  shortcut(): Promise<string>;
  openShortcutSettings(): void;
  /** This extension's origin, for the key's allowed-origins list. */
  origin: string;
  platform: string;
  fetch: typeof fetch;
}

const SKIN_LABELS: Record<SkinTone, string> = {
  none: "Default",
  light: "Light",
  "medium-light": "Medium-light",
  medium: "Medium",
  "medium-dark": "Medium-dark",
  dark: "Dark",
};
const SKIN_SWATCH: Record<SkinTone, string> = {
  none: "👍",
  light: "👍🏻",
  "medium-light": "👍🏼",
  medium: "👍🏽",
  "medium-dark": "👍🏾",
  dark: "👍🏿",
};

/** How long the "Saved" notice stays on screen. */
export const SAVED_NOTICE_MS = 2500;

export async function initOptions(doc: Document, deps: OptionsDeps): Promise<void> {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const locale = $<HTMLSelectElement>("locale");
  const tones = $<HTMLDivElement>("skin-tones");
  const semanticEnabled = $<HTMLInputElement>("semantic-enabled");
  const endpoint = $<HTMLInputElement>("endpoint");
  const key = $<HTMLInputElement>("key");
  const docsDirect = $<HTMLInputElement>("docs-direct");
  const saved = $<HTMLParagraphElement>("saved");
  const testButton = $<HTMLButtonElement>("test-connection");
  const testResult = $<HTMLSpanElement>("test-result");
  const view: Window = doc.defaultView ?? window;

  let current = await deps.loadSettings();

  $("origin").textContent = deps.origin;
  for (const node of doc.querySelectorAll(".paste-key")) node.textContent = pasteShortcut(deps.platform);
  showShortcut($("shortcut"), await deps.shortcut().catch(() => ""));
  $("change-shortcut").addEventListener("click", () => deps.openShortcutSettings());

  // The address and key stay visible while search by meaning is off: they can be filled in and
  // tested first, and nothing is sent until the switch is on.
  locale.value = current.locale;
  for (const tone of SKIN_TONES) tones.append(skinOption(doc, tone, tone === current.skinTone));
  semanticEnabled.checked = current.semantic.enabled;
  endpoint.value = current.semantic.endpoint;
  key.value = current.semantic.key;
  docsDirect.checked = current.docsDirectInsert;

  let savedTimer: number | undefined;
  async function save(next: Settings): Promise<void> {
    current = next;
    await deps.saveSettings(next);
    const offline = next.semantic.enabled && !semanticConfig(next);
    saved.textContent = offline
      ? "Saved. Search by meaning starts when the address and key are valid."
      : "Saved ✓";
    view.clearTimeout(savedTimer);
    savedTimer = view.setTimeout(() => {
      saved.textContent = "";
    }, SAVED_NOTICE_MS);
  }

  function showError(input: HTMLInputElement, message: string | undefined): void {
    const error = $<HTMLParagraphElement>(`${input.id}-error`);
    error.hidden = message === undefined;
    error.textContent = message ?? "";
    if (message === undefined) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  }

  locale.addEventListener(
    "change",
    () => void save({ ...current, locale: locale.value as LocalePreference }),
  );
  tones.addEventListener("change", (event) => {
    const value = (event.target as HTMLInputElement).value as SkinTone;
    if (SKIN_TONES.includes(value)) void save({ ...current, skinTone: value });
  });
  semanticEnabled.addEventListener("change", () => {
    if (semanticEnabled.checked && endpoint.value.trim() === "") endpoint.focus();
    void save({ ...current, semantic: { ...current.semantic, enabled: semanticEnabled.checked } });
  });
  endpoint.addEventListener("change", () => {
    const check = checkEndpoint(endpoint.value);
    showError(endpoint, check.ok ? undefined : check.error);
    if (!check.ok) return;
    endpoint.value = check.value;
    void save({ ...current, semantic: { ...current.semantic, endpoint: check.value } });
  });
  key.addEventListener("change", () => {
    const check = checkKey(key.value);
    showError(key, check.ok ? undefined : check.error);
    if (!check.ok) return;
    key.value = check.value;
    void save({ ...current, semantic: { ...current.semantic, key: check.value } });
  });
  docsDirect.addEventListener(
    "change",
    () => void save({ ...current, docsDirectInsert: docsDirect.checked }),
  );

  testButton.addEventListener("click", async () => {
    const config = semanticConfig({ ...current, semantic: { ...current.semantic, enabled: true } });
    testResult.hidden = false;
    if (!config) {
      testResult.dataset.state = "error";
      testResult.textContent = "Enter a valid address and key first.";
      return;
    }
    testButton.disabled = true;
    testResult.dataset.state = "pending";
    testResult.textContent = "Testing…";
    const outcome = await testConnection(config, deps.fetch);
    testResult.dataset.state = outcome.ok ? "ok" : "error";
    testResult.textContent = outcome.message;
    testButton.disabled = false;
  });
}

/** "Ctrl+Shift+Space" → Ctrl, Shift, Space; "⇧⌘Space" (macOS) → ⇧, ⌘, Space. */
export function shortcutKeys(shortcut: string): string[] {
  if (shortcut.includes("+")) return shortcut.split("+").filter((key) => key !== "");
  return shortcut.match(/[⌃⌥⇧⌘]|[^⌃⌥⇧⌘]+/g) ?? [];
}

function showShortcut(container: HTMLElement, shortcut: string): void {
  const keys = shortcutKeys(shortcut);
  if (keys.length === 0) {
    container.textContent = "Not set";
    return;
  }
  container.replaceChildren(
    ...keys.map((name) => {
      const key = container.ownerDocument.createElement("kbd");
      key.textContent = name;
      return key;
    }),
  );
}

function skinOption(doc: Document, tone: SkinTone, checked: boolean): HTMLLabelElement {
  const label = doc.createElement("label");
  label.className = "tone";
  const input = doc.createElement("input");
  input.type = "radio";
  input.name = "skin-tone";
  input.value = tone;
  input.checked = checked;
  const swatch = doc.createElement("span");
  swatch.className = "swatch";
  swatch.setAttribute("aria-hidden", "true");
  swatch.textContent = SKIN_SWATCH[tone];
  label.append(input, swatch, SKIN_LABELS[tone]);
  return label;
}

export interface ConnectionOutcome {
  ok: boolean;
  message: string;
}

/**
 * One real search (it counts as one semantic call), because only a search checks the key and the
 * allowed origins; /v1/health checks neither.
 */
export async function testConnection(
  config: { endpoint: string; key: string },
  doFetch: typeof fetch,
): Promise<ConnectionOutcome> {
  const params = new URLSearchParams({ q: "rocket", mode: "semantic", limit: "1" });
  if (config.key) params.set("key", config.key);
  let response: Response;
  try {
    response = await doFetch(`${config.endpoint}/v1/search?${params}`);
  } catch {
    return {
      ok: false,
      message: "Could not reach this address. Check it, and check the API sends CORS headers.",
    };
  }
  return describeResponse(response.status, response.ok ? await response.json().catch(() => ({})) : {});
}

export function describeResponse(
  status: number,
  body: { overLimit?: boolean; degraded?: boolean },
): ConnectionOutcome {
  if (status === 200) {
    if (body.overLimit) return { ok: true, message: "Connected, but the key is over its monthly limit." };
    if (body.degraded) return { ok: true, message: "Connected. The meaning model is down right now." };
    return { ok: true, message: "Connected ✓" };
  }
  const reasons: Record<number, string> = {
    401: "The key is unknown or revoked.",
    403: "This extension is not an allowed origin for the key.",
    429: "Too many requests. Try again in a minute.",
  };
  return { ok: false, message: reasons[status] ?? `The API answered with HTTP ${status}.` };
}
