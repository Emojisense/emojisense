import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, queryFromPath } from "../src/lib/not-found";

describe("queryFromPath", () => {
  it.each([
    ["/jurassic-park", "jurassic park"],
    ["/blog/greatest_of_all_time/", "greatest of all time"],
    ["/docs/ship+it.html", "ship it"],
    ["/feliz%20cumplea%C3%B1os", "feliz cumpleaños"],
    ["/%E7%94%9F%E6%97%A5%E5%BF%AB%E4%B9%90", "生日快乐"],
    ["/%F0%9F%A6%96", "🦖"],
    ["/Pizza-Party/index.html", "pizza party"],
    ["/i'm-exhausted", "i'm exhausted"],
  ])("reads %s as “%s”", (path, query) => {
    expect(queryFromPath(path)).toBe(query);
  });

  it("skips segments without words", () => {
    expect(queryFromPath("/tacos/2024/")).toBe("tacos");
    expect(queryFromPath("/123/456")).toBe("");
    expect(queryFromPath("/")).toBe("");
  });

  it("survives malformed escapes", () => {
    expect(queryFromPath("/100%-sure")).toBe("100 sure");
  });

  it("cuts long addresses at a word boundary", () => {
    const query = queryFromPath(`/${"party-".repeat(30)}`);
    expect(query.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    expect(query.endsWith("party")).toBe(true);
  });
});
