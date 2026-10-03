import { defineConfig } from "vitest/config";

/** The same tests against CKEditor 47.6.2, the last 47.x under GPL (Drupal 10 and 11 run 47). */
export default defineConfig({
  resolve: { alias: { ckeditor5: "ckeditor5-47" } },
  test: { environment: "happy-dom" },
});
