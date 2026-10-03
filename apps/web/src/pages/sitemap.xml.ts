import { SITE_URL } from "../config";
import { LEGAL_PAGES } from "../content/legal";
import { isLocalizedPath, LOCALE_INFO, LOCALES, localizePath } from "../i18n/locales";
import { DOCS_PAGES } from "../lib/docs-nav";

/**
 * Every public English page; translated pages are listed next to them. Left out on purpose: the
 * 404 page, the /dev/ previews, and /waitlist/ (in every language), which stays only for older
 * links and forms now that paid plans are on sale.
 */
const SITEMAP_PATHS = [
  "/",
  "/pricing/",
  "/integrations/",
  "/playground/",
  "/about/",
  "/changelog/",
  "/legal/",
  ...LEGAL_PAGES.map((page) => page.href),
  ...DOCS_PAGES.map((page) => page.href),
];

/** Each language version of a translated page lists all of them (and x-default), as hreflang does. */
function alternates(path: string): string {
  const links = LOCALES.map(
    (locale) =>
      `    <xhtml:link rel="alternate" hreflang="${LOCALE_INFO[locale].tag}" href="${SITE_URL}${localizePath(path, locale)}"/>`,
  );
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${path}"/>`);
  return links.join("\n");
}

function entries(path: string): string[] {
  if (!isLocalizedPath(path)) return [`  <url><loc>${SITE_URL}${path}</loc></url>`];
  return LOCALES.map(
    (locale) =>
      `  <url>\n    <loc>${SITE_URL}${localizePath(path, locale)}</loc>\n${alternates(path)}\n  </url>`,
  );
}

export function GET(): Response {
  const urls = [...new Set(SITEMAP_PATHS)].flatMap(entries).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
