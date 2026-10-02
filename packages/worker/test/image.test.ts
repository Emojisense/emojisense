import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, VISION_MODEL } from "../src/config.ts";
import type { ClassifyImageBody } from "../src/image.ts";
import { parseLabel, sniffImage, toBase64 } from "../src/vision.ts";
import { API, DEFAULT_LABEL, EMBEDDING_MODEL, harness, image, jpeg, ROW } from "./fixtures.ts";

const HASH = "0123456789abcdef";

describe("POST /v1/classify-image", () => {
  it("captions the image with the vision model, then searches caption and reaction", async () => {
    const h = harness({ embedTo: ROW.dog });
    const bytes = jpeg();
    const res = await h.call(image(bytes));
    const body = (await res.json()) as ClassifyImageBody;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ...DEFAULT_LABEL, cached: false, degraded: false, overLimit: false });
    expect(body.results[0]).toMatchObject({ emoji: "🐶" });

    const [model, input] = h.ai.mock.calls[0] ?? [];
    expect(model).toBe(VISION_MODEL);
    const { messages, response_format } = input as {
      messages: { role: string; content: unknown }[];
      response_format: { type: string };
    };
    expect(response_format.type).toBe("json_schema");
    expect(messages[1]?.content).toContainEqual({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${toBase64(bytes)}` },
    });
    expect(h.ai).toHaveBeenCalledWith(EMBEDDING_MODEL, {
      text: [`task: search result | query: ${DEFAULT_LABEL.caption}. ${DEFAULT_LABEL.reaction}`],
    });
  });

  it("caches only the caption, keyed by X-Image-Hash", async () => {
    const h = harness();
    await h.call(image(jpeg(), { "X-Image-Hash": HASH }));
    await h.ctx.settle();
    const second = (await (
      await h.call(image(jpeg(), { "X-Image-Hash": HASH.toUpperCase() }))
    ).json()) as ClassifyImageBody;
    expect(second).toMatchObject({ ...DEFAULT_LABEL, cached: true });
    expect(h.ai.mock.calls.filter(([model]) => model === VISION_MODEL)).toHaveLength(1);

    expect(h.cache.puts).toHaveLength(1);
    expect(h.cache.puts[0]).toContain(`h=${HASH}`);
    const stored = await h.cache.store.values().next().value?.clone().json();
    expect(stored).toEqual(DEFAULT_LABEL);
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

  it("degrades without metering when the vision model is unavailable", async () => {
    const h = harness({ env: { DEV_KEYS: "pk_demo" } });
    h.env.AI = { run: async () => Promise.reject(new Error("offline")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = (await (await h.call(image(jpeg(), {}, "?key=pk_demo"))).json()) as ClassifyImageBody;
    expect(body).toEqual({
      caption: "",
      reaction: "",
      results: [],
      cached: false,
      degraded: true,
      overLimit: false,
    });
    expect(await h.app.meter?.count("dev:0", "image_classifications")).toBe(0);
    warn.mockRestore();
  });
});

describe("vision helpers", () => {
  it("parse chat-completion JSON, fenced JSON and bare responses", () => {
    const wrap = (content: string) => ({ choices: [{ message: { content } }] });
    expect(parseLabel(wrap('{"caption":" a  cat ","reaction":"lol"}'))).toEqual({
      caption: "a cat",
      reaction: "lol",
    });
    expect(parseLabel(wrap('```json\n{"caption":"a cat","reaction":"lol"}\n```')).caption).toBe("a cat");
    expect(parseLabel({ response: { caption: "a cat" } })).toEqual({ caption: "a cat", reaction: "" });
    expect(() => parseLabel(wrap('{"reaction":"lol"}'))).toThrow();
    expect(() => parseLabel(wrap("not json"))).toThrow();
  });

  it("sniff signatures and encode base64 like btoa", () => {
    expect(sniffImage(jpeg())).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBP"))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("\x89PNG\r\n\x1a\n"))).toBeUndefined();
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
  });
});
