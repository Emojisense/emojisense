import { SITE_URL } from "../config";
import { LEGAL_PAGES } from "../content/legal";
import { DOCS_PAGES } from "../lib/docs-nav";

/**
 * Every public page. Left out on purpose: the 404 page, the /dev/ previews, and /waitlist/, which
 * stays only for older links and forms now that paid plans are on sale.
 */
const SITEMAP_PATHS = [
  "/",
  "/pricing/",
  "/playground/",
  "/about/",
  "/changelog/",
  "/legal/",
  ...LEGAL_PAGES.map((page) => page.href),
  ...DOCS_PAGES.map((page) => page.href),
];

export function GET(): Response {
  const urls = [...new Set(SITEMAP_PATHS)]
    .map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`)
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
