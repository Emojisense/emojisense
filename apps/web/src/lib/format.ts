const COUNT_UNITS: [number, string][] = [
  [1_000_000_000, "B"],
  [1_000_000, "M"],
  [1_000, "k"],
];

/** 100000 → "100k", 3000000 → "3M", 1500 → "1.5k", Infinity → "Unlimited". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "Unlimited";
  for (const [size, unit] of COUNT_UNITS) {
    if (value >= size) return `${trimZeros((value / size).toFixed(1))}${unit}`;
  }
  return String(value);
}

/** Whole dollars without decimals, cents with two: 5 → "$5", 4.5 → "$4.50". */
export function formatUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** 30 → "30 days", 365 → "1 year". */
export function formatDays(days: number): string {
  if (days > 0 && days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Code-chart label for an emoji id: "1F996" → "U+1F996". Sequences show their first code point
 * and a "+", the way Unicode charts label a single cell.
 */
export function codePointLabel(id: string): string {
  const [first, ...rest] = id.split("-").filter((part) => part !== "FE0F");
  return `U+${first ?? id}${rest.length > 0 ? " +" : ""}`;
}

function trimZeros(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
