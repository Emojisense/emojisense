/**
 * The Culture page's edit form ⇄ a culture entry record (packages/data/culture/schema.json). The
 * form keeps lists as text so an editor can type freely; the API Worker validates the record.
 */
import type { CultureEntryRecord } from "@emojisense/platform";

/** The pack locales, English first (packages/data/src/locales.ts). */
export const PACK_LOCALES = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id", "tr"] as const;

export type CultureKind = CultureEntryRecord["kind"];
export const CULTURE_KINDS: readonly CultureKind[] = ["lasting", "seasonal", "event", "regional"];

export interface EntryForm {
  id: string;
  kind: CultureKind;
  from: string;
  to: string;
  yearly: boolean;
  /** Comma-separated ISO 3166-1 codes, or "*". */
  regions: string;
  exceptRegions: string;
  /** Comma-separated pack locales, or "*". */
  locales: string;
  featured: boolean;
  emoji: { hexcode: string; weight: string }[];
  context: Record<string, string>;
  /** One trigger per line, per locale. */
  triggers: Record<string, string>;
  outranks: string;
}

const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** The locales an entry targets: its list, or every pack locale for "*". */
export function formLocales(form: Pick<EntryForm, "locales">): string[] {
  const locales = list(form.locales);
  return locales.includes("*") ? [...PACK_LOCALES] : locales;
}

export function toForm(record: CultureEntryRecord): EntryForm {
  return {
    id: record.id,
    kind: record.kind,
    from: record.when?.from ?? "",
    to: record.when?.to ?? "",
    yearly: record.when?.recurs === "yearly",
    regions: record.regions.join(", "),
    exceptRegions: (record.exceptRegions ?? []).join(", "),
    locales: record.locales.join(", "),
    featured: record.featured === true,
    emoji: record.emoji.map((e) => ({ hexcode: e.hexcode, weight: String(e.weight) })),
    context: { ...record.context },
    triggers: Object.fromEntries(Object.entries(record.triggers).map(([l, t]) => [l, t.join("\n")])),
    outranks: (record.outranks ?? []).join(", "),
  };
}

/**
 * The record an edited form stands for. Provenance (source, createdBy, createdAt) and status come
 * from `base`; the API Worker keeps the stored ones anyway.
 */
export function toRecord(form: EntryForm, base: CultureEntryRecord): CultureEntryRecord {
  const locales = formLocales(form);
  const always = form.kind === "lasting" || form.kind === "regional";
  const triggers = Object.fromEntries(
    locales.flatMap((locale) => {
      const lines = (form.triggers[locale] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return lines.length > 0 ? [[locale, lines]] : [];
    }),
  );
  const context = Object.fromEntries(
    ["en", ...locales.filter((l) => l !== "en")].flatMap((locale) => {
      const text = form.context[locale]?.trim();
      return text ? [[locale, text]] : [];
    }),
  );
  const exceptRegions = list(form.exceptRegions).map((r) => r.toUpperCase());
  const outranks = list(form.outranks).map((h) => h.toUpperCase());
  return {
    id: form.id.trim(),
    status: base.status,
    kind: form.kind,
    context,
    when: always
      ? null
      : { from: form.from.trim(), to: form.to.trim(), ...(form.yearly ? { recurs: "yearly" as const } : {}) },
    regions: list(form.regions).map((r) => (r === "*" ? r : r.toUpperCase())),
    ...(exceptRegions.length > 0 ? { exceptRegions } : {}),
    locales: list(form.locales),
    triggers,
    emoji: form.emoji
      .filter((e) => e.hexcode.trim())
      .map((e) => ({ hexcode: e.hexcode.trim().toUpperCase(), weight: Number(e.weight) })),
    ...(form.kind === "regional" && outranks.length > 0 ? { outranks } : {}),
    ...(form.featured ? { featured: true } : {}),
    source: base.source,
    createdBy: base.createdBy,
    ...(base.reviewedBy ? { reviewedBy: base.reviewedBy } : {}),
    createdAt: base.createdAt,
  };
}

/** The emoji of a hexcode ("1F1E6-1F1F7" → 🇦🇷), or "" when it is not one. */
export function glyphOf(hexcode: string): string {
  try {
    const points = hexcode
      .trim()
      .split("-")
      .map((part) => Number.parseInt(part, 16));
    if (points.length === 0 || points.some((p) => !Number.isInteger(p) || p < 0x20 || p > 0x10ffff))
      return "";
    return String.fromCodePoint(...points);
  } catch {
    return "";
  }
}

/** The window in words: "2026-10-18 → 2026-10-25", "Every year 10-15 → 10-31" or "Always". */
export function describeWhen(record: Pick<CultureEntryRecord, "when">): string {
  const when = record.when;
  if (!when) return "Always";
  return when.recurs === "yearly" ? `Every year ${when.from} → ${when.to}` : `${when.from} → ${when.to}`;
}
