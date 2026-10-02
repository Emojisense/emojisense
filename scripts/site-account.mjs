// The website's own account: shared by create-site-key.mjs and set-site-plan.mjs.

/**
 * The website's key is public (it ships in the site's JavaScript), so anyone can spend the
 * account's monthly budget with it. Its plan is that budget's hard ceiling: Pro caps a month at
 * 3M semantic calls and 10k image classifications and still includes hosted emoji sets
 * (PLANS in packages/platform/src/plans.ts).
 */
export const SITE_PLAN = "pro";
export const SITE_ACCOUNT_NAME = "Emojisense website";

export const SITE_ORIGINS = {
  dev: ["https://emojisense.dev"],
  production: ["https://emojisense.com", "https://www.emojisense.com"],
};

/** SQL string literal. */
export const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
