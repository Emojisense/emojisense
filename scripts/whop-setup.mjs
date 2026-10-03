// Sets up Whop for one environment, idempotently: a product per listed paid plan, a variant
// ("plan_…") per plan and billing interval, and the webhook to the dashboard. Scale is not listed:
// it gets no product, and a Scale entry already in WHOP_PLAN_IDS is kept for its renewals.
//   node scripts/whop-setup.mjs dev|production [--dry-run]
//
// Reads from .deploy/<env>.env (gitignored): WHOP_API_KEY (required), WHOP_API_BASE (default the
// live API) and WHOP_COMPANY_ID (default the Emojisense company). Writes back WHOP_API_BASE,
// WHOP_COMPANY_ID and WHOP_PLAN_IDS (public), and WHOP_WEBHOOK_SECRET (secret) when it creates the
// webhook: Whop shows a webhook secret only once. It never prints a key or a secret.
//
// Dev can use the Whop sandbox (WHOP_API_BASE=https://sandbox-api.whop.com/api/v1 with a sandbox
// company and key) or the live company: then its products and variants get a "(dev)" suffix, and
// both webhooks receive every event of the company; each dashboard applies only its own (the
// checkout metadata names the environment). Prices come from PLANS in @emojisense/platform, so
// build it first: pnpm exec turbo run build --filter=@emojisense/platform
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LIVE_API = "https://api.whop.com/api/v1";
export const SANDBOX_API = "https://sandbox-api.whop.com/api/v1";
/** The owner's live Whop company "Emojisense" (public). */
export const DEFAULT_COMPANY_ID = "biz_AcjkJ4LZDgZjxC";
/** Webhook payloads are pinned to this dated API version (the shapes the dashboard reads). */
export const WEBHOOK_API_VERSION_DATE = "2026-09-29";
export const WEBHOOK_EVENTS = [
  "payment.succeeded",
  "payment.failed",
  "membership.activated",
  "membership.deactivated",
  "membership.cancel_at_period_end_changed",
  "refund.created",
  "refund.updated",
  "dispute.created",
  "dispute.updated",
];

const DOMAINS = { dev: "emojisense.dev", production: "emojisense.com" };
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** KEY=VALUE lines; values may be single- or double-quoted. Comments and blank lines are kept. */
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

