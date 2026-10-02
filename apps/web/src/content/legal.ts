import acceptableUse from "./legal/acceptable-use.md?raw";
import privacy from "./legal/privacy.md?raw";
import subprocessors from "./legal/subprocessors.md?raw";
import terms from "./legal/terms.md?raw";

export interface LegalPage {
  href: string;
  /** Short name for navigation ("Privacy"). */
  label: string;
  title: string;
  description: string;
  emoji: string;
  source: string;
}

/** The date of the current draft. Update it with every change to a legal text. */
export const LEGAL_UPDATED = "2026-10-02";

export const LEGAL_PAGES: LegalPage[] = [
  {
    href: "/legal/terms/",
    label: "Terms",
    title: "Terms of Service",
    description: "The rules for using the Emojisense website, API, dashboard and hosted features.",
    emoji: "📜",
    source: terms,
  },
  {
    href: "/legal/privacy/",
    label: "Privacy",
    title: "Privacy Policy",
    description: "What Emojisense stores, for how long, who processes it, and what it never stores.",
    emoji: "🔏",
    source: privacy,
  },
  {
    href: "/legal/acceptable-use/",
    label: "Acceptable use",
    title: "Acceptable Use Policy",
    description: "What you may and may not do with the Emojisense API, custom emoji and keys.",
    emoji: "🤝",
    source: acceptableUse,
  },
  {
    href: "/legal/subprocessors/",
    label: "Subprocessors",
    title: "Subprocessors",
    description: "The companies that process data for Emojisense, what they do and where.",
    emoji: "🏢",
    source: subprocessors,
  },
];

/** Wraps each "[Placeholder]" left in rendered HTML so it stands out until legal review fills it in. */
export function markPlaceholders(html: string): string {
  return html.replace(/\[([^[\]<>]{2,160})\]/g, '<span class="legal-placeholder">[$1]</span>');
}

export function legalPage(href: string): LegalPage {
  const page = LEGAL_PAGES.find((p) => p.href === href);
  if (!page) throw new Error(`No legal page registered for ${href}`);
  return page;
}
