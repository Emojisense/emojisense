import { describe, expect, it } from "vitest";
import {
  CUSTOM_EMOJI_MAX_BYTES,
  EmojiImageError,
  sniffEmojiImage,
  svgProblem,
  validateEmojiImage,
} from "../src/emoji-image.js";
import { IMAGES, svg } from "./fakes.js";

const encode = (text: string) => new TextEncoder().encode(text);

function rejection(bytes: Uint8Array): EmojiImageError {
  try {
    validateEmojiImage(bytes);
  } catch (error) {
    if (error instanceof EmojiImageError) return error;
    throw error;
  }
  throw new Error("expected the image to be rejected");
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

describe("validateEmojiImage", () => {
  it("accepts the four formats and keeps the bytes", () => {
    const image = validateEmojiImage(IMAGES.png);
    expect(image).toMatchObject({ contentType: "image/png", extension: "png" });
    expect(image.bytes).toBe(IMAGES.png);
  });

  it("rejects empty, oversized and unsupported files with their status", () => {
    expect(rejection(new Uint8Array())).toMatchObject({ code: "missing_file", status: 400 });
    const large = new Uint8Array(CUSTOM_EMOJI_MAX_BYTES + 1);
    large.set(IMAGES.png);
    expect(rejection(large)).toMatchObject({ code: "file_too_large", status: 413, field: "file" });
    expect(rejection(encode("just text"))).toMatchObject({ code: "unsupported_image", status: 415 });
  });

  it("accepts exactly the size limit", () => {
    const limit = new Uint8Array(CUSTOM_EMOJI_MAX_BYTES);
    limit.set(IMAGES.png);
    expect(validateEmojiImage(limit).contentType).toBe("image/png");
  });

  it("rejects an SVG that is not valid UTF-8", () => {
    const bytes = new Uint8Array([...encode("<svg>"), 0xff, 0xfe, ...encode("</svg>")]);
    expect(rejection(bytes)).toMatchObject({ code: "unsupported_image" });
  });

  it("rejects unsafe SVGs with a reason", () => {
    expect(rejection(svg("<script>alert(1)</script>"))).toMatchObject({ code: "unsafe_svg", status: 400 });
  });
});

describe("svgProblem", () => {
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
    expect(svgProblem(new TextDecoder().decode(svg(body)))).toEqual(expect.any(String));
  });

  it("rejects entity declarations (entity expansion)", () => {
    const text = '<!DOCTYPE svg [<!ENTITY lol "lol">]><svg>&lol;</svg>';
    expect(svgProblem(text)).toMatch(/entities/);
  });

  it("accepts links and url() references inside the file, and embedded raster images", () => {
    const body =
      '<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' +
      '<rect fill="url(#g)" style="fill:url( \'#g\' )"/><use href="#g"/><use xlink:href="#g"/>' +
      '<image href="data:image/png;base64,iVBORw0KGgo="/><text>Click on me</text>';
    expect(svgProblem(new TextDecoder().decode(svg(body)))).toBeUndefined();
  });

  it("accepts a DOCTYPE without an internal subset", () => {
    const text =
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>';
    expect(svgProblem(text)).toBeUndefined();
  });
});
