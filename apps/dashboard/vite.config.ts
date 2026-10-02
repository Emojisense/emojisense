import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Static asset headers of the SPA (`_headers`). API responses set their own headers in the
 * Worker. Fonts are bundled, so font-src is 'self'. The search API (VITE_API_URL) serves the
 * packs and the live search (connect-src) and the custom emoji and hosted set images (img-src);
 * blob: is the upload preview.
 */
function headersFor(apiOrigin: string): string {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${apiOrigin}`,
    `connect-src 'self' ${apiOrigin}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
  return `/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;
}

function staticHeaders(apiUrl: string): Plugin {
  return {
    name: "emojisense-static-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headersFor(new URL(apiUrl).origin) });
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
  return {
    plugins: [react(), staticHeaders(apiUrl)],
    build: { outDir: "dist/client", emptyOutDir: true },
    server: {
      // Without mock mode, the dev server sends /api to `wrangler dev` (pnpm dev, port 8790).
      proxy: mock ? undefined : { "/api": { target: "http://localhost:8790", changeOrigin: false } },
    },
  };
});
