/** schema.org data shared by several pages (Base renders it as JSON-LD). */
import { REPO_URL, SITE_URL } from "../config";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

/** The organization and the site, with the playground as the site's search. Home page only. */
export function siteJsonLd(languageTag: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: "Emojisense",
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/icon-512.png`,
        sameAs: [REPO_URL],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Emojisense",
        url: `${SITE_URL}/`,
        inLanguage: languageTag,
        publisher: { "@id": ORGANIZATION_ID },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/playground/?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

/** A docs page as a technical article, without the `@context` (it goes in a graph). */
export function techArticle(page: { title: string; description: string; path: string; image: string }) {
  return {
    "@type": "TechArticle",
    headline: page.title,
    description: page.description,
    url: `${SITE_URL}${page.path}`,
    image: `${SITE_URL}${page.image}`,
    inLanguage: "en",
    publisher: { "@type": "Organization", "@id": ORGANIZATION_ID, name: "Emojisense", url: `${SITE_URL}/` },
  };
}
