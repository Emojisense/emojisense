/**
 * "Copy as code": the SDK call and the HTTP request that give the same answer as the playground's
 * current settings. Only real exports of `emojisense` and `@emojisense/react` appear here.
 * Snippets use a placeholder key; curl goes without one (the anonymous rate limit applies).
 */
import type { Mode } from "./settings";

export interface CodeSample {
  id: "js" | "react" | "curl";
  label: string;
  language: "js" | "shell";
  code: string;
}

export interface Endpoints {
  /** API base, e.g. "https://api.emojisense.com". */
  api: string;
  packVersion: string;
}

const KEY = "pk_live_…";
const str = (value: string) => JSON.stringify(value);

/** Single-quoted for POSIX shells: a quote inside becomes '\''. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function packBase(endpoints: Endpoints) {
  return `${endpoints.api}/v1/pack/${endpoints.packVersion}`;
}

function locales(locale: string) {
  return locale === "en" ? "" : `, locales: [${str(locale)}]`;
}

export interface SearchSnippetInput {
  query: string;
  locale: string;
  mode: Mode;
  limit: number;
  alwaysEdge: boolean;
}

export function searchSnippets(input: SearchSnippetInput, endpoints: Endpoints): CodeSample[] {
  const { query, locale, mode, limit } = input;
  const q = str(query);
  const loadEngine = `const engine = createEngine(
  await loadPacks({ baseUrl: ${str(packBase(endpoints))}${locales(locale)} }),
);`;

  const js: Record<Mode, string> = {
    alias: `import { createEngine, loadPacks } from "emojisense";

${loadEngine}

// On the device: no request, works offline.
const { results } = engine.search(${q}, { limit: ${limit}, locale: ${str(locale)} });`,
    hybrid: `import { createEngine, createSearchSession, createSemanticClient, loadPacks } from "emojisense";

${loadEngine}

const session = createSearchSession({
  engine,
  semantic: createSemanticClient({ endpoint: ${str(endpoints.api)}, key: ${str(KEY)} }),
  locale: ${str(locale)},
  limit: ${limit},${input.alwaysEdge ? "\n  shouldUseSemantic: (alias) => alias.tokens.length > 0, // always ask the edge" : ""}
  onChange: (state) => render(state.results),
});

session.update(${q});`,
    semantic: `import { createSemanticClient } from "emojisense";

const client = createSemanticClient({ endpoint: ${str(endpoints.api)}, key: ${str(KEY)} });

// Meaning search only. Resolves undefined when the edge has no answer.
const response = await client.search(${q}, { locale: ${str(locale)}, limit: ${limit} });
response?.results; // [{ emoji, id, score, source: "semantic" }, …]`,
  };

  const edgeOptions =
    mode === "alias" ? "" : `\n  endpoint: ${str(endpoints.api)},\n  publishableKey: ${str(KEY)},`;
  const react = `import { useEmojiSearch, useEmojisense } from "@emojisense/react";

const sense = useEmojisense({
  packBaseUrl: ${str(packBase(endpoints))},
  locale: ${str(locale)},${edgeOptions}
});
const { results, status } = useEmojiSearch(${q}, sense, { limit: ${limit} });`;

  const curl: Record<Mode, string> = {
    alias: `# On-device search sends no request. The engine reads static packs once
# (English always loads first), then answers offline:
curl -O ${packBase(endpoints)}/pack.en.json${locale === "en" ? "" : `\ncurl -O ${packBase(endpoints)}/pack.${locale}.json`}`,
    hybrid: `# The SDK sends mode=semantic and fuses on the device.
# Thin clients send mode=hybrid: the server fuses aliases and meaning.
curl --get ${str(`${endpoints.api}/v1/search`)} \\
  --data-urlencode ${shellQuote(`q=${query}`)} \\
  -d locale=${locale} -d limit=${limit} -d mode=hybrid
# Add -d key=${KEY} for your plan's rate limits.`,
    semantic: `curl --get ${str(`${endpoints.api}/v1/search`)} \\
  --data-urlencode ${shellQuote(`q=${query}`)} \\
  -d locale=${locale} -d limit=${limit} -d mode=semantic
# Add -d key=${KEY} for your plan's rate limits.`,
  };

  return [
    { id: "js", label: "JavaScript", language: "js", code: js[mode] },
    ...(mode === "semantic" ? [] : [{ id: "react", label: "React", language: "js", code: react } as const]),
    { id: "curl", label: "curl", language: "shell", code: curl[mode] },
  ];
}

export function reactionSnippets(
  input: { text: string; locale: string; limit: number },
  endpoints: Endpoints,
): CodeSample[] {
  const body = { text: input.text, locale: input.locale, limit: input.limit };
  const js = `const text = ${str(input.text)};

const response = await fetch(${str(`${endpoints.api}/v1/suggest-reactions?key=${KEY}`)}, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, locale: ${str(input.locale)}, limit: ${input.limit} }),
});
const { results } = await response.json();

// Offline fallback: the on-device dictionary (same engine as search).
const { results: offline } = engine.search(text, { limit: ${input.limit}, locale: ${str(input.locale)}, prefix: false });`;
  const curl = `# The text is never logged or cached. The API reads the first 256 characters.
curl ${str(`${endpoints.api}/v1/suggest-reactions`)} \\
  -H "Content-Type: application/json" \\
  -d ${shellQuote(JSON.stringify(body))}`;
  return [
    { id: "js", label: "JavaScript", language: "js", code: js },
    { id: "curl", label: "curl", language: "shell", code: curl },
  ];
}

export function photoSnippets(input: { limit: number }, endpoints: Endpoints): CodeSample[] {
  const url = `${endpoints.api}/v1/classify-image?limit=${input.limit}&locale=en`;
  const js = `// Downscale to about 384 px on the long edge first (the API accepts 256 KB at most).
const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });

const response = await fetch(${str(`${url}&key=${KEY}`)}, {
  method: "POST",
  headers: { "Content-Type": "image/jpeg" },
  body: jpeg,
});
const { caption, reaction, results } = await response.json();`;
  const curl = `# The image is never stored: it is read in memory and dropped.
curl ${str(url)} \\
  -H "Content-Type: image/jpeg" \\
  --data-binary @photo.jpg`;
  return [
    { id: "js", label: "JavaScript", language: "js", code: js },
    { id: "curl", label: "curl", language: "shell", code: curl },
  ];
}
