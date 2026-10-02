import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    // The build smoke test runs a full `astro build`.
    testTimeout: 20_000,
    hookTimeout: 180_000,
  },
});
