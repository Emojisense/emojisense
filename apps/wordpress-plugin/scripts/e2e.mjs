/**
 * End-to-end check of the release build in WordPress Playground (PHP in WebAssembly, no Docker),
 * driven by headless Chromium. Takes the WordPress.org screenshots on the way.
 *
 *   pnpm build && pnpm release && pnpm e2e
 *
 * Environment:
 *   PLAYGROUND_NPX   npx that runs @wp-playground/cli (it needs Node >= 24.18), default "npx"
 *   E2E_PHP          PHP version of the site, default 8.3
 *   E2E_SMOKE=1      only load the main pages and fail on PHP errors (for E2E_PHP=7.4)
 *   E2E_FORUMS=1     install bbPress and BuddyPress from wordpress.org (network) and check the
 *                    forum and activity forms and reactions instead
 *   CHROMIUM_PATH    a Chromium binary; default: Playwright's, else the newest cached headless shell
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./chromium.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(PLUGIN, "release", "emojisense");
const OUT = join(PLUGIN, "test-results", "e2e");
const PORT = 4410;
const BASE = `http://127.0.0.1:${PORT}`;
const PHP = process.env.E2E_PHP ?? "8.3";
const SMOKE = process.env.E2E_SMOKE === "1";
const FORUMS = process.env.E2E_FORUMS === "1";
const DEMO_SLUG = "emojisense-demo";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` (${detail})` : ""}`);
};

/** Site setup: the plugin active, reactions on posts, a demo post and classic pages. */
function blueprint() {
  const php = `<?php
require_once '/wordpress/wp-load.php';
update_option( 'emojisense_settings', array_merge( Emojisense_Settings::defaults(), array( 'reactions_post_types' => array( 'post' ) ) ) );
$id = wp_insert_post( array(
	'post_title'     => 'Launch day',
	'post_name'      => '${DEMO_SLUG}',
	'post_content'   => '<!-- wp:paragraph --><p>We shipped the new onboarding today. Thank you all for the help, the reviews and the late nights!</p><!-- /wp:paragraph -->',
	'post_status'    => 'publish',
	'comment_status' => 'open',
) );
update_post_meta( $id, '_emojisense_reaction_set', array( '🎉', '🚀', '👏', '❤️', '🙌' ) );
update_post_meta( $id, '_emojisense_reaction_counts', array( '🎉' => 12, '🚀' => 7, '👏' => 4, '❤️' => 9 ) );
update_user_meta( 1, $GLOBALS['wpdb']->get_blog_prefix() . 'persisted_preferences', array(
	'core/edit-post' => array( 'welcomeGuide' => false ),
	'core'           => array( 'welcomeGuide' => false ),
	'_modified'      => gmdate( 'c' ),
) );
wp_mkdir_p( WPMU_PLUGIN_DIR );
file_put_contents( WPMU_PLUGIN_DIR . '/e2e-classic-pages.php', '<?php add_filter( "use_block_editor_for_post_type", function ( $use, $type ) { return "page" === $type ? false : $use; }, 10, 2 );' );
// The headless shell fails core's emoji support test, and core then swaps emoji for images from
// s.w.org. Screenshots should show the browser's emoji, as most visitors see them.
file_put_contents( WPMU_PLUGIN_DIR . '/e2e-no-core-emoji.php', '<?php remove_action( "wp_head", "print_emoji_detection_script", 7 ); remove_action( "admin_print_scripts", "print_emoji_detection_script" ); remove_action( "wp_print_styles", "print_emoji_styles" ); remove_action( "admin_print_styles", "print_emoji_styles" );' );
`;
  const forumSteps = FORUMS
    ? ["bbpress", "buddypress"].map((slug) => ({
        step: "installPlugin",
        pluginData: { resource: "wordpress.org/plugins", slug },
        options: { activate: true },
      }))
    : [];
  return {
    $schema: "https://playground.wordpress.net/blueprint-schema.json",
    login: true,
    steps: [
      ...forumSteps,
      { step: "activatePlugin", pluginPath: "emojisense/emojisense.php" },
      { step: "runPHP", code: php },
      ...(FORUMS
        ? [
            { step: "runPHP", code: buddypressInstall() },
            { step: "runPHP", code: forumSetup() },
          ]
        : []),
    ],
  };
}

