import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // The shadcn registry source imports this package by name and `cn` from the app's
  // `@/lib/utils`, exactly as it will after `shadcn add`. Resolve both to local files in tests.
  resolve: {
    alias: [
      { find: "@emojisense/react/frimousse", replacement: here("./src/frimousse.tsx") },
      { find: /^@emojisense\/react$/, replacement: here("./src/index.ts") },
      { find: /^@\/(.*)$/, replacement: `${here("./registry/")}$1` },
    ],
  },
  test: { environment: "happy-dom", setupFiles: ["./test/setup.ts"] },
});
