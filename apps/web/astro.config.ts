import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  integrations: [react()],
  build: { format: "directory" },
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  server: { port: 4321 },
});
