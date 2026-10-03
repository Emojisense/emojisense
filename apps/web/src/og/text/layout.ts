/**
 * Text layout for the share cards: font fallback per character, bidi, line breaking and emoji,
 * drawn as SVG paths so the rasterizer needs no fonts. HarfBuzz shapes every run, which keeps
 * Arabic joining and Devanagari/Bengali conjuncts right.
 */
import bidiFactory from "bidi-js";
import type { Face, FontLibrary, StackName } from "./fonts";
import type { HarfBuzz, ShapedGlyph } from "./harfbuzz";

export interface TextStyle {
  stack: StackName;
  /** Font size in px. */
  size: number;
  fill: string;
  /** Distance between baselines in px. */
  lineHeight: number;
  /** Letter spacing in px; applied to the site's Latin faces only. */
  tracking?: number;
}

export interface TextBox {
  /** Left edge of the box; lines align inside [x, x + width]. */
  x: number;
  /** Baseline of the first line. */
  y: number;
  width: number;
  maxLines: number;
  /** Paragraph direction. "start" alignment follows it. */
  direction: "ltr" | "rtl";
  align?: "start" | "center" | "end";
  /** Even out line lengths, as CSS `text-wrap: balance`, so a headline ends without a lone word. */
  balance?: boolean;
  /** BCP 47 tag, for shaping and line breaking. */
  language?: string;
}

export interface TextBlock {
  svg: string;
  lines: number;
  /** Width of the widest line. */
  width: number;
  /** True when the text did not fit and the last line ends in "…". */
  truncated: boolean;
  /** The style the block was laid out in (the one `fit()` settled on). */
  style: TextStyle;
}

export interface EmojiImages {
  /** A data: URI of the emoji's image for drawing at `size` px, or undefined when it cannot be drawn. */
  dataUri(emoji: string, size?: number): Promise<string | undefined>;
}

const bidi = bidiFactory();
const ELLIPSIS = "…";
/** An emoji takes a square of the font size plus a little room on either side. */
const EMOJI_ADVANCE = 1.12;
const EMOJI_ASCENT = 0.86;
const EMOJI = /\p{Emoji_Presentation}|\uFE0F|\u20E3|\p{Regional_Indicator}/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
/** Characters that take the face of the character before them when it can draw them. */
const NEUTRAL = /[\p{M}\p{Zs}\p{P}\p{S}]|\u200C|\u200D/u;
const SPACE = /\s/u;
const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u;
/** No line starts with these. */
const CLOSING = /[)\]}»”’、。，．！？：；」』）】〉》〕…%]/u;

interface Item {
  start: number;
  end: number;
  level: number;
  face?: Face;
  /** Emoji items are one grapheme drawn as an image. */
  emoji?: string;
}

interface Prepared {
  text: string;
  items: Item[];
  /** Advance in px owed by each UTF-16 index (the first index of a cluster carries it). */
  advances: Float64Array;
  images: Map<string, string>;
  style: TextStyle;
  box: TextBox;
}

interface PlacedRun {
  item: Item;
  start: number;
  end: number;
  glyphs: ShapedGlyph[];
  width: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function isEmoji(grapheme: string): boolean {
  return PICTOGRAPHIC.test(grapheme) && (EMOJI.test(grapheme) || /\p{Regional_Indicator}{2}/u.test(grapheme));
}

export class TextEngine {
  private readonly paths = new Map<string, string>();

  constructor(
    private readonly hb: HarfBuzz,
    private readonly fonts: FontLibrary,
    private readonly emoji: EmojiImages,
    /** Told about every text that had to end in "…" (the tests keep the cards free of them). */
    private readonly onTruncate?: (text: string) => void,
  ) {}

  /** Lays out `text` with the first style whose lines fit; the last style truncates. */
  async fit(text: string, styles: readonly TextStyle[], box: TextBox): Promise<TextBlock> {
    let block: TextBlock | undefined;
    for (const style of styles) {
      block = await this.layout(text, style, box);
      if (!block.truncated) return block;
    }
    if (!block) throw new Error("fit() needs at least one style");
    this.onTruncate?.(text);
    return block;
  }

