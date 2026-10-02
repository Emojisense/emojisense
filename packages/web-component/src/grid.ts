/**
 * Keyboard model for options laid out in a grid. Each group (emoji category) starts on a new
 * row, so ArrowUp/ArrowDown must follow the visual rows, not `index ± columns`.
 */
export interface GridLayout {
  /** Option indices of each visual row, top to bottom. */
  rows: number[][];
  /** Row of each option index. */
  rowOf: number[];
}

export type GridKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export function isGridKey(key: string): key is GridKey {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
}

/** Split consecutive groups of options into rows of at most `columns` options. */
export function layoutRows(groupSizes: readonly number[], columns: number): GridLayout {
  const rows: number[][] = [];
  const rowOf: number[] = [];
  let index = 0;
  for (const size of groupSizes) {
    for (let start = 0; start < size; start += columns) {
      const row: number[] = [];
      for (let i = start; i < Math.min(size, start + columns); i++) {
        rowOf.push(rows.length);
        row.push(index++);
      }
      rows.push(row);
    }
  }
  return { rows, rowOf };
}

/**
 * The option that becomes active after an arrow key. With nothing active (-1), any arrow
 * activates the first option. Moves stop at the edges instead of wrapping.
 */
export function moveActive(layout: GridLayout, active: number, key: GridKey): number {
  const count = layout.rowOf.length;
  if (count === 0) return -1;
  if (active < 0 || active >= count) return 0;
  if (key === "ArrowLeft") return Math.max(0, active - 1);
  if (key === "ArrowRight") return Math.min(count - 1, active + 1);
  const row = layout.rowOf[active] as number;
  const column = (layout.rows[row] as number[]).indexOf(active);
  const target = layout.rows[key === "ArrowDown" ? row + 1 : row - 1];
  return target ? (target[Math.min(column, target.length - 1)] as number) : active;
}
