/**
 * Renders the WordPress.org directory assets into release/wordpress-org/ (they go to the SVN
 * `assets/` folder, not into the plugin zip): icons, banners and the screenshots that
 * `pnpm e2e` took. Emoji in the banner come from the Noto set of the Emojisense API (Apache 2.0).
 */
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(PLUGIN, "assets", "wporg");
const OUT = join(PLUGIN, "release", "wordpress-org");
const SCREENSHOTS = join(PLUGIN, "test-results", "e2e");
const API = process.env.EMOJISENSE_API ?? "https://api.emojisense.com";
const require = createRequire(import.meta.url);

async function fontFace(family, file) {
  const path = require.resolve(file);
  const data = (await readFile(path)).toString("base64");
  return `@font-face { font-family: "${family}"; src: url(data:font/woff2;base64,${data}) format("woff2"); font-weight: 100 900; }`;
}

async function bannerHtml() {
  const fonts = [
    await fontFace(
      "Bricolage Grotesque",
      "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
    ),
    await fontFace(
      "Hanken Grotesk",
      "@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2",
    ),
  ];
  const html = await readFile(join(SOURCE, "banner.html"), "utf8");
  return html
    .replace("/*FONTS*/", fonts.join("\n"))
    .replace(/EMOJI:([0-9A-F-]+)/g, (_, hex) => `${API}/v1/sets/noto/${hex}.svg`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await launchChromium();
  try {
    const html = await bannerHtml();
    for (const [width, height, zoom] of [
      [1544, 500, 1],
      [772, 250, 0.5],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(html.replace('<html lang="en">', `<html lang="en" style="--zoom: ${zoom}">`), {
        waitUntil: "networkidle",
      });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(OUT, `banner-${width}x${height}.png`) });
      await page.close();
    }

    const icon = await readFile(join(SOURCE, "icon.svg"), "utf8");
    for (const size of [128, 256]) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${icon}`,
      );
      await page.screenshot({ path: join(OUT, `icon-${size}x${size}.png`), omitBackground: true });
      await page.close();
    }
    await copyFile(join(SOURCE, "icon.svg"), join(OUT, "icon.svg"));
  } finally {
    await browser.close();
  }

  const shots = (await readdir(SCREENSHOTS).catch(() => [])).filter((file) =>
    /^screenshot-\d\.png$/.test(file),
  );
  for (const file of shots) await copyFile(join(SCREENSHOTS, file), join(OUT, file));
  console.log(`wporg-assets: banners, icons and ${shots.length} screenshots in ${OUT}`);
}

await main();
