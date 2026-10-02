import { createEngine } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, VISION_MODEL, VISION_PROMPT_VERSION } from "../src/config.ts";
import { resolveEmoji } from "../src/emoji-lookup.ts";
import { type ClassifyImageBody, labelCacheKey } from "../src/image.ts";
import { parseLabel, sniffImage, toBase64 } from "../src/vision.ts";
import { API, catalog, DEFAULT_LABEL, EMBEDDING_MODEL, harness, image, jpeg, ROW } from "./fixtures.ts";

const HASH = "0123456789abcdef";
const { emoji: _proposed, ...PUBLIC_LABEL } = DEFAULT_LABEL;

describe("POST /v1/classify-image", () => {
  it("labels the image with the vision model, then embeds the caption alone", async () => {
    const h = harness({ embedTo: ROW.dog });
    const bytes = jpeg();
    const res = await h.call(image(bytes));
    const body = (await res.json()) as ClassifyImageBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ...PUBLIC_LABEL, cached: false, degraded: false, overLimit: false });
    expect(body).not.toHaveProperty("emoji");
    expect(body.results[0]).toMatchObject({ emoji: "🐶" });

    const [model, input] = h.ai.mock.calls[0] ?? [];
    expect(model).toBe(VISION_MODEL);
    const { messages, response_format } = input as {
      messages: { role: string; content: unknown }[];
      response_format: { type: string; json_schema: { schema: { required: string[] } } };
    };
    expect(response_format.type).toBe("json_schema");
    expect(response_format.json_schema.schema.required).toEqual(["caption", "reaction", "keywords", "emoji"]);
    expect(messages[1]?.content).toContainEqual({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${toBase64(bytes)}` },
    });
    expect(h.ai).toHaveBeenCalledWith(EMBEDDING_MODEL, { text: [DEFAULT_LABEL.caption] });
  });

  it("ranks the model's own emoji first and drops proposals the catalog does not know", async () => {
    const h = harness({
      embedTo: ROW.volcano,
      label: {
        caption: "a rocket launch",
        reaction: "wow",
        keywords: ["rocket"],
        emoji: ["🚀", "🛸", "dog"],
      },
    });
    const body = (await (await h.call(image(jpeg()))).json()) as ClassifyImageBody;
    expect(body.results.map((r) => r.emoji)).toEqual(["🚀", "🌋"]);
    expect(body.results[0]?.score).toBeGreaterThan(body.results[1]?.score ?? 1);
  });

  it("caches only the label, keyed by X-Image-Hash and the prompt version", async () => {
    const h = harness();
    await h.call(image(jpeg(), { "X-Image-Hash": HASH }));
    await h.ctx.settle();
    const second = (await (
      await h.call(image(jpeg(), { "X-Image-Hash": HASH.toUpperCase() }))
    ).json()) as ClassifyImageBody;
    expect(second).toMatchObject({ ...PUBLIC_LABEL, cached: true });
    expect(h.ai.mock.calls.filter(([model]) => model === VISION_MODEL)).toHaveLength(1);

    expect(h.cache.puts).toEqual([labelCacheKey(API, HASH).url]);
    expect(h.cache.puts[0]).toContain(`h=${HASH}`);
    const stored = await h.cache.store.values().next().value?.clone().json();
    expect(stored).toEqual(DEFAULT_LABEL);
  });

  it("does not read a label cached by an older prompt version", async () => {
    const h = harness();
    const old = new Request(
      `${API}/v1/classify-image?${new URLSearchParams({ h: HASH, v: `${VISION_MODEL}:${VISION_PROMPT_VERSION - 1}` })}`,
    );
    await h.cache.put(old, Response.json({ caption: "an old caption", reaction: "" }));
    const body = (await (await h.call(image(jpeg(), { "X-Image-Hash": HASH }))).json()) as ClassifyImageBody;
    expect(body).toMatchObject({ caption: DEFAULT_LABEL.caption, cached: false });
    expect(labelCacheKey(API, HASH).url).toContain(
      `v=${encodeURIComponent(`${VISION_MODEL}:${VISION_PROMPT_VERSION}`)}`,
    );
    expect(VISION_PROMPT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("reads a cached label without keywords or emoji", async () => {
    const h = harness({ embedTo: ROW.dog });
    await h.cache.put(labelCacheKey(API, HASH), Response.json({ caption: "a puppy", reaction: "aww" }));
    const body = (await (await h.call(image(jpeg(), { "X-Image-Hash": HASH }))).json()) as ClassifyImageBody;
    expect(body).toMatchObject({ caption: "a puppy", keywords: [], cached: true });
    expect(body.results[0]?.emoji).toBe("🐶");
    expect(h.ai.mock.calls.filter(([model]) => model === VISION_MODEL)).toHaveLength(0);
  });

  it("does not cache without a hash and never logs captions", async () => {
    const h = harness();
    const res = await h.call(image(jpeg()));
    await h.ctx.settle();
    expect(h.cache.puts).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.events.mock.calls[0]?.[0].blobs).toEqual(["", "en", "hybrid", "miss", "image"]);
    expect(JSON.stringify(h.events.mock.calls)).not.toContain("puppy");
  });

  it("refuses images over 256 KB with 413, declared or streamed", async () => {
    const h = harness();
    const big = jpeg(MAX_IMAGE_BYTES + 1);
    expect((await h.call(image(big))).status).toBe(413);
    expect((await h.call(image(jpeg(), { "content-length": String(MAX_IMAGE_BYTES + 1) }))).status).toBe(413);
    expect((await h.call(image(jpeg(MAX_IMAGE_BYTES)))).status).toBe(200);
    expect(h.ai.mock.calls.filter(([model]) => model === VISION_MODEL)).toHaveLength(1);
  });

  it("accepts only JPEG and WebP bodies with a matching signature", async () => {
    const h = harness();
    expect((await h.call(image(jpeg(), { "content-type": "image/png" }))).status).toBe(400);
    expect((await h.call(image(new Uint8Array([1, 2, 3, 4])))).status).toBe(400);
    expect((await h.call(image(new Uint8Array()))).status).toBe(400);
    expect((await h.call(image(jpeg(), { "X-Image-Hash": "nothex" }))).status).toBe(400);
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect((await h.call(image(webp, { "content-type": "image/webp" }))).status).toBe(200);
    expect((await h.call(new Request(`${API}/v1/classify-image`))).status).toBe(405);
  });

  it("degrades without metering when the vision model is unavailable or answers garbage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const expected = {
      caption: "",
      reaction: "",
      keywords: [],
      results: [],
      cached: false,
      degraded: true,
      overLimit: false,
    };
    const offline = harness({ env: { DEV_KEYS: "pk_demo" } });
    offline.env.AI = { run: async () => Promise.reject(new Error("offline")) };
    expect(await (await offline.call(image(jpeg(), {}, "?key=pk_demo"))).json()).toEqual(expected);
    expect(await offline.app.meter?.count("dev:0", "image_classifications")).toBe(0);

    const garbage = harness({ label: "I see a dog!" });
    expect(await (await garbage.call(image(jpeg()))).json()).toEqual(expected);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("dog");
    warn.mockRestore();
  });
});

describe("vision label parser", () => {
  const wrap = (content: string) => ({ choices: [{ message: { content } }] });
  const engine = catalog.engine();
  const known = (text: string) => resolveEmoji(engine, text).map((id) => engine.get(id)?.emoji ?? "");

  it("reads chat-completion JSON, fenced JSON and bare responses", () => {
    const answer = { caption: " a  dog ", reaction: "lol", keywords: ["Dog", " sofa "], emoji: ["🐶"] };
    expect(parseLabel(wrap(JSON.stringify(answer)), known)).toEqual({
      caption: "a dog",
      reaction: "lol",
      keywords: ["dog", "sofa"],
      emoji: ["🐶"],
    });
    expect(parseLabel(wrap(`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``), known).caption).toBe("a dog");
    expect(parseLabel({ response: { caption: "a cat" } }, known)).toEqual({
      caption: "a cat",
      reaction: "",
      keywords: [],
      emoji: [],
    });
  });

  it("throws on bad JSON or a missing caption", () => {
    expect(() => parseLabel(wrap("not json"), known)).toThrow();
    expect(() => parseLabel(wrap('{"caption": "a dog", "emoji": ['), known)).toThrow();
    expect(() => parseLabel(wrap('{"reaction":"lol","emoji":["🐶"]}'), known)).toThrow("no caption");
    expect(() => parseLabel(wrap('{"caption":"   "}'), known)).toThrow("no caption");
    expect(() => parseLabel(undefined, known)).toThrow();
  });

  it("keeps only catalog emoji: splits runs, strips skin tones, drops words and repeats", () => {
    const label = parseLabel(
      wrap(
        JSON.stringify({
          caption: "a dog and a rocket",
          emoji: ["🐶🚀", "🦄", ":dog:", "dog", "", 42, "🐶", "🌋️"],
          keywords: "dog",
        }),
      ),
      known,
    );
    expect(label.emoji).toEqual(["🐶", "🚀", "🌋"]);
    expect(label.keywords).toEqual([]);
  });

  it("caps keywords at 6 and emoji at 8", () => {
    const numbers = Array.from({ length: 12 }, (_, i) => String(i));
    const label = parseLabel(
      wrap(JSON.stringify({ caption: "a lot", keywords: numbers, emoji: numbers })),
      (text) => [text],
    );
    expect(label.keywords).toEqual(numbers.slice(0, 6));
    expect(label.emoji).toEqual(numbers.slice(0, 8));
  });

  it("maps a skin-toned proposal to its base emoji", () => {
    const people = createEngine({
      format: "emojisense-pack",
      formatVersion: 1,
      packVersion: "t",
      locale: "en",
      emojiVersion: "17.0",
      groups: ["g"],
      emoji: [["👍️", "1F44D", 0, 1, 1, "thumbs up", "", "", "", "", ""]],
    });
    expect(resolveEmoji(people, "👍🏽")).toEqual(["1F44D"]);
    expect(resolveEmoji(people, "👍")).toEqual(["1F44D"]);
  });
});

describe("image helpers", () => {
  it("sniff signatures and encode base64 like btoa", () => {
    expect(sniffImage(jpeg())).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBP"))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("\x89PNG\r\n\x1a\n"))).toBeUndefined();
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
  });
});
