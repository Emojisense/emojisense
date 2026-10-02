/**
 * Display names for the pack `groups` (Emojibase group keys). Pickers in every framework need
 * the same strings, so they live next to the pack format instead of in each adapter.
 */
const GROUP_LABELS: Record<string, Record<string, string>> = {
  en: {
    "smileys-emotion": "Smileys & emotion",
    "people-body": "People & body",
    "animals-nature": "Animals & nature",
    "food-drink": "Food & drink",
    "travel-places": "Travel & places",
    activities: "Activities",
    objects: "Objects",
    symbols: "Symbols",
    flags: "Flags",
    custom: "Custom",
  },
  tr: {
    "smileys-emotion": "İfadeler ve duygular",
    "people-body": "İnsanlar ve vücut",
    "animals-nature": "Hayvanlar ve doğa",
    "food-drink": "Yiyecek ve içecek",
    "travel-places": "Seyahat ve yerler",
    activities: "Etkinlikler",
    objects: "Nesneler",
    symbols: "Semboller",
    flags: "Bayraklar",
    custom: "Özel",
  },
};

/** Label of a pack group in the UI locale, falling back to English, then to the group key. */
export function groupLabel(group: string, locale = "en"): string {
  return GROUP_LABELS[locale]?.[group] ?? GROUP_LABELS.en?.[group] ?? group;
}
