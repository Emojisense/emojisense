/**
 * Renders the website's raster icons with headless Chrome and writes them to public/. Run it after
 * a change to the mark (public/favicon.svg), then commit the output. The site build does not run it.
 *
 *   node scripts/brand-assets.mjs
 *
 * Output: favicon.ico (16, 32, 48), apple-touch-icon.png (180), icon-192.png, icon-512.png,
 * icon-maskable-512.png. Share cards are made at build time instead (src/og/).
 *
 * Needs Google Chrome. Set CHROME to its binary when it is not in the default macOS place.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const INK = "#0d0d12";

function fail(message) {
  console.error(`brand-assets: ${message}`);
  process.exit(1);
}

if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}. Set CHROME to its binary.`);

/** The mark from public/favicon.svg (64 × 64 grid), always the light-scheme colors. */
function mark(x, y, size) {
  const k = size / 64;
  return `<g transform="translate(${x} ${y}) scale(${k})"><rect width="64" height="64" rx="16" fill="${INK}"/><g fill="#fff" stroke="#fff" stroke-linecap="round" stroke-width="5.5"><circle cx="22" cy="25.5" r="4.75" stroke="none"/><path fill="none" d="M36 26.75q5.25-5.75 10.5 0"/><path fill="none" d="M18.5 37q13.5 14 27 0"/></g></g>`;
}

/**
 * Opens `html` in a fresh headless Chrome. `done` resolves with the result once Chrome has
 * produced it; Chrome can linger afterwards, so it is stopped then.
 */
async function withChrome(html, args, done) {
  const dir = await mkdtemp(join(tmpdir(), "emojisense-brand-"));
  const pagePath = join(dir, "page.html");
  await writeFile(pagePath, html);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--user-data-dir=${join(dir, "profile")}`,
      "--disable-gpu",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      "--virtual-time-budget=4000",
      ...args(dir),
      pathToFileURL(pagePath).href,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  try {
    return await done({ dir, chrome, exited });
  } finally {
    chrome.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Draws an SVG into a `size × size` canvas and returns the PNG. Chrome will not make a window
 * smaller than 256 px, so small icons cannot be screenshots.
 */
function rasterize(svg, size) {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const html = `<!doctype html><meta charset="utf-8"><body><script>
const image = new Image();
image.onload = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ${size};
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, ${size}, ${size});
  document.body.textContent = canvas.toDataURL("image/png");
};
image.src = "${source}";
</script></body>`;
  return withChrome(
    html,
    () => ["--dump-dom"],
    ({ chrome }) =>
      new Promise((resolve, reject) => {
        let dom = "";
        const timer = setTimeout(() => reject(new Error(`Chrome drew no ${size} px icon`)), 30_000);
        chrome.stdout.on("data", (chunk) => {
          dom += chunk;
          if (!dom.includes("</html>")) return;
          clearTimeout(timer);
          const match = dom.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
          if (match?.[1]) resolve(Buffer.from(match[1], "base64"));
          else reject(new Error(`no PNG for the ${size} px icon`));
        });
      }),
  );
}

/** PNG width and height from the IHDR chunk. */
function pngSize(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** An ICO file that stores PNG images (supported by every browser that still asks for .ico). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const ICON_CANVAS = 512;

/**
 * The mark at `size` px. `fullBleed` fills the corners too: iOS shows transparent corners as
 * black, and maskable icons need a full background. The face stays inside the 80 % safe zone.
 */
async function icon(size, { fullBleed = false } = {}) {
  const background = fullBleed ? `<rect width="100%" height="100%" fill="${INK}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_CANVAS}" height="${ICON_CANVAS}" viewBox="0 0 ${ICON_CANVAS} ${ICON_CANVAS}">${background}${mark(0, 0, ICON_CANVAS)}</svg>`;
  const png = await rasterize(svg, size);
  const actual = pngSize(png);
  if (actual.width !== size || actual.height !== size) {
    throw new Error(`icon ${size}: Chrome produced ${actual.width} × ${actual.height}`);
  }
  return png;
}

async function main() {
  const icons = [
    ["apple-touch-icon.png", 180, true],
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ];
  for (const [file, size, fullBleed] of icons) {
    await writeFile(join(PUBLIC, file), await icon(size, { fullBleed }));
    console.log(file);
  }

  const small = [];
  for (const size of [16, 32, 48]) small.push({ size, png: await icon(size) });
  await writeFile(join(PUBLIC, "favicon.ico"), ico(small));
  console.log("favicon.ico");
}

await main();
