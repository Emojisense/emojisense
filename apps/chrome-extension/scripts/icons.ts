/**
 * Toolbar and store icons, drawn in code so the repository holds no binary files: a white keycap
 * with an ink outline, a thicker bottom edge like the UI's keycaps, and a smiling face. Monochrome,
 * as the design system asks (emoji are the only color), and visible on light and dark toolbars.
 */
import { crc32, deflateSync } from "node:zlib";

type Rgba = readonly [number, number, number, number];

/** --bg and --ink of src/shared/tokens.css. */
const PAPER: Rgba = [0xff, 0xff, 0xff, 0xff];
const INK: Rgba = [0x0d, 0x0d, 0x12, 0xff];
const CLEAR: Rgba = [0, 0, 0, 0];
const SAMPLES = 4;

/** Inside a rounded rectangle (coordinates are 0–1 of the icon). */
function inRoundedRect(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): boolean {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && Math.hypot(x - cx, y - cy) <= r;
}

function colourAt(x: number, y: number, size: number): Rgba {
  // Small icons need thicker strokes, or the outline and face vanish.
  const stroke = Math.max(0.045, 1.25 / size);
  const bottom = stroke * 1.8;
  let colour = CLEAR;
  if (inRoundedRect(x, y, 0.06, 0.06, 0.94, 0.94, 0.22)) colour = INK; // outline
  if (inRoundedRect(x, y, 0.06 + stroke, 0.06 + stroke, 0.94 - stroke, 0.94 - bottom, 0.22 - stroke)) {
    colour = PAPER;
  }
  const eye = Math.max(0.055, 1 / size);
  if (Math.hypot(x - 0.37, y - 0.4) <= eye || Math.hypot(x - 0.63, y - 0.4) <= eye) colour = INK;
  const smile = Math.hypot(x - 0.5, y - 0.44);
  if (y > 0.52 && smile >= 0.2 && smile <= 0.2 + stroke) colour = INK;
  return colour;
}

function rasterize(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [r, g, b, a] = colourAt(
            (px + (sx + 0.5) / SAMPLES) / size,
            (py + (sy + 0.5) / SAMPLES) / size,
            size,
          );
          // Premultiplied sums, so edges against transparency do not darken.
          sum[0] = (sum[0] as number) + r * a;
          sum[1] = (sum[1] as number) + g * a;
          sum[2] = (sum[2] as number) + b * a;
          sum[3] = (sum[3] as number) + a;
        }
      }
      const alpha = sum[3] as number;
      const offset = (py * size + px) * 4;
      pixels[offset] = alpha ? Math.round((sum[0] as number) / alpha) : 0;
      pixels[offset + 1] = alpha ? Math.round((sum[1] as number) / alpha) : 0;
      pixels[offset + 2] = alpha ? Math.round((sum[2] as number) / alpha) : 0;
      pixels[offset + 3] = Math.round(alpha / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A square RGBA PNG of the icon at `size` pixels. */
export function renderIcon(size: number): Buffer {
  const pixels = rasterize(size);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    rows.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}
