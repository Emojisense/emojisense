import { SITE_URL } from "../config";

export function GET(): Response {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
