import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, type Pack, type PackRow } from "emojisense";
import { afterAll, describe, expect, it } from "vitest";
import {
  filenameCaptioner,
  parseCaptionAnswer,
  sidecarCaptioner,
  workersAiCaptioner,
} from "../src/images/captioners.ts";
import { loadPhotoSet, MAX_IMAGE_BYTES, type Photo, parsePhotoLabels } from "../src/images/labels.ts";
import { rankForCaption } from "../src/images/search.ts";

const dir = mkdtempSync(join(tmpdir(), "emojisense-photos-"));
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
    rmSync(photos, { recursive: true, force: true });
    execFileSync("mkdir", ["-p", photos]);
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

  it("treats a directory without labels as an empty set", () => {
    expect(loadPhotoSet(join(dir, "nothing-here"))).toEqual({ photos: [], missing: [], oversized: [] });
  });
});

describe("captioners", () => {
  const photo: Photo = { label: { ...valid }, path: join(dir, "dog-sofa.jpg"), bytes: 4 };
  writeFileSync(photo.path, Buffer.from([1, 2, 3, 4]));

  it("reads captions written beforehand", async () => {
    const path = join(dir, "captions.json");
    writeFileSync(
      path,
      JSON.stringify({ "dog-sofa.jpg": { caption: "a puppy on a sofa", reaction: "aww" } }),
    );
    const captioner = sidecarCaptioner(path);
    expect(await captioner.caption(photo)).toEqual({ caption: "a puppy on a sofa", reaction: "aww" });
    await expect(captioner.caption({ ...photo, label: { ...valid, file: "x.jpg" } })).rejects.toThrow(
      "x.jpg",
    );
    expect(() => sidecarCaptioner(join(dir, "none.json"))).toThrow("not found");
  });

  it("uses the file name as a smoke-test caption", async () => {
    expect(await filenameCaptioner().caption(photo)).toEqual({ caption: "dog sofa", reaction: "" });
  });

  it("parses the vision model answer and sends the image bytes", async () => {
    expect(parseCaptionAnswer("Caption: a dog | Reaction: so cute")).toEqual({
      caption: "a dog",
      reaction: "so cute",
    });
    expect(parseCaptionAnswer("A dog on a couch.")).toEqual({ caption: "A dog on a couch.", reaction: "" });
    let sent: Record<string, unknown> = {};
    const captioner = workersAiCaptioner("@cf/test/vision", async (_, input) => {
      sent = input;
      return { description: "caption: a puppy | reaction: aww" };
    });
    expect(await captioner.caption(photo)).toEqual({ caption: "a puppy", reaction: "aww" });
    expect(sent.image).toEqual([1, 2, 3, 4]);
  });
});

describe("caption → emoji", () => {
  const row = (emoji: string, hexcode: string, label: string, keyword: string, alias: string): PackRow => [
    emoji,
    hexcode,
    0,
    1,
    0,
    label,
    "",
    keyword,
    alias,
    "",
    "",
  ];
  const pack: Pack = {
    format: "emojisense-pack",
    formatVersion: 1,
    packVersion: "test",
    locale: "en",
    emojiVersion: "17.0",
    groups: ["test"],
    emoji: [
      row("🐶", "1F436", "dog face", "dog|puppy", "doggo"),
      row("🥹", "1F979", "face holding back tears", "grateful|touched", "aww|so cute"),
      row("🛋️", "1F6CB-FE0F", "couch and lamp", "couch|sofa", ""),
      row("🚀", "1F680", "rocket", "space", "ship it"),
    ],
  };
  const engine = createEngine(pack);

  it("puts what the photo shows and how people react in the top 5", () => {
    const top = rankForCaption(engine, { caption: "a puppy asleep on a sofa", reaction: "aww so cute" });
    expect(top.slice(0, 5)).toEqual(expect.arrayContaining(["🐶", "🥹"]));
    expect(top).not.toContain("🚀");
  });

  it("works with a caption alone and returns nothing for empty text", () => {
    expect(rankForCaption(engine, { caption: "dog", reaction: "" })[0]).toBe("🐶");
    expect(rankForCaption(engine, { caption: "", reaction: " " })).toEqual([]);
  });
});

describe("eval:images CLI", () => {
  it("skips with exit 0 when there are no photos", () => {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/images.ts", "--photos", join(dir, "empty")],
      { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
    );
    expect(output).toContain("Skipping");
  });
});
