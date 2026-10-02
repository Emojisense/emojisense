import { LOCALE_CODES } from "@emojisense/data/locales";
import { describe, expect, it } from "vitest";
import { parseLocale } from "../src/http.ts";
import type { SearchBody } from "../src/search.ts";
import { harness, image, jpeg, reactions, search } from "./fixtures.ts";

describe("parseLocale", () => {
  it("accepts every pack locale", () => {
    expect(LOCALE_CODES).toHaveLength(11);
    for (const code of LOCALE_CODES) expect(parseLocale(code)).toBe(code);
  });

  it("maps BCP 47 tags to their language, ignoring case", () => {
    expect(parseLocale("en-US")).toBe("en");
    expect(parseLocale("pt-BR")).toBe("pt");
    expect(parseLocale("zh-Hans")).toBe("zh");
    expect(parseLocale("zh-Hant-TW")).toBe("zh");
    expect(parseLocale("ES")).toBe("es");
    expect(parseLocale("en_GB")).toBe("en");
  });

  it("defaults to English when no locale is given", () => {
    expect(parseLocale(null)).toBe("en");
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("")).toBe("en");
  });

  it("rejects languages without a pack and values that are not strings", () => {
    for (const raw of ["de", "xx", "english", "-", 42, ["es"]]) expect(parseLocale(raw)).toBeUndefined();
  });
});

describe("locale parameter on the API", () => {
  it("accepts every pack locale on all three endpoints", async () => {
    const h = harness();
    for (const locale of LOCALE_CODES) {
      const found = await h.call(search("rocket", `&locale=${locale}`));
      expect(found.status, locale).toBe(200);
      const reacted = await h.call(reactions({ text: "ship it", locale }));
      expect(reacted.status, locale).toBe(200);
      const classified = await h.call(image(jpeg(), {}, `?locale=${locale}`));
      expect(classified.status, locale).toBe(200);
    }
  });

  it("answers 400 with the supported list for an unknown locale, before any metering", async () => {
    const h = harness();
    const res = await h.call(search("rocket", "&locale=de"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      'unknown locale "de": use one of en, zh, hi, es, ar, fr, bn, pt, ru, id, tr (or a BCP 47 tag of one, e.g. pt-BR)',
    );
    expect((await h.call(reactions({ text: "hi", locale: 7 }))).status).toBe(400);
    expect((await h.call(image(jpeg(), {}, "?locale=xx"))).status).toBe(400);
    expect(h.ai).not.toHaveBeenCalled();
    expect(h.events).not.toHaveBeenCalled();
  });

  it("keys the shared cache and the analytics by the parsed locale", async () => {
    const h = harness();
    await h.call(search("lava eruption", "&locale=es-MX"));
    await h.ctx.settle();
    expect(h.cache.puts).toHaveLength(1);
    expect(new URL(h.cache.puts[0] as string).searchParams.get("locale")).toBe("es");
    const spanish = (await (await h.call(search("lava eruption", "&locale=es"))).json()) as SearchBody;
    expect(spanish.cached).toBe(true);
    const english = (await (await h.call(search("lava eruption", "&locale=en"))).json()) as SearchBody;
    expect(english.cached).toBe(false);
    expect(h.events.mock.calls.map(([point]) => point.blobs[1])).toEqual(["es", "es", "en"]);
  });
});
