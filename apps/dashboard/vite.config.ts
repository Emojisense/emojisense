import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { clerkFrontendApi } from "./src/shared/clerk";
import { headersFor } from "./static-headers";

function staticHeaders(apiUrl: string, clerkHost: string | null): Plugin {
  return {
    name: "emojisense-static-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: headersFor(new URL(apiUrl).origin, clerkHost),
      });
    },
  };
}

// dist/client holds the SPA (served as static assets). `check:worker` writes the Worker
// bundle to dist/worker, so it never lands in the public asset directory.
export default defineConfig(({ command, mode }) => {
  // loadEnv also reads VITE_* variables from the shell.
  const env = loadEnv(mode, ".", "VITE_");
  const mock = env.VITE_MOCK === "1";
  // Mock mode is for the dev server only; a build with it set is a mistake, so it stops here.
  if (command === "build" && mock) {
    throw new Error("VITE_MOCK=1 is for `vite dev` only. Unset it to build the dashboard.");
  }
  // Same default as src/app/lib/config.ts: the local API Worker.
  const apiUrl = env.VITE_API_URL ?? "http://localhost:8788";
  // The CSP allows exactly the Clerk instance the build signs in with.
  const clerkKey = mock ? "" : (env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
  const clerkHost = clerkFrontendApi(clerkKey);
  if (clerkKey && !clerkHost) {
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key (pk_test_… or pk_live_…).");
  }
  if (command === "build" && !clerkHost) {
    console.warn("Building without VITE_CLERK_PUBLISHABLE_KEY: only the localhost dev sign-in will work.");
  }
  return {
    plugins: [react(), staticHeaders(apiUrl, clerkHost)],
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      // Without mock mode, the dev server sends /api to `wrangler dev` (pnpm dev, port 8790).
      proxy: mock ? undefined : { "/api": { target: "http://localhost:8790", changeOrigin: false } },
    },
  };
});
