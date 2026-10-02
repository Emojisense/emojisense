import { describe, expect, it } from "vitest";
import {
  customEmojiImageKey,
  customEmojiImageUrl,
  hasCustomEmoji,
  hasEmojiImport,
  MAX_ALIASES,
  parseAliases,
  parseShortcode,
  storedAliases,
  toCustomEmoji,
} from "../src/custom-emoji.js";
import type { Parsed } from "../src/d1-like.js";
import { lowestPlanWith, PLANS } from "../src/plans.js";

function inputError(parsed: Parsed<unknown>) {
  if (parsed.ok) throw new Error("expected an input error");
  return parsed;
}

describe("parseShortcode", () => {
  it.each([
    [":Party_Parrot:", "party_parrot"],
    ["  shipit ", "shipit"],
    ["+1", "+1"],
    ["thumbs-up-2", "thumbs-up-2"],
    ["x".repeat(64), "x".repeat(64)],
  ])("accepts %j as %j", (input, expected) => {
    expect(parseShortcode(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [undefined],
    [42],
    [""],
    ["::"],
    ["party parrot"],
    ["çay"],
    ["a.b"],
    ["x".repeat(65)],
    ["___"],
    ["+-"],
  ])("rejects %j", (input) => {
    expect(inputError(parseShortcode(input))).toMatchObject({ ok: false, field: "shortcode" });
  });
});

describe("parseAliases", () => {
  const value = (parsed: Parsed<string[]>) => (parsed.ok ? parsed.value : parsed);

  it("normalizes a comma-separated string, dropping empty and repeated aliases", () => {
    expect(value(parseAliases(" Ship It!, ship it , , Çok Güzel"))).toEqual(["ship it", "cok guzel"]);
  });

  it("accepts a string array and treats missing values as none", () => {
    expect(value(parseAliases(["Rocket 🚀", "launch"]))).toEqual(["rocket", "launch"]);
    expect(value(parseAliases(undefined))).toEqual([]);
    expect(value(parseAliases(null))).toEqual([]);
    expect(value(parseAliases(""))).toEqual([]);
  });

  it("caps each alias at the query length", () => {
    expect(value(parseAliases("x".repeat(80)))).toEqual(["x".repeat(64)]);
  });

  it("rejects other types and too many aliases", () => {
    expect(inputError(parseAliases(5)).field).toBe("aliases");
    expect(inputError(parseAliases(["ok", 5])).field).toBe("aliases");
    const many = Array.from({ length: MAX_ALIASES + 1 }, (_, i) => `alias ${i}`);
    expect(inputError(parseAliases(many)).message).toMatch(String(MAX_ALIASES));
  });

  it("reads stored JSON defensively", () => {
    expect(storedAliases('["a","b",3]')).toEqual(["a", "b"]);
    expect(storedAliases("not json")).toEqual([]);
    expect(storedAliases('{"a":1}')).toEqual([]);
  });
});

describe("keys, URLs and JSON", () => {
  it("builds the R2 key with '_' for app-wide emoji", () => {
    expect(customEmojiImageKey("app1", null, "e1", "png")).toBe("custom/app1/_/e1.png");
    expect(customEmojiImageKey("app1", "t1", "e1", "svg")).toBe("custom/app1/t1/e1.svg");
  });

  it("builds the image URL on the API Worker", () => {
    expect(customEmojiImageUrl("https://api.example.com/", "app1", "e1")).toBe(
      "https://api.example.com/v1/custom/app1/e1",
    );
  });

  it("maps a row to the contract shape", () => {
    expect(
      toCustomEmoji(
        {
          id: "e1",
          app_id: "app1",
          tenant_id: "",
          shortcode: "shipit",
          aliases: '["ship it"]',
          image_key: "custom/app1/_/e1.png",
          content_type: "image/png",
          bytes: 12,
          source: "upload",
          created_at: 5,
        },
        "http://localhost:8788",
      ),
    ).toEqual({
      id: "e1",
      shortcode: "shipit",
      aliases: ["ship it"],
      imageUrl: "http://localhost:8788/v1/custom/app1/e1",
      tenantId: null,
      source: "upload",
      bytes: 12,
      createdAt: 5,
    });
  });

  it("adds the tenant's external id when the caller knows it", () => {
    const row = {
      id: "e1",
      app_id: "app1",
      tenant_id: "t1",
      shortcode: "logo",
      aliases: "[]",
      image_key: "custom/app1/t1/e1.png",
      content_type: "image/png" as const,
      bytes: 1,
      source: "api" as const,
      created_at: 1,
    };
    expect(toCustomEmoji(row, "https://api.test", "acme")).toMatchObject({
      tenantId: "t1",
      tenantExternalId: "acme",
    });
    expect(toCustomEmoji(row, "https://api.test")).not.toHaveProperty("tenantExternalId");
  });
});

describe("plan gates", () => {
  it("names the cheapest plan that has a feature", () => {
    expect(lowestPlanWith(hasCustomEmoji)).toBe("solo");
    expect(lowestPlanWith(hasEmojiImport)).toBe("pro");
    expect(lowestPlanWith(() => false)).toBeUndefined();
  });

  it("allows imports from Pro up", () => {
    expect([PLANS.free, PLANS.solo, PLANS.pro, PLANS.scale].map(hasEmojiImport)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});
