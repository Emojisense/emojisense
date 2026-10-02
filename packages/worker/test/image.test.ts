import { createEngine } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, VISION_MODEL, VISION_PROMPT_VERSION } from "../src/config.ts";
import { resolveEmoji } from "../src/emoji-lookup.ts";
import { type ClassifyImageBody, labelCacheKey, sha256Hex } from "../src/image.ts";
import type { Store } from "../src/store.ts";
import { parseLabel, sniffImage, toBase64 } from "../src/vision.ts";
import {
  API,
  catalog,
  DEFAULT_LABEL,
  EMBEDDING_MODEL,
  harness,
  image,
  jpeg,
  KEYED,
  ROW,
} from "./fixtures.ts";

const HASH = "0123456789abcdef";
/** A classification with the harness's development key. */
const classify = (bytes: Uint8Array, headers: Record<string, string> = {}) => image(bytes, headers, KEYED);
const { emoji: _proposed, ...PUBLIC_LABEL } = DEFAULT_LABEL;
/** The cache key of `jpeg()`: the SHA-256 of its bytes. */
const jpegKey = async () => labelCacheKey(API, await sha256Hex(jpeg()));
/** Another valid JPEG with other bytes. */
const otherJpeg = () => {
  const bytes = jpeg();
  bytes[10] = 9;
  return bytes;
};
const visionCalls = (h: ReturnType<typeof harness>) =>
  h.ai.mock.calls.filter(([model]) => model === VISION_MODEL).length;