/**
 * BuddyPress installs its components and tables from the admin after activation. Here, in its own
 * request: the next request then loads the activity component.
 */
function buddypressInstall() {
  return `<?php
require_once '/wordpress/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once buddypress()->plugin_dir . 'bp-core/admin/bp-core-admin-schema.php';
$components = array( 'activity' => 1, 'members' => 1, 'xprofile' => 1, 'settings' => 1, 'notifications' => 1 );
bp_update_option( 'bp-active-components', $components );
bp_core_install( $components );
bp_core_add_page_mappings( $components );
if ( function_exists( 'bp_version_bump' ) ) {
	bp_version_bump();
}
update_option( 'permalink_structure', '/%postname%/' );
`;
}

/**
 * Forum setup: the forum settings on, a public forum with a topic and a reply, an activity
 * update, and the page URLs in a file the checks read.
 */
function forumSetup() {
  return `<?php
require_once '/wordpress/wp-load.php';
flush_rewrite_rules();
update_option( 'emojisense_settings', array_merge( Emojisense_Settings::get(), array(
	'forum_fields'       => true,
	'forum_reactions'    => true,
	'activity_reactions' => true,
	'default_reactions'  => array( '👍', '🎉', '🚀' ),
) ) );
wp_set_current_user( 1 );
$forum = bbp_insert_forum( array( 'post_title' => 'Launch', 'post_content' => 'Everything about the launch.' ) );
$topic = bbp_insert_topic(
	array( 'post_parent' => $forum, 'post_title' => 'What should we ship first?', 'post_content' => 'Ideas welcome.', 'post_author' => 1 ),
	array( 'forum_id' => $forum )
);
bbp_insert_reply(
	array( 'post_parent' => $topic, 'post_title' => 'Reply', 'post_content' => 'The onboarding, for sure.', 'post_author' => 1 ),
	array( 'forum_id' => $forum, 'topic_id' => $topic )
);
$activity = bp_activity_add( array(
	'user_id'   => 1,
	'component' => 'activity',
	'type'      => 'activity_update',
	'action'    => 'admin posted an update',
	'content'   => 'We shipped the new onboarding today!',
) );
file_put_contents( WP_CONTENT_DIR . '/e2e-urls.json', wp_json_encode( array(
	'topic'    => get_permalink( $topic ),
	'activity' => bp_get_activity_directory_permalink(),
	'activityId' => (int) $activity,
) ) );
`;
}

async function startPlayground() {
  if (!existsSync(join(STAGE, "emojisense.php")))
    throw new Error("release/emojisense is missing: run `pnpm release`");
  await mkdir(OUT, { recursive: true });
  const blueprintFile = join(OUT, "blueprint.json");
  await writeFile(blueprintFile, JSON.stringify(blueprint(), null, 2));
  const args = [
    "-y",
    "@wp-playground/cli@3.1.55",
    "server",
    `--port=${PORT}`,
    `--php=${PHP}`,
    "--wp=7.1",
    "--login",
    `--mount=${STAGE}:/wordpress/wp-content/plugins/emojisense`,
    `--blueprint=${blueprintFile}`,
  ];
  const npx = process.env.PLAYGROUND_NPX ?? "npx";
  // An absolute npx brings its own node (npx runs `node` from PATH).
  const env = npx.includes("/")
    ? { ...process.env, PATH: `${dirname(npx)}:${process.env.PATH}` }
    : process.env;
  // detached: its own process group, so stopping it also stops the server that npx starts.
  const child = spawn(npx, args, { stdio: ["ignore", "pipe", "pipe"], env, detached: true });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Playground exited:\n${log.slice(-2000)}`);
    if (log.includes("Ready!")) {
      // manual: the auto-login answers with redirects that need cookies.
      const response = await fetch(`${BASE}/wp-login.php`, {
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      }).catch((error) => error);
      if (response instanceof Response && response.status < 500) return { child, log: () => log };
      console.log(`waiting for WordPress: ${response instanceof Response ? response.status : response}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  stop(child);
  throw new Error(`Playground did not start:\n${log.slice(-2000)}`);
}