  /** `report: false` for a try that a caller follows with a smaller size. */
  async block(text: string, style: TextStyle, box: TextBox, report = true): Promise<TextBlock> {
    const block = await this.layout(text, style, box);
    if (block.truncated && report) this.onTruncate?.(text);
    return block;
  }

  private async layout(text: string, style: TextStyle, box: TextBox): Promise<TextBlock> {
    const prepared = await this.prepare(text, style, box);
    let lines = this.breakLines(prepared, box.width);
    if (box.balance && lines.length > 1 && lines.length <= box.maxLines)
      lines = this.balance(prepared, lines.length);
    let truncated = false;
    const parts: Prepared[] = [];
    if (lines.length > box.maxLines) {
      truncated = true;
      lines = lines.slice(0, box.maxLines);
      const last = lines.pop() as [number, number];
      parts.push(...lines.map(() => prepared));
      parts.push(await this.ellipsize(prepared, last[0]));
      lines.push([0, parts.at(-1)?.text.length ?? 0]);
    } else {
      parts.push(...lines.map(() => prepared));
    }

    let svg = "";
    let width = 0;
    lines.forEach(([start, end], i) => {
      const source = parts[i] as Prepared;
      const runs = this.placeLine(source, start, end);
      const lineWidth = runs.reduce((total, run) => total + run.width, 0);
      width = Math.max(width, lineWidth);
      svg += this.drawLine(source, runs, lineWidth, box.y + i * style.lineHeight);
    });
    return { svg: `<g fill="${style.fill}">${svg}</g>`, lines: lines.length, width, truncated, style };
  }

  /** Width of `text` on one line, in px. */
  async measure(text: string, style: TextStyle, language?: string): Promise<number> {
    const box: TextBox = { x: 0, y: 0, width: Number.POSITIVE_INFINITY, maxLines: 1, direction: "ltr" };
    if (language) box.language = language;
    const prepared = await this.prepare(text, style, box);
    return this.placeLine(prepared, 0, text.length).reduce((total, run) => total + run.width, 0);
  }

  private async prepare(text: string, style: TextStyle, box: TextBox): Promise<Prepared> {
    const segmenter = new Intl.Segmenter(box.language, { granularity: "grapheme" });
    const emoji = new Map<number, { end: number; value: string }>();
    let plain = "";
    for (const { segment, index } of segmenter.segment(text)) {
      if (isEmoji(segment)) emoji.set(index, { end: index + segment.length, value: segment });
      else plain += segment;
    }
    const [faces, images] = await Promise.all([
      this.fonts.facesFor(style.stack, plain),
      this.loadImages(
        [...emoji.values()].map((entry) => entry.value),
        style.size,
      ),
    ]);
    const { levels } = bidi.getEmbeddingLevels(text, box.direction);

    const items: Item[] = [];
    let previous: Face | undefined;
    for (let i = 0; i < text.length; ) {
      const level = levels[i] ?? 0;
      const found = emoji.get(i);
      if (found) {
        items.push({ start: i, end: found.end, level, emoji: found.value });
        i = found.end;
        continue;
      }
      const codePoint = text.codePointAt(i) ?? 0;
      const width = codePoint > 0xffff ? 2 : 1;
      const char = text.slice(i, i + width);
      const keep = previous && NEUTRAL.test(char) && previous.font.coverage.has(codePoint);
      const face = keep ? previous : (faces.find((f) => f.font.coverage.has(codePoint)) ?? faces[0]);
      const last = items.at(-1);
      if (last && !last.emoji && last.face === face && last.level === level && last.end === i)
        last.end = i + width;
      else items.push(face ? { start: i, end: i + width, level, face } : { start: i, end: i + width, level });
      previous = face;
      i += width;
    }

    const advances = new Float64Array(text.length);
    for (const item of items) {
      if (item.emoji) {
        advances[item.start] = images.has(item.emoji) ? style.size * EMOJI_ADVANCE : 0;
        continue;
      }
      if (!item.face) continue;
      const scale = style.size / item.face.font.upem;
      const tracking = item.face.spec.tracking ? (style.tracking ?? 0) : 0;
      const glyphs = this.hb.shape(
        item.face.font,
        text,
        item.start,
        item.end,
        item.level % 2 === 1,
        box.language,
      );
      let cluster = -1;
      for (const glyph of glyphs) {
        advances[glyph.cluster] = (advances[glyph.cluster] ?? 0) + glyph.xAdvance * scale;
        if (glyph.cluster !== cluster) advances[glyph.cluster] = (advances[glyph.cluster] ?? 0) + tracking;
        cluster = glyph.cluster;
      }
    }
    return { text, items, advances, images, style, box };
  }

