/**
 * Culture record validation (PULSE.md, "Validation"). Errors block the build and approval;
 * warnings are shown by culture:check and culture:review.
 */
import { normalize } from "emojisense";
import { LOCALE_CODES } from "../locales.ts";
import { type Exclusion, findExcluded } from "./exclusions.ts";
import type { CultureRecord, Issue } from "./types.ts";

export const LIMITS = {
  contextMin: 3,
  contextMax: 90,
  triggerMaxChars: 48,
  triggerMaxWords: 6,
  emojiMin: 1,
  emojiMax: 6,
  /** Days, inclusive. */
  eventMaxDays: 60,
  seasonMaxDays: 92,
  /** A regional sense names at most this many canonical answers it may move down. */
  outranksMax: 3,
};

const STATUSES = ["draft", "approved", "retired"];
const KINDS = ["lasting", "seasonal", "event", "regional"];
/** Kinds without a window. */
const ALWAYS = ["lasting", "regional"];
const SOURCES = ["editorial", "ai-proposed", "calendar"];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEXCODE = /^[0-9A-F]{2,6}(-[0-9A-F]{2,6})*$/;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
/** Six or more capitals in a row: shouting ("AMAZING"), while acronyms like "LGBTQ" pass. */
const SHOUTING = /\p{Lu}{6,}/u;
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** A real ISO 3166-1 alpha-2 region: CLDR has a name for it ("ZZ" is CLDR's "Unknown Region"). */
function isRegion(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code) || code === "ZZ") return false;
  const name = regionNames.of(code);
  return name !== undefined && name !== code;
}

export interface ValidationContext {
  /** hexcode → emoji (catalog.ts). */
  catalog: ReadonlyMap<string, string>;
  exclusions: readonly Exclusion[];
  /** File name, to check that it matches the id. */
  fileName?: string;
}

/** Locales a record targets: its list, or every pack locale for "*". */
export function targetLocales(record: Pick<CultureRecord, "locales">): string[] {
  return record.locales.includes("*") ? [...LOCALE_CODES] : record.locales;
}

const DAY_MS = 86_400_000;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/** Milliseconds of a valid calendar date, or NaN. `year` 2001 = a non-leap year for MM-DD. */
function dateValue(value: string, yearly: boolean): number {
  const match = (yearly ? MONTH_DAY : DATE).exec(value);
  if (!match) return Number.NaN;
  const [y, m, d] = yearly ? [2001, Number(match[1]), Number(match[2])] : match.slice(1).map(Number);
  const time = utc(y as number, m as number, d as number);
  const date = new Date(time);
  return date.getUTCMonth() + 1 === m && date.getUTCDate() === d ? time : Number.NaN;
}

/** Days in a window, inclusive. Yearly windows may wrap the year end. */
export function windowDays(from: string, to: string, yearly: boolean): number {
  const [a, b] = [dateValue(from, yearly), dateValue(to, yearly)];
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  const span = (b - a) / DAY_MS + 1;
  return yearly && span <= 0 ? span + 365 : span;
}

function checkWhen(record: CultureRecord, error: (m: string) => void) {
  const { kind, when } = record;
  if (ALWAYS.includes(kind)) {
    if (when !== null) error(`a ${kind} entry has \`when: null\``);
    return;
  }
  if (when === null || typeof when !== "object" || Array.isArray(when)) {
    error(
      `a ${kind} entry needs one window: { "from", "to" } (lunar-calendar festivals: one entry per year)`,
    );
    return;
  }
  const yearly = when.recurs === "yearly";
  if (when.recurs !== undefined && !yearly) error(`unknown recurs "${when.recurs}"`);
  if (kind === "event" && yearly) error("an event has dated days (YYYY-MM-DD), not a yearly window");
  const days = windowDays(when.from, when.to, yearly);
  const format = yearly ? "MM-DD" : "YYYY-MM-DD";
  if (Number.isNaN(days)) {
    error(`window ${when.from} → ${when.to} is not two valid ${format} days${yearly ? " (no 02-29)" : ""}`);
  } else if (days <= 0) {
    error(`window ${when.from} → ${when.to} ends before it starts`);
  } else {
    const max = kind === "event" || !yearly ? LIMITS.eventMaxDays : LIMITS.seasonMaxDays;
    if (days > max) error(`window ${when.from} → ${when.to} is ${days} days (max ${max})`);
  }
}

