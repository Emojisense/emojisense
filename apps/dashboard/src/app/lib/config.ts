/** Build-time settings. Override with `VITE_*` variables (see the dashboard README). */
const env = import.meta.env;

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** Search API (packages/worker): packs, `/v1/search`, custom emoji images and hosted sets. */
export const API_URL = trimSlash(env.VITE_API_URL ?? "http://localhost:8788");
export const PACK_VERSION = env.VITE_PACK_VERSION ?? "0.1.0";
export const PACK_BASE_URL = `${API_URL}/v1/pack/${PACK_VERSION}`;
export const DOCS_URL = trimSlash(env.VITE_DOCS_URL ?? "https://emojisense.com/docs");

/**
 * Mock mode serves every `/api/*` route from fixtures, for UI work without the Worker.
 * `import.meta.env.DEV` is `false` in production builds, so the bundler drops the mock code and
 * `VITE_MOCK` cannot turn it on there.
 */
export const MOCK_MODE = import.meta.env.DEV && env.VITE_MOCK === "1";

/**
 * Clerk signs people in when the build has a publishable key (`VITE_CLERK_PUBLISHABLE_KEY`).
 * Mock mode never uses Clerk, so UI work needs no Clerk keys.
 */
export const CLERK_PUBLISHABLE_KEY = MOCK_MODE ? "" : (env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
