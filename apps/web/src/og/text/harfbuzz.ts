/**
 * HarfBuzz text shaping over the `hb.wasm` of harfbuzzjs 0.3.6 (MIT).
 *
 * Why this version and not the package's own wrapper: later harfbuzzjs builds create Wasm
 * functions at run time (Emscripten `addFunction`), which Cloudflare Workers forbid. 0.3.6 ships a
 * self-contained module (no imports) with a C helper that writes a glyph outline as SVG path
 * data. Its JS wrapper keeps typed-array views that go stale when the Wasm memory grows (large
 * fonts make it grow), so this file reads memory through fresh views instead.
 */

export interface ShapedGlyph {
  glyph: number;
  /** UTF-16 index, in the full text, of the first character of the glyph's cluster. */
  cluster: number;
  /** Font units. */
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface HbFont {
  readonly upem: number;
  /** The code points the font maps to a glyph. */
  readonly coverage: ReadonlySet<number>;
}

interface FontHandle extends HbFont {
  readonly fontPtr: number;
}

interface HbExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  free_ptr(): number;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_get_upem(face: number): number;
  hb_face_collect_unicodes(face: number, set: number): void;
  hb_font_create(face: number): number;
  hb_set_create(): number;
  hb_set_destroy(set: number): void;
  hb_set_get_population(set: number): number;
  hb_set_next_many(set: number, codepoint: number, out: number, size: number): number;
  hb_buffer_create(): number;
  hb_buffer_destroy(buffer: number): void;
  hb_buffer_add_utf16(buffer: number, text: number, length: number, offset: number, itemLength: number): void;
  hb_buffer_guess_segment_properties(buffer: number): void;
  hb_buffer_set_direction(buffer: number, direction: number): void;
  hb_buffer_set_language(buffer: number, language: number): void;
  hb_language_from_string(text: number, length: number): number;
  hb_buffer_get_length(buffer: number): number;
  hb_buffer_get_glyph_infos(buffer: number, length: number): number;
  hb_buffer_get_glyph_positions(buffer: number, length: number): number;
  hb_shape(font: number, buffer: number, features: number, count: number): void;
  hbjs_glyph_svg(font: number, glyph: number, out: number, size: number): number;
  _initialize?: () => void;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_DIRECTION_LTR = 4;
const HB_DIRECTION_RTL = 5;
const HB_SET_VALUE_INVALID = 0xffffffff;
/** hb_glyph_info_t and hb_glyph_position_t are both five 32-bit fields. */
const RECORD_WORDS = 5;
const PATH_BUFFER_BYTES = 128 * 1024;

export class HarfBuzz {
  private readonly hb: HbExports;
  private readonly pathBuffer: number;
  private readonly decoder = new TextDecoder();
  private readonly languages = new Map<string, number>();

  constructor(instance: WebAssembly.Instance) {
    this.hb = instance.exports as unknown as HbExports;
    this.hb._initialize?.();
    this.pathBuffer = this.hb.malloc(PATH_BUFFER_BYTES);
  }

  /** Loads a TrueType or OpenType font (not WOFF). The font lives as long as the module. */
  loadFont(bytes: Uint8Array): HbFont {
    const { hb } = this;
    const data = hb.malloc(bytes.byteLength);
    new Uint8Array(hb.memory.buffer).set(bytes, data);
    const blob = hb.hb_blob_create(data, bytes.byteLength, HB_MEMORY_MODE_WRITABLE, data, hb.free_ptr());
    const face = hb.hb_face_create(blob, 0);
    const handle: FontHandle = {
      fontPtr: hb.hb_font_create(face),
      upem: hb.hb_face_get_upem(face),
      coverage: this.collectUnicodes(face),
    };
    return handle;
  }

  /**
   * Shapes `text[start, end)` with the whole text as context, so Arabic joining and Indic
   * reordering see the neighbouring characters. Glyphs come in visual order.
   */
  shape(
    font: HbFont,
    text: string,
    start: number,
    end: number,
    rtl: boolean,
    language?: string,
  ): ShapedGlyph[] {
    const { hb } = this;
    const buffer = hb.hb_buffer_create();
    const units = hb.malloc(Math.max(text.length, 1) * 2);
    const view = new Uint16Array(hb.memory.buffer, units, text.length);
    for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i);
    hb.hb_buffer_add_utf16(buffer, units, text.length, start, end - start);
    hb.free(units);
    hb.hb_buffer_guess_segment_properties(buffer);
    hb.hb_buffer_set_direction(buffer, rtl ? HB_DIRECTION_RTL : HB_DIRECTION_LTR);
    if (language) hb.hb_buffer_set_language(buffer, this.language(language));
    hb.hb_shape((font as FontHandle).fontPtr, buffer, 0, 0);

    const length = hb.hb_buffer_get_length(buffer);
    const infos = hb.hb_buffer_get_glyph_infos(buffer, 0) / 4;
    const positions = hb.hb_buffer_get_glyph_positions(buffer, 0) / 4;
    const words = new Uint32Array(hb.memory.buffer);
    const signed = new Int32Array(hb.memory.buffer);
    const glyphs: ShapedGlyph[] = [];
    for (let i = 0; i < length; i++) {
      const info = infos + i * RECORD_WORDS;
      const position = positions + i * RECORD_WORDS;
      glyphs.push({
        glyph: words[info] ?? 0,
        cluster: words[info + 2] ?? 0,
        xAdvance: signed[position] ?? 0,
        xOffset: signed[position + 2] ?? 0,
        yOffset: signed[position + 3] ?? 0,
      });
    }
    hb.hb_buffer_destroy(buffer);
    return glyphs;
  }

  /** The glyph outline as SVG path data in font units, y pointing up. "" for an empty glyph. */
  glyphPath(font: HbFont, glyph: number): string {
    const length = this.hb.hbjs_glyph_svg(
      (font as FontHandle).fontPtr,
      glyph,
      this.pathBuffer,
      PATH_BUFFER_BYTES,
    );
    if (length <= 0) return "";
    return this.decoder.decode(new Uint8Array(this.hb.memory.buffer, this.pathBuffer, length));
  }

  private collectUnicodes(face: number): Set<number> {
    const { hb } = this;
    const set = hb.hb_set_create();
    hb.hb_face_collect_unicodes(face, set);
    const count = hb.hb_set_get_population(set);
    const out = hb.malloc(count * 4);
    hb.hb_set_next_many(set, HB_SET_VALUE_INVALID, out, count);
    const codePoints = new Set(new Uint32Array(hb.memory.buffer, out, count));
    hb.free(out);
    hb.hb_set_destroy(set);
    return codePoints;
  }

  private language(tag: string): number {
    let language = this.languages.get(tag);
    if (language === undefined) {
      const { hb } = this;
      const bytes = new TextEncoder().encode(tag);
      const ptr = hb.malloc(bytes.byteLength);
      new Uint8Array(hb.memory.buffer).set(bytes, ptr);
      language = hb.hb_language_from_string(ptr, bytes.byteLength);
      hb.free(ptr);
      this.languages.set(tag, language);
    }
    return language;
  }
}
