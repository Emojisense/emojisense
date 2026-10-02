import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadPhotoSet, MAX_IMAGE_BYTES, parsePhotoLabels } from "../src/images/labels.ts";
import { parseMessages } from "../src/live/messages.ts";
import { canonicalEmoji, judgeRanking, summarizePrecision } from "../src/live/precision.ts";
import { type LiveRun, loadRuns, markTop, renderComparison, saveRun } from "../src/live/runs.ts";

const EVAL_ROOT = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "emojisense-live-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const line = (label: Record<string, unknown>) => JSON.stringify(label);
const valid = { file: "dog-sofa.jpg", answers: ["🐶", "🥹"], license: "CC0", source: "own photo" };

describe("photo labels", () => {
  it("parses the documented format and skips blank lines", () => {
    const labels = parsePhotoLabels(
      `${line(valid)}\n\n${line({ ...valid, file: "b.webp", license: "own" })}\n`,
    );
    expect(labels.map((l) => l.file)).toEqual(["dog-sofa.jpg", "b.webp"]);
    expect(labels[0]?.answers).toEqual(["🐶", "🥹"]);
  });

  it("rejects licenses we cannot commit, and CC BY without an author", () => {
    expect(() => parsePhotoLabels(line({ ...valid, license: "CC-BY-NC-4.0" }))).toThrow("not allowed");
    expect(() => parsePhotoLabels(line({ ...valid, license: "Unsplash" }))).toThrow("not allowed");
    expect(() => parsePhotoLabels(line({ ...valid, license: "CC-BY-4.0" }))).toThrow("author");
    expect(parsePhotoLabels(line({ ...valid, license: "CC-BY-SA-4.0", author: "A. Person" }))).toHaveLength(
      1,
    );
  });

  it("names the line of a broken label", () => {
    expect(() => parsePhotoLabels(`${line(valid)}\n{oops`)).toThrow("line 2");
    expect(() => parsePhotoLabels(line({ ...valid, file: "../secret.jpg" }))).toThrow("file");
    expect(() => parsePhotoLabels(line({ ...valid, file: "a.gif" }))).toThrow("file");
    expect(() => parsePhotoLabels(line({ ...valid, answers: [] }))).toThrow("answers");
    expect(() => parsePhotoLabels(line({ ...valid, source: " " }))).toThrow("source");
    expect(() => parsePhotoLabels(`${line(valid)}\n${line(valid)}`)).toThrow("twice");
  });

  it("loads the files that exist and reports missing and oversized ones", () => {
    const photos = join(dir, "set");
    mkdirSync(photos, { recursive: true });
    writeFileSync(join(photos, "dog-sofa.jpg"), Buffer.alloc(1000));
    writeFileSync(join(photos, "huge.jpg"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
    writeFileSync(
      join(photos, "labels.jsonl"),
      [valid, { ...valid, file: "gone.jpg" }, { ...valid, file: "huge.jpg" }].map(line).join("\n"),
    );
    const set = loadPhotoSet(photos);
    expect(set.photos.map((p) => p.label.file)).toEqual(["dog-sofa.jpg", "huge.jpg"]);
    expect(set.missing).toEqual(["gone.jpg"]);
    expect(set.oversized).toEqual(["huge.jpg"]);
  });

  it("keeps the committed photo set valid: every file present, under the API limit", () => {
    const set = loadPhotoSet(join(EVAL_ROOT, "photos"));
    expect(set.photos.length).toBeGreaterThanOrEqual(26);
    expect(set.missing).toEqual([]);
    expect(set.oversized).toEqual([]);
    for (const photo of set.photos) expect(photo.label.answers.length).toBeGreaterThanOrEqual(2);
  });
});

describe("labelled chat messages", () => {
  it("parses the committed set with several languages and traps", () => {
    const messages = parseMessages(readFileSync(join(EVAL_ROOT, "queries", "reactions.jsonl"), "utf8"));
    expect(messages.length).toBeGreaterThanOrEqual(40);
    expect(new Set(messages.map((m) => m.locale)).size).toBeGreaterThanOrEqual(5);
    expect(messages.find((m) => m.id === "en-smoke-tests")?.forbid).toContain("🚬");
  });

  it("rejects broken lines", () => {
    const ok = { id: "a", text: "thanks!", answers: ["🙏", "❤️"] };
    expect(parseMessages(line(ok))[0]).toMatchObject({ locale: "en", intent: "other" });
    expect(() => parseMessages(`${line(ok)}\n${line(ok)}`)).toThrow("repeated");
    expect(() => parseMessages(line({ ...ok, text: " " }))).toThrow("text");
    expect(() => parseMessages(line({ ...ok, answers: ["🙏"] }))).toThrow("answers");
    expect(() => parseMessages("{oops")).toThrow("line 1");
  });
});

describe("precision", () => {
  it("scores the top 1 and the share of acceptable emoji in the top 4", () => {
    const judged = judgeRanking(["🐶", "🦔", "🐕️", "🐩", "🥰"], ["🐶", "🐕", "🥰"], ["🦔"]);
    expect(judged).toEqual({
      top: ["🐶", "🦔", "🐕️", "🐩"],
      p1: 1,
      p4: 0.5,
      hit4: true,
      ceiling4: 0.75,
      trap4: true,
    });
    expect(judgeRanking([], ["🐶", "🐕"])).toMatchObject({ p1: 0, p4: 0, hit4: false, ceiling4: 0.5 });
  });

  it("ignores variation selectors and skin tones", () => {
    expect(canonicalEmoji("❤️")).toBe(canonicalEmoji("❤"));
    expect(canonicalEmoji("👍🏽")).toBe("👍");
    expect(judgeRanking(["👍🏽"], ["👍", "👌"]).p1).toBe(1);
  });

  it("averages to percentages", () => {
    const summary = summarizePrecision([
      judgeRanking(["🐶", "🐕", "🥰", "😍"], ["🐶", "🐕", "🥰", "😍"]),
      judgeRanking(["🦔"], ["🐶", "🐕"]),
    ]);
    expect(summary).toEqual({ n: 2, p1: 50, p4: 50, hit4: 50, ceiling4: 75, trap4: 0 });
  });
});

describe("stored runs", () => {
  const run = (label: string, top: string[], date: string): LiveRun => {
    const judged = judgeRanking(top, ["🐱", "🐈"], ["🐼"]);
    return {
      kind: "photos",
      label,
      date,
      api: "http://localhost:8788",
      summary: summarizePrecision([judged]),
      failed: 0,
      items: [
        { id: "cat", input: "a cat | asleep", answers: ["🐱", "🐈"], forbid: ["🐼"], judged, results: [] },
      ],
    };
  };

  it("orders before, after, then the rest by date, and renders a comparison", () => {
    const reports = join(dir, "reports");
    mkdirSync(reports, { recursive: true });
    saveRun(reports, run("zeta", ["🐱"], "2026-10-03"));
    saveRun(reports, run("after", ["🐱", "🐈"], "2026-10-02"));
    saveRun(reports, run("before", ["🐼", "🐱"], "2026-10-01"));
    const runs = loadRuns(reports, "photos");
    expect(runs.map((r) => r.label)).toEqual(["before", "after", "zeta"]);
    const markdown = renderComparison(runs, { title: "T", intro: [], itemName: "Photo" });
    expect(markdown).toContain("| cat | 🐱🐈 | 🐼✗ 🐱✓ | 🐱✓ 🐈✓ | 🐱✓ |");
    expect(markdown).toContain("a cat / asleep");
    expect(markTop({ ...(runs[0]?.items[0] as LiveRun["items"][number]), error: "timeout" })).toBe(
      "error: timeout",
    );
  });

  it("refuses labels that are not file-name safe", () => {
    expect(() => saveRun(dir, run("../x", [], "2026-10-01"))).toThrow("--label");
  });
});

describe("photos CLI", () => {
  it("skips with exit 0 when there are no photos", () => {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/photos.ts", "--photos", join(dir, "empty")],
      { cwd: EVAL_ROOT, encoding: "utf8" },
    );
    expect(output).toContain("Skipping");
  });
});
