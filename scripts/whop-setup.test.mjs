// node --test scripts/whop-setup.test.mjs  (after building @emojisense/platform)
// Runs the Whop setup against an in-memory fake of Whop's API: nothing leaves the machine.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_COMPANY_ID,
  LIVE_API,
  parseEnvFile,
  runSetup,
  SANDBOX_API,
  updateEnvFile,
  WEBHOOK_EVENTS,
} from "./whop-setup.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const platform = await import(pathToFileURL(join(root, "packages/platform/dist/index.js")).href);

const KEY = "test_key_not_real";
const SECRET = "ws_testsecret_not_real";

/** Whop's products, variants and webhooks in memory, behind fetch. Hidden ones can be left out of lists. */
function fakeWhop({ listHidden = true, variantsPath = "/variants" } = {}) {
  const state = { products: [], variants: [], webhooks: [], calls: [] };
  let next = 1;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const page = (items) => json({ data: items, page_info: { end_cursor: null, has_next_page: false } });
  const visible = (item) => listHidden || item.visibility !== "hidden";

  async function fetch(url, init = {}) {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? "GET";
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${KEY}`);
    const body = init.body ? JSON.parse(init.body) : undefined;
    let path = pathname.replace(/^\/api\/v1/, "");
    state.calls.push(`${method} ${path}`);
    // An API without the /variants name answers 404 there and serves the same under /plans.
    if (path.startsWith("/variants") && variantsPath !== "/variants") {
      return json({ error: { message: "Not found" } }, 404);
    }
    if (path.startsWith("/plans") && variantsPath === "/plans") path = path.replace("/plans", "/variants");
    if (method === "GET" && path === "/products") {
      assert.equal(searchParams.get("account_id"), DEFAULT_COMPANY_ID);
      return page(state.products.filter(visible));
    }
    if (method === "POST" && path === "/products") {
      const product = { id: `prod_${next++}`, ...body };
      state.products.push(product);
      return json(product);
    }
    if (method === "GET" && path === "/variants") return page(state.variants.filter(visible));
    const variant = /^\/variants\/(.+)$/.exec(path);
    if (method === "GET" && variant) {
      const found = state.variants.find((v) => v.id === variant[1]);
      return found ? json(found) : json({ error: { message: "Not found" } }, 404);
    }
    if (method === "POST" && path === "/variants") {
      const made = { id: `plan_${next++}`, ...body, product: { id: body.product_id } };
      state.variants.push(made);
      return json(made);
    }
    if (method === "GET" && path === "/webhooks") return page(state.webhooks);
    if (method === "POST" && path === "/webhooks") {
      const webhook = { id: `hook_${next++}`, enabled: true, ...body };
      state.webhooks.push(webhook);
      return json({ ...webhook, webhook_secret: SECRET });
    }
    const hook = /^\/webhooks\/(.+)$/.exec(path);
    if (method === "PATCH" && hook) {
      const webhook = state.webhooks.find((w) => w.id === hook[1]);
      Object.assign(webhook, body);
      return json(webhook);
    }
    return json({ error: { message: `No fake for ${method} ${path}` } }, 404);
  }
  return { state, fetch };
}

const setup = (whop, env, options = {}) =>
  runSetup({
    environment: "production",
    env: { WHOP_API_KEY: KEY, ...env },
    platform,
    fetch: whop.fetch,
    ...options,
  });

describe("whop-setup", () => {
  it("creates hidden products and variants at the PLANS prices, and the webhook with its secret", async () => {
    const whop = fakeWhop();
    const result = await setup(whop, {});
    assert.equal(whop.state.products.length, 3);
    assert.deepEqual(
      whop.state.products.map((p) => [p.title, p.visibility, p.metadata.emojisense_product]),
      [
        ["Emojisense Solo", "hidden", "emojisense-solo"],
        ["Emojisense Pro", "hidden", "emojisense-pro"],
        ["Emojisense Scale", "hidden", "emojisense-scale"],
      ],
    );
    assert.deepEqual(
      whop.state.variants.map((v) => [
        v.metadata.emojisense_variant,
        v.renewal_price,
        v.billing_period,
        v.initial_price,
      ]),
      [
        ["emojisense-solo-month", 5, 30, 0],
        ["emojisense-solo-year", 48, 365, 0],
        ["emojisense-pro-month", 20, 30, 0],
        ["emojisense-scale-month", 100, 30, 0],
      ],
    );
    const [webhook] = whop.state.webhooks;
    assert.equal(webhook.url, "https://app.emojisense.com/api/whop/webhook");
    assert.deepEqual(webhook.events, WEBHOOK_EVENTS);
    assert.equal(webhook.resource_id, DEFAULT_COMPANY_ID);

    const ids = platform.parseWhopPlanIds(result.updates.WHOP_PLAN_IDS);
    assert.deepEqual(Object.keys(ids), ["solo", "pro", "scale"]);
    assert.equal(ids.solo.year, whop.state.variants[1].id);
    assert.equal(result.updates.WHOP_WEBHOOK_SECRET, SECRET);
    assert.equal(result.updates.WHOP_API_BASE, LIVE_API);
    assert.equal(result.updates.WHOP_COMPANY_ID, DEFAULT_COMPANY_ID);
    assert.deepEqual(result.warnings, []);
    // The report is printed: it names ids, never the key or the secret.
    assert.ok(!result.report.join("\n").includes(SECRET));
    assert.ok(!result.report.join("\n").includes(KEY));
  });

  it("is idempotent: a second run creates nothing and keeps the secret it has", async () => {
    const whop = fakeWhop();
    const first = await setup(whop, {});
    const env = { ...first.updates };
    const before = whop.state.calls.filter((call) => call.startsWith("POST")).length;
    const second = await setup(whop, env);
    assert.equal(whop.state.calls.filter((call) => call.startsWith("POST")).length, before);
    assert.equal(second.updates.WHOP_PLAN_IDS, first.updates.WHOP_PLAN_IDS);
    assert.equal(second.updates.WHOP_WEBHOOK_SECRET, undefined);
    assert.deepEqual(second.warnings, []);
  });

  it("finds its hidden variants by WHOP_PLAN_IDS when Whop's lists leave them out", async () => {
    const whop = fakeWhop({ listHidden: false });
    const first = await setup(whop, {});
    const variants = whop.state.variants.length;
    const second = await setup(whop, { ...first.updates });
    assert.equal(whop.state.variants.length, variants);
    assert.equal(second.updates.WHOP_PLAN_IDS, first.updates.WHOP_PLAN_IDS);
  });

  it("adds missing events to an existing webhook and warns when its secret is not in the env file", async () => {
    const whop = fakeWhop();
    whop.state.webhooks.push({
      id: "hook_old",
      url: "https://app.emojisense.com/api/whop/webhook",
      events: ["payment.succeeded"],
      enabled: false,
    });
    const result = await setup(whop, {});
    assert.deepEqual(new Set(whop.state.webhooks[0].events), new Set(WEBHOOK_EVENTS));
    assert.equal(whop.state.webhooks[0].enabled, true);
    assert.equal(whop.state.webhooks.length, 1);
    assert.equal(result.updates.WHOP_WEBHOOK_SECRET, undefined);
    assert.match(result.warnings.join("\n"), /WHOP_WEBHOOK_SECRET is not in/);
  });

  it("names dev products apart on the live company and points the webhook at app.emojisense.dev", async () => {
    const whop = fakeWhop();
    await runSetup({ environment: "dev", env: { WHOP_API_KEY: KEY }, platform, fetch: whop.fetch });
    assert.equal(whop.state.products[0].title, "Emojisense Solo (dev)");
    assert.equal(whop.state.products[0].metadata.emojisense_product, "emojisense-solo-dev");
    assert.equal(whop.state.variants[0].metadata.emojisense_variant, "emojisense-solo-month-dev");
    assert.equal(whop.state.webhooks[0].url, "https://app.emojisense.dev/api/whop/webhook");
  });

  it("uses plain names in the sandbox, with its own company", async () => {
    const whop = fakeWhop();
    const sandboxFetch = (url, init) => whop.fetch(url.replace(SANDBOX_API, LIVE_API), init);
    const env = { WHOP_API_KEY: KEY, WHOP_API_BASE: SANDBOX_API, WHOP_COMPANY_ID: DEFAULT_COMPANY_ID };
    const result = await runSetup({ environment: "dev", env, platform, fetch: sandboxFetch });
    assert.equal(whop.state.products[0].title, "Emojisense Solo");
    assert.equal(result.updates.WHOP_API_BASE, SANDBOX_API);
  });

  it("changes nothing in a dry run", async () => {
    const whop = fakeWhop();
    const result = await setup(whop, {}, { dryRun: true });
    assert.deepEqual(
      whop.state.calls.filter((call) => !call.startsWith("GET")),
      [],
    );
    assert.deepEqual(result.updates, {});
    assert.match(result.report.join("\n"), /would create/);
  });

  it("refuses to reuse a variant whose price no longer matches PLANS", async () => {
    const whop = fakeWhop();
    const first = await setup(whop, {});
    whop.state.variants[2].renewal_price = 25;
    const second = await setup(whop, { ...first.updates });
    assert.match(second.warnings.join("\n"), /emojisense-pro-month .* costs 25/);
    assert.equal(second.updates.WHOP_PLAN_IDS, undefined);
  });

  it("uses Whop's current /variants endpoints, and the deprecated /plans only where /variants is missing", async () => {
    const current = fakeWhop();
    await setup(current, {});
    assert.ok(current.state.calls.includes("POST /variants"));
    assert.ok(!current.state.calls.some((call) => call.includes("/plans")));

    const older = fakeWhop({ variantsPath: "/plans" });
    const result = await setup(older, {});
    assert.ok(older.state.calls.includes("POST /plans"));
    assert.equal(older.state.variants.length, 4);
    assert.ok(result.updates.WHOP_PLAN_IDS);
  });

  it("needs the API key", async () => {
    await assert.rejects(
      runSetup({ environment: "production", env: {}, platform, fetch: fakeWhop().fetch }),
      /WHOP_API_KEY is missing/,
    );
  });
});

describe("env file helpers", () => {
  it("reads quoted values and updates keys in place, quoting JSON for the shell", () => {
    const text = "# deploy\nPUBLIC_PUBLISHABLE_KEY=pk_live_x\nWHOP_API_KEY='abc'\n";
    assert.deepEqual(parseEnvFile(text), { PUBLIC_PUBLISHABLE_KEY: "pk_live_x", WHOP_API_KEY: "abc" });
    const updated = updateEnvFile(text, { WHOP_API_KEY: "def", WHOP_PLAN_IDS: '{"pro":{"month":"plan_1"}}' });
    assert.equal(
      updated,
      `# deploy\nPUBLIC_PUBLISHABLE_KEY=pk_live_x\nWHOP_API_KEY=def\nWHOP_PLAN_IDS='{"pro":{"month":"plan_1"}}'\n`,
    );
    assert.deepEqual(parseEnvFile(updated).WHOP_PLAN_IDS, '{"pro":{"month":"plan_1"}}');
  });
});
