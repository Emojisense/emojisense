/**
 * Downloads the share-card fonts into src/og/fonts/. Run it after a change to FONTS, then commit
 * the output. The site build does not run it.
 *
 *   node scripts/og-fonts.mjs
 *
 * Google Fonts sends one complete static WOFF per weight to a browser that predates
 * `unicode-range`, so each file has every glyph of the family. The cards need complete files:
 * HarfBuzz shapes a word inside one font, and a word that crosses two slices of a font loses its
 * Indic or Arabic shaping. Chinese and Cyrillic come from the @fontsource packages instead (their
 * scripts need no cross-glyph shaping, and the Chinese family is too large to commit).
 *
 * All families are under the SIL Open Font License 1.1 (NOTICE, "Share-card fonts").
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../src/og/fonts/", import.meta.url));
/** A browser without WOFF2 or unicode-range support: Google Fonts answers with whole WOFF files. */
const LEGACY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.112 Safari/534.30";

/** File name → Google Fonts CSS2 family query. The display face is its 96 pt optical size. */
const FONTS = {
  "bricolage-grotesque-700": "Bricolage+Grotesque:opsz,wght@96,700",
  "hanken-grotesk-400": "Hanken+Grotesk:wght@400",
  "hanken-grotesk-500": "Hanken+Grotesk:wght@500",
  "dm-mono-400": "DM+Mono:wght@400",
  "noto-sans-arabic-400": "Noto+Sans+Arabic:wght@400",
  "noto-sans-arabic-700": "Noto+Sans+Arabic:wght@700",
  "noto-sans-devanagari-400": "Noto+Sans+Devanagari:wght@400",
  "noto-sans-devanagari-700": "Noto+Sans+Devanagari:wght@700",
  "noto-sans-bengali-400": "Noto+Sans+Bengali:wght@400",
  "noto-sans-bengali-700": "Noto+Sans+Bengali:wght@700",
};

async function download(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

await mkdir(OUT, { recursive: true });
for (const [name, family] of Object.entries(FONTS)) {
  const css = await (
    await download(`https://fonts.googleapis.com/css2?family=${family}`, {
      headers: { "user-agent": LEGACY_USER_AGENT },
    })
  ).text();
  const urls = [...css.matchAll(/url\((https:[^)]+\.woff)\)/g)].map((match) => match[1]);
  if (urls.length !== 1) throw new Error(`${family}: expected one WOFF file, got ${urls.length}`);
  const bytes = new Uint8Array(await (await download(urls[0])).arrayBuffer());
  await writeFile(join(OUT, `${name}.woff`), bytes);
  console.log(`${name}.woff  ${(bytes.byteLength / 1024).toFixed(0)} KB  ${urls[0]}`);
}
