/**
 * Webhook target rules (SSRF guard). Checked when a webhook is saved and again before every
 * delivery, so a stored URL cannot outlive a rule change.
 *
 * - Production: `https:` only, and never a private, loopback, link-local or reserved address, or
 *   an internal host name (`localhost`, `*.local`, `*.internal`, single-label names, …).
 * - Development: `http:` or `https:` to loopback (`localhost`, `127.0.0.0/8`, `[::1]`) is also allowed.
 *
 * Only literal addresses and names are checked: Workers cannot resolve DNS before a fetch. Workers
 * egress leaves from Cloudflare's network, which has no route into our own private network.
 */
export interface WebhookUrlPolicy {
  /** `ENVIRONMENT=development`: allow loopback targets over http. */
  allowLoopback: boolean;
}

export type WebhookUrlCheck = { ok: true; url: string } | { ok: false; message: string };

export const MAX_WEBHOOK_URL_LENGTH = 2048;

const INTERNAL_SUFFIXES = ["localhost", "local", "internal", "localdomain", "lan", "home.arpa", "intranet"];

export function checkWebhookUrl(raw: unknown, policy: WebhookUrlPolicy): WebhookUrlCheck {
  if (typeof raw !== "string" || raw.trim() === "") return fail("url is required.");
  if (raw.length > MAX_WEBHOOK_URL_LENGTH) {
    return fail(`url can have at most ${MAX_WEBHOOK_URL_LENGTH} characters.`);
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return fail("url must be an absolute URL, like https://example.com/hooks/emojisense.");
  }
  if (url.username || url.password) return fail("url cannot contain a user name or password.");
  if (url.protocol !== "https:" && url.protocol !== "http:") return fail("url must use https.");

  const host = hostOf(url);
  const loopback = isLoopbackHost(host);
  if (loopback && policy.allowLoopback) return ok(url);
  if (url.protocol !== "https:") {
    return fail(
      policy.allowLoopback
        ? "url must use https (http is allowed for localhost only)."
        : "url must use https.",
    );
  }
  if (loopback || isInternalHost(host)) {
    return fail("url must point to a public host, not a private, local or reserved address.");
  }
  return ok(url);
}

function ok(url: URL): WebhookUrlCheck {
  url.hash = "";
  return { ok: true, url: url.href };
}

function fail(message: string): WebhookUrlCheck {
  return { ok: false, message };
}

/** The host name without IPv6 brackets or a trailing root dot ("localhost." is "localhost"). */
function hostOf(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host.startsWith("[") ? host.slice(1, -1) : host;
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = parseIPv4(host);
  if (v4 !== undefined) return v4 >>> 24 === 127;
  const v6 = parseIPv6(host);
  if (!v6) return false;
  return v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1;
}

function isInternalHost(host: string): boolean {
  const v4 = parseIPv4(host);
  if (v4 !== undefined) return isReservedIPv4(v4);
  const v6 = parseIPv6(host);
  if (v6 !== undefined) return isReservedIPv6(v6);
  if (!host.includes(".")) return true;
  return INTERNAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** [network, prefix length] of IPv4 ranges that are not public unicast (IANA special-purpose). */
const RESERVED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isReservedIPv4(address: number): boolean {
  return RESERVED_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (address & mask) >>> 0 === ((parseIPv4(network) ?? 0) & mask) >>> 0;
  });
}

/** IPv6 ranges that are not public unicast, plus the ones that embed an IPv4 address. */
function isReservedIPv6(g: number[]): boolean {
  const [g0 = 0, g1 = 0] = g;
  const embeddedV4 = (((g[6] ?? 0) << 16) | (g[7] ?? 0)) >>> 0;
  // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96 (IPv4-mapped).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    return g[5] === 0 || isReservedIPv4(embeddedV4);
  }
  // 64:ff9b::/96 (NAT64) carries an IPv4 address; 64:ff9b:1::/48 is local-use NAT64.
  if (g0 === 0x64 && g1 === 0xff9b) return g.slice(2, 6).some((x) => x !== 0) || isReservedIPv4(embeddedV4);
  // 2002::/16 (6to4) carries an IPv4 address in groups 1–2.
  if (g0 === 0x2002) return isReservedIPv4(((g1 << 16) | (g[2] ?? 0)) >>> 0);
  return (
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g0 & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
    (g0 & 0xff00) === 0xff00 || // ff00::/8 multicast
    (g0 === 0x100 && g.slice(1, 4).every((x) => x === 0)) || // 100::/64 discard
    (g0 === 0x2001 && g1 < 0x200) || // 2001::/23 IETF protocol assignments (Teredo, …)
    (g0 === 0x2001 && g1 === 0xdb8) // 2001:db8::/32 documentation
  );
}

/** Dotted-quad IPv4 as an unsigned 32-bit number. The URL parser already folds 0x7f.1 and friends. */
function parseIPv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return undefined;
  return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

/** Eight 16-bit groups, or undefined when `host` is not an IPv6 literal. */
function parseIPv6(host: string): number[] | undefined {
  if (!host.includes(":")) return undefined;
  let text = host;
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const v4 = parseIPv4(dotted[1]);
    if (v4 === undefined) return undefined;
    tail.push(v4 >>> 16, v4 & 0xffff);
    text = text.slice(0, -dotted[1].length);
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string | undefined) =>
    part ? part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? Number.parseInt(h, 16) : Number.NaN)) : [];
  const head = parse(halves[0]);
  const rest = [...parse(halves[1]), ...tail];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<number>(halves.length === 1 ? 0 : missing).fill(0), ...rest];
  return groups.some((g) => Number.isNaN(g)) ? undefined : groups;
}
