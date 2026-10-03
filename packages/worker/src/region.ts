import { UNKNOWN_COUNTRY } from "@emojisense/platform";
import { isRegionCode } from "./culture.ts";

/**
 * The country of the request, from Cloudflare's edge (`request.cf.country`, derived from the IP
 * address): ISO 3166-1 alpha-2, uppercase, or UNKNOWN_COUNTRY ("XX") when Cloudflare does not
 * know it ("XX"), for Tor ("T1") and outside Cloudflare (local runs, tests).
 *
 * It has two uses only (DECISIONS.md, "Regional statistics: locale and country"): with
 * `region=auto` it selects the regional culture entries of one answer, and it is a count
 * dimension of query_daily (searches per app, day, query, locale and country). It is never stored
 * with a user, key or IP, and it is not part of the shared cache key.
 */
export function edgeCountry(request: Request): string {
  const country = (request as { cf?: { country?: unknown } }).cf?.country;
  if (typeof country !== "string") return UNKNOWN_COUNTRY;
  const code = country.toUpperCase();
  return code !== UNKNOWN_COUNTRY && isRegionCode(code) ? code : UNKNOWN_COUNTRY;
}

/**
 * The IANA time zone of the request, from Cloudflare's edge (`request.cf.timezone`, derived from
 * the IP address), e.g. "Asia/Tokyo"; undefined outside Cloudflare. It only picks the caller's
 * local day for the culture windows of one answer (culture.ts `dayIn`, which checks the name). It
 * is never stored and it is not part of the shared cache key.
 */
export function edgeTimeZone(request: Request): string | undefined {
  const zone = (request as { cf?: { timezone?: unknown } }).cf?.timezone;
  return typeof zone === "string" && zone !== "" ? zone : undefined;
}

/** What Cloudflare's edge knows about the caller, for the culture layer of one answer. */
export interface EdgeCaller {
  /** {@link edgeCountry}, undefined when it is unknown: `region=auto` then selects no region. */
  country: string | undefined;
  /** {@link edgeTimeZone}. */
  timeZone: string | undefined;
}

export function edgeCaller(request: Request): EdgeCaller {
  const country = edgeCountry(request);
  return { country: country === UNKNOWN_COUNTRY ? undefined : country, timeZone: edgeTimeZone(request) };
}
