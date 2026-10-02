/** Each app gets a stable emoji, so apps are easy to tell apart in a monochrome UI. */
const APP_EMOJI = ["🦖", "🐙", "🦊", "🐝", "🦉", "🐳", "🦩", "🐢", "🦔", "🐧", "🦦", "🐌", "🦜", "🐞"];

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function appEmoji(appId: string): string {
  return APP_EMOJI[hash(appId) % APP_EMOJI.length] ?? "🦖";
}

export function initials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? "?").trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : source.slice(0, 2);
  return letters.toUpperCase();
}
