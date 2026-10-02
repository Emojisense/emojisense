import { SITE_URL } from "../config";
import { DOC_PAGES } from "../content/docs";

const PATHS = ["/", "/pricing/", "/waitlist/", ...DOC_PAGES.map((page) => page.href)];

export function GET(): Response {
  const urls = PATHS.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
