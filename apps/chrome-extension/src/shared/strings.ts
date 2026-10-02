import type { UiLocale } from "./settings";

export interface Strings {
  dialogLabel: string;
  searchLabel: string;
  placeholder: string;
  resultsLabel: string;
  /** Query-state pill texts. */
  loading: string;
  recent: string;
  resultCount: (count: number) => string;
  searchingMeaning: string;
  noMatch: string;
  /** Under the empty-state sticker. */
  noMatchHelp: string;
  unavailable: string;
  semanticMark: string;
  /** Footer key hints: "↵ insert · esc close" / "↵ copy · then ⌘V". */
  keyInsert: string;
  keyCopy: string;
  keyClose: string;
  keyThen: string;
  /** Sticker-card messages after a pick. */
  copied: (pasteKey: string) => string;
  insertedDocs: (pasteKey: string) => string;
  copyFailed: string;
}

const en: Strings = {
  dialogLabel: "Emoji picker",
  searchLabel: "Search emoji",
  placeholder: "A word, a feeling, a film…",
  resultsLabel: "Emoji",
  loading: "Loading emoji…",
  recent: "Recently used",
  resultCount: (count) => (count === 1 ? "1 result" : `${count} results`),
  searchingMeaning: "searching by meaning…",
  noMatch: "No match",
  noMatchHelp: "Nothing here yet. Try other words, or describe it.",
  unavailable: "Connection lost. Press the shortcut again.",
  semanticMark: "semantic match",
  keyInsert: "insert",
  keyCopy: "copy",
  keyClose: "close",
  keyThen: "then",
  copied: (pasteKey) => `Copied — press ${pasteKey} to paste`,
  insertedDocs: (pasteKey) => `Inserted — not there? Press ${pasteKey}`,
  copyFailed: "Could not copy. Select the emoji and copy it.",
};

const tr: Strings = {
  dialogLabel: "Emoji seçici",
  searchLabel: "Emoji ara",
  placeholder: "Bir kelime, bir his, bir film…",
  resultsLabel: "Emoji",
  loading: "Emojiler yükleniyor…",
  recent: "Son kullanılanlar",
  resultCount: (count) => `${count} sonuç`,
  searchingMeaning: "anlamına göre aranıyor…",
  noMatch: "Eşleşme yok",
  noMatchHelp: "Burada bir şey yok. Başka kelimeler deneyin ya da tarif edin.",
  unavailable: "Bağlantı koptu. Kısayola yeniden basın.",
  semanticMark: "anlam eşleşmesi",
  keyInsert: "ekle",
  keyCopy: "kopyala",
  keyClose: "kapat",
  keyThen: "sonra",
  copied: (pasteKey) => `Kopyalandı — yapıştırmak için ${pasteKey}`,
  insertedDocs: (pasteKey) => `Eklendi — görünmüyorsa ${pasteKey}`,
  copyFailed: "Kopyalanamadı. Emojiyi seçip kopyalayın.",
};

export const STRINGS: Record<UiLocale, Strings> = { en, tr };

/** "⌘V" on macOS, "Ctrl+V" elsewhere. */
export function pasteShortcut(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? "⌘V" : "Ctrl+V";
}
