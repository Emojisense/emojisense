/**
 * Names of the vector files of a pack version (docs/PACK_FORMAT.md §5):
 *
 *   vectors.<model>.<dims>.bin            shared documents (English; every locale searches them)
 *   vectors.<model>.<dims>.<locale>.bin   one locale's documents (only that locale searches them)
 */
export interface VectorFile {
  modelKey: string;
  dims: number;
  /** Absent for the shared file. */
  locale?: string;
}

export function vectorFileName(modelKey: string, dims: number, locale?: string): string {
  return `vectors.${modelKey}.${dims}${locale ? `.${locale}` : ""}.bin`;
}

const PATTERN = /^vectors\.([\w-]+)\.(\d+)(?:\.([a-z]{2,3}))?\.bin$/;

export function parseVectorFileName(name: string): VectorFile | undefined {
  const match = PATTERN.exec(name);
  if (!match) return undefined;
  const [, modelKey, dims, locale] = match as unknown as [string, string, string, string | undefined];
  return { modelKey, dims: Number(dims), ...(locale ? { locale } : {}) };
}
