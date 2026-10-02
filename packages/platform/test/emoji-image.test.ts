import { describe, expect, it } from "vitest";
import { CUSTOM_EMOJI_MAX_BYTES, checkSvg, inspectEmojiImage, sniffEmojiImage } from "../src/emoji-image.js";
import { IMAGES, svg } from "./fakes.js";

const encode = (text: string) => new TextEncoder().encode(text);

function rejection(bytes: Uint8Array) {
  const checked = inspectEmojiImage(bytes);
  if (checked.ok) throw new Error("expected the image to be rejected");
  return checked;
}

describe("sniffEmojiImage", () => {
  it.each([
    ["png", "image/png"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
    ["svg", "image/svg+xml"],
  ] as const)("detects %s by its first bytes", (kind, contentType) => {
    expect(sniffEmojiImage(IMAGES[kind])).toEqual({ contentType, extension: kind });
  });

  it("finds the SVG root after a BOM, an XML declaration, comments and a DOCTYPE", () => {
    const text =
      '﻿<?xml version="1.0"?>\n<!-- made by hand -->\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg/>';
    expect(sniffEmojiImage(encode(text))?.contentType).toBe("image/svg+xml");
  });

  it("does not trust anything else, even when it looks like an image name", () => {
    expect(sniffEmojiImage(encode("\xFF\xD8\xFF\xE0 jpeg"))).toBeUndefined();
    expect(sniffEmojiImage(encode("<html><svg></svg></html>"))).toBeUndefined();
    expect(sniffEmojiImage(encode("RIFF0000WAVE"))).toBeUndefined();
  });
});

describe("inspectEmojiImage", () => {
  it("accepts the four formats and keeps the bytes", () => {
    const checked = inspectEmojiImage(IMAGES.png);
    expect(checked).toMatchObject({ ok: true, image: { contentType: "image/png", extension: "png" } });
    expect(checked.ok && checked.image.bytes).toBe(IMAGES.png);
    for (const kind of ["gif", "webp", "svg"] as const) {
      expect(inspectEmojiImage(IMAGES[kind])).toMatchObject({ ok: true, image: { extension: kind } });
    }
  });

  it("rejects empty, oversized and unsupported files with their status", () => {
    expect(rejection(new Uint8Array())).toMatchObject({ error: "missing_file", status: 400 });
    const large = new Uint8Array(CUSTOM_EMOJI_MAX_BYTES + 1);
    large.set(IMAGES.png);
    expect(rejection(large)).toMatchObject({ error: "image_too_large", status: 413, field: "file" });
    expect(rejection(encode("just text"))).toMatchObject({ error: "unsupported_image", status: 415 });
    expect(rejection(encode("<html><body>hi</body></html>"))).toMatchObject({ error: "unsupported_image" });
    expect(rejection(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({
      error: "unsupported_image",
    });
  });

  it("accepts exactly the size limit", () => {
    const limit = new Uint8Array(CUSTOM_EMOJI_MAX_BYTES);
    limit.set(IMAGES.png);
    expect(inspectEmojiImage(limit)).toMatchObject({ ok: true, image: { contentType: "image/png" } });
  });

  it("rejects an SVG that is not valid UTF-8", () => {
    const bytes = new Uint8Array([...encode("<svg>"), 0xff, 0xfe, ...encode("</svg>")]);
    expect(rejection(bytes)).toMatchObject({ error: "unsupported_image" });
  });

  it("rejects unsafe SVGs with a reason", () => {
    expect(rejection(svg("<script>alert(1)</script>"))).toMatchObject({
      error: "unsafe_svg",
      status: 400,
      message: expect.stringContaining("scripts"),
    });
  });
});

describe("checkSvg", () => {
  const unsafe = [
    ["a script element", "<script>alert(1)</script>"],
    ["an uppercase script element", "<SCRIPT>alert(1)</SCRIPT>"],
    ["an event handler", '<circle r="4" onclick="alert(1)"/>'],
    ["an event handler after a slash", "<circle/onload=alert(1) />"],
    ["a javascript: link", '<a href="javascript:alert(1)"><circle r="4"/></a>'],
    ["an encoded javascript: link", '<a xlink:href="&#106;ava&#x73;cript&colon;alert(1)"><circle/></a>'],
    ["javascript: split by whitespace", '<a href="java\tscript:alert(1)"/>'],
    ["an external href", '<image href="https://evil.example/track.png"/>'],
    ["an external xlink:href", '<use xlink:href="https://evil.example/sprite.svg#a"/>'],
    ["an unquoted external href", "<image href=//evil.example/a.png />"],
    ["a nested SVG data URL", '<image href="data:image/svg+xml;base64,PHN2Zz4="/>'],
    ["foreignObject", "<foreignObject><div>hi</div></foreignObject>"],
    ["an iframe", '<iframe src="https://evil.example"></iframe>'],
    ["an animated href", '<a href="#x"><set attributeName="href" to="https://evil.example"/></a>'],
    ["a style import", "<style>@import url(https://evil.example/a.css);</style>"],
    ["an external CSS url", '<rect style="fill: url(https://evil.example/a.png)"/>'],
  ] as const;

  it.each(unsafe)("rejects %s", (_, body) => {
    expect(checkSvg(new TextDecoder().decode(svg(body)))).toEqual(expect.any(String));
  });

  it("rejects entity declarations (entity expansion)", () => {
    const text = '<!DOCTYPE svg [<!ENTITY lol "lol">]><svg>&lol;</svg>';
    expect(checkSvg(text)).toMatch(/entities/);
  });

  it("accepts links and url() references inside the file, and embedded raster images", () => {
    const body =
      '<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' +
      '<rect fill="url(#g)" style="fill:url( \'#g\' )"/><use href="#g"/><use xlink:href="#g"/>' +
      '<image href="data:image/png;base64,iVBORw0KGgo="/><text>Click on me</text>';
    expect(checkSvg(new TextDecoder().decode(svg(body)))).toBeUndefined();
  });

  it("accepts a DOCTYPE without an internal subset", () => {
    const text =
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>';
    expect(checkSvg(text)).toBeUndefined();
  });
});
