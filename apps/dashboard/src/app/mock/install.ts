/**
 * Mock mode: answers every same-origin `/api/*` fetch from in-memory fixtures, with a short
 * delay, so each page can be built and screenshotted without the Worker. Loaded only by the dev
 * server with VITE_MOCK=1 (see main.tsx); production builds do not contain this module.
 *
 * URL switches, read once on load and kept in localStorage:
 *   ?mock-plan=free|solo|pro|scale   the account's plan (default pro, the top plan on sale)
 *   ?mock-signed-out=1|0             start signed out (sign in from the page) or signed in
 *   ?mock-ui=0                       hide the mock toolbar (for screenshots)
 *   ?mock-billing=active|canceling|past_due|canceled|none   the subscription state (Billing banners)
 */
import { BILLING_STATUSES, type BillingStatus, PLAN_IDS, PLANS, type PlanId } from "@emojisense/platform";
import { createDb, type MockDb } from "./data";
import { handle } from "./handlers";

const STORE_KEY = "emojisense:mock";

interface MockSettings {
  plan: PlanId;
  signedIn: boolean;
  toolbar: boolean;
  /** Unset: active on a paid plan, none on Free. */
  billing?: BillingStatus;
}

function readSettings(): MockSettings {
  const fallback: MockSettings = { plan: "pro", signedIn: true, toolbar: true };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<MockSettings>) };
  } catch {
    return fallback;
  }
}

function saveSettings(settings: MockSettings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode: settings last until reload.
  }
}

/** Applies ?mock-* switches, then removes them from the address bar. */
function applyUrlSwitches(settings: MockSettings): MockSettings {
  const url = new URL(window.location.href);
  const next = { ...settings };
  const plan = url.searchParams.get("mock-plan");
  if (plan && (PLAN_IDS as readonly string[]).includes(plan)) next.plan = plan as PlanId;
  if (url.searchParams.has("mock-signed-out"))
    next.signedIn = url.searchParams.get("mock-signed-out") !== "1";
  if (url.searchParams.has("mock-ui")) next.toolbar = url.searchParams.get("mock-ui") !== "0";
  const billing = url.searchParams.get("mock-billing");
  if (billing && (BILLING_STATUSES as readonly string[]).includes(billing))
    next.billing = billing as BillingStatus;
  for (const name of ["mock-plan", "mock-signed-out", "mock-ui", "mock-billing"])
    url.searchParams.delete(name);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return next;
}

/** Sign-in routes are page navigations; the dev server answers them with index.html. */
function handleAuthNavigation(settings: MockSettings): MockSettings {
  if (!window.location.pathname.startsWith("/api/auth/")) return settings;
  window.history.replaceState(null, "", "/");
  return { ...settings, signedIn: true };
}

const unauthorized = { error: { code: "unauthorized", message: "Sign in to continue." } };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function installMockApi(): void {
  let settings = handleAuthNavigation(applyUrlSwitches(readSettings()));
  saveSettings(settings);
  const db: MockDb = createDb(settings.plan, settings.billing);
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/"))
      return realFetch(input, init);

    await delay(120 + Math.random() * 220);
    const isForm = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
    const form = isForm ? await request.formData() : null;
    const text = isForm || request.method === "GET" ? "" : await request.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    let result: { status: number; body: unknown };
    if (!settings.signedIn) {
      result = { status: 401, body: unauthorized };
    } else {
      result = await handle(db, { method: request.method, url, json, form });
      if (url.pathname === "/api/auth/logout") settings = { ...settings, signedIn: false };
      if (url.pathname === "/api/billing/checkout" && result.status === 200) {
        settings = { ...settings, plan: db.plan, billing: db.billing.status };
      }
      saveSettings(settings);
    }
    console.debug(`[mock] ${request.method} ${url.pathname}${url.search} → ${result.status}`);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  };

  if (settings.toolbar) {
    mountToolbar(settings, (plan) => {
      const { billing: _, ...rest } = settings;
      saveSettings({ ...rest, plan });
    });
  }
}

/** A small control in the corner: which plan the fixtures use. Changing it reloads the page. */
function mountToolbar(settings: MockSettings, onPlan: (plan: PlanId) => void) {
  const bar = document.createElement("div");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Mock mode");
  bar.style.cssText =
    "position:fixed;left:.75rem;bottom:.75rem;z-index:90;display:flex;align-items:center;gap:.5rem;" +
    "padding:.3125rem .375rem .3125rem .75rem;border-radius:999px;background:var(--accent);color:var(--on-accent);" +
    "font:500 .75rem/1 var(--font-mono);box-shadow:var(--shadow-lg)";
  const label = document.createElement("label");
  label.textContent = "Mock data · plan";
  const select = document.createElement("select");
  select.style.cssText =
    "font:inherit;border:0;border-radius:999px;padding:.25rem .5rem;background:var(--bg);color:var(--ink)";
  for (const id of PLAN_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = PLANS[id].name;
    option.selected = id === settings.plan;
    select.append(option);
  }
  select.id = "mock-plan";
  label.htmlFor = "mock-plan";
  select.addEventListener("change", () => {
    onPlan(select.value as PlanId);
    window.location.reload();
  });
  bar.append(label, select);
  document.body.append(bar);
}
