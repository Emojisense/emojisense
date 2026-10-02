import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { cspHeaders } from "./src/integrations/csp";

export default defineConfig({
  output: "static",
  integrations: [react(), cspHeaders()],
  build: { format: "directory" },
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  server: { port: 4321 },
});
