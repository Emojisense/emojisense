import { moderate } from "../blocklist.ts";

export type PrivacyReason = "email" | "url" | "phone" | "number" | "code" | "long-token" | "blocked";

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/u;
const URL_RAW = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.)/iu;
const DOMAIN_RAW = /[\p{L}\p{N}-]+\.(?:com|net|org|edu|gov|info|biz|xyz)\b/iu;
/** Tokens that are only ever part of an address once punctuation is gone ("jane doe gmail com"). */
const URL_TOKENS = new Set(["http", "https", "www", "mailto"]);
const MAIL_PROVIDERS = new Set([
  "gmail",
  "googlemail",
  "hotmail",
  "outlook",
  "yahoo",
  "icloud",
  "protonmail",
  "gmx",
  "yandex",
]);
/** Generic top-level domains that are not words in a pack language (so not "me", "io", "de"). */
const TLDS = new Set(["com", "net", "org", "edu", "gov", "info", "biz", "xyz"]);
const DIGIT = /\p{Nd}/gu;
const DIGIT_RUN = /\p{Nd}{5,}/u;
const LETTER = /\p{L}/u;
/** Phone numbers, card and account numbers: 7 digits or more in one query. */
const MAX_DIGITS = 6;
/** Hashes, tokens and pasted ids. No word of a pack language comes close. */
const MAX_TOKEN_LENGTH = 30;

/**
 * Why a query must never be published in a shard, or undefined when it may be. Shard files are
 * public, so text that can point to a person (an email address, a URL, a phone, account or
 * postal number, a user id like "jane1987") or that the alias blocklist blocks stays out,
 * however often it was searched. It accepts raw text and normalize() output, where
 * "jane.doe@gmail.com" became "jane doe gmail com". It errs on the side of dropping: a dropped
 * query is still answered by the API.
 */
export function privacyReason(text: string): PrivacyReason | undefined {
  if (EMAIL.test(text)) return "email";
  if (URL_RAW.test(text) || DOMAIN_RAW.test(text)) return "url";
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
  if (tokens.some((t) => MAIL_PROVIDERS.has(t))) return "email";
  if (tokens.some((t, i) => URL_TOKENS.has(t) || (i > 0 && TLDS.has(t)))) return "url";
  if ((text.match(DIGIT)?.length ?? 0) > MAX_DIGITS) return "phone";
  if (DIGIT_RUN.test(text)) return "number";
  if (tokens.some((t) => LETTER.test(t) && (t.match(DIGIT)?.length ?? 0) >= 3)) return "code";
  if (tokens.some((t) => t.length > MAX_TOKEN_LENGTH)) return "long-token";
  if (moderate(tokens.join(" "), "en") === "block") return "blocked";
  return undefined;
}
