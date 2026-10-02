import { INDEXABLE, SITE_URL } from "../config";

export function GET(): Response {
  const body = INDEXABLE
    ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