function stop(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}

const PHP_ERROR = /(Fatal error|Parse error|Warning:|Notice:|Deprecated:|critical error)/;

async function smoke(page) {
  for (const path of [
    "/",
    `/?name=${DEMO_SLUG}`,
    "/wp-admin/options-general.php?page=emojisense",
    "/wp-admin/post-new.php?post_type=page",
  ]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    const error = PHP_ERROR.exec(html);
    check(
      `PHP ${PHP}: ${path} loads without PHP errors`,
      response?.status() === 200 && !error,
      error?.[0] ?? `HTTP ${response?.status()}`,
    );
  }
  check(
    `PHP ${PHP}: reaction bar renders`,
    (await page.goto(`${BASE}/?name=${DEMO_SLUG}`).then(() => page.locator(".emojisense-reaction").count())) >
      0,
  );
}

async function blockEditor(page) {
  await page.goto(`${BASE}/wp-admin/post-new.php`, { waitUntil: "domcontentloaded" });
  const canvas = page.frameLocator('iframe[name="editor-canvas"]');
  await canvas.locator("body").waitFor({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  const title = canvas.locator(".editor-post-title__input, h1[contenteditable]").first();
  await title.click();
  await page.keyboard.type("Launch notes");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Lunch is :pizz", { delay: 60 });
  await page.keyboard.type("a", { delay: 60 });
  const list = page.locator(".components-autocomplete__results");
  await list.waitFor({ timeout: 30_000 });
  const first = (await list.getByRole("option").first().textContent()) ?? "";
  check("block editor: :pizza suggests 🍕 first", first.includes("🍕"), first.trim());
  await page.keyboard.press("Enter");
  const paragraph = canvas.locator("p[data-type='core/paragraph'], p.wp-block-paragraph").first();
  const text = (await paragraph.textContent()) ?? "";
  check(
    "block editor: Enter inserts 🍕 in place of :pizza",
    text.includes("🍕") && !text.includes(":pizza"),
    text,
  );

  await page.keyboard.type(" and then we :ship it", { delay: 50 });
  await list.waitFor({ timeout: 30_000 });
  const shipIt = (await list.getByRole("option").first().textContent()) ?? "";
  check("block editor: :ship it suggests 🚀 first (meaning, not name)", shipIt.includes("🚀"), shipIt.trim());
  await page.screenshot({ path: join(OUT, "screenshot-1.png"), clip: await editorClip(page) });
  await page.keyboard.press("Enter");

  // The toolbar picker: block toolbar → More → Emoji.
  await page.keyboard.press("Shift+Tab").catch(() => {});
  await paragraph.click();
  const more = page
    .locator(
      '.block-editor-block-toolbar button[aria-label="More"], .block-editor-block-toolbar button[aria-label="More rich text controls"]',
    )
    .first();
  await more.click({ timeout: 15_000 });
  await page.getByRole("menuitem", { name: "Emoji" }).click();
  const picker = page.locator(".emojisense-popover emojisense-picker");
  await picker.waitFor({ timeout: 15_000 });
  await picker.locator("input").fill("party");
  await picker.getByRole("option").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "screenshot-2.png"), clip: await editorClip(page) });
  await picker.locator("input").press("Enter");
  await page.waitForTimeout(300);
  const withParty = (await paragraph.textContent()) ?? "";
  check(
    "block editor: toolbar picker inserts the chosen emoji",
    /🥳|🎉|🎊/u.test(withParty),
    withParty.slice(-12),
  );

  // The reactions panel of the document sidebar.
  const settingsButton = page.locator('button[aria-label="Settings"]').first();
  if ((await settingsButton.getAttribute("aria-pressed")) !== "true") await settingsButton.click();
  await page.getByRole("tab", { name: "Post" }).click();
  const panel = page.locator(".emojisense-reactions-panel");
  const toggle = page.getByRole("button", { name: "Reactions", exact: true });
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await panel.locator(".emojisense-reactions-panel__chip").first().waitFor({ timeout: 15_000 });
  const chips = await panel.locator(".emojisense-reactions-panel__chip").count();
  check("block editor: reactions panel lists the default reactions", chips === 6, `${chips} chips`);
  const box = await panel.boundingBox();
  if (box) {
    await page.screenshot({
      path: join(OUT, "screenshot-3.png"),
      clip: {
        x: Math.max(0, box.x - 24),
        y: Math.max(0, box.y - 72),
        width: box.width + 48,
        height: box.height + 120,
      },
    });
  }
}

