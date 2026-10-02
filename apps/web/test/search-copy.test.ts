/** How the search demos show unsure queries (src/lib/search-copy.ts). */
import type { CanonicalSearchOutput, SessionState } from "emojisense";
import { describe, expect, it } from "vitest";
import { honestyOf, SEARCH_COPY } from "../src/lib/search-copy";

const alias: CanonicalSearchOutput = { query: "q", tokens: ["q"], results: [], confidence: 0, coverage: 0 };
const state = (overrides: Partial<SessionState>): SessionState => ({
  query: "kendrick lamar",
  results: [{ emoji: "🦁", id: "1F981", score: 0.4, source: "semantic" }],
  alias,
  status: "fused",
  aliasMs: 1,
  unsure: false,
  confidence: 0.2,
  ...overrides,
});

describe("honestyOf", () => {
  it("shows guesses when no tier understood the query", () => {
    expect(honestyOf(state({ unsure: true }), "kendrick lamar")).toEqual({ guessing: true });
  });

  it("stays quiet for sure answers, empty queries and idle sessions", () => {
    expect(honestyOf(state({}), "rocket")).toEqual({ guessing: false });
    expect(honestyOf(state({ unsure: true }), "  ")).toEqual({ guessing: false });
    expect(honestyOf(state({ unsure: true, status: "idle" }), "x").guessing).toBe(false);
    // Waiting for the API: no flicker while someone types.
    expect(honestyOf(state({ unsure: true, status: "loading" }), "x").guessing).toBe(false);
    // Offline or over the limit: the dictionary's verdict is final.
    expect(honestyOf(state({ unsure: true, status: "alias" }), "x").guessing).toBe(true);
    expect(honestyOf(undefined, "x").guessing).toBe(false);
  });

  it("keeps its words in one place", () => {
    expect(SEARCH_COPY.unsure).toBe("No strong match — try another word");
  });
});
