import type { CultureRecord } from "./types.ts";

/** Regions tried in order when a probe needs one inside or outside an entry's scope. */
const PROBES = ["GB", "DE", "IN", "NG", "BR", "FR", "JP", "ZA", "US", "AQ"];

export interface RegionProbes {
  /** A region where the entry applies. */
  inside: string;
  /** A region where it does not; undefined only if every probe is in scope. */
  outside: string | undefined;
}

/**
 * One region inside and one outside a record's scope, for previews (culture:review) and the
 * regional part of the eval gate. The lead logic does not depend on which region in scope.
 */
export function probeRegions(record: Pick<CultureRecord, "regions" | "exceptRegions">): RegionProbes {
  const except = record.exceptRegions ?? [];
  if (record.regions.includes("*")) {
    return {
      inside: PROBES.find((r) => !except.includes(r)) ?? "GB",
      outside: except[0],
    };
  }
  return {
    inside: record.regions[0] ?? "GB",
    outside: PROBES.find((r) => !record.regions.includes(r)),
  };
}
