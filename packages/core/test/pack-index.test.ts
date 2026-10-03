import { afterEach, describe, expect, it, vi } from "vitest";
import { noteSearch } from "../src/activity.js";
import { loadPacks } from "../src/loader.js";
import type { Pack } from "../src/pack.js";
import { QUIET_MS, sharedPackIndex, whenQuiet } from "../src/pack-index.js";
import { en } from "./fixture.js";

const tr: Pack = { ...en, locale: "tr" };

function packFetch(files: Record<string, Pack>) {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const pack = files[url.split("/").pop() ?? ""];
    return pack ? new Response(JSON.stringify(pack)) : new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const now = (task: () => void) => task();

afterEach(() => {
  vi.useRealTimers();
});

describe("sharedPackIndex", () => {
  it("gives every caller with the same packs one download and one index", async () => {
    const { fetchImpl, requests } = packFetch({ "pack.en.json": en, "pack.tr.json": tr });
    const options = { locale: "tr", extended: false, fetch: fetchImpl, whenIdle: now, whenQuiet: now };
    const first = sharedPackIndex({ ...options, packUrl: "https://packs.test/0.1.0" });
    const second = sharedPackIndex({ ...options, packUrl: "https://packs.test/0.1.0/" });
    expect(second).toBe(first);
    const [a, b] = await Promise.all([first.load(), second.load()]);
    expect(b).toBe(a);
    expect(requests).toHaveLength(2);
    expect(sharedPackIndex({ ...options, packUrl: "https://packs.test/0.1.0", locale: "en" })).not.toBe(
      first,
    );
  });

  it("builds the extension index only when typing pauses", async () => {
    const { fetchImpl } = packFetch({
      "pack.en.json": en,
      "pack.en.ext.json": { ...en, part: "ext" },
    });
    let quiet: (() => void) | undefined;
    const index = sharedPackIndex({
      packUrl: "https://ext.test/0.1.0",
      locale: "en",
      extended: true,
      fetch: fetchImpl,
      whenIdle: now,
      whenQuiet: (task) => {
        quiet = task;
      },
    });
    const core = await index.load();
    await vi.waitFor(() => expect(quiet).toBeDefined());
    expect(index.current()).toBe(core);
    const upgraded = new Promise((resolve) => index.subscribe(resolve));
    quiet?.();
    await upgraded;
    expect(index.current()?.packs.map((pack) => pack.part ?? "core")).toEqual(["core", "ext"]);
  });

  it("falls back to English, and retries after a failed load", async () => {
    let fail = true;
    const { fetchImpl } = packFetch({ "pack.en.json": en });
    const flaky = (async (input: RequestInfo | URL) =>
      fail ? new Response("down", { status: 503 }) : fetchImpl(input)) as typeof fetch;
    const index = sharedPackIndex({
      packUrl: "https://flaky.test/0.1.0",
      locale: "xx",
      extended: false,
      fetch: flaky,
      whenIdle: now,
      whenQuiet: now,
    });
    await expect(index.load()).rejects.toThrow(/HTTP 503/);
    fail = false;
    expect((await index.load()).engine.locales).toEqual(["en"]);
  });
});

describe("whenQuiet", () => {
  it("waits until no search ran for QUIET_MS", () => {
    vi.useFakeTimers();
    noteSearch();
    const task = vi.fn();
    whenQuiet(task);
    vi.advanceTimersByTime(QUIET_MS - 100);
    noteSearch();
    vi.advanceTimersByTime(QUIET_MS - 100);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(task).toHaveBeenCalledOnce();
  });
});

describe("loadPacks", () => {
  it("names the file and the status of a failed request", async () => {
    const { fetchImpl } = packFetch({});
    await expect(loadPacks({ baseUrl: "https://packs.test/0.1.0", fetch: fetchImpl })).rejects.toThrow(
      "emojisense: pack.en.json failed with HTTP 404",
    );
  });
});
