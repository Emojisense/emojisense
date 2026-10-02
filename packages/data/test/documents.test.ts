import { describe, expect, it } from "vitest";
import { buildDocument, buildDocuments } from "../src/documents.ts";
import type { BaseEmoji } from "../src/types.ts";
import { parseVectorFileName, vectorFileName } from "../src/vector-files.ts";

const dog: BaseEmoji = {
  hexcode: "1F436",
  emoji: "🐶",
  label: "dog face",
  tags: ["dog", "face", "pet"],
  shortcodes: ["dog"],
  group: "animals-nature",
  subgroup: "animal-mammal",
  order: 1,
  version: 1,
  skins: [],
  i18n: {
    es: { label: "cara de perro", tags: ["perro", "mascota"] },
    hi: { label: null, tags: [] },
  },
};

const validated = {
  "1F436": {
    en: { desc: "A friendly dog.", alias: ["puppy", "doggo", "pet", "good boy"] },
    es: { desc: "Un perro simpático.", alias: ["perrito", "mascota", "guau"] },
  },
};

describe("buildDocument", () => {
  it("writes the locale's label, description, CLDR keywords and first aliases", () => {
    expect(buildDocument(dog, "es", validated["1F436"].es)).toEqual({
      title: "cara de perro",
      text: "Un perro simpático. perro, mascota, perrito, guau",
    });
    expect(buildDocument(dog, "en", validated["1F436"].en, 2)).toEqual({
      title: "dog face",
      text: "A friendly dog. dog, face, pet, puppy, doggo",
    });
  });

  it("falls back to the English label, and to the label alone without enrichment", () => {
    expect(buildDocument(dog, "hi", undefined)).toEqual({ title: "dog face", text: "" });
  });
});

describe("buildDocuments", () => {
  it("builds one document per emoji and locale", () => {
    const [docs] = buildDocuments([dog], validated, ["en", "es", "hi"]);
    expect(docs?.hexcode).toBe("1F436");
    expect(Object.keys(docs?.docs ?? {})).toEqual(["en", "es", "hi"]);
    expect(docs?.docs.es?.title).toBe("cara de perro");
  });
});

describe("vector file names", () => {
  it("names the shared file and each locale's file, and parses them back", () => {
    expect(vectorFileName("bge-m3", 1024)).toBe("vectors.bge-m3.1024.bin");
    expect(vectorFileName("bge-m3", 1024, "es")).toBe("vectors.bge-m3.1024.es.bin");
    expect(parseVectorFileName("vectors.bge-m3.1024.bin")).toEqual({ modelKey: "bge-m3", dims: 1024 });
    expect(parseVectorFileName("vectors.embeddinggemma.256.tr.bin")).toEqual({
      modelKey: "embeddinggemma",
      dims: 256,
      locale: "tr",
    });
    expect(parseVectorFileName("pack.es.json")).toBeUndefined();
    expect(parseVectorFileName("vectors.bge-m3.bin")).toBeUndefined();
  });
});
