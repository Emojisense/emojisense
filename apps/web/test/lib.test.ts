import { PLANS } from "@emojisense/platform";
import { describe, expect, it } from "vitest";
import { codePointLabel, formatCount, formatDays, formatUsd } from "../src/lib/format";
import { docsLinkResolver, renderMarkdown, slugify } from "../src/lib/markdown";
import { comparisonOf, planViews, soonFeatures, yearlySavingsPercent } from "../src/lib/pricing";

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

  it("lists the plans on sale in PLANS order with their prices, without Scale", () => {
    expect(views.map((v) => v.id)).toEqual(["free", "solo", "pro"]);
    expect(views.map((v) => v.monthly)).toEqual(["$0", "$5", "$20"]);
    expect(views.find((v) => v.id === "solo")?.yearly).toEqual({ price: "$48", savings: "$12", raw: 48 });
  });

  it("sends free to the dashboard and paid plans to its Billing page with the plan picked", () => {
    expect(views[0]?.cta.href).toBe("https://dashboard.test/");
    expect(views.find((v) => v.id === "pro")?.cta).toEqual({
      label: "Get Pro",
      href: "https://dashboard.test/billing?plan=pro&interval=month",
    });
    expect(views.find((v) => v.id === "solo")?.cta).toEqual({
      label: "Get Solo",
      href: "https://dashboard.test/billing?plan=solo&interval=month",
      yearlyHref: "https://dashboard.test/billing?plan=solo&interval=year",
    });
  });

  it("shows a dash, not a zero, for limits a plan does not include", () => {
    const free = views[0]?.features.find((f) => f.key === "analytics");
    expect(PLANS.free.analyticsRetentionDays).toBe(0);
    expect(free?.value).toBe(false);
  });

  it("frames each paid card as everything in the plan before it, plus what it adds", () => {
    expect(views.map((v) => v.inherits)).toEqual([undefined, "Free", "Solo"]);
    const keys = (id: string) => views.find((v) => v.id === id)?.highlights.map((f) => f.key) ?? [];
    expect(keys("free")).toContain("search");
    expect(keys("free")).not.toContain("hosted_sets");
    expect(keys("solo")).toEqual(expect.arrayContaining(["semantic_calls", "hosted_sets"]));
    expect(keys("solo")).not.toContain("search");
    expect(keys("pro")).toEqual(expect.arrayContaining(["team", "analytics"]));
    expect(keys("pro")).not.toContain("hosted_sets");
  });

  it("sells no photos, custom emoji, import, tenants, webhooks or support; lists four as soon", () => {
    const sold = [
      ...views.flatMap((v) => v.highlights.map((f) => f.key)),
      ...comparisonOf().flatMap((group) => group.rows.map((row) => row.key)),
    ];
    for (const key of [
      "image_classifications",
      "custom_emoji",
      "emoji_import",
      "tenants",
      "webhooks",
      "priority_support",
      "community_support",
    ]) {
      expect(sold, key).not.toContain(key);
    }
    expect(soonFeatures().map((f) => f.key)).toEqual([
      "image_classifications",
      "custom_emoji",
      "emoji_import",
      "tenants",
    ]);
    expect(soonFeatures().map((f) => f.label)).toEqual([
      "Photo to emoji",
      "Custom emoji",
      "Slack and Discord import",
      "Tenants",
    ]);
  });

  it("spreads the yearly price over twelve months", () => {
    expect(views.find((v) => v.id === "solo")?.yearlyPerMonth).toBe("$4");
    expect(yearlySavingsPercent()).toBe(20);
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
