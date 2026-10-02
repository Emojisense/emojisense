import { describe, expect, it } from "vitest";
import { boundedEditDistance, maxEditsFor } from "../src/fuzzy.js";

describe("boundedEditDistance", () => {
  it.each([
    ["pizza", "pizza", 2, 0],
    ["pizaa", "pizza", 2, 1],
    ["rockt", "rocket", 2, 1],
    ["hallowelen", "halloween", 2, 1],
    ["teh", "the", 1, 1],
    ["dinosuar", "dinosaur", 2, 1],
    ["cat", "dog", 1, 2],
    ["a", "abcdef", 2, 3],
  ])("%s ↔ %s (max %i) = %i", (a, b, max, expected) => {
    expect(boundedEditDistance(a, b, max)).toBe(expected);
  });

  it("allows edits only for longer tokens", () => {
    expect(maxEditsFor(3)).toBe(0);
    expect(maxEditsFor(5)).toBe(1);
    expect(maxEditsFor(10)).toBe(2);
  });
});