async function editorClip(page) {
  const viewport = page.viewportSize();
  return { x: 0, y: 0, width: viewport.width, height: Math.min(viewport.height, 700) };
}

async function settingsPage(page) {
  await page.goto(`${BASE}/wp-admin/options-general.php?page=emojisense`, { waitUntil: "domcontentloaded" });
  await page.locator("#emojisense-comment-picker").check();
  await page.screenshot({ path: join(OUT, "screenshot-6.png"), fullPage: true });
  await page.locator("#submit").click();
  await page.waitForLoadState("domcontentloaded");
  const saved = await page
    .locator("#setting-error-settings_updated, .notice-success")
    .first()
    .isVisible()
    .catch(() => false);
  check("settings: saving shows “Settings saved.”", saved);
  check(
    "settings: the comment picker stays on after saving",
    await page.locator("#emojisense-comment-picker").isChecked(),
  );

  await page.locator("#emojisense-publishable-key").fill("sk_live_notapublishablekey123");
  await page.locator("#submit").click();
  await page.waitForLoadState("domcontentloaded");
  const refused = await page
    .locator(".notice-error, .error")
    .filter({ hasText: "secret key" })
    .first()
    .isVisible()
    .catch(() => false);
  check("settings: a secret key is refused with advice", refused);
  check(
    "settings: the refused key is not stored",
    (await page.locator("#emojisense-publishable-key").inputValue()) === "",
  );
}