function checkContext(text: string, locale: string, context: ValidationContext, error: (m: string) => void) {
  const where = `context.${locale}`;
  if (typeof text !== "string" || text.trim().length < LIMITS.contextMin) {
    error(`${where} is missing or too short`);
    return;
  }
  if (text.length > LIMITS.contextMax) error(`${where} is longer than ${LIMITS.contextMax} characters`);
  if (text !== text.trim()) error(`${where} has leading or trailing spaces`);
  if (PICTOGRAPH.test(text)) error(`${where} contains an emoji (the emoji are in \`emoji\`)`);
  if (/[!！¡]/.test(text)) error(`${where} is not neutral: no exclamation marks`);
  if (/https?:|www\.|[#@]/.test(text)) error(`${where} contains a link, hashtag or mention`);
  if (SHOUTING.test(text)) error(`${where} is not neutral: a word in capitals`);
  const excluded = findExcluded(text, context.exclusions, locale);
  if (excluded) error(`${where} contains an excluded phrase: ${excluded}`);
}

export function validateRecord(value: unknown, context: ValidationContext): Issue[] {
  const record = value as CultureRecord;
  const id = typeof record?.id === "string" ? record.id : (context.fileName ?? "?");
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ id, level: "error", message });
  const warn = (message: string) => issues.push({ id, level: "warning", message });

  if (typeof record !== "object" || record === null)
    return [{ id, level: "error", message: "not an object" }];
  if (!ID.test(id)) error(`id "${id}" must be lowercase words joined by "-"`);
  if (context.fileName && context.fileName !== `${id}.json`) error(`file name must be ${id}.json`);
  if (!STATUSES.includes(record.status)) error(`status must be one of ${STATUSES.join(", ")}`);
  if (!KINDS.includes(record.kind)) error(`kind must be one of ${KINDS.join(", ")}`);
  if (!SOURCES.includes(record.source)) error(`source must be one of ${SOURCES.join(", ")}`);
  if (typeof record.createdBy !== "string" || record.createdBy === "") error("createdBy is required");
  if (typeof record.createdAt !== "string" || !CREATED_AT.test(record.createdAt)) {
    error("createdAt must be YYYY-MM-DD or an ISO time");
  }
  if (record.status === "approved" && !record.reviewedBy)
    error("an approved entry names its reviewer (reviewedBy)");
  if (record.featured !== undefined && typeof record.featured !== "boolean")
    error("featured must be a boolean");
  if (record.featured && ALWAYS.includes(record.kind))
    error("only seasonal and event entries can be featured");
  if (KINDS.includes(record.kind)) checkWhen(record, error);

  // Targeting.
  const locales = Array.isArray(record.locales) ? record.locales : [];
  const regions = Array.isArray(record.regions) ? record.regions : [];
  if (locales.length === 0) error('locales must list pack locales or be ["*"]');
  if (locales.includes("*") && locales.length > 1) error('locales: "*" stands alone');
  for (const l of locales) if (l !== "*" && !LOCALE_CODES.includes(l)) error(`unknown locale "${l}"`);
  if (regions.length === 0) error('regions must list ISO 3166-1 codes or be ["*"]');
  if (regions.includes("*") && regions.length > 1) error('regions: "*" stands alone');
  for (const r of regions) {
    if (r !== "*" && !isRegion(r)) error(`unknown region "${r}"`);
  }
  if (new Set(locales).size !== locales.length || new Set(regions).size !== regions.length) {
    error("locales and regions must not repeat");
  }
  checkExceptRegions(record, regions, error);
  const targeted = new Set(
    targetLocales({ locales: locales.filter((l) => l === "*" || LOCALE_CODES.includes(l)) }),
  );

  // Context: English (reviewers and the website read it) plus every targeted locale.
  const contexts = typeof record.context === "object" && record.context !== null ? record.context : {};
  for (const locale of new Set(["en", ...targeted])) {
    checkContext(contexts[locale] as string, locale, context, error);
  }
  for (const locale of Object.keys(contexts)) {
    if (locale !== "en" && !targeted.has(locale))
      error(`context.${locale}: the entry does not target ${locale}`);
  }

  // Triggers.
  const triggers = typeof record.triggers === "object" && record.triggers !== null ? record.triggers : {};
  let triggerCount = 0;
  for (const [locale, list] of Object.entries(triggers)) {
    if (!targeted.has(locale)) error(`triggers.${locale}: the entry does not target ${locale}`);
    if (!Array.isArray(list)) {
      error(`triggers.${locale} must be a list`);
      continue;
    }
    const seen = new Set<string>();
    for (const trigger of list) {
      triggerCount++;
      const where = `triggers.${locale} "${trigger}"`;
      if (typeof trigger !== "string" || trigger === "") {
        error(`triggers.${locale} has an empty trigger`);
        continue;
      }
      if (normalize(trigger) !== trigger)
        error(`${where} is not normalized (expected "${normalize(trigger)}")`);
      if (trigger.length > LIMITS.triggerMaxChars)
        error(`${where} is longer than ${LIMITS.triggerMaxChars} chars`);
      if (trigger.split(" ").length > LIMITS.triggerMaxWords)
        error(`${where} has more than ${LIMITS.triggerMaxWords} words`);
      if (seen.has(trigger)) error(`${where} is listed twice`);
      seen.add(trigger);
      const excluded = findExcluded(trigger, context.exclusions, locale);
      if (excluded) error(`${where} contains an excluded phrase: ${excluded}`);
    }
  }
  if (triggerCount === 0 && !record.featured) error("no triggers: the entry would never apply");
  if (triggerCount === 0 && record.featured) warn("no triggers: the entry only appears on the shelf");

  // Emoji.
  const emoji = Array.isArray(record.emoji) ? record.emoji : [];
  if (emoji.length < LIMITS.emojiMin || emoji.length > LIMITS.emojiMax) {
    error(`emoji: ${LIMITS.emojiMin}–${LIMITS.emojiMax} items`);
  }
  const hexcodes = new Set<string>();
  for (const item of emoji) {
    const hexcode = item?.hexcode;
    if (typeof hexcode !== "string" || !HEXCODE.test(hexcode)) {
      error(`emoji hexcode "${hexcode}" must be uppercase Emojibase hexcode`);
      continue;
    }
    if (!context.catalog.has(hexcode)) error(`emoji ${hexcode} is not a base emoji of the catalog`);
    if (hexcodes.has(hexcode)) error(`emoji ${hexcode} is listed twice`);
    hexcodes.add(hexcode);
    const weight = item.weight;
    if (typeof weight !== "number" || !(weight > 0 && weight <= 1))
      error(`emoji ${hexcode}: weight must be in (0, 1]`);
  }
  checkOutranks(record, hexcodes, context, error);
  return issues;
}

