import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmbeddingModel } from "@emojisense/data/models";
import { parseVectorFileName } from "@emojisense/data/vector-files";
import { decodeVectors, searchVectorSets, type VectorIndex, type VectorMatch } from "emojisense";

/** The vector files of one model and dims in a pack directory: shared and per locale. */
export interface VectorLayout {
  /** e.g. "bge-m3@1024 (shared + 10 locales)" */
  label: string;
  /** Locales with their own file. */
  locales: string[];
  /** The indexes a query of `locale` searches: the shared one and the locale's own, when present. */
  indexesFor(locale: string): VectorIndex[];
  search(locale: string, query: Float32Array, k: number): VectorMatch[];
}

/** Undefined when the directory holds no vector file of this model and dims. */
export function loadVectorLayout(
  packDir: string,
  model: EmbeddingModel,
  dims: number,
): VectorLayout | undefined {
  if (!existsSync(packDir)) return undefined;
  let shared: VectorIndex | undefined;
  const byLocale = new Map<string, VectorIndex>();
  for (const name of readdirSync(packDir)) {
    const file = parseVectorFileName(name);
    if (!file || file.modelKey !== model.key || file.dims !== dims) continue;
    const index = decodeVectors(readFileSync(join(packDir, name)));
    if (index.model !== model.id || index.dims !== dims) {
      throw new Error(`${name} holds ${index.model}@${index.dims}, expected ${model.id}@${dims}`);
    }
    if (file.locale) byLocale.set(file.locale, index);
    else shared = index;
  }
  if (!shared && byLocale.size === 0) return undefined;
  const indexesFor = (locale: string) =>
    [shared, byLocale.get(locale)].filter((i): i is VectorIndex => i !== undefined);
  const locales = [...byLocale.keys()].sort();
  return {
    label: `${model.key}@${dims} (${shared ? "shared" : "no shared file"}${locales.length ? ` + ${locales.length} locales` : ""})`,
    locales,
    indexesFor,
    search: (locale, query, k) => {
      const indexes = indexesFor(locale);
      return indexes.length ? searchVectorSets(indexes, query, k) : [];
    },
  };
}
