import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@emojisense/data/models";
import { encodeVectors, l2normalize } from "emojisense";
import { afterAll, describe, expect, it } from "vitest";
import { loadVectorLayout } from "../src/vector-layout.ts";

const model = getModel("bge-m3");
const ids = ["1F600", "1F436", "1F680"];
const axis = (i: number) => l2normalize(Float32Array.from({ length: 8 }, (_, d) => (d === i ? 1 : 0.01)));
const write = (dir: string, name: string, rows: Float32Array[], id = model.id) =>
  writeFileSync(join(dir, name), encodeVectors(id, ids, rows));

describe("loadVectorLayout", () => {
  const dir = mkdtempSync(join(tmpdir(), "emojisense-layout-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  write(dir, "vectors.bge-m3.8.bin", [axis(0), axis(1), axis(2)]);
  // In the Spanish documents, 1F680 sits where the query lands.
  write(dir, "vectors.bge-m3.8.es.bin", [axis(0), axis(1), axis(5)]);
  // Another dims: not part of the @8 layout.
  write(
    dir,
    "vectors.bge-m3.16.es.bin",
    [axis(0), axis(1), axis(2)].map((v) =>
      l2normalize(Float32Array.from({ length: 16 }, (_, d) => v[d % 8] as number)),
    ),
  );

  it("searches the shared file and the query locale's own file", () => {
    const layout = loadVectorLayout(dir, model, 8);
    expect(layout?.locales).toEqual(["es"]);
    expect(layout?.indexesFor("en")).toHaveLength(1);
    expect(layout?.indexesFor("es")).toHaveLength(2);
    expect(layout?.search("es", axis(5), 1)[0]?.id).toBe("1F680");
    expect(layout?.search("en", axis(5), 1)[0]?.id).not.toBe("1F680");
  });

  it("is undefined without files of that model and dims, and refuses a file of another model", () => {
    expect(loadVectorLayout(dir, model, 32)).toBeUndefined();
    expect(loadVectorLayout(dir, getModel("qwen3"), 8)).toBeUndefined();
    write(dir, "vectors.bge-m3.8.tr.bin", [axis(0), axis(1), axis(2)], "@cf/other/model");
    expect(() => loadVectorLayout(dir, model, 8)).toThrow("expected @cf/baai/bge-m3@8");
  });
});
