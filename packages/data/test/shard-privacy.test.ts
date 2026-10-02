import { normalize } from "emojisense";
import { describe, expect, it } from "vitest";
import { privacyReason } from "../src/shards/privacy.ts";
import { aggregateQueries } from "../src/shards/queries.ts";

/** Checked as typed and as the logs hold it (normalize() drops "@", "." and "/"). */
const both = (text: string) => [privacyReason(text), privacyReason(normalize(text))];

describe("privacyReason", () => {
  it("drops email addresses, before and after normalization", () => {
    expect(both("jane.doe@example.com")).toEqual(["email", "url"]);
    expect(both("Jane.Doe@gmail.com")).toEqual(["email", "email"]);
    expect(privacyReason("mail me at jane yahoo")).toBe("email");
  });

  it("drops URLs and domains", () => {
    expect(both("https://example.org/jane")).toEqual(["url", "url"]);
    expect(both("www.janes-shop.de")).toEqual(["url", "url"]);
    expect(both("janes-shop.com")).toEqual(["url", "url"]);
  });

  it("drops phone, card, account and postal numbers", () => {
    expect(both("+1 (555) 010-0199")).toEqual(["phone", "phone"]);
    expect(privacyReason("4111 1111 1111 1111")).toBe("phone");
    expect(privacyReason("call 0555 123 45 67")).toBe("phone");
    expect(privacyReason("90210")).toBe("number");
    expect(privacyReason("order 123456")).toBe("number");
    expect(privacyReason("٠٥٥٥١٢٣٤٥٦٧")).toBe("phone");
  });

  it("drops user ids, hashes and pasted tokens", () => {
    expect(privacyReason("jane1987")).toBe("code");
    expect(privacyReason(normalize("sk_live_abc123def"))).toBe("code");
    expect(privacyReason("a".repeat(31))).toBe("long-token");
  });

  it("drops text the alias blocklist blocks", () => {
    expect(privacyReason("you nazi")).toBe("blocked");
  });

  it("keeps ordinary emoji searches, numbers and words that look like domains", () => {
    for (const q of [
      "congrats on the launch",
      "happy new year 2027",
      "100",
      "24 7",
      "mp3",
      "covid19",
      "y2k party",
      "1080",
      "love me",
      "io ti amo",
      "com",
      "doğum günü",
      "çok yorgun",
      "生日快乐",
      "dot",
    ]) {
      expect([q, privacyReason(q)]).toEqual([q, undefined]);
    }
  });
});

describe("aggregateQueries privacy", () => {
  it("leaves out personal text however often it was seen", () => {
    const queries = aggregateQueries(
      [
        { q: "jane.doe@example.com", n: 900 },
        { q: "+1 555 010 0199", n: 900 },
        { q: "ship it", n: 9 },
      ],
      { minCount: 5, maxQueries: 10 },
    );
    expect(queries).toEqual([{ q: "ship it", n: 9, locales: ["en"] }]);
  });
});
