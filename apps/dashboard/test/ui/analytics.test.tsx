import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import type { AnalyticsResponse } from "../../src/shared/contract";
import { APP, me, stubApi } from "./fake-api";

const PRO_APP = { ...APP, plan: "pro" as const };

/** Brazil searches in Portuguese and English, Britain in English; "XX" is an unknown country. */
function report(url: URL): AnalyticsResponse {
  const country = url.searchParams.get("country");
  const locale = url.searchParams.get("locale");
  const rows = [
    { country: "BR", locale: "pt", query: "futebol", searches: 30 },
    { country: "BR", locale: "en", query: "football", searches: 10 },
    { country: "GB", locale: "en", query: "football", searches: 20 },
    { country: "XX", locale: "en", query: "football", searches: 5 },
  ];
  const kept = rows.filter((r) => (!country || r.country === country) && (!locale || r.locale === locale));
  const sum = (list: typeof rows) => list.reduce((total, r) => total + r.searches, 0);
  const group = (key: "country" | "locale", list: typeof rows) =>
    [...new Set(list.map((r) => r[key]))]
      .map((code) => ({ code, searches: sum(list.filter((r) => r[key] === code)) }))
      .sort((a, b) => b.searches - a.searches);
  return {
    days: [{ day: "2026-10-15", searches: sum(kept), misses: 0 }],
    topQueries: group("locale", kept).length > 0 ? [{ query: "football", searches: sum(kept) }] : [],
    topMisses: [],
    countries: group(
      "country",
      rows.filter((r) => !locale || r.locale === locale),
    ).map(({ code, searches }) => ({ country: code, searches, misses: 0 })),
    locales: group(
      "locale",
      rows.filter((r) => !country || r.country === country),
    ).map(({ code, searches }) => ({ locale: code, searches, misses: 0 })),
    filters: { country, locale },
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/apps/app_1/analytics");
});

describe("analytics by country and language", () => {
  function setup() {
    return stubApi({
      "GET /api/me": { body: me() },
      "GET /api/apps": { body: { apps: [PRO_APP] } },
      "GET /api/apps/app_1": { body: { app: PRO_APP, keys: [] } },
      "GET /api/apps/app_1/analytics": ({ url }) => ({ body: report(url) }),
    });
  }

  const analyticsCalls = (calls: { path: string }[]) =>
    calls.filter((call) => call.path.startsWith("/api/apps/app_1/analytics")).map((call) => call.path);

  it("breaks searches down by country and language, with names, flags and shares", async () => {
    setup();
    render(<App />);
    const countries = await screen.findByRole("region", { name: "Countries" });
    const rows = within(countries).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "🇧🇷 Brazil40 · 61.5%",
      "🇬🇧 United Kingdom20 · 30.8%",
      "🌐 Unknown5 · 7.7%",
    ]);
    const languages = screen.getByRole("region", { name: "Languages" });
    expect(within(languages).getByRole("button", { name: /English/ })).toBeTruthy();
    expect(within(languages).getByRole("button", { name: /Portuguese/ })).toBeTruthy();
  });

  it("filters by a country from the select or from its row, and clears the filters", async () => {
    const { calls } = setup();
    render(<App />);
    const countrySelect = (await screen.findByLabelText("Country")) as HTMLSelectElement;
    await screen.findByRole("region", { name: "Countries" });
    fireEvent.change(countrySelect, { target: { value: "BR" } });
    // The language list follows the country filter.
    const languages = await screen.findByRole("region", { name: "Languages" });
    await within(languages).findByRole("button", { name: /Portuguese/ });
    expect(analyticsCalls(calls).at(-1)).toBe("/api/apps/app_1/analytics?days=30&country=BR");

    fireEvent.click(within(languages).getByRole("button", { name: /Portuguese/ }));
    await screen.findByRole("button", { name: /Portuguese/, pressed: true });
    expect(analyticsCalls(calls).at(-1)).toBe("/api/apps/app_1/analytics?days=30&country=BR&locale=pt");
    expect((screen.getByLabelText("Language") as HTMLSelectElement).value).toBe("pt");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("region", { name: "Countries" });
    expect(analyticsCalls(calls).at(-1)).toBe("/api/apps/app_1/analytics?days=30");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });
});
