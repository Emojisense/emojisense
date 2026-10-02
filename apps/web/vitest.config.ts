import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    // The build smoke test runs a full `astro build` (the site in 11 languages; slow on a busy machine).
    testTimeout: 20_000,
    hookTimeout: 300_000,
  },
});