  private async loadImages(emoji: readonly string[], size: number): Promise<Map<string, string>> {
    const unique = [...new Set(emoji)];
    const uris = await Promise.all(unique.map((value) => this.emoji.dataUri(value, size)));
    return new Map(unique.flatMap((value, i) => (uris[i] ? [[value, uris[i] as string] as const] : [])));
  }

  /** The narrowest width that keeps the same number of lines, found by bisection. */
  private balance(prepared: Prepared, count: number): [number, number][] {
    let low = prepared.box.width / 2;
    let high = prepared.box.width;
    let best = this.breakLines(prepared, high);
    for (let step = 0; step < 12 && high - low > 1; step++) {
      const width = (low + high) / 2;
      const lines = this.breakLines(prepared, width);
      if (lines.length === count) {
        best = lines;
        high = width;
      } else {
        low = width;
      }
    }
    return best;
  }

  /** Greedy line breaking at spaces and between CJK characters. Lines exclude trailing spaces. */
  private breakLines({ text, advances, box }: Prepared, maxWidth: number): [number, number][] {
    const breaks = new Set<number>();
    const words = new Intl.Segmenter(box.language, { granularity: "word" });
    for (const { index } of words.segment(text)) {
      if (index === 0) continue;
      const before = text[index - 1] ?? "";
      const at = text.slice(index, index + 2);
      if (CLOSING.test(at[0] ?? "")) continue;
      if (SPACE.test(before) && !SPACE.test(at[0] ?? "")) breaks.add(index);
      else if (CJK.test(before) || CJK.test(at)) breaks.add(index);
    }
    // Any grapheme boundary, for a single word wider than the box.
    const graphemes = [...new Intl.Segmenter(box.language, { granularity: "grapheme" }).segment(text)].map(
      (segment) => segment.index,
    );

    const widthOf = (start: number, end: number) => {
      let total = 0;
      for (let i = start; i < end; i++) total += advances[i] ?? 0;
      return total;
    };
    const trimEnd = (start: number, end: number) => {
      let cut = end;
      while (cut > start && SPACE.test(text[cut - 1] ?? "")) cut--;
      return cut;
    };

    const lines: [number, number][] = [];
    let start = 0;
    while (start < text.length) {
      let end = text.length;
      if (widthOf(start, trimEnd(start, end)) > maxWidth) {
        const fitting = [...breaks].filter((b) => b > start && widthOf(start, trimEnd(start, b)) <= maxWidth);
        if (fitting.length > 0) end = Math.max(...fitting);
        else {
          const cuts = graphemes.filter((g) => g > start && widthOf(start, g) <= maxWidth);
          end = cuts.length > 0 ? Math.max(...cuts) : (graphemes.find((g) => g > start) ?? text.length);
        }
      }
      lines.push([start, trimEnd(start, end)]);
      start = end;
      while (start < text.length && SPACE.test(text[start] ?? "")) start++;
    }
    return lines.length > 0 ? lines : [[0, 0]];
  }

  /** The text from `start` cut so that it plus "…" fits one line. */
  private async ellipsize(prepared: Prepared, start: number): Promise<Prepared> {
    const { text, style, box } = prepared;
    const graphemes = [...new Intl.Segmenter(box.language, { granularity: "grapheme" }).segment(text)]
      .map((segment) => segment.index)
      .filter((index) => index > start);
    for (let i = graphemes.length - 1; i >= 0; i--) {
      const cut = text.slice(start, graphemes[i]).trimEnd() + ELLIPSIS;
      const candidate = await this.prepare(cut, style, box);
      const width = this.placeLine(candidate, 0, cut.length).reduce((total, run) => total + run.width, 0);
      if (width <= box.width) return candidate;
    }
    return this.prepare(ELLIPSIS, style, box);
  }

