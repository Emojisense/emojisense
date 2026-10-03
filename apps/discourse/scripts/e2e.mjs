/**
 * Checks the theme component on a running Discourse site with it installed, in headless Chromium:
 * the composer's `:` autocomplete, the picker search, and the theme's QUnit tests.
 *
 *   DISCOURSE_URL=http://127.0.0.1:3000 DISCOURSE_USERNAME=… DISCOURSE_PASSWORD=… \
 *     pnpm --filter @emojisense/discourse e2e
 *
 * DISCOURSE_CHAT_PATH: a chat channel the account can post in (default /chat/c/staff/1).
 *
 * Use a development or test site and a test account. CHROMIUM_PATH picks the browser.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = (process.env.DISCOURSE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const USERNAME = process.env.DISCOURSE_USERNAME;
const PASSWORD = process.env.DISCOURSE_PASSWORD;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test-results");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` (${detail})` : ""}`);
};

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const own = chromium.executablePath();
    if (existsSync(own)) return own;
  } catch {
    // Not installed for this Playwright version.
  }
  for (const cache of [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
  ]) {
    if (!existsSync(cache)) continue;
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
  throw new Error("no Chromium: set CHROMIUM_PATH or run `npx playwright install chromium-headless-shell`");
}

async function logIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#login-account-name").fill(USERNAME);
  await page.locator("#login-account-password").fill(PASSWORD);
  await page.locator("#login-button").click();
  await page.locator(".current-user, #current-user").first().waitFor({ timeout: 60_000 });
}

/** Types into the composer at a human pace and returns the autocomplete's emoji names. */
async function autocomplete(page, text) {
  // Discourse's first-post tips cover the editor.
  const tip = page.locator(".composer-popup .close, .composer-popup button.close").first();
  if (await tip.isVisible().catch(() => false)) await tip.click();
  const input = page.locator(".d-editor-input").first();
  await input.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text, { delay: 120 });
  const rows = page.locator(".autocomplete li [data-code], .autocomplete li .emoji-shortname");
  await rows.first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".autocomplete li")).map(
      (li) => li.querySelector("[data-code]")?.dataset.code ?? li.textContent?.trim() ?? "",
    ),
  );
}

/** The composer's text: the textarea's value, or the rich editor's markup with emoji images. */
const editorText = (page) =>
  page
    .locator(".d-editor-input")
    .first()
    .evaluate((element) => ("value" in element ? element.value : element.innerHTML));

async function composer(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.locator("#create-topic").click();
  await page.locator(".d-editor-input").first().waitFor({ timeout: 60_000 });

  for (const mode of ["first editor", "other editor"]) {
    const ship = await autocomplete(page, "Ready to :ship it");
    check(
      `composer (${mode}): :ship it lists rocket first`,
      /rocket/.test(ship[0] ?? ""),
      ship.slice(0, 3).join(", "),
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const text = await editorText(page);
    check(`composer (${mode}): Enter inserts rocket`, /rocket/.test(text), text.slice(0, 120));
    if (mode === "first editor") await page.screenshot({ path: join(OUT, "composer.png") }).catch(() => {});

    const pizza = await autocomplete(page, " :pizza");
    check(
      `composer (${mode}): :pizza lists pizza first`,
      /pizza/.test(pizza[0] ?? ""),
      pizza.slice(0, 3).join(", "),
    );
    await page.keyboard.press("Escape");

    // The Markdown and the rich text editor share the autocomplete; check the other one too.
    const toggle = page.locator(".composer-toggle-switch").first();
    if (mode === "first editor") {
      if (!(await toggle.count())) break;
      await page
        .locator(".d-editor-input")
        .first()
        .evaluate((element) => {
          if ("value" in element) element.value = "";
          else element.innerHTML = "";
        });
      await toggle.click();
      await page.waitForTimeout(1500);
    }
  }

  // The picker from the composer toolbar.
  await page.locator(".insert-composer-emoji, button.emoji").first().click();
  const filter = page.locator(".emoji-picker input.filter-input, .emoji-picker__filter input").first();
  await filter.waitFor({ timeout: 30_000 });
  await filter.fill("ship it");
  const first = page.locator(".emoji-picker__section.filtered img.emoji").first();
  await first.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const name = await first.getAttribute("data-emoji");
  check("picker: searching ship it shows rocket first", name === "rocket", name ?? "");
  await page.screenshot({ path: join(OUT, "picker.png") }).catch(() => {});
}

async function chat(page) {
  await page.goto(`${BASE}${process.env.DISCOURSE_CHAT_PATH ?? "/chat/c/staff/1"}`, {
    waitUntil: "domcontentloaded",
  });
  const input = page.locator(".chat-composer__input").first();
  if (
    !(await input.waitFor({ timeout: 30_000 }).then(
      () => true,
      () => false,
    ))
  ) {
    // The chat plugin is off, or there is no channel: nothing to check.
    console.log("- chat: no chat composer on this site, skipped");
    return;
  }
  await input.focus();
  await page.keyboard.type("We :ship it", { delay: 120 });
  const rows = page.locator(".autocomplete li [data-code], .autocomplete li .emoji-shortname");
  await rows.first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  const first = await page.evaluate(
    () =>
      document.querySelector(".autocomplete li [data-code]")?.dataset.code ??
      document.querySelector(".autocomplete li")?.textContent?.trim() ??
      "",
  );
  check("chat: :ship it lists rocket first", /rocket/.test(first), first);
  await page.keyboard.press("Enter");
  check(
    "chat: Enter inserts :rocket:",
    (await input.inputValue()).includes(":rocket:"),
    await input.inputValue(),
  );
  await input.fill("");
}

async function qunit(page) {
  await page.goto(`${BASE}/theme-qunit`, { waitUntil: "domcontentloaded" });
  const link = page.locator("a", { hasText: "Emojisense" }).first();
  if (!(await link.count())) {
    check("QUnit: the theme's tests are listed at /theme-qunit", false);
    return;
  }
  await link.click();
  await page
    .locator("#qunit-testresult .total, #qunit-testresult-display")
    .first()
    .waitFor({ timeout: 300_000 });
  await page.waitForFunction(
    () => /completed/i.test(document.querySelector("#qunit-testresult")?.textContent ?? ""),
    null,
    {
      timeout: 300_000,
    },
  );
  const summary = (await page.locator("#qunit-testresult").textContent()) ?? "";
  const failed = Number(/(\d+)\s+failed/.exec(summary)?.[1] ?? "1");
  check("QUnit: the theme's tests pass", failed === 0, summary.replace(/\s+/g, " ").trim().slice(0, 120));
}

async function main() {
  if (!USERNAME || !PASSWORD)
    throw new Error("set DISCOURSE_USERNAME and DISCOURSE_PASSWORD (a test account)");
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  // Only errors from the component's code: Discourse throws TransitionAborted on navigation.
  page.on("pageerror", (error) => {
    if (/emojisense|theme-javascripts/i.test(`${error.message}\n${error.stack ?? ""}`))
      errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && /emojisense/i.test(message.text())) errors.push(message.text());
  });
  try {
    await logIn(page);
    for (const [name, step] of [
      ["composer", composer],
      ["chat", chat],
      ["qunit", qunit],
    ]) {
      try {
        await step(page);
      } catch (error) {
        check(`${name}: steps completed`, false, String(error).split("\n")[0]);
        await page.screenshot({ path: join(OUT, `failure-${name}.png`) }).catch(() => {});
      }
    }
    check("no script errors from the component", errors.length === 0, errors.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
