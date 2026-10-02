import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// dist/client holds the SPA (served as static assets). `check:worker` writes the Worker
// bundle to dist/worker, so it never lands in the public asset directory.
export default defineConfig(({ command, mode }) => {
  // loadEnv also reads VITE_* variables from the shell.
  const mock = loadEnv(mode, ".", "VITE_").VITE_MOCK === "1";
  // Mock mode is for the dev server only; a build with it set is a mistake, so it stops here.
  if (command === "build" && mock) {
    throw new Error("VITE_MOCK=1 is for `vite dev` only. Unset it to build the dashboard.");
  }
  return {
    plugins: [react()],
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      // Without mock mode, the dev server sends /api to `wrangler dev` (pnpm dev, port 8790).
      proxy: mock ? undefined : { "/api": { target: "http://localhost:8790", changeOrigin: false } },
    },
  };
});
