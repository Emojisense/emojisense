// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { afterEach, describe, expect, it } from "vitest";
import {
  CONSENT_KEY,
  cleanReferrer,
  cleanTitle,
  cleanUrl,
  readConsent,
  startGoogleAnalytics,
  updateConsent,
} from "../src/lib/analytics";

afterEach(() => {
  localStorage.clear();
  delete window.dataLayer;
  delete window.gtag;
  for (const script of document.head.querySelectorAll("script")) script.remove();
});

/** The data layer as plain arrays (gtag pushes Arguments objects). */
const calls = () => (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));

describe("search text stays out of Google Analytics", () => {
  it("drops the query and the hash, and keeps campaign tags", () => {
    expect(cleanUrl("https://emojisense.com/playground/?q=my+secret&locale=es#photo")).toBe(
      "https://emojisense.com/playground/",
    );
    expect(cleanUrl("https://emojisense.com/s/?q=hi&utm_source=x&utm_medium=social")).toBe(
      "https://emojisense.com/s/?utm_source=x&utm_medium=social",
    );
  });

  it("cleans our own referrers only", () => {
    const origin = "https://emojisense.com";
    expect(cleanReferrer("https://emojisense.com/playground/?q=private", origin)).toBe(
      "https://emojisense.com/playground/",
    );
    expect(cleanReferrer("https://news.example/post?id=1", origin)).toBe("https://news.example/post?id=1");
    expect(cleanReferrer("", origin)).toBe("");
  });

  it("replaces the shared-search title, which holds the query", () => {
    expect(cleanTitle("/s/", "“my secret” · Emoji search · Emojisense")).toBe("Shared search · Emojisense");
    expect(cleanTitle("/pricing/", "Pricing · Emojisense")).toBe("Pricing · Emojisense");
  });
});

describe("consent", () => {
  it("denies every storage type until the visitor accepts", () => {
    startGoogleAnalytics("G-TEST", undefined);
    const [first] = calls();
    expect(first).toEqual([
      "consent",
      "default",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      },
    ]);
    const config = calls().find(([command]) => command === "config");
    expect(config?.[1]).toBe("G-TEST");
    expect(config?.[2]).toMatchObject({
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    expect(document.head.querySelector("script")?.getAttribute("src")).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-TEST",
    );
  });

  it("starts with analytics storage granted after an earlier yes", () => {
    startGoogleAnalytics("G-TEST", "granted");
    expect(calls()[0]?.[2]).toMatchObject({ analytics_storage: "granted", ad_storage: "denied" });
  });

  it("reports a fixed path instead of a private address", () => {
    startGoogleAnalytics("G-TEST", undefined, "/404/");
    const config = calls().find(([command]) => command === "config");
    expect(config?.[2]).toMatchObject({ page_location: `${location.origin}/404/` });
  });

  it("saves the choice, updates Consent Mode and forgets the cookies on a no", () => {
    startGoogleAnalytics("G-TEST", undefined);
    for (const cookie of ["_ga=GA1.1.123", "_ga_TEST=GS1.1", "other=1"]) {
      // biome-ignore lint/suspicious/noDocumentCookie: the cookies that gtag.js would set
      document.cookie = `${cookie}; Path=/`;
    }

    updateConsent("granted");
    expect(readConsent()).toBe("granted");
    expect(calls().at(-1)).toEqual(["consent", "update", { analytics_storage: "granted" }]);

    updateConsent("denied");
    expect(localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(calls().at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toContain("other=1");
  });

  it("ignores an unknown stored value", () => {
    localStorage.setItem(CONSENT_KEY, "maybe");
    expect(readConsent()).toBeUndefined();
  });
});
