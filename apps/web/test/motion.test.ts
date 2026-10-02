/**
 * WCAG 2.2.2 (pause, stop, hide): nothing on the site moves on its own for more than five seconds,
 * unless a control can pause it. These checks read the CSS in src/, so a new endless loop fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));
const LIMIT_MS = 5000;

/** Files with an endless animation behind a pause control, and the control's marker. */
const PAUSABLE: Record<string, string> = {
  "components/EdgeNetwork.astro": "data-map-pause",
};

const sources = (readdirSync(src, { recursive: true }) as string[])
  .filter((file) => /\.(css|astro)$/.test(file))
  .map((file) => ({ file, text: readFileSync(join(src, file), "utf8") }));

function toMs(time: string): number {
  return time.endsWith("ms") ? Number.parseFloat(time) : Number.parseFloat(time) * 1000;
}

/** Duration × iteration count + delay of one `animation` shorthand without var() timing. */
function runtimeMs(value: string): number {
  let flat = value;
  for (let depth = 0; depth < 8 && flat.includes("("); depth++) flat = flat.replace(/\([^()]*\)/g, "");
  const tokens = flat.trim().split(/\s+/);
  const [duration = 0, delay = 0] = tokens.filter((t) => /^-?[\d.]+m?s$/.test(t)).map(toMs);
  const count = Number(tokens.find((t) => /^[\d.]+$/.test(t)) ?? 1);
  return duration * count + Math.max(delay, 0);
}

describe("motion", () => {
  it("runs no endless animation without a pause control", () => {
    const endless = sources
      .filter(({ text }) => /animation(?:-iteration-count)?\s*:[^;]*\binfinite\b/.test(text))
      .map(({ file }) => file);
    expect(endless.sort()).toEqual(Object.keys(PAUSABLE).sort());
    for (const [file, marker] of Object.entries(PAUSABLE)) {
      expect(readFileSync(join(src, file), "utf8")).toContain(marker);
    }
  });

  it("stops every other animation within five seconds", () => {
    const long = sources
      .filter(({ file }) => !(file in PAUSABLE))
      .flatMap(({ file, text }) =>
        [...text.matchAll(/\banimation\s*:\s*([^;]+);/g)]
          .map((match) => ({ value: match[1] ?? "", ms: runtimeMs(match[1] ?? "") }))
          .filter(({ ms }) => ms > LIMIT_MS)
          .map(({ value, ms }) => `${file}: ${value} (${ms} ms)`),
      );
    expect(long).toEqual([]);
  });

  it("stops all CSS motion under reduced motion", () => {
    const global = readFileSync(join(src, "styles/global.css"), "utf8");
    const reduced = global.slice(global.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });
});
