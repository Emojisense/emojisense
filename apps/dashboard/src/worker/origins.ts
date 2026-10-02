/**
 * Allowed origins of publishable keys. The output must match the patterns that
 * `originAllowed` in @emojisense/platform understands: exact origins, or one leading
 * wildcard label ("https://*.example.com").
 */
import type { KeyKind } from "@emojisense/platform";
import type { Environment } from "../shared/contract";
import { HttpError } from "./http";

export const MAX_ORIGINS = 20;
const FIELD = "allowedOrigins";
// `*` is not a valid host character, so the wildcard label is swapped out while parsing.
const PLACEHOLDER = "wildcard-placeholder";
// host[:port] with an optional trailing slash: no path, query, fragment or credentials.
const HOST_PART = /^[^/?#@\s]+\/?$/;

export class OriginError extends Error {}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/** Returns the canonical form ("https://app.example.com") or throws an OriginError. */
export function normalizeOrigin(input: string): string {
  const raw = input.trim();
  const match = /^(https?):\/\/(\*\.)?(.*)$/i.exec(raw);
  if (!match) {
    throw new OriginError(`"${raw}" must start with https:// (or http:// for localhost).`);
  }
  const [, scheme = "", wildcard, rest = ""] = match;
  if (rest.includes("*")) {
    throw new OriginError(`"${raw}" may use * only as the first label, like https://*.example.com.`);
  }
  if (!HOST_PART.test(rest)) {
    throw new OriginError(
      `"${raw}" is not an origin. Use the scheme and host only, like https://app.example.com.`,
    );
  }

  let url: URL;
  try {
    url = new URL(`${scheme.toLowerCase()}://${wildcard ? `${PLACEHOLDER}.` : ""}${rest}`);
  } catch {
    throw new OriginError(`"${raw}" is not a valid origin.`);
  }

  if (wildcard) {
    const domain = url.hostname.slice(PLACEHOLDER.length + 1);
    if (!domain.includes(".")) {
      throw new OriginError(`"${raw}" is too broad. Put a wildcard only before a domain like example.com.`);
    }
  }
  if (url.protocol === "http:" && (wildcard || !isLoopback(url.hostname))) {
    throw new OriginError(`"${raw}" uses http://. Use https://, except for localhost.`);
  }
  return url.origin.replace(`${PLACEHOLDER}.`, "*.");
}

/** Validates the `allowedOrigins` field: an array of origins, deduplicated, at most 20. */
export function parseAllowedOrigins(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "invalid_request", "allowedOrigins must be an array of strings.", FIELD);
  }
  const origins: string[] = [];
  for (const item of value as string[]) {
    if (item.trim() === "") continue;
    try {
      const origin = normalizeOrigin(item);
      if (!origins.includes(origin)) origins.push(origin);
    } catch (error) {
      if (error instanceof OriginError) throw new HttpError(400, "invalid_origin", error.message, FIELD);
      throw error;
    }
  }
  if (origins.length > MAX_ORIGINS) {
    throw new HttpError(
      400,
      "invalid_origin",
      `A key can have at most ${MAX_ORIGINS} allowed origins.`,
      FIELD,
    );
  }
  return origins;
}

/**
 * Secret keys are for servers, where Origin means nothing. An empty list on a publishable key
 * allows any origin, which docs/API.md permits only for development keys.
 */
export function assertOriginPolicy(
  kind: KeyKind,
  environment: Environment,
  origins: readonly string[],
): void {
  if (kind === "secret" && origins.length > 0) {
    throw new HttpError(
      400,
      "invalid_origin",
      "Secret keys are for servers and have no allowed origins. Remove them or create a publishable key.",
      FIELD,
    );
  }
  if (kind === "publishable" && origins.length === 0 && environment !== "dev") {
    throw new HttpError(
      400,
      "invalid_origin",
      "Add at least one allowed origin. Only keys of dev apps may allow any origin.",
      FIELD,
    );
  }
}