  /** The runs of one line in visual order (rule L2 of the bidi algorithm), shaped. */
  private placeLine(prepared: Prepared, start: number, end: number): PlacedRun[] {
    const { text, items, style, box } = prepared;
    const runs: PlacedRun[] = [];
    for (const item of items) {
      const from = Math.max(item.start, start);
      const to = Math.min(item.end, end);
      if (from >= to) continue;
      if (item.emoji) {
        const width = prepared.images.has(item.emoji) ? style.size * EMOJI_ADVANCE : 0;
        runs.push({ item, start: from, end: to, glyphs: [], width });
        continue;
      }
      if (!item.face) continue;
      const glyphs = this.hb.shape(item.face.font, text, from, to, item.level % 2 === 1, box.language);
      const scale = style.size / item.face.font.upem;
      const tracking = item.face.spec.tracking ? (style.tracking ?? 0) : 0;
      const clusters = new Set(glyphs.map((glyph) => glyph.cluster)).size;
      const width = glyphs.reduce((total, glyph) => total + glyph.xAdvance * scale, 0) + tracking * clusters;
      runs.push({ item, start: from, end: to, glyphs, width });
    }

    const levels = runs.map((run) => run.item.level);
    const highest = Math.max(0, ...levels);
    const lowestOdd = Math.min(...levels.filter((level) => level % 2 === 1), highest + 1);
    for (let level = highest; level >= lowestOdd; level--) {
      for (let i = 0; i < runs.length; ) {
        if ((runs[i]?.item.level ?? 0) < level) {
          i++;
          continue;
        }
        let j = i;
        while (j < runs.length && (runs[j]?.item.level ?? 0) >= level) j++;
        runs.splice(i, j - i, ...runs.slice(i, j).reverse());
        i = j;
      }
    }
    return runs;
  }

  private drawLine(prepared: Prepared, runs: PlacedRun[], lineWidth: number, baseline: number): string {
    const { style, box, images } = prepared;
    const align = box.align ?? "start";
    const toEnd = (align === "end") !== (box.direction === "rtl");
    let x = box.x + (align === "center" ? (box.width - lineWidth) / 2 : toEnd ? box.width - lineWidth : 0);
    let svg = "";
    for (const run of runs) {
      if (run.item.emoji) {
        const href = images.get(run.item.emoji);
        if (href) {
          const size = style.size;
          const left = round(x + (style.size * EMOJI_ADVANCE - size) / 2);
          svg += `<image href="${href}" x="${left}" y="${round(baseline - size * EMOJI_ASCENT)}" width="${size}" height="${size}"/>`;
        }
        x += run.width;
        continue;
      }
      const face = run.item.face as Face;
      const scale = style.size / face.font.upem;
      const tracking = face.spec.tracking ? (style.tracking ?? 0) : 0;
      let cluster = -1;
      for (const glyph of run.glyphs) {
        if (cluster !== -1 && glyph.cluster !== cluster) x += tracking;
        cluster = glyph.cluster;
        const d = this.path(face, glyph.glyph);
        if (d) {
          const gx = round(x + glyph.xOffset * scale);
          const gy = round(baseline - glyph.yOffset * scale);
          const k = round(scale * 10000) / 10000;
          svg += `<path transform="matrix(${k} 0 0 ${-k} ${gx} ${gy})" d="${d}"/>`;
        }
        x += glyph.xAdvance * scale;
      }
      if (cluster !== -1) x += tracking;
    }
    return svg;
  }

  private path(face: Face, glyph: number): string {
    const key = `${face.spec.file}#${glyph}`;
    let d = this.paths.get(key);
    if (d === undefined) {
      d = this.hb.glyphPath(face.font, glyph);
      this.paths.set(key, d);
    }
    return d;
  }
}