function checkExceptRegions(record: CultureRecord, regions: readonly string[], error: (m: string) => void) {
  const except = record.exceptRegions;
  if (except === undefined) return;
  if (!Array.isArray(except) || except.length === 0) {
    error("exceptRegions must list ISO 3166-1 codes (or be left out)");
    return;
  }
  if (!(regions.length === 1 && regions[0] === "*")) error('exceptRegions needs regions: ["*"]');
  for (const r of except) if (!isRegion(r)) error(`unknown region "${r}" in exceptRegions`);
  if (new Set(except).size !== except.length) error("exceptRegions must not repeat");
}

/**
 * A regional sense is the one kind that may take rank 1, so it must say which canonical answer it
 * may move down (`outranks`) and where it applies: named regions, or every region but some.
 */
function checkOutranks(
  record: CultureRecord,
  ownHexcodes: ReadonlySet<string>,
  context: ValidationContext,
  error: (m: string) => void,
) {
  const outranks = record.outranks;
  if (record.kind !== "regional") {
    if (outranks !== undefined) error("only regional entries have outranks");
    return;
  }
  const regions = Array.isArray(record.regions) ? record.regions : [];
  if (regions.includes("*") && !record.exceptRegions?.length) {
    error('a regional entry names its regions, or uses ["*"] with exceptRegions');
  }
  if (!Array.isArray(outranks) || outranks.length === 0 || outranks.length > LIMITS.outranksMax) {
    error(`a regional entry lists 1–${LIMITS.outranksMax} canonical answers in outranks`);
    return;
  }
  for (const hexcode of outranks) {
    if (typeof hexcode !== "string" || !HEXCODE.test(hexcode) || !context.catalog.has(hexcode)) {
      error(`outranks ${hexcode} is not a base emoji of the catalog`);
    } else if (ownHexcodes.has(hexcode)) {
      error(`outranks ${hexcode} is one of the entry's own emoji`);
    }
  }
  if (new Set(outranks).size !== outranks.length) error("outranks must not repeat");
}

/** Validate a set of records: each one, plus ids that repeat. */
export function validateRecords(
  records: readonly { record: unknown; fileName?: string }[],
  context: Omit<ValidationContext, "fileName">,
): Issue[] {
  const issues = records.flatMap(({ record, fileName }) =>
    validateRecord(record, { ...context, ...(fileName ? { fileName } : {}) }),
  );
  const counts = new Map<string, number>();
  for (const { record } of records) {
    const id = (record as CultureRecord)?.id;
    if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts)
    if (count > 1) issues.push({ id, level: "error", message: `id used ${count} times` });
  return issues;
}
