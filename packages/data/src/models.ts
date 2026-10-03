/**
 * Embedding models we benchmark. `key` names the vector files. Query and document templates
 * follow each model card (see docs/RESEARCH.md). Queries and documents MUST use the same model,
 * pooling and dims; the vector file records the model id and the manifest the query template.
 */
export interface EmbeddingModel {
  key: string;
  id: string;
  nativeDims: number;
  /** Matryoshka-trained: truncation is a supported operation. */
  mrl: boolean;
  multilingual: boolean;
  maxBatch: number;
  queryTemplate: string;
  documentTemplate: string;
  /** Workers AI input body for a list of texts. */
  input(texts: string[], kind: "query" | "document"): Record<string, unknown>;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");

export const MODELS: EmbeddingModel[] = [
  {
    key: "bge-small",
    id: "@cf/baai/bge-small-en-v1.5",
    nativeDims: 384,
    mrl: false,
    multilingual: false,
    maxBatch: 100,
    queryTemplate: "Represent this sentence for searching relevant passages: {q}",
    documentTemplate: "{title}. {text}",
    input: (text) => ({ text, pooling: "cls" }),
  },
  {
    key: "bge-m3",
    id: "@cf/baai/bge-m3",
    nativeDims: 1024,
    mrl: false,
    multilingual: true,
    maxBatch: 100,
    queryTemplate: "{q}",
    documentTemplate: "{title}. {text}",
    input: (text) => ({ text }),
  },
  {
    key: "embeddinggemma",
    id: "@cf/google/embeddinggemma-300m",
    nativeDims: 768,
    mrl: true,
    multilingual: true,
    maxBatch: 100,
    queryTemplate: "task: search result | query: {q}",
    documentTemplate: "title: {title} | text: {text}",
    input: (text) => ({ text }),
  },
  {
    key: "qwen3",
    id: "@cf/qwen/qwen3-embedding-0.6b",
    nativeDims: 1024,
    mrl: true,
    multilingual: true,
    maxBatch: 32,
    // Workers AI applies the instruction itself when texts are sent as `queries`.
    queryTemplate: "{q}",
    documentTemplate: "{title}. {text}",
    input: (texts, kind) =>
      kind === "query"
        ? {
            queries: texts,
            instruction: "Given an emoji search query, retrieve emoji whose description matches it",
          }
        : { documents: texts },
  },
  // Off-the-shelf small models Workers AI does not host, embedded on this machine by
  // scripts/local_embed_server.py (eval experiments only; embeddings.ts routes "local/").
  ...(
    [
      ["granite-97m-r2", 384, "{q}", "{title}. {text}"],
      ["bekko-a8m", 384, "{q}", "{title}. {text}"],
      ["bekko-a25m", 384, "{q}", "{title}. {text}"],
      ["e5-small", 384, "query: {q}", "passage: {title}. {text}"],
      ["potion-multi", 256, "{q}", "{title}. {text}"],
    ] as const
  ).map(
    ([key, nativeDims, queryTemplate, documentTemplate]): EmbeddingModel => ({
      key,
      id: `local/${key}`,
      nativeDims,
      mrl: false,
      multilingual: true,
      maxBatch: 64,
      queryTemplate,
      documentTemplate,
      input: (texts) => ({ texts }),
    }),
  ),
];

export function getModel(key: string): EmbeddingModel {
  const model = MODELS.find((m) => m.key === key);
  if (!model) throw new Error(`unknown model "${key}" (known: ${MODELS.map((m) => m.key).join(", ")})`);
  return model;
}

export const formatQuery = (model: EmbeddingModel, q: string) => fill(model.queryTemplate, { q });
export const formatDocument = (model: EmbeddingModel, title: string, text: string) =>
  fill(model.documentTemplate, { title, text });
