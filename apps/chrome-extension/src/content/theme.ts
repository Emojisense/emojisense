/**
 * Light or dark, to match the page around the field rather than only the system setting: a dark
 * editor on a light system (or the reverse) would otherwise get a picker that glares at it.
 */
export type Theme = "light" | "dark";

type Rgba = readonly [number, number, number, number];

/** Backgrounds more transparent than this let the parent's colour show through. */
const OPAQUE_ENOUGH = 0.5;

/**
 * The page's scheme at `element`: the first mostly opaque background on the way up decides.
 * Without one, the canvas decides: white unless the page opted into dark (`color-scheme`).
 * Undefined means "follow the system setting" (a page that supports both, or a colour we cannot
 * read, such as oklch()).
 */
export function pageTheme(element: Element | null, view: Window): Theme | undefined {
  const doc = view.document;
  for (let node: Element | null = element ?? doc.body; node; node = parentAcrossShadow(node)) {
    const background = view.getComputedStyle(node).backgroundColor;
    const rgba = parseRgb(background);
    if (!rgba) {
      if (isTransparentKeyword(background)) continue;
      return undefined;
    }
    if (rgba[3] >= OPAQUE_ENOUGH) return isDark(rgba) ? "dark" : "light";
  }
  return canvasTheme(doc, view);
}

function canvasTheme(doc: Document, view: Window): Theme | undefined {
  let schemes = view.getComputedStyle(doc.documentElement).colorScheme || "normal";
  if (schemes === "normal") {
    schemes = doc.querySelector('meta[name="color-scheme"]')?.getAttribute("content") ?? "normal";
  }
  const dark = /\bdark\b/.test(schemes);
  const light = /\blight\b/.test(schemes);
  if (dark && light) return undefined;
  return dark ? "dark" : "light";
}

function parentAcrossShadow(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return "host" in root ? (root as ShadowRoot).host : null;
}

function isTransparentKeyword(value: string): boolean {
  return value === "" || value === "transparent";
}

/** "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)" or "rgb(1 2 3 / 50%)": how browsers serialize sRGB. */
export function parseRgb(value: string): Rgba | undefined {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const [, r, g, b, a, percent] = match;
  const alpha = a === undefined ? 1 : Number(a) / (percent ? 100 : 1);
  return [Number(r), Number(g), Number(b), alpha];
}

/** Dark when black text would have less contrast on it than white text (WCAG luminance). */
export function isDark([r, g, b]: Rgba): boolean {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return (luminance + 0.05) / 0.05 < 1.05 / (luminance + 0.05);
}
