import { describe, expect, it } from "vitest";
import { layoutRows, moveActive } from "../src/grid.js";

describe("layoutRows", () => {
  it("starts every group on a new row", () => {
    expect(layoutRows([3, 2], 2).rows).toEqual([[0, 1], [2], [3, 4]]);
    expect(layoutRows([3, 2], 2).rowOf).toEqual([0, 0, 1, 2, 2]);
    expect(layoutRows([], 9).rows).toEqual([]);
  });
});

describe("moveActive", () => {
  const layout = layoutRows([3, 2], 2); // rows [0 1] [2] [3 4]

  it("activates the first option from nothing", () => {
    expect(moveActive(layout, -1, "ArrowDown")).toBe(0);
    expect(moveActive(layoutRows([], 9), -1, "ArrowDown")).toBe(-1);
  });

  it("moves left and right in reading order and stops at the ends", () => {
    expect(moveActive(layout, 1, "ArrowRight")).toBe(2);
    expect(moveActive(layout, 4, "ArrowRight")).toBe(4);
    expect(moveActive(layout, 0, "ArrowLeft")).toBe(0);
  });

  it("moves up and down by visual row, clamping to shorter rows", () => {
    expect(moveActive(layout, 1, "ArrowDown")).toBe(2);
    expect(moveActive(layout, 2, "ArrowDown")).toBe(3);
    expect(moveActive(layout, 4, "ArrowUp")).toBe(2);
    expect(moveActive(layout, 0, "ArrowUp")).toBe(0);
    expect(moveActive(layout, 4, "ArrowDown")).toBe(4);
  });
});
