import { PLANS } from "@emojisense/platform";
import type { EmojiSearchState } from "@emojisense/react";
import type { AliasSearchOutput, SearchResult } from "emojisense";
import { describe, expect, it } from "vitest";
import { describeAnswer, semanticLayerOf } from "../src/lib/answer";
import { burstPieces, settledAnswer, tiltFor } from "../src/lib/celebrate";
import { codePointLabel, formatCount, formatDays, formatUsd } from "../src/lib/format";
import { docsLinkResolver, renderMarkdown, slugify } from "../src/lib/markdown";
import { planViews } from "../src/lib/pricing";

const DINO: SearchResult = { emoji: "🦖", id: "1F996", score: 0.82, source: "alias" };

function state(overrides: Partial<EmojiSearchState> & { layer?: string }): EmojiSearchState {
  return {
    results: [DINO],
    status: "alias",
    alias: { confidence: 0.9 } as AliasSearchOutput,
    aliasMs: 0.25,
    semanticMs: undefined,
    semanticCached: undefined,
    ...overrides,
  } as EmojiSearchState;
}

describe("format", () => {
  it.each([
    [100, "100"],
    [1_000, "1k"],
    [1_500, "1.5k"],
    [100_000, "100k"],
    [3_000_000, "3M"],
    [15_000_000, "15M"],
    [Number.POSITIVE_INFINITY, "Unlimited"],
  ])("formatCount(%d) = %s", (value, expected) => {
    expect(formatCount(value)).toBe(expected);
  });

  it("formats dollars and days", () => {
    expect(formatUsd(5)).toBe("$5");
    expect(formatUsd(4.5)).toBe("$4.50");
    expect(formatDays(30)).toBe("30 days");
    expect(formatDays(365)).toBe("1 year");
  });

  it("labels code points like a code chart", () => {
    expect(codePointLabel("1F996")).toBe("U+1F996");
    expect(codePointLabel("1F926-200D-2642-FE0F")).toBe("U+1F926 +");
    expect(codePointLabel("2615-FE0F")).toBe("U+2615");
  });
});

describe("planViews", () => {
  const views = planViews("https://dashboard.test");

  it("lists the plans in PLANS order with their prices", () => {
    expect(views.map((v) => v.id)).toEqual(["free", "solo", "pro", "scale"]);
    expect(views.map((v) => v.monthly)).toEqual(["$0", "$5", "$20", "$100"]);
    expect(views.find((v) => v.id === "solo")?.yearly).toEqual({ price: "$48", savings: "$12", raw: 48 });
  });

  it("sends free to the dashboard and paid plans to the waitlist", () => {
    expect(views[0]?.cta.href).toBe("https://dashboard.test/");
    expect(views.find((v) => v.id === "pro")?.cta).toEqual({
      label: "Join the Pro waitlist",
      href: "/waitlist/?plan=pro",
    });
  });

  it("shows a dash, not a zero, for limits a plan does not include", () => {
    const free = views[0]?.features.find((f) => f.key === "custom_emoji");
    expect(PLANS.free.limits.custom_emoji).toBe(0);
    expect(free?.value).toBe(false);
  });
});

describe("renderMarkdown", () => {
  const source = [
    "# Title here",
    "",
    "Intro with a [link](PACK_FORMAT.md#3-normalization) and [another](../DECISIONS.md).",
    "",
    "## `GET /v1/search`",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "## Notes",
    "### Notes",
  ].join("\n");
  const resolveLink = docsLinkResolver({ "docs/PACK_FORMAT.md": "/docs/pack-format/" }, "https://repo.test");
  const out = renderMarkdown(source, { resolveLink });

  it("lifts the h1 out as the title", () => {
    expect(out.title).toBe("Title here");
    expect(out.html).not.toContain("<h1");
  });

  it("gives headings unique ids and lists the h2s", () => {
    expect(out.headings).toEqual([
      { depth: 2, id: "get-v1search", text: "GET /v1/search" },
      { depth: 2, id: "notes", text: "Notes" },
    ]);
    expect(out.html).toContain('<h3 id="notes-1">');
  });

  it("rewrites links to site pages or the repository", () => {
    expect(out.html).toContain('href="/docs/pack-format/#3-normalization"');
    expect(out.html).toContain('href="https://repo.test/blob/main/DECISIONS.md"');
    expect(resolveLink("https://example.com/x")).toBe("https://example.com/x");
    expect(resolveLink("#local")).toBe("#local");
  });

  it("wraps tables so they scroll on small screens", () => {
    expect(out.html).toContain('<div class="table-scroll" tabindex="0"><table>');
  });

  it("slugifies like a reader expects", () => {
    expect(slugify("Über  Fast — Search!")).toBe("uber-fast-search");
  });
});

describe("answer readout", () => {
  it("reads the layer defensively and treats fused answers without it as the API", () => {
    expect(semanticLayerOf(state({ status: "alias" }))).toBeUndefined();
    expect(semanticLayerOf(state({ status: "fused" }))).toBe("api");
    expect(semanticLayerOf(state({ status: "fused", layer: "shard" }))).toBe("shard");
    expect(semanticLayerOf(state({ status: "fused", layer: "something-new" }))).toBe("api");
  });

  it("says where each answer came from", () => {
    expect(describeAnswer(state({ status: "alias" }))).toBe("Answered on this device in 0.25 ms. Cost: $0.");
    expect(describeAnswer(state({ status: "fused", semanticMs: 48.4, layer: "shard" }))).toContain(
      "precomputed results in 48 ms. Cost: $0.",
    );
    expect(describeAnswer(state({ status: "fused", semanticMs: 48.4, semanticCached: true }))).toBe(
      "On this device, plus the Worker in 48 ms (cached).",
    );
    expect(describeAnswer(state({ status: "error" }))).toContain("dictionary results");
  });
});

describe("celebration", () => {
  it("celebrates only settled, confident answers", () => {
    expect(settledAnswer(state({ status: "alias" }))).toBe(DINO);
    expect(settledAnswer(state({ status: "fused", alias: { confidence: 0.1 } as AliasSearchOutput }))).toBe(
      DINO,
    );
    expect(settledAnswer(state({ status: "loading" }))).toBeUndefined();
    expect(
      settledAnswer(state({ status: "alias", alias: { confidence: 0.4 } as AliasSearchOutput })),
    ).toBeUndefined();
    expect(settledAnswer(state({ status: "alias", results: [] }))).toBeUndefined();
  });

  it("tilts stickers between -6 and 6 degrees, the same way every time", () => {
    for (const id of ["1F996", "1F410", "1F383", "1F92F"]) {
      expect(tiltFor(id)).toBeGreaterThanOrEqual(-6);
      expect(tiltFor(id)).toBeLessThanOrEqual(6);
      expect(tiltFor(id)).toBe(tiltFor(id));
    }
  });

  it("makes a stable burst of the requested size", () => {
    const pieces = burstPieces(8, "1F996");
    expect(pieces).toHaveLength(8);
    expect(burstPieces(8, "1F996")).toEqual(pieces);
    for (const piece of pieces) expect(Math.hypot(piece.dx, piece.dy + 0.75)).toBeLessThanOrEqual(5.6);
  });
});
