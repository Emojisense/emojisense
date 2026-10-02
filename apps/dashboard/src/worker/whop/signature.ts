/**
 * Whop webhook signatures (Standard Webhooks, docs.whop.com/developer/guides/webhooks, "Verify
 * without an SDK"): HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}`, base64, sent as
 * `webhook-signature: v1,<signature>` (several entries may be separated by spaces).
 *
 * The key is the UTF-8 bytes of the whole `ws_…` secret as Whop shows it. Unlike other Standard
 * Webhooks senders, Whop does not strip a prefix or base64-decode the secret; its own SDK
 * base64-encodes the secret before handing it to the `standardwebhooks` library for that reason.
 */

/** Whop's limit, in both directions: older or future timestamps are refused (replays). */
export const WHOP_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type WhopSignatureFailure = "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature";

export interface WhopSignatureInput {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  /** The raw request body, byte for byte. */
  body: Uint8Array;
  secret: string;
  nowMs: number;
}

const encoder = new TextEncoder();

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function signedContent(id: string, timestamp: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const content = new Uint8Array(prefix.byteLength + body.byteLength);
  content.set(prefix, 0);
  content.set(body, prefix.byteLength);
  return content;
}

/** `null` when the signature is valid; otherwise why it is not. */
export async function checkWhopSignature(input: WhopSignatureInput): Promise<WhopSignatureFailure | null> {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return "missing_headers";
  if (!/^\d{1,12}$/.test(timestamp)) return "bad_timestamp";
  const ageSeconds = Math.abs(input.nowMs / 1000 - Number(timestamp));
  if (ageSeconds > WHOP_SIGNATURE_TOLERANCE_SECONDS) return "stale_timestamp";

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const content = signedContent(id, timestamp, input.body);
  for (const entry of signature.split(" ")) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    const expected = decodeBase64(value);
    // subtle.verify compares in constant time.
    if (expected && (await crypto.subtle.verify("HMAC", key, expected, content))) return null;
  }
  return "bad_signature";
}
