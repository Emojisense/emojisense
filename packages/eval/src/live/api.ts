/** A tiny client for the endpoints the live evals call. Retries on 429 (per-key rate limit). */

export interface ApiResult {
  emoji: string;
  id: string;
  score: number;
  source: string;
}

export interface LiveTarget {
  /** e.g. http://localhost:8788 */
  api: string;
  key: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call<T>(url: string, init: RequestInit): Promise<{ body: T; ms: number }> {
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    const response = await fetch(url, init);
    if (response.status === 429 && attempt < 5) {
      await sleep(1000 * Number(response.headers.get("retry-after") ?? 5));
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
    return { body: (await response.json()) as T, ms: Math.round(performance.now() - started) };
  }
}

export interface ClassifyImageBody {
  caption: string;
  reaction: string;
  /** Added with vision prompt v2; absent on older Workers. */
  keywords?: string[];
  results: ApiResult[];
  degraded: boolean;
  overLimit: boolean;
}

/** POST /v1/classify-image without X-Image-Hash, so every run asks the vision model again. */
export function classifyImage(target: LiveTarget, bytes: Uint8Array, type: string, limit: number) {
  const url = `${target.api}/v1/classify-image?${new URLSearchParams({ key: target.key, limit: String(limit), locale: "en" })}`;
  return call<ClassifyImageBody>(url, {
    method: "POST",
    headers: { "content-type": type },
    body: bytes,
  });
}

export interface ReactionsBody {
  results: ApiResult[];
  degraded: boolean;
  overLimit: boolean;
}

export function suggestReactions(target: LiveTarget, text: string, locale: string, limit: number) {
  const url = `${target.api}/v1/suggest-reactions?${new URLSearchParams({ key: target.key })}`;
  return call<ReactionsBody>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, locale, limit }),
  });
}