async function frontEnd(page) {
  await page.goto(`${BASE}/?name=${DEMO_SLUG}`, { waitUntil: "domcontentloaded" });
  const bar = page.locator(".emojisense-reactions");
  await bar.scrollIntoViewIfNeeded();
  const party = bar.locator('.emojisense-reaction[data-emoji-hex="1F389"]');
  await party.waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".emojisense-reaction")?.hasAttribute("disabled"),
    null,
    { timeout: 20_000 },
  );
  const before = Number((await party.locator(".emojisense-reaction__count").textContent()) ?? "0");
  await party.click();
  await page.waitForFunction(
    (count) =>
      document.querySelector('.emojisense-reaction[data-emoji-hex="1F389"] .emojisense-reaction__count')
        ?.textContent === String(count),
    before + 1,
    { timeout: 15_000 },
  );
  check(
    "reactions: a click adds one and presses the button",
    (await party.getAttribute("aria-pressed")) === "true",
    `${before} → ${before + 1}`,
  );
  const box = await bar.boundingBox();
  const article = await page.locator("main, article, .wp-site-blocks").first().boundingBox();
  if (box && article) {
    const top = Math.max(0, box.y - 260);
    await page.screenshot({
      path: join(OUT, "screenshot-4.png"),
      clip: {
        x: article.x,
        y: top,
        width: Math.min(article.width, 1280),
        height: box.y + box.height + 40 - top,
      },
    });
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".emojisense-reactions").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => !document.querySelector(".emojisense-reaction")?.hasAttribute("disabled"),
    null,
    { timeout: 20_000 },
  );
  const stored = page.locator('.emojisense-reaction[data-emoji-hex="1F389"]');
  check(
    "reactions: the count is stored on the server",
    (await stored.locator(".emojisense-reaction__count").textContent()) === String(before + 1),
  );
  check(
    "reactions: the browser remembers the reaction",
    (await stored.getAttribute("aria-pressed")) === "true",
  );
  await stored.click();
  await page.waitForFunction(
    (count) =>
      document.querySelector('.emojisense-reaction[data-emoji-hex="1F389"] .emojisense-reaction__count')
        ?.textContent === String(count),
    before,
    { timeout: 15_000 },
  );
  check("reactions: a second click takes it back", (await stored.getAttribute("aria-pressed")) === "false");

  // The comment picker and colon search (turned on in settingsPage).
  const button = page.locator(".emojisense-field-button").first();
  await button.scrollIntoViewIfNeeded();
  check("comments: the Emoji button is visible", await button.isVisible());
  const typed = await typeColonQuery(page, "#comment", "Lunch :pizza");
  check("comments: :pizza suggests 🍕 first", typed.first.includes("🍕"), typed.first);
  check("comments: Enter inserts 🍕", typed.value === "Lunch 🍕", typed.value);
  await page.locator("#comment").fill("Congrats team ");
  await button.click();
  const picker = page.locator(".emojisense-popover emojisense-picker");
  await picker.locator("input").fill("pizza");
  await picker.getByRole("option").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  const popover = await page.locator(".emojisense-popover").boundingBox();
  const field = await page.locator("#comment").boundingBox();
  if (popover && field) {
    const top = Math.max(0, field.y - 40);
    await page.screenshot({
      path: join(OUT, "screenshot-5.png"),
      clip: {
        x: Math.max(0, field.x - 24),
        y: top,
        width: Math.max(field.width, popover.width) + 48,
        height: popover.y + popover.height + 24 - top,
      },
    });
  }
  await picker.locator("input").press("Enter");
  const comment = await page.locator("#comment").inputValue();
  check("comments: the picker inserts 🍕 at the caret", comment === "Congrats team 🍕", comment);
}

/** Types `text` into a plain field, reads the first row of the colon menu and presses Enter. */
async function typeColonQuery(page, selector, text) {
  const field = page.locator(selector).first();
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await field.fill("");
  await page.keyboard.type(text, { delay: 60 });
  const row = page.locator(".emojisense-textarea-menu [role=option]").first();
  await row.waitFor({ timeout: 30_000 });
  const first = ((await row.textContent()) ?? "").trim();
  await page.keyboard.press("Enter");
  return { first, value: await field.inputValue() };
}

/** Clicks the first reaction of a bar and waits for the count to go up by one. */
async function reactOnce(page, bar) {
  const reaction = bar.locator(".emojisense-reaction").first();
  await reaction.scrollIntoViewIfNeeded();
  await page.waitForFunction((element) => !element.hasAttribute("disabled"), await reaction.elementHandle(), {
    timeout: 20_000,
  });
  const counter = reaction.locator(".emojisense-reaction__count");
  const before = Number((await counter.textContent()) ?? "0");
  await reaction.click();
  await page.waitForFunction(
    ([element, count]) => element.textContent === String(count),
    [await counter.elementHandle(), before + 1],
    { timeout: 15_000 },
  );
  return (await reaction.getAttribute("aria-pressed")) === "true";
}

