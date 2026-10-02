/**
 * CORS: any origin may call the API; publishable keys are bound to origins separately (auth.ts).
 * `Authorization` is deliberately not in Allow-Headers, so browsers cannot send secret keys
 * cross-origin even by mistake.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Image-Hash",
  "Access-Control-Expose-Headers": "Server-Timing, Retry-After",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...headers },
  });
}

export function errorResponse(status: number, error: string, headers: Record<string, string> = {}) {
  return json({ error }, status, { "Cache-Control": "no-store", ...headers });
}

export function parseLimit(raw: unknown, fallback: number, max: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value))) : fallback;
}

export function parseLocale(raw: unknown): "en" | "tr" {
  return raw === "tr" ? "tr" : "en";
}

/**
 * Read at most `max` bytes of the body. Returns undefined when the body is larger, without
 * buffering the rest, so an oversized upload costs no more memory than the limit.
 */
export async function readBodyCapped(request: Request, max: number): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return undefined;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    total += chunk.byteLength;
    if (total > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
