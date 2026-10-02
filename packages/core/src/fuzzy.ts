/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition), bounded:
 * returns `max + 1` as soon as the distance must exceed `max`.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  const width = b.length + 1;
  let prevPrev = new Int32Array(width);
  let prev = new Int32Array(width);
  let current = new Int32Array(width);
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
