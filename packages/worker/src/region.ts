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
