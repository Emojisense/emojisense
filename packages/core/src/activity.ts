/**
 * When this page last searched. Optional heavy work (the extension-pack index) waits for a pause
 * in typing, so it never blocks a keystroke.
 */
let lastSearch = Number.NEGATIVE_INFINITY;

/** Every search session calls this on each keystroke. */
export function noteSearch(): void {
  lastSearch = Date.now();
}

/** Milliseconds since the last search on this page; Infinity before the first. */
export function msSinceSearch(): number {
  return Date.now() - lastSearch;
}
