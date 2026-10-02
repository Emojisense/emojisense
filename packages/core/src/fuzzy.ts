// Reused across calls: the fuzzy scan compares thousands of tokens per keystroke, and per-call
// allocation showed up as GC pauses (> 16 ms) in profiling.
let prevPrev = new Int32Array(32);
let prev = new Int32Array(32);
let current = new Int32Array(32);

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition), bounded:
 * returns `max + 1` as soon as the distance must exceed `max`.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  const width = b.length + 1;
  if (prev.length < width) {
    prevPrev = new Int32Array(width * 2);
    prev = new Int32Array(width * 2);
    current = new Int32Array(width * 2);
  }
  for (let j = 0; j < width; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j < width; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(
        (prev[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        value = Math.min(value, (prevPrev[j - 2] as number) + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    [prevPrev, prev, current] = [prev, current, prevPrev];
  }
  return prev[b.length] as number;
}

/** Edits we tolerate for a token of this length: none below 4 chars, 1 up to 7, then 2. */
export function maxEditsFor(length: number): number {
  if (length < 4) return 0;
  return length < 8 ? 1 : 2;
}

/**
 * Cheap gate before the edit distance: people rarely mistype the first letter, so the two
 * tokens must agree on it, or on a swap of the first two letters.
 */
export function plausibleTypo(typed: string, candidate: string): boolean {
  const a0 = typed.charCodeAt(0);
  const b0 = candidate.charCodeAt(0);
  return a0 === b0 || (a0 === candidate.charCodeAt(1) && b0 === typed.charCodeAt(1));
}
