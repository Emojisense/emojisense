/**
 * Slack and Discord as emoji sources for the import routes. Tokens are used for one request and
 * never stored or logged; error messages name the provider's error code, never the token.
 * Image URLs are only fetched from the providers' own CDNs.
 */
import type { Deps } from "./env";
import { HttpError } from "./http";

export interface EmojiCandidate {
  /** The provider's name for the emoji; it becomes the shortcode if it passes the rules. */
  name: string;
  url: string;
}

export interface EmojiListing {
  candidates: EmojiCandidate[];
  /** Slack `alias:` entries: other names for an emoji in the list. Not imported. */
  aliases: number;
  /** Entries without a usable name, id or image URL. */
  invalid: number;
}

type Fetch = Deps["fetch"];

const PROVIDER_TIMEOUT_MS = 10_000;

const unavailable = (provider: string) =>
  new HttpError(502, "import_unavailable", `${provider} did not answer. Try again in a minute.`);

const rateLimited = (provider: string) =>
  new HttpError(429, "import_rate_limited", `${provider} is limiting requests. Wait a minute and try again.`);

async function call(provider: string, fetch: Fetch, url: string, authorization: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { authorization, accept: "application/json" },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw unavailable(provider);
  }
}

/** A provider error code is shown to the user, so only a short [a-z_] word passes. */
const safeCode = (value: unknown) =>
  typeof value === "string" && /^[a-z0-9_]{1,40}$/i.test(value) ? value : "unknown_error";

// ---------------------------------------------------------------------------------------------
// Slack: GET https://slack.com/api/emoji.list with a user token (emoji:read).

export const SLACK_EMOJI_LIST_URL = "https://slack.com/api/emoji.list";

const SLACK_TOKEN = /^xox[a-z]-[A-Za-z0-9-]{10,250}$/;
const SLACK_AUTH_ERRORS = new Set([
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "no_permission",
  "not_allowed_token_type",
]);

export function parseSlackToken(value: unknown): string {
  if (typeof value !== "string" || !SLACK_TOKEN.test(value.trim())) {
    throw new HttpError(400, "invalid_request", "token must be a Slack user token (xoxp-…).", "token");
  }
  return value.trim();
}

function isSlackImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "slack-edge.com" || url.hostname.endsWith(".slack-edge.com"))
    );
  } catch {
    return false;
  }
}

/** `{ ok, emoji: { name: url | "alias:other" } }` → candidates; aliases are counted, not imported. */
export function parseSlackEmojiList(body: unknown): EmojiListing {
  const listing: EmojiListing = { candidates: [], aliases: 0, invalid: 0 };
  const emoji = (body as { emoji?: unknown } | null)?.emoji;
  if (!emoji || typeof emoji !== "object") return listing;
  for (const [name, value] of Object.entries(emoji)) {
    if (typeof value === "string" && value.startsWith("alias:")) listing.aliases++;
    else if (typeof value === "string" && isSlackImageUrl(value))
      listing.candidates.push({ name, url: value });
    else listing.invalid++;
  }
  return listing;
}

export async function listSlackEmoji(fetch: Fetch, token: string): Promise<EmojiListing> {
  const response = await call("Slack", fetch, SLACK_EMOJI_LIST_URL, `Bearer ${token}`);
  if (response.status === 429) throw rateLimited("Slack");
  if (!response.ok) throw unavailable("Slack");
  const body = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
  if (body?.ok !== true) {
    const code = safeCode(body?.error);
    if (SLACK_AUTH_ERRORS.has(code)) {
      throw new HttpError(
        400,
        "import_auth_failed",
        `Slack refused the token (${code}). Use a user token (xoxp-…) with the emoji:read scope.`,
        "token",
      );
    }
    throw new HttpError(502, "import_unavailable", `Slack answered with an error (${code}).`);
  }
  return parseSlackEmojiList(body);
}

// ---------------------------------------------------------------------------------------------
// Discord: GET https://discord.com/api/v10/guilds/:id/emojis with a bot token; images on the CDN.

export const DISCORD_API = "https://discord.com/api/v10";
export const DISCORD_CDN = "https://cdn.discordapp.com";

const SNOWFLAKE = /^\d{15,25}$/;
const DISCORD_TOKEN = /^[A-Za-z0-9._-]{20,200}$/;

export function parseDiscordInput(body: Record<string, unknown>): { botToken: string; guildId: string } {
  const botToken = typeof body.botToken === "string" ? body.botToken.trim().replace(/^Bot\s+/i, "") : "";
  if (!DISCORD_TOKEN.test(botToken)) {
    throw new HttpError(400, "invalid_request", "botToken must be a Discord bot token.", "botToken");
  }
  const guildId = typeof body.guildId === "string" ? body.guildId.trim() : "";
  if (!SNOWFLAKE.test(guildId)) {
    throw new HttpError(
      400,
      "invalid_request",
      "guildId must be a Discord server id (digits only).",
      "guildId",
    );
  }
  return { botToken, guildId };
}

/** `[{ id, name, animated }]` → candidates on the Discord CDN (GIF when animated, else PNG). */
export function parseDiscordEmojiList(body: unknown): EmojiListing {
  const listing: EmojiListing = { candidates: [], aliases: 0, invalid: 0 };
  if (!Array.isArray(body)) return listing;
  for (const item of body as { id?: unknown; name?: unknown; animated?: unknown }[]) {
    if (typeof item?.id !== "string" || !SNOWFLAKE.test(item.id) || typeof item.name !== "string") {
      listing.invalid++;
      continue;
    }
    const extension = item.animated === true ? "gif" : "png";
    listing.candidates.push({
      name: item.name,
      url: `${DISCORD_CDN}/emojis/${item.id}.${extension}?size=128`,
    });
  }
  return listing;
}

export async function listDiscordEmoji(
  fetch: Fetch,
  botToken: string,
  guildId: string,
): Promise<EmojiListing> {
  const response = await call("Discord", fetch, `${DISCORD_API}/guilds/${guildId}/emojis`, `Bot ${botToken}`);
  if (response.status === 401) {
    throw new HttpError(400, "import_auth_failed", "Discord refused the bot token.", "botToken");
  }
  if (response.status === 403) {
    throw new HttpError(
      400,
      "import_auth_failed",
      "The bot cannot read this server's emoji. Add the bot to the server first.",
      "guildId",
    );
  }
  if (response.status === 404) {
    throw new HttpError(400, "invalid_request", "Discord does not know a server with this id.", "guildId");
  }
  if (response.status === 429) throw rateLimited("Discord");
  if (!response.ok) throw unavailable("Discord");
  return parseDiscordEmojiList(await response.json().catch(() => null));
}

/** Image hosts the importers may download from (the providers' CDNs only). */
export function isProviderImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (isSlackImageUrl(value) || url.origin === DISCORD_CDN);
  } catch {
    return false;
  }
}
