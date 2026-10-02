import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { DEFAULT_LOCALE, LOCALES } from "./src/i18n/locales";
import { cspHeaders } from "./src/integrations/csp";

export default defineConfig({
  output: "static",
  integrations: [react(), cspHeaders()],
  build: { format: "directory" },
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  server: { port: 4321 },
  // English lives at the root; every other language under its code (/es/, /ar/ …). Only the pages
  // in src/i18n/locales.ts LOCALIZED_PAGES exist in every language.
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    routing: { prefixDefaultLocale: false },
  },
});