describe("POST /v1/classify-image", () => {
  it("labels the image with the vision model, then embeds the caption alone", async () => {
    const h = harness({ embedTo: ROW.dog });
    const bytes = jpeg();
    const res = await h.call(classify(bytes));
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
    const body = (await (await h.call(classify(jpeg()))).json()) as ClassifyImageBody;
    expect(body.results.map((r) => r.emoji)).toEqual(["🚀", "🌋"]);
    expect(body.results[0]?.score).toBeGreaterThan(body.results[1]?.score ?? 1);
  });

  it("caches only the label, keyed by the image's SHA-256 and the prompt version", async () => {
    const h = harness();
    await h.call(classify(jpeg(), { "X-Image-Hash": HASH }));
    await h.ctx.settle();
    const second = (await (
      await h.call(classify(jpeg(), { "X-Image-Hash": HASH.toUpperCase() }))
    ).json()) as ClassifyImageBody;
    expect(second).toMatchObject({ ...PUBLIC_LABEL, cached: true });
    expect(visionCalls(h)).toBe(1);

    const key = await jpegKey();
    expect(h.cache.puts).toEqual([key.url]);
    expect(h.cache.puts[0]).toContain(`sha256=${await sha256Hex(jpeg())}`);
    expect(h.cache.puts[0]).not.toContain(HASH);
    const stored = await h.cache.store.values().next().value?.clone().json();
    expect(stored).toEqual(DEFAULT_LABEL);
  });

  it("never lets X-Image-Hash reach the label of another image", async () => {
    const h = harness({ label: { ...DEFAULT_LABEL, caption: "a cat on a keyboard" } });
    // A poisoned entry under the victim's bytes cannot be written with the attacker's image…
    await h.call(classify(otherJpeg(), { "X-Image-Hash": HASH }));
    await h.ctx.settle();
    // …and the victim's image with the same hash gets its own label, not the cached one.
    const victim = (await (
      await h.call(classify(jpeg(), { "X-Image-Hash": HASH }))
    ).json()) as ClassifyImageBody;
    expect(victim.cached).toBe(false);
    expect(visionCalls(h)).toBe(2);
    expect(new Set(h.cache.puts).size).toBe(2);

    // The same bytes with any other valid hash still hit their own entry.
    const again = (await (
      await h.call(classify(jpeg(), { "X-Image-Hash": "fedcba9876543210" }))
    ).json()) as ClassifyImageBody;
    expect(again.cached).toBe(true);
    expect(visionCalls(h)).toBe(2);
  });

  it("does not read a label stored under the client's hash, as before", async () => {
    const h = harness();
    const legacy = new Request(
      `${API}/v1/classify-image?${new URLSearchParams({ h: HASH, v: `${VISION_MODEL}:${VISION_PROMPT_VERSION}` })}`,
    );
    await h.cache.put(legacy, Response.json({ caption: "a poisoned caption", reaction: "" }));
    const body = (await (
      await h.call(classify(jpeg(), { "X-Image-Hash": HASH }))
    ).json()) as ClassifyImageBody;
    expect(body).toMatchObject({ caption: DEFAULT_LABEL.caption, cached: false });
  });

  it("does not read a label cached by an older prompt version", async () => {
    const h = harness();
    const old = new Request(
      `${API}/v1/classify-image?${new URLSearchParams({ sha256: await sha256Hex(jpeg()), v: `${VISION_MODEL}:${VISION_PROMPT_VERSION - 1}` })}`,
    );
    await h.cache.put(old, Response.json({ caption: "an old caption", reaction: "" }));
    const body = (await (
      await h.call(classify(jpeg(), { "X-Image-Hash": HASH }))
    ).json()) as ClassifyImageBody;
    expect(body).toMatchObject({ caption: DEFAULT_LABEL.caption, cached: false });
    expect((await jpegKey()).url).toContain(
      `v=${encodeURIComponent(`${VISION_MODEL}:${VISION_PROMPT_VERSION}`)}`,
    );
    expect(VISION_PROMPT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("reads a cached label without keywords or emoji", async () => {
    const h = harness({ embedTo: ROW.dog });
    await h.cache.put(await jpegKey(), Response.json({ caption: "a puppy", reaction: "aww" }));
    const body = (await (
      await h.call(classify(jpeg(), { "X-Image-Hash": HASH }))
    ).json()) as ClassifyImageBody;
    expect(body).toMatchObject({ caption: "a puppy", keywords: [], cached: true });
    expect(body.results[0]?.emoji).toBe("🐶");
    expect(visionCalls(h)).toBe(0);
  });

  it("does not cache without a hash and never logs captions", async () => {
    const h = harness();
    const res = await h.call(classify(jpeg()));
    await h.ctx.settle();
    expect(h.cache.puts).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.events.mock.calls[0]?.[0].blobs).toEqual(["", "en", "hybrid", "miss", "image"]);
    expect(JSON.stringify(h.events.mock.calls)).not.toContain("puppy");
  });

  it("refuses images over 256 KB with 413, declared or streamed", async () => {
    const h = harness();
    const big = jpeg(MAX_IMAGE_BYTES + 1);
    expect((await h.call(classify(big))).status).toBe(413);
    expect((await h.call(classify(jpeg(), { "content-length": String(MAX_IMAGE_BYTES + 1) }))).status).toBe(
      413,
    );
    expect((await h.call(classify(jpeg(MAX_IMAGE_BYTES)))).status).toBe(200);
    expect(h.ai.mock.calls.filter(([model]) => model === VISION_MODEL)).toHaveLength(1);
  });

  it("accepts only JPEG and WebP bodies with a matching signature", async () => {
    const h = harness();
    expect((await h.call(classify(jpeg(), { "content-type": "image/png" }))).status).toBe(400);
    expect((await h.call(classify(new Uint8Array([1, 2, 3, 4])))).status).toBe(400);
    expect((await h.call(classify(new Uint8Array()))).status).toBe(400);
    expect((await h.call(classify(jpeg(), { "X-Image-Hash": "nothex" }))).status).toBe(400);
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect((await h.call(classify(webp, { "content-type": "image/webp" }))).status).toBe(200);
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
    expect(await offline.app.meter?.accountCount("dev:0", "image_classifications")).toBe(0);

    const garbage = harness({ label: "I see a dog!" });
    expect(await (await garbage.call(classify(jpeg()))).json()).toEqual(expected);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("dog");
    warn.mockRestore();
  });

  it("needs a key: anonymous callers get 401 before the image is read", async () => {
    const h = harness();
    const request = image(jpeg(), { "X-Image-Hash": HASH });
    const res = await h.call(request);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "a key is required for image classification" });
    expect(request.bodyUsed).toBe(false);
    expect(h.ai).not.toHaveBeenCalled();
    expect(h.cache.puts).toEqual([]);
  });

  it("answers 503, not 401, when a key was sent but the key store is down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { findKeyByHash: vi.fn().mockRejectedValue(new Error("D1 unavailable")) };
    const h = harness({ store: store as unknown as Store });
    const res = await h.call(image(jpeg(), {}, "?key=pk_live_unchecked"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(h.ai).not.toHaveBeenCalled();
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

  it("hash the image bytes with SHA-256", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
