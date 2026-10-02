import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

/**
 * A headless Chromium: CHROMIUM_PATH, else Playwright's own, else the newest headless shell in the
 * Playwright cache (any revision works for these scripts).
 */
export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const own = chromium.executablePath();
    if (existsSync(own)) return own;
  } catch {
    // Not installed for this Playwright version.
  }
  const caches = [
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ];
  for (const cache of caches.filter((dir) => existsSync(dir))) {
    const shells = readdirSync(cache)
      .filter((name) => name.startsWith("chromium_headless_shell-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const shell of shells) {
      for (const sub of readdirSync(join(cache, shell))) {
        const binary = join(cache, shell, sub, "chrome-headless-shell");
        if (existsSync(binary)) return binary;
      }
    }
  }
  throw new Error(
    "no Chromium found: set CHROMIUM_PATH or run `npx playwright install chromium-headless-shell`",
  );
}

/** Always headless. */
export function launchChromium() {
  return chromium.launch({ headless: true, executablePath: findChromium() });
}
