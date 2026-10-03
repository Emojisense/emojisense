/**
 * Google Analytics 4 behind the cookie banner, with Consent Mode v2. gtag.js loads with every
 * storage type denied, so it sets no cookie and sends cookieless pings until the visitor accepts.
 *
 * Search text never goes to Google. The playground keeps the query in the URL (`?q=`), and the
 * shared-search pages (`/s/`) also put it in the title, so the page URL, the referrer and the
 * title are cleaned before gtag reads them.
 */

export type Consent = "granted" | "denied";

/** The visitor's choice, in localStorage. It never leaves the browser. */
export const CONSENT_KEY = "emojisense:analytics-consent";

const SHARED_SEARCH_TITLE = "Shared search · Emojisense";
const GA_COOKIE = /^_ga(?:_|$)/;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readConsent(): Consent | undefined {
  try {
    const value = storage()?.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveConsent(consent: Consent): void {
  try {
    storage()?.setItem(CONSENT_KEY, consent);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

/** The URL without its query and hash. Campaign tags (`utm_*`) stay, for traffic sources. */
export function cleanUrl(href: string): string {
  const url = new URL(href);
  const campaign = new URLSearchParams();
  for (const [name, value] of url.searchParams) if (name.startsWith("utm_")) campaign.append(name, value);
  const query = campaign.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

/** Other sites' referrers as they are; our own pages without their query. */
export function cleanReferrer(referrer: string, origin: string): string {
  if (!referrer) return "";
  try {
    return new URL(referrer).origin === origin ? cleanUrl(referrer) : referrer;
  } catch {
    return "";
  }
}

export function cleanTitle(pathname: string, title: string): string {
  return pathname.startsWith("/s/") ? SHARED_SEARCH_TITLE : title;
}

/**
 * `reportPath` replaces the page's own path, for pages whose address is private (the 404 page
 * shows what the visitor typed).
 */
export function startGoogleAnalytics(
  measurementId: string,
  consent: Consent | undefined,
  reportPath?: string,
): void {
  window.dataLayer ??= [];
  const dataLayer = window.dataLayer;
  // gtag.js reads Arguments objects from the data layer, not arrays.
  window.gtag = function gtag() {
    // biome-ignore lint/complexity/noArguments: see above
    dataLayer.push(arguments);
  };
  window.gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: consent === "granted" ? "granted" : "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    page_location: reportPath ? `${location.origin}${reportPath}` : cleanUrl(location.href),
    page_referrer: cleanReferrer(document.referrer, location.origin),
    page_title: cleanTitle(location.pathname, document.title),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);
}

export function updateConsent(consent: Consent): void {
  saveConsent(consent);
  window.gtag?.("consent", "update", { analytics_storage: consent });
  if (consent === "denied") removeGoogleCookies();
}

/** GA sets `_ga` and `_ga_<id>` on the registrable domain (.emojisense.com). */
function removeGoogleCookies(): void {
  const host = location.hostname;
  const domains = ["", host, `.${host.split(".").slice(-2).join(".")}`];
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim() ?? "";
    if (!GA_COOKIE.test(name)) continue;
    for (const domain of domains) {
      // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in older Safari and Firefox
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}`;
    }
  }
}