async function forums(page) {
  const urls = await (await fetch(`${BASE}/wp-content/e2e-urls.json`)).json();

  await page.goto(urls.topic, { waitUntil: "domcontentloaded" });
  const bars = page.locator('.emojisense-reactions[data-emojisense-type="post"]');
  await bars.first().waitFor({ timeout: 20_000 });
  check(
    "bbPress: the topic and the reply have reaction bars",
    (await bars.count()) === 2,
    `${await bars.count()} bars`,
  );
  check("bbPress: a reaction on the reply counts", await reactOnce(page, bars.nth(1)));
  check(
    "bbPress: the reply form has the Emoji button",
    (await page
      .locator(
        "#bbp_reply_content ~ .emojisense-field-tools .emojisense-field-button, .emojisense-field-button",
      )
      .count()) > 0,
  );
  const reply = await typeColonQuery(page, "#bbp_reply_content", "Agreed :ship it");
  await page.screenshot({ path: join(OUT, "screenshot-7.png"), fullPage: false }).catch(() => {});
  check("bbPress: :ship it in the reply form suggests 🚀 first", reply.first.includes("🚀"), reply.first);
  check("bbPress: Enter inserts 🚀", reply.value === "Agreed 🚀", reply.value);

  await page.goto(urls.activity, { waitUntil: "domcontentloaded" });
  const activityBar = page.locator(
    `.emojisense-reactions[data-emojisense-type="activity"][data-emojisense-id="${urls.activityId}"]`,
  );
  await activityBar.waitFor({ timeout: 30_000 });
  check("BuddyPress: the activity update has a reaction bar", await activityBar.isVisible());
  check("BuddyPress: a reaction on the update counts", await reactOnce(page, activityBar));
  await page.screenshot({ path: join(OUT, "screenshot-8.png"), fullPage: false }).catch(() => {});
  const update = await typeColonQuery(page, "#whats-new", "Lunch :pizza");
  check("BuddyPress: :pizza in the post form suggests 🍕 first", update.first.includes("🍕"), update.first);
  check("BuddyPress: Enter inserts 🍕", update.value === "Lunch 🍕", update.value);
}

async function classicEditor(page) {
  await page.goto(`${BASE}/wp-admin/post-new.php?post_type=page`, { waitUntil: "domcontentloaded" });
  const button = page
    .locator('.mce-btn[aria-label="Insert emoji"] button, .mce-btn[aria-label="Insert emoji"]')
    .first();
  await button.waitFor({ timeout: 30_000 });
  await page.frameLocator("#content_ifr").locator("body").click();
  await page.keyboard.type("Ready ");
  await button.click();
  const picker = page.locator(".emojisense-popover emojisense-picker");
  await picker.locator("input").fill("rocket");
  await picker.getByRole("option").first().waitFor({ timeout: 30_000 });
  await picker.locator("input").press("Enter");
  const content = await page.evaluate(() => window.tinymce?.get("content")?.getContent() ?? "");
  check("classic editor: the TinyMCE button inserts 🚀", content.includes("🚀"), content);
}

async function main() {
  const { child, log } = await startPlayground();
  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const errors = [];
  const consoleLog = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    consoleLog.push(`[${message.type()}] ${message.text()}`);
    if (message.type() === "error" && /emojisense/i.test(message.text())) errors.push(message.text());
  });
  try {
    await page.goto(`${BASE}/wp-admin/`, { waitUntil: "domcontentloaded" });
    if (SMOKE) {
      await smoke(page);
    } else if (FORUMS) {
      try {
        await forums(page);
      } catch (error) {
        check("forums: steps completed", false, String(error).split("\n")[0]);
        await page.screenshot({ path: join(OUT, "failure-forums.png") }).catch(() => {});
      }
    } else {
      for (const [name, step] of [
        ["block editor", blockEditor],
        ["settings", settingsPage],
        ["front end", frontEnd],
        ["classic editor", classicEditor],
      ]) {
        try {
          await step(page);
        } catch (error) {
          check(`${name}: steps completed`, false, String(error).split("\n")[0]);
          await page.screenshot({ path: join(OUT, `failure-${name.replace(" ", "-")}.png`) }).catch(() => {});
        }
      }
    }
    check("no script errors from the plugin", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    stop(child);
    await writeFile(
      join(OUT, `results-php${PHP}${FORUMS ? "-forums" : ""}.json`),
      JSON.stringify({ php: PHP, smoke: SMOKE, forums: FORUMS, results }, null, 2),
    );
    await writeFile(join(OUT, `playground-php${PHP}.log`), log());
    await writeFile(join(OUT, `console-php${PHP}.log`), consoleLog.join("\n"));
  }
  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed (PHP ${PHP}${SMOKE ? ", smoke" : ""})`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
