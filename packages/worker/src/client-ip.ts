const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const DOTTED_TAIL = /:(\d{1,3}(?:\.\d{1,3}){3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/i;

/**
 * What per-IP rate limits count for a client address: an IPv4 address as is, an IPv6 address by
 * its /64 network (one subscriber gets a whole /64 and can rotate through it at will), and an
 * IPv4-mapped IPv6 address as its IPv4 address. Anything else is returned unchanged.
 */
export function rateLimitAddress(ip: string): string {
  const octets = ipv4Octets(ip);
  if (octets) return octets.join(".");
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  const [a, b, c, d, e, f, g = 0, h = 0] = groups;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    return [g >> 8, g & 0xff, h >> 8, h & 0xff].join(".");
  }
  const network = groups.slice(0, 4).map((group) => group.toString(16));
  return `${network.join(":")}::/64`;
}

function ipv4Octets(text: string): number[] | undefined {
  const match = IPV4.exec(text);
  if (!match) return undefined;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

/** The eight 16-bit groups of an IPv6 address, with `::` and a dotted IPv4 tail expanded. */
function ipv6Groups(text: string): number[] | undefined {
  let address = text;
  const dotted = DOTTED_TAIL.exec(address);
  if (dotted?.[1]) {
    const octets = ipv4Octets(dotted[1]);
    if (!octets) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    address = `${address.slice(0, dotted.index + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const [head = [], tail = []] = halves.map((half) => (half === "" ? [] : half.split(":")));
  const gap = 8 - head.length - tail.length;
  if (halves.length === 1 ? gap !== 0 : gap < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 1 ? 0 : gap).fill("0"), ...tail];
  if (!groups.every((group) => HEXTET.test(group))) return undefined;
  return groups.map((group) => Number.parseInt(group, 16));
}
