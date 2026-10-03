// @vitest-environment happy-dom
/**
 * The landing hero's edge states on the real engine: a meaning-only query ("macintosh") shows the
 * edge's answer, and says so when the edge cannot answer instead of a bare "on your device". Every
 * edge answer shows its time, a cached one too. A picked emoji is copied to the clipboard.
 * Skipped until `pnpm data:build` has produced the packs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createEngine, type Pack, type SemanticProvider } from "emojisense";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PACK_VERSION } from "../src/config";
import en from "../src/i18n/en.json";
import { heroExamples } from "../src/i18n/examples";
import { HeroSearch } from "../src/islands/HeroSearch";

const PACK_DIR = join(process.cwd(), "../../packages/data/dist/packs", PACK_VERSION);
const built = existsSync(join(PACK_DIR, "pack.en.json"));
const pack = (name: string) => JSON.parse(readFileSync(join(PACK_DIR, `pack.${name}.json`), "utf8")) as Pack;
const engine = built ? createEngine([pack("en"), pack("en.ext")]) : undefined;

/** What the edge does for this test. */
let edge: SemanticProvider["search"] = async () => undefined;
/** What the edge already holds in memory (a loaded shard) for this test. */
let peek: NonNullable<SemanticProvider["peek"]> = () => undefined;

vi.mock("../src/lib/engine-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/engine-client")>()),
  useEngine: () => ({ engine, ready: "english" }),
  fullEngine: async () => engine,
  requestLanguages: () => {},
  sharedSemantic: (): SemanticProvider => ({
    search: (query, options) => edge(query, options),
    peek: (query, options) => peek(query, options),
  }),
  sharedStats: () => undefined,
  pageLocale: () => "en",
  visitorLocales: () => ["en"],
}));

afterEach(() => {
  cleanup();
  peek = () => undefined;
});

/** Stops the autoplay and types `query` as a visitor. */
function search(query: string) {
  render(<HeroSearch messages={en.hero} lang="en" examples={heroExamples("en")} />);
  const input = screen.getByRole("combobox");
  fireEvent.pointerDown(input);
  fireEvent.change(input, { target: { value: query } });
}

describe.skipIf(!built)("hero search edge states", () => {
  it("shows the edge's answer for a query only the meaning search knows", async () => {
    edge = async () => ({
      results: [{ emoji: "💻", id: "1F4BB", score: 0.51, source: "semantic" }],
      packVersion: PACK_VERSION,
      cached: false,
    });
    search("macintosh");
    await waitFor(() => expect(screen.getAllByRole("option")).not.toHaveLength(0));
    expect(document.querySelector(".hs-timing")?.textContent).toMatch(/edge AI$/);
    expect(document.querySelector(".hs-dot")?.hasAttribute("data-down")).toBe(false);
  });

  it("says the edge is unreachable, not just 'on your device', when the request fails", async () => {
    edge = async () => {
      throw new Error("emojisense: semantic search failed with HTTP 401");
    };
    search("macintosh");
    await waitFor(() => expect(screen.getByText(en.hero.emptyEdgeDown)).toBeTruthy());
    expect(document.querySelector(".hs-timing")?.textContent).toMatch(/edge unreachable$/);
    expect(document.querySelector(".hs-dot")?.hasAttribute("data-down")).toBe(true);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("shows the time of an edge cache answer", async () => {
    edge = async () => ({
      results: [{ emoji: "💻", id: "1F4BB", score: 0.51, source: "semantic" }],
      packVersion: PACK_VERSION,
      cached: true,
    });
    search("macintosh");
    await waitFor(() => expect(screen.getAllByRole("option")).not.toHaveLength(0));
    expect(document.querySelector(".hs-timing")?.textContent).toMatch(/\d ms · edge cache$/);
  });

  it("shows a time for a cached answer that needed no request", async () => {
    peek = () => ({
      results: [{ emoji: "💻", id: "1F4BB", score: 0.51, source: "semantic" }],
      packVersion: PACK_VERSION,
      cached: true,
    });
    search("macintosh");
    await waitFor(() => expect(screen.getAllByRole("option")).not.toHaveLength(0));
    expect(document.querySelector(".hs-timing")?.textContent).toMatch(/\d ms · edge cache$/);
  });
});

describe.skipIf(!built)("hero search copy", () => {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  afterEach(() => writeText.mockClear());

  it("copies the emoji the visitor clicks", async () => {
    search("pizza");
    await waitFor(() => expect(screen.getAllByRole("option")).not.toHaveLength(0));
    const second = screen.getAllByRole("option")[1] as HTMLElement;
    fireEvent.click(second);
    await waitFor(() => expect(screen.getByText(en.hero.copied)).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(second.textContent);
  });

  it("copies the highlighted emoji on Enter", async () => {
    search("pizza");
    await waitFor(() => expect(screen.getAllByRole("option")).not.toHaveLength(0));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(en.hero.copied)).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(screen.getAllByRole("option")[0]?.textContent);
  });
});
