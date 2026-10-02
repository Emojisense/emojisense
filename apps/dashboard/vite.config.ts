import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// dist/client holds the SPA (served as static assets). `check:worker` writes the Worker
// bundle to dist/worker, so it never lands in the public asset directory.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
});
