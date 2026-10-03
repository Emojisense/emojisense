/**
 * Semantic-tier configurations that `eval:models` compares as drop-ins for the production model:
 * which model embeds the query and how (template, instruction), which document and glyph vector
 * files it searches, and at which dims. A spec is `<variant>@<dims>`, e.g. `qwen3-task@512`.
 *
 * A query variant may differ from its document model only in how queries are embedded (Qwen3's
 * instruction). Each query variant has its own `key`, so its query vectors get their own embedding
 * cache file (the cache key does not include the instruction).
 */
import { type EmbeddingModel, getModel } from "@emojisense/data/models";

/** Qwen3's instruction from the owner's brief: what an emoji search is for. */
export const QWEN3_TASK_INSTRUCTION =
  "Given a word or phrase someone types into an emoji search, retrieve the emoji that best expresses it";

const qwen3 = getModel("qwen3");
const qwen3Queries = (key: string, instruction: string | undefined): EmbeddingModel => ({
  ...qwen3,
  key,
  // Documents are embedded without an instruction (the model card); only queries carry one.
  input: (texts, kind) =>
    kind === "query" ? { queries: texts, ...(instruction ? { instruction } : {}) } : { documents: texts },
});

interface VariantDefinition {
  /** Embeds the queries. */
  query: EmbeddingModel;
  /** Key of the document and glyph vector files (`vectors.<key>.<dims>[.<locale>|.glyph].bin`). */
  documents: string;
  note: string;
}

export const VARIANTS: Record<string, VariantDefinition> = {
  "bge-m3": { query: getModel("bge-m3"), documents: "bge-m3", note: "production" },
  embeddinggemma: {
    query: getModel("embeddinggemma"),
    documents: "embeddinggemma",
    note: 'task prompts: "task: search result | query: …", "title: … | text: …"',
  },
  qwen3: {
    query: getModel("qwen3"),
    documents: "qwen3",
    note: "instruction from models.ts (emoji search query → emoji description)",
  },
  "qwen3-default": {
    query: qwen3Queries("qwen3-default", undefined),
    documents: "qwen3",
    note: "Workers AI default instruction (web search query → passages)",
  },
  "qwen3-task": {
    query: qwen3Queries("qwen3-task", QWEN3_TASK_INSTRUCTION),
    documents: "qwen3",
    note: "instruction: word or phrase typed into an emoji search → emoji",
  },
  ...Object.fromEntries(
    ["granite-97m-r2", "bekko-a8m", "bekko-a25m", "e5-small", "potion-multi"].map((key) => [
      key,
      {
        query: getModel(key),
        documents: key,
        note: "off-the-shelf, embedded locally (scripts/local_embed_server.py)",
      },
    ]),
  ),
};

export interface ModelVariant {
  /** The spec, e.g. "qwen3-task@512". */
  name: string;
  query: EmbeddingModel;
  documents: EmbeddingModel;
  dims: number;
  /** The production configuration (pack.config.json): its learned fusion weights apply. */
  shipped: boolean;
  note: string;
}

export function parseVariant(spec: string, production: { key: string; dims: number }): ModelVariant {
  const match = /^([\w-]+)@(\d+)$/.exec(spec.trim());
  if (!match) throw new Error(`variant "${spec}": expected <variant>@<dims>, e.g. qwen3-task@512`);
  const [, key, dimsText] = match as unknown as [string, string, string];
  const definition = VARIANTS[key];
  if (!definition) {
    throw new Error(`unknown variant "${key}" (known: ${Object.keys(VARIANTS).join(", ")})`);
  }
  const documents = getModel(definition.documents);
  const dims = Number(dimsText);
  if (dims > documents.nativeDims) {
    throw new Error(`${spec}: ${documents.key} has ${documents.nativeDims} dims`);
  }
  return {
    name: `${key}@${dims}`,
    query: definition.query,
    documents,
    dims,
    shipped: key === production.key && dims === production.dims,
    note: definition.note,
  };
}
