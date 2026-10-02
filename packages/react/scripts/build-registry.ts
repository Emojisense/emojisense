/// <reference types="node" />
/**
 * Build the shadcn registry the way `shadcn build` does: registry/registry.json →
 * <outDir>/registry.json + <outDir>/<item>.json with every file's content inlined. Any static
 * host can then serve `npx shadcn add <host>/r/emoji-picker.json`.
 *   tsx scripts/build-registry.ts [outDir]     (default: dist/r)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY_ITEM_SCHEMA = "https://ui.shadcn.com/schema/registry-item.json";

export interface RegistryFile {
  path: string;
  type: string;
  target?: string;
  content?: string;
}

export interface RegistryItem {
  name: string;
  type: string;
  files?: RegistryFile[];
  [field: string]: unknown;
}

export interface Registry {
  $schema?: string;
  name: string;
  homepage: string;
  items: RegistryItem[];
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
export const DEFAULT_REGISTRY = join(packageRoot, "registry", "registry.json");

/** Resolve every item of a registry into its installable form (file contents inlined). */
export async function buildRegistry(registryPath = DEFAULT_REGISTRY): Promise<{
  registry: Registry;
  items: (RegistryItem & { $schema: string })[];
}> {
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
  if (!registry.name || !registry.homepage || !Array.isArray(registry.items)) {
    throw new Error(`${registryPath}: a root registry needs name, homepage and items`);
  }
  const root = dirname(registryPath);
  const items = await Promise.all(
    registry.items.map(async (item) => {
      if (!item.name || !item.type) throw new Error(`${registryPath}: every item needs name and type`);
      const files = await Promise.all(
        (item.files ?? []).map(async (file) => ({
          ...file,
          content: await readFile(resolve(root, file.path), "utf8"),
        })),
      );
      return { $schema: REGISTRY_ITEM_SCHEMA, ...item, files };
    }),
  );
  return { registry, items };
}

export async function writeRegistry(outDir: string, registryPath = DEFAULT_REGISTRY): Promise<string[]> {
  const { registry, items } = await buildRegistry(registryPath);
  await mkdir(outDir, { recursive: true });
  const written = [join(outDir, "registry.json")];
  await writeFile(written[0] as string, `${JSON.stringify(registry, null, 2)}\n`);
  for (const item of items) {
    const file = join(outDir, `${item.name}.json`);
    await writeFile(file, `${JSON.stringify(item, null, 2)}\n`);
    written.push(file);
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = resolve(process.argv[2] ?? join(packageRoot, "dist", "r"));
  for (const file of await writeRegistry(outDir)) console.log(`registry: wrote ${file}`);
}
