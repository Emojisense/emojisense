const SKIN_TONE = /-1F3F[B-F]/g;

/** Map a skin-tone variant hexcode ("1F44D-1F3FD") to its base ("1F44D"). */
export function baseId(hexcode: string): string {
  return hexcode.toUpperCase().replace(SKIN_TONE, "");
}
