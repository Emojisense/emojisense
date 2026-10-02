import { getModel } from "@emojisense/data/models";
import { hashKey } from "@emojisense/platform";
import { createEngine, decodeVectors, encodeVectors, l2normalize, type Pack } from "emojisense";
import { vi } from "vitest";
import { createApp } from "../src/app.ts";
import { VISION_MODEL } from "../src/config.ts";
import type { CacheLike } from "../src/context.ts";
import type { CustomEmojiReader } from "../src/custom-store.ts";
import type { AiBinding, Env } from "../src/env.ts";
import type { Catalog } from "../src/semantic.ts";
import { type ApiKey, createMemoryStore, type Store } from "../src/store.ts";
import type { ImageLabel } from "../src/vision.ts";

const row = (emoji: string, hexcode: string, label: string, alias = ""): Pack["emoji"][number] => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  "",
  "",
  alias,
  "",
  "",
];

const pack: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["g"],
  emoji: [
    row("🦖", "1F996", "T-Rex", "jurassic park"),
    row("🌋", "1F30B", "volcano"),
    row("🚀", "1F680", "rocket", "ship it|shipped"),
    row("🐶", "1F436", "dog face", "puppy"),
  ],
};

const DIMS = 8;
/** Vector row of each fixture emoji, for `fakeAi({ embedTo })`. */
export const ROW = { trex: 0, volcano: 1, rocket: 2, dog: 3 } as const;
export const unit = (i: number) =>
  l2normalize(Float32Array.from({ length: DIMS }, (_, d) => (d === i ? 1 : 0.01)));

/** The production model (bge-m3 @1024); the fixture vectors use 8 dims. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/** Fixture vectors: one row per fixture emoji; `rows[i]` defaults to `unit(i)`. */
export const fixtureVectors = (rows: Float32Array[] = [unit(0), unit(1), unit(2), unit(3)]) =>
  decodeVectors(encodeVectors(EMBEDDING_MODEL, ["1F996", "1F30B", "1F680", "1F436"], rows));

const sharedIndex = fixtureVectors();

export const catalog: Catalog = {
  config: {
    packVersion: "test",
    modelKey: "bge-m3",
    modelId: EMBEDDING_MODEL,
    dims: DIMS,
    queryTemplate: "{q}",
    vectorLocales: [],
    contentHash: "c0ffee",
  },
  model: getModel("bge-m3"),
  engine: () => createEngine(pack),
  // English only; test/locales.test.ts builds a catalog with real packs of other locales.
  aliasEngine: async (locale) => (locale === "en" ? createEngine(pack) : undefined),
  index: () => sharedIndex,
  // Shared vectors only; test/locale-vectors.test.ts covers the vectors of other locales.
  vectors: async () => ({ indexes: [sharedIndex], complete: true }),
};

export function memoryCache(): CacheLike & { store: Map<string, Response>; puts: string[] } {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  return {
    store,
    puts,
    match: async (r) => store.get(r.url)?.clone(),
    put: async (r, res) => {
      puts.push(r.url);
      store.set(r.url, res.clone());
    },
  };
}

/** Collects waitUntil promises so a test can await background work (cache puts, flushes). */
export function executionContext() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

export const DEFAULT_LABEL: ImageLabel = {
  caption: "a puppy asleep on a sofa",
  reaction: "aww so cute",
  keywords: ["puppy", "sofa"],
  emoji: ["🐶"],
};

/**
 * A fake Workers AI: embeddings always land next to `embedTo` (the volcano row by default), and
 * the vision model answers with `label` in the chat-completions shape (a string is sent as is).
 */
const visionContent = (label: ImageLabel | string | undefined) =>
  typeof label === "string" ? label : JSON.stringify(label ?? DEFAULT_LABEL);

export function fakeAi(options: { embedTo?: number; label?: ImageLabel | string } = {}) {
  return vi.fn<AiBinding["run"]>(async (model) => {
    if (model === VISION_MODEL) {
      return {
        choices: [{ message: { role: "assistant", content: visionContent(options.label) } }],
      };
    }
    return { data: [Array.from(unit(options.embedTo ?? 1))] };
  });
}

