/** How the search demos show unsure queries and concept answers (src/lib/search-copy.ts). */
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
  it("shows guesses when no tier understood the query and no concept answer came", () => {
    expect(honestyOf(state({ unsure: true }), "kendrick lamar")).toEqual({ guessing: true, terms: [] });
    expect(honestyOf(state({ unsure: true, concept: { status: "pending" } }), "x").guessing).toBe(true);
    expect(honestyOf(state({ unsure: true, concept: { status: "none" } }), "x").guessing).toBe(true);
  });

  it("shows the concept tier's reading once it answered", () => {
    const answered = state({ unsure: true, concept: { status: "ok", terms: ["rapper", "hip hop"] } });
    expect(honestyOf(answered, "kendrick lamar")).toEqual({ guessing: false, terms: ["rapper", "hip hop"] });
  });

  it("stays quiet for sure answers, empty queries and idle sessions", () => {
    expect(honestyOf(state({}), "rocket")).toEqual({ guessing: false, terms: [] });
    expect(honestyOf(state({ unsure: true }), "  ")).toEqual({ guessing: false, terms: [] });
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
