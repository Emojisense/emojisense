// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildRegistry, REGISTRY_ITEM_SCHEMA } from "../scripts/build-registry.js";

// Item and file types from https://ui.shadcn.com/schema/registry-item.json (checked 2026-10-02).
const ITEM_TYPES = new Set([
  "registry:lib",
  "registry:block",
  "registry:component",
  "registry:ui",
  "registry:hook",
  "registry:theme",
  "registry:page",
  "registry:file",
  "registry:style",
  "registry:base",
  "registry:font",
  "registry:item",
]);

/** Bare package names a file imports ("@scope/pkg/sub" → "@scope/pkg"). */
function importedPackages(source: string): string[] {
  const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
  return specifiers
    .filter((s) => !s.startsWith(".") && !s.startsWith("@/"))
    .map((s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : (s.split("/")[0] as string)));
}

describe("shadcn registry", () => {
  it("builds installable items with their file contents inlined", async () => {
    const { registry, items } = await buildRegistry();
    expect(registry).toMatchObject({ $schema: "https://ui.shadcn.com/schema/registry.json" });
    const item = items.find((i) => i.name === "emoji-picker");
    expect(item?.$schema).toBe(REGISTRY_ITEM_SCHEMA);
    expect(ITEM_TYPES.has(item?.type ?? "")).toBe(true);
    for (const file of item?.files ?? []) {
      expect(ITEM_TYPES.has(file.type)).toBe(true);
      expect(file.content).toContain('"use client"');
    }
  });

  it("lists every imported package as a dependency, and imports cn from @/lib/utils", async () => {
    const { items } = await buildRegistry();
    const item = items.find((i) => i.name === "emoji-picker");
    const content = item?.files?.[0]?.content ?? "";
    const declared = new Set(
      ((item?.dependencies ?? []) as string[]).map((d) => d.replace(/(?<=.)@[^/]*$/, "")),
    );
    const provided = new Set(["react"]);
    for (const pkg of importedPackages(content)) {
      if (!provided.has(pkg)) expect(declared, pkg).toContain(pkg);
    }
    expect(content).toContain('import { cn } from "@/lib/utils";');
    expect(content.match(/from "@\//g)).toHaveLength(1);
  });
});
