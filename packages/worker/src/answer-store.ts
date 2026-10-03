import type { CacheLike } from "./context.ts";
import type { WaitUntil } from "./meter.ts";

/** The part of R2Bucket the answer store uses. */
export interface AnswerBucket {
  get(key: string): Promise<{ text(): Promise<string>; httpMetadata?: { cacheControl?: string } } | null>;
  put(
    key: string,
    value: string,
    options: { httpMetadata: { contentType: string; cacheControl: string } },
  ): Promise<unknown>;
}

/** Answers are stored by a hash of their cache key, so no object name holds query text. */
export const ANSWER_PREFIX = "answers/";

async function keyOf(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${ANSWER_PREFIX}${hex}`;
}

/**
 * A second tier behind the Cache API, which is per data center: answers in R2, shared by every
 * data center (DECISIONS.md, "Global answer cache"). A miss here goes on to the model; an answer
 * found here is copied into this data center's cache. On by `ANSWER_CACHE_ENABLED=true` only:
 * each new answer is an R2 write ($4.50 per 1M), more than its embedding costs, so it pays only
 * when the same long-tail queries come from many data centers. The bucket's lifecycle rule
 * expires `answers/` after 7 days, like the edge copies.
 */
export function withAnswerStore(edge: CacheLike, bucket: AnswerBucket, ctx: WaitUntil): CacheLike {
  return {
    async match(request) {
      const hit = await edge.match(request);
      if (hit) return hit;
      let stored: Awaited<ReturnType<AnswerBucket["get"]>>;
      try {
        stored = await bucket.get(await keyOf(request.url));
      } catch {
        return undefined;
      }
      if (!stored) return undefined;
      const cacheControl = stored.httpMetadata?.cacheControl ?? "public, max-age=3600";
      const response = new Response(await stored.text(), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
      });
      ctx.waitUntil(edge.put(request, response.clone()));
      return response;
    },
    async put(request, response) {
      const copy = response.clone();
      await edge.put(request, response);
      try {
        await bucket.put(await keyOf(request.url), await copy.text(), {
          httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: copy.headers.get("Cache-Control") ?? "public, max-age=3600",
          },
        });
      } catch {
        // The answer store is an optimization; the edge copy is written.
      }
    },
    delete: (url) => edge.delete(url),
  };
}
