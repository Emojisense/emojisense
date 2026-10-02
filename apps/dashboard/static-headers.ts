/**
 * Static asset headers of the SPA (`_headers`, emitted by vite.config.ts). API responses set their
 * own headers in the Worker.
 */

/**
 * What Clerk needs, per clerk.com/docs/guides/secure/best-practices/csp-headers: its Frontend API
 * (clerk-js, Clerk's UI and its API calls), img.clerk.com (avatars), Cloudflare Turnstile and
 * Clerk's fraud protection hosts (bot protection: scripts, frames, and connections on any port),
 * workers from blob:, and inline styles (Clerk's components use runtime CSS-in-JS).
 */
function clerkSources(frontendApi: string) {
  const api = `https://${frontendApi}`;
  const turnstile = "https://challenges.cloudflare.com";
  const protect = "https://*.protect.clerk.com";
  return {
    script: [api, turnstile, protect],
    style: ["'unsafe-inline'"],
    img: ["https://img.clerk.com"],
    connect: [api, `${protect}:*`],
    frame: [turnstile, protect],
    worker: ["'self'", "blob:"],
  };
}

const directive = (name: string, values: string[]) => [name, ...values].join(" ");

/**
 * Fonts are bundled, so font-src is 'self'. The search API (`apiOrigin`) serves the packs and the
 * live search (connect-src) and the custom emoji and hosted set images (img-src); blob: is the
 * upload preview. With a Clerk Frontend API host, Clerk's sources are added and nothing else.
 */
export function headersFor(apiOrigin: string, clerkFrontendApi: string | null = null): string {
  const clerk = clerkFrontendApi ? clerkSources(clerkFrontendApi) : null;
  const csp = [
    "default-src 'self'",
    directive("script-src", ["'self'", ...(clerk?.script ?? [])]),
    directive("style-src", ["'self'", ...(clerk?.style ?? [])]),
    "font-src 'self'",
    directive("img-src", ["'self'", "data:", "blob:", apiOrigin, ...(clerk?.img ?? [])]),
    directive("connect-src", ["'self'", apiOrigin, ...(clerk?.connect ?? [])]),
    ...(clerk ? [directive("frame-src", clerk.frame), directive("worker-src", clerk.worker)] : []),
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
  return `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;
}
