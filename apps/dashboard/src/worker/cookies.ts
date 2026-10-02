export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** Browsers do not keep Secure cookies from plain-http localhost in every engine (Safari). */
export function isLocalhost(url: URL): boolean {
  const host = url.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

interface CookieOptions {
  maxAgeSeconds: number;
  path: string;
  url: URL;
}

/** Every cookie this Worker sets is HttpOnly and SameSite=Lax, and Secure except on localhost. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!isLocalhost(options.url)) parts.push("Secure");
  return parts.join("; ");
}