export const KEYS = {
  publishable: "pk_live_publishable0000000000000000",
  wildcard: "pk_live_anyorigin00000000000000000000",
  secret: "sk_live_secret000000000000000000000000",
  revoked: "pk_live_revoked0000000000000000000000",
  pro: "pk_live_pro00000000000000000000000000",
  /** A second app of the Pro account: it shares the account's plan limits. */
  proSibling: "pk_live_prosibling000000000000000000",
};

export const ALLOWED_ORIGIN = "https://app.example.com";

/** A key row of `owner.appId`, an app of `owner.accountId`, for memory stores. */
export function apiKey(owner: { appId: string; accountId: string }, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: `key_${owner.appId}`,
    ...owner,
    kind: "publishable",
    plan: "free",
    allowedOrigins: [],
    revoked: false,
    ...overrides,
  };
}

/** A memory store with one key of each kind, registered by hash like the api_keys table. */
export async function seededStore() {
  const keys: Record<string, ApiKey> = {
    [await hashKey(KEYS.publishable)]: {
      id: "key_pub",
      appId: "app_free",
      accountId: "acc_free",
      kind: "publishable",
      plan: "free",
      allowedOrigins: [ALLOWED_ORIGIN],
      revoked: false,
    },
    [await hashKey(KEYS.wildcard)]: {
      id: "key_any",
      appId: "app_free",
      accountId: "acc_free",
      kind: "publishable",
      plan: "free",
      allowedOrigins: [],
      revoked: false,
    },
    [await hashKey(KEYS.secret)]: {
      id: "key_sec",
      appId: "app_free",
      accountId: "acc_free",
      kind: "secret",
      plan: "free",
      allowedOrigins: [],
      revoked: false,
    },
    [await hashKey(KEYS.revoked)]: {
      id: "key_rev",
      appId: "app_free",
      accountId: "acc_free",
      kind: "publishable",
      plan: "free",
      allowedOrigins: [],
      revoked: true,
    },
    [await hashKey(KEYS.pro)]: {
      id: "key_pro",
      appId: "app_pro",
      accountId: "acc_pro",
      kind: "publishable",
      plan: "pro",
      allowedOrigins: [],
      revoked: false,
    },
    [await hashKey(KEYS.proSibling)]: apiKey({ appId: "app_pro_2", accountId: "acc_pro" }, { plan: "pro" }),
  };
  return createMemoryStore(keys);
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  env: Env;
  ai: ReturnType<typeof fakeAi>;
  cache: ReturnType<typeof memoryCache>;
  ctx: ReturnType<typeof executionContext>;
  events: ReturnType<typeof vi.fn>;
  call(request: Request): Promise<Response>;
}

export function harness(
  options: {
    store?: Store;
    customEmoji?: CustomEmojiReader;
    env?: Partial<Env>;
    now?: () => number;
    embedTo?: number;
    /** What the vision model answers: a label, or raw text. */
    label?: ImageLabel | string;
    catalog?: Catalog;
    /** Outgoing webhook requests, and the wait between their retries. */
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Harness {
  const ai = fakeAi({
    ...(options.embedTo === undefined ? {} : { embedTo: options.embedTo }),
    ...(options.label === undefined ? {} : { label: options.label }),
  });
  const events = vi.fn();
  const cache = memoryCache();
  const ctx = executionContext();
  const env: Env = { AI: { run: ai }, EVENTS: { writeDataPoint: events }, ...options.env };
  const app = createApp({
    catalog: options.catalog ?? catalog,
    cache: () => cache,
    store: () => options.store,
    customEmoji: () => options.customEmoji,
    ...(options.now ? { now: options.now } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  return { app, env, ai, cache, ctx, events, call: (request) => app.fetch(request, env, ctx) };
}

export const API = "https://api.test";

export const search = (q: string, extra = "", init?: RequestInit) =>
  new Request(`${API}/v1/search?q=${encodeURIComponent(q)}${extra}`, init);

export const reactions = (body: unknown, query = "", init: RequestInit = {}) =>
  new Request(`${API}/v1/suggest-reactions${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** A minimal byte string that passes the JPEG signature check. */
export function jpeg(size = 64): Uint8Array {
  const bytes = new Uint8Array(size).fill(7);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

export const image = (bytes: Uint8Array, headers: Record<string, string> = {}, query = "") =>
  new Request(`${API}/v1/classify-image${query}`, {
    method: "POST",
    headers: { "content-type": "image/jpeg", ...headers },
    body: bytes,
  });
