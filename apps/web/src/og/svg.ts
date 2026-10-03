/** Drawing primitives and colors shared by the card templates (the site's light scheme). */

export const WIDTH = 1200;
export const HEIGHT = 630;

export const INK = "#0d0d12";
export const INK_2 = "#4b4b57";
export const INK_3 = "#85858f";
export const LINE = "#e7e7ec";
export const LINE_STRONG = "#d3d3db";
export const BG_SOFT = "#f6f6f8";
export const BG_SUNK = "#eeeef2";

export const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function svgDocument(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${body}</svg>`;
}

/** White page with the site's dot grid, fading out from `focusX` (0–1). */
export function background(focusX: number): string {
  return `<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="${LINE_STRONG}"/></pattern>
  <radialGradient id="fade" cx="${focusX}" cy="0.45" r="0.6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
  <mask id="dots-mask"><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fade)"/></mask>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="${INK}" flood-opacity="0.04"/>
    <feDropShadow dx="0" dy="24" stdDeviation="32" flood-color="${INK}" flood-opacity="0.10"/>
  </filter>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#dots)" mask="url(#dots-mask)" opacity="0.9"/>`;
}

/** The mark from public/favicon.svg (64 × 64 grid), always in the light-scheme colors. */
export function mark(x: number, y: number, size: number): string {
  const k = size / 64;
  return `<g transform="translate(${x} ${y}) scale(${k})"><rect width="64" height="64" rx="16" fill="${INK}"/><g fill="#fff" stroke="#fff" stroke-linecap="round" stroke-width="5.5"><circle cx="22" cy="25.5" r="4.75" stroke="none"/><path fill="none" d="M36 26.75q5.25-5.75 10.5 0"/><path fill="none" d="M18.5 37q13.5 14 27 0"/></g></g>`;
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  {
    radius = 0,
    fill = "none",
    stroke,
    filter,
  }: { radius?: number; fill?: string; stroke?: string; filter?: string } = {},
): string {
  const strokeAttrs = stroke ? ` stroke="${stroke}" stroke-width="1.5"` : "";
  const shape = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"${strokeAttrs}/>`;
  return filter ? `<g filter="url(#${filter})">${shape}</g>` : shape;
}

export function hline(x1: number, x2: number, y: number): string {
  return `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${LINE}" stroke-width="1.5"/>`;
}

/** An emoji image of `size`, centered on (cx, cy). */
export function emojiImage(href: string | undefined, cx: number, cy: number, size: number): string {
  if (!href) return "";
  return `<image href="${href}" x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}"/>`;
}

/** A rounded square with an emoji in its middle, as the site's result tiles. */
export function tile(
  x: number,
  y: number,
  href: string | undefined,
  { size = 56, glyphSize = 32, fill = BG_SOFT }: { size?: number; glyphSize?: number; fill?: string } = {},
): string {
  return (
    rect(x, y, size, size, { radius: size * 0.27, fill }) +
    emojiImage(href, x + size / 2, y + size / 2, glyphSize)
  );
}