/** Single quotes keep JSON intact when scripts/deploy.sh sources the file. */
function quote(value) {
  return /^[A-Za-z0-9_./:@-]*$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Sets keys in an env file's text, in place where they exist, appended where they do not. */
export function updateEnvFile(text, updates) {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const done = new Set();
  const next = lines.map((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    const key = match?.[1];
    if (!key || !(key in updates)) return line;
    done.add(key);
    return `${key}=${quote(updates[key])}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!done.has(key)) next.push(`${key}=${quote(value)}`);
  }
  return `${next.join("\n")}\n`;
}

class WhopError extends Error {
  constructor(method, path, status, message) {
    super(`Whop ${method} ${path} failed with ${status}${message ? `: ${message}` : ""}`);
    this.status = status;
  }
}

function whopClient({ base, apiKey, fetch }) {
  async function request(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      // Whop's error message names the problem (a missing permission, a bad field); never a key.
      const message = typeof json?.error?.message === "string" ? json.error.message.slice(0, 300) : "";
      throw new WhopError(method, path.split("?")[0], response.status, message);
    }
    return json;
  }

  async function list(path, params) {
    const items = [];
    let after = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ ...params, first: String(PAGE_SIZE), ...(after ? { after } : {}) });
      const answer = await request("GET", `${path}?${query}`);
      items.push(...(Array.isArray(answer?.data) ? answer.data : []));
      if (!answer?.page_info?.has_next_page || !answer.page_info.end_cursor) break;
      after = answer.page_info.end_cursor;
    }
    return items;
  }

  /** One object, or `null` when Whop does not know the id. */
  async function retrieve(path) {
    try {
      return await request("GET", path);
    } catch (error) {
      if (error instanceof WhopError && error.status === 404) return null;
      throw error;
    }
  }

  return { request, list, retrieve };
}

/**
 * The setup itself, without files: `env` holds the values of .deploy/<env>.env. Returns the env
 * values to write (`updates`), the lines to print (`report`, no secrets) and `warnings`.
 */
export async function runSetup({ environment, env, platform, fetch, dryRun = false }) {
  const domain = DOMAINS[environment];
  if (!domain) throw new Error(`Unknown environment "${environment}". Use dev or production.`);
  const apiKey = env.WHOP_API_KEY;
  if (!apiKey) throw new Error(`WHOP_API_KEY is missing in .deploy/${environment}.env.`);
  const base = (env.WHOP_API_BASE || LIVE_API).replace(/\/+$/, "");
  const companyId = env.WHOP_COMPANY_ID || DEFAULT_COMPANY_ID;
  const sandbox = new URL(base).hostname.startsWith("sandbox");
  // Dev on the live company shares it with production: name its products apart.
  const shared = environment === "dev" && !sandbox;
  const titleSuffix = shared ? " (dev)" : "";
  const keySuffix = shared ? "-dev" : "";
  const whop = whopClient({ base, apiKey, fetch });
  const report = [];
  const warnings = [];
  const created = (what) => (dryRun ? `would create ${what}` : `created ${what}`);

  report.push(
    `Whop ${sandbox ? "sandbox" : "live"} API ${base}, company ${companyId}${shared ? ", dev names" : ""}`,
  );

  // Whop's API reference now calls plans "variants": GET/POST /variants and GET /variants/{id},
  // with the same plan_ ids. /plans is the deprecated name of the same endpoints; it is used only
  // where /variants does not exist.
  let variantsPath = "/variants";
  let listed;
  try {
    listed = await whop.list(variantsPath, { account_id: companyId });
  } catch (error) {
    if (error?.status !== 404) throw error;
    variantsPath = "/plans";
    listed = await whop.list(variantsPath, { account_id: companyId });
  }

  // Variants this script made before, by the ids in WHOP_PLAN_IDS: a hidden variant may be missing
  // from Whop's lists, and a second copy must never be made.
  const known = [];
  const knownIds = platform.parseWhopPlanIds(env.WHOP_PLAN_IDS) ?? {};
  for (const option of platform.billingOptions()) {
    const id = knownIds[option.plan]?.[option.interval];
    const variant = id ? await whop.retrieve(`${variantsPath}/${encodeURIComponent(id)}`) : null;
    if (variant) known.push(variant);
  }

  // Products: one per listed paid plan, found again by metadata.emojisense_product (or
  // external_identifier).
  const products = await whop.list("/products", { account_id: companyId });
  const productIds = {};
  const listedPlans = [...new Set(platform.billingOptions().map((option) => option.plan))];
  for (const plan of listedPlans) {
    const key = `emojisense-${plan}${keySuffix}`;
    const knownProduct = known.find((v) =>
      v?.metadata?.emojisense_variant?.startsWith(`emojisense-${plan}-`),
    )?.product;
    let product =
      products.find((p) => p?.metadata?.emojisense_product === key || p?.external_identifier === key) ??
      (knownProduct?.id ? knownProduct : undefined);
    if (product) {
      report.push(`product ${key}: ${product.id}`);
    } else if (dryRun) {
      report.push(`product ${key}: ${created("it")}`);
    } else {
      product = await whop.request("POST", "/products", {
        account_id: companyId,
        title: `Emojisense ${platform.PLANS[plan].name}${titleSuffix}`,
        description: `The ${platform.PLANS[plan].name} plan of Emojisense, the emoji platform for every app.`,
        // Sold only through the dashboard's checkout, which names the account.
        visibility: "hidden",
        metadata: { emojisense_product: key },
      });
      report.push(`product ${key}: ${created(product.id)}`);
    }
    productIds[plan] = product?.id ?? null;
  }

  // Variants: one per plan and interval, priced from PLANS.
  const variants = [...known, ...listed.filter((v) => !known.some((k) => k.id === v?.id))];
  const planIds = {};
  let mismatch = false;
  for (const option of platform.billingOptions()) {
    const key = `emojisense-${option.plan}-${option.interval}${keySuffix}`;
    const productId = productIds[option.plan];
    let variant = variants.find((v) => v?.metadata?.emojisense_variant === key);
    if (variant) {
      const price = Number(variant.renewal_price);
      if (price !== option.priceUsd || Number(variant.billing_period) !== option.periodDays) {
        mismatch = true;
        warnings.push(
          `variant ${key} (${variant.id}) costs ${price} every ${variant.billing_period} days, but PLANS says ${option.priceUsd} every ${option.periodDays}. Archive it in Whop and run this again.`,
        );
        continue;
      }
      report.push(`variant ${key}: ${variant.id}`);
    } else if (dryRun || !productId) {
      report.push(`variant ${key}: ${created(`$${option.priceUsd} every ${option.periodDays} days`)}`);
      continue;
    } else {
      variant = await whop.request("POST", variantsPath, {
        account_id: companyId,
        product_id: productId,
        title: `${platform.PLANS[option.plan].name} ${option.interval === "year" ? "yearly" : "monthly"}${titleSuffix}`,
        plan_type: "renewal",
        billing_period: option.periodDays,
        // Whop charges initial_price plus the first renewal_price at checkout: no setup fee.
        initial_price: 0,
        renewal_price: option.priceUsd,
        currency: "usd",
        visibility: "hidden",
        metadata: { emojisense_variant: key },
        internal_notes: "Made by scripts/whop-setup.mjs. The dashboard maps it through WHOP_PLAN_IDS.",
      });
      report.push(`variant ${key}: ${created(variant.id)}`);
    }
    planIds[option.plan] = { ...planIds[option.plan], [option.interval]: variant.id };
  }

  // A plan that is not listed gets no variant, but the ones WHOP_PLAN_IDS names stay mapped: the
  // webhook needs them to renew the accounts still on that plan.
  for (const plan of platform.PAID_PLAN_IDS) {
    if (platform.isListedPlan(plan) || !knownIds[plan]) continue;
    planIds[plan] = knownIds[plan];
    report.push(
      `${plan}: kept ${Object.values(knownIds[plan]).join(", ")} from WHOP_PLAN_IDS (not for sale)`,
    );
  }

  // The webhook to the dashboard of this environment.
  const url = `https://app.${domain}/api/whop/webhook`;
  const webhooks = await whop.list("/webhooks", { account_id: companyId });
  const webhook = webhooks.find((w) => w?.url === url);
  const updates = {};
  if (webhook) {
    if (webhook.api_version !== undefined && webhook.api_version !== "v1") {
      warnings.push(
        `The webhook ${webhook.id} uses api_version ${webhook.api_version}, not v1: the dashboard cannot verify its signatures. Delete it in Whop and run this again.`,
      );
    }
    const missing = WEBHOOK_EVENTS.filter((event) => !(webhook.events ?? []).includes(event));
    if (missing.length > 0 || webhook.enabled === false) {
      if (!dryRun) {
        await whop.request("PATCH", `/webhooks/${encodeURIComponent(webhook.id)}`, {
          events: [...new Set([...(webhook.events ?? []), ...WEBHOOK_EVENTS])],
          enabled: true,
        });
      }
      report.push(
        `webhook ${webhook.id} → ${url}: ${dryRun ? "would add" : "added"} ${missing.join(", ") || "enabled"}`,
      );
    } else {
      report.push(`webhook ${webhook.id} → ${url}: up to date`);
    }
    if (!env.WHOP_WEBHOOK_SECRET) {
      warnings.push(
        `The webhook ${webhook.id} exists, but WHOP_WEBHOOK_SECRET is not in .deploy/${environment}.env. Whop shows a secret only once: copy it from the Whop dashboard (Developer → Webhooks → Secret), or delete the webhook and run this again.`,
      );
    }
  } else if (dryRun) {
    report.push(`webhook → ${url}: ${created("it")}`);
  } else {
    const body = {
      url,
      events: WEBHOOK_EVENTS,
      // v1 is the Standard Webhooks format the dashboard verifies (v2 and v5 are not signed so).
      api_version: "v1",
      api_version_date: WEBHOOK_API_VERSION_DATE,
      resource_id: companyId,
    };
    let made;
    try {
      made = await whop.request("POST", "/webhooks", body);
    } catch (error) {
      // Whop's newer reference no longer takes api_version (new webhooks are v1): send it without.
      if (error?.status !== 400) throw error;
      const { api_version: _, ...withoutVersion } = body;
      made = await whop.request("POST", "/webhooks", withoutVersion);
    }
    if (made?.api_version !== undefined && made.api_version !== "v1") {
      warnings.push(
        `The new webhook ${made.id} uses api_version ${made.api_version}, not v1: its deliveries are not Standard Webhooks signed. Change it to v1 in the Whop dashboard.`,
      );
    }
    if (typeof made?.webhook_secret !== "string" || !made.webhook_secret) {
      warnings.push(
        `Whop created the webhook ${made?.id} but sent no secret. Copy it from the Whop dashboard.`,
      );
    } else {
      updates.WHOP_WEBHOOK_SECRET = made.webhook_secret;
    }
    report.push(`webhook → ${url}: ${created(made?.id ?? "it")}`);
  }

  const complete = platform.billingOptions().every((o) => planIds[o.plan]?.[o.interval]);
  if (!dryRun && complete && !mismatch) {
    updates.WHOP_API_BASE = base;
    updates.WHOP_COMPANY_ID = companyId;
    updates.WHOP_PLAN_IDS = platform.serializeWhopPlanIds(planIds);
  }
  return { updates, report, warnings, planIds: complete ? platform.serializeWhopPlanIds(planIds) : null };
}

async function main() {
  const [environment, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  if (!DOMAINS[environment]) {
    console.error("Usage: node scripts/whop-setup.mjs dev|production [--dry-run]");
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envFile = join(root, ".deploy", `${environment}.env`);
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const platform = await import(pathToFileURL(join(root, "packages/platform/dist/index.js")).href);

  const result = await runSetup({ environment, env: parseEnvFile(text), platform, fetch, dryRun });
  for (const line of result.report) console.log(`  ${line}`);
  for (const line of result.warnings) console.warn(`! ${line}`);
  if (dryRun) {
    console.log("Dry run: nothing was created or written.");
    return;
  }
  const keys = Object.keys(result.updates);
  if (keys.length > 0) {
    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, updateEnvFile(text, result.updates), { mode: 0o600 });
    chmodSync(envFile, 0o600);
    console.log(`Wrote ${keys.join(", ")} to ${envFile}`);
  }
  if (result.planIds) console.log(`WHOP_PLAN_IDS=${result.planIds}`);
  if (result.warnings.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  });
}
