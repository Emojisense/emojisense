import type { Pack, PackRow } from "emojisense";
import { vi } from "vitest";
import type { PickerItem } from "../src/shared/messages";

const row = (
  emoji: string,
  hexcode: string,
  label: string,
  keyword: string,
  alias = "",
  skins: 0 | 1 = 0,
): PackRow => [emoji, hexcode, 0, 1, skins, label, "", keyword, alias, "", ""];

export const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["smileys-emotion"],
  emoji: [
    row("👍️", "1F44D", "thumbs up", "good|like", "lgtm", 1),
    row("❤️", "2764", "red heart", "love"),
    row("🦖", "1F996", "T-Rex", "dinosaur", "jurassic park"),
    row("🚀", "1F680", "rocket", "space", "ship it"),
  ],
};

export const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [
    row("👍️", "1F44D", "baş parmak yukarıda", "tamam", "", 1),
    row("❤️", "2764", "kırmızı kalp", "aşk"),
    row("🦖", "1F996", "T-Rex", "dinozor"),
    row("🚀", "1F680", "roket", "uzay"),
  ],
};

export const es: Pack = {
  ...en,
  locale: "es",
  emoji: [row("🚀", "1F680", "cohete", "espacio", "despegue")],
};

/** "saudade" exists only in Portuguese. */
export const pt: Pack = {
  ...en,
  locale: "pt",
  emoji: [row("❤️", "2764", "coração vermelho", "amor", "saudade")],
};

/** A stand-in for the bundled packs: the packs of these locales, core order (English first). */
export async function bundledPacks(locales: readonly string[]): Promise<Pack[]> {
  return [en, es, pt, tr].filter((pack) => locales.includes(pack.locale));
}

export function item(
  emoji: string,
  id: string,
  label: string,
  source: PickerItem["source"] = "alias",
): PickerItem {
  return { emoji, id, label, source };
}

export const ITEMS: PickerItem[] = [
  item("🚀", "1F680", "rocket"),
  item("🦖", "1F996", "T-Rex"),
  item("👍", "1F44D", "thumbs up"),
  item("❤️", "2764", "red heart", "semantic"),
  ...Array.from({ length: 8 }, (_, i) => item("⭐", `2B5${i}`, `star ${i}`)),
];

type ExecCommand = (command: string, showUi?: boolean, value?: string) => boolean;

/** happy-dom has no execCommand; tests install a stand-in for Chrome's native editing. */
export function stubExecCommand(doc: Document, implementation: ExecCommand) {
  const mock = vi.fn(implementation);
  Object.defineProperty(doc, "execCommand", { value: mock, configurable: true, writable: true });
  return mock;
}

export function removeExecCommand(doc: Document): void {
  Reflect.deleteProperty(doc, "execCommand");
}

/** Let pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: keyName,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}
