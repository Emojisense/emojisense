import { describe, expect, it } from "vitest";
import { harness, search } from "./fixtures.ts";

describe("JSON responses", () => {
  it("are never sniffed as another type, errors that echo the input included", async () => {
    const h = harness();
    const answer = await h.call(search("rocket"));
    const refused = await h.call(search("rocket", "&locale=<svg onload=alert(1)>"));
    expect(refused.status).toBe(400);
    for (const res of [answer, refused]) {
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});
