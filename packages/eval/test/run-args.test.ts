import { describe, expect, it } from "vitest";
import { parseRunArgs } from "../src/run-args.ts";

describe("parseRunArgs", () => {
  it("runs the held-out suite by default", () => {
    expect(parseRunArgs([])).toMatchObject({ heldout: true, offline: false, ci: false });
  });

  it("skips the held-out suite with --no-heldout", () => {
    expect(parseRunArgs(["--offline", "--ci", "--no-heldout"])).toMatchObject({
      heldout: false,
      offline: true,
      ci: true,
    });
  });

  it("reads flags after the literal -- that pnpm forwards", () => {
    expect(parseRunArgs(["--", "--no-heldout", "--models", "bge-m3"])).toMatchObject({
      heldout: false,
      models: "bge-m3",
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseRunArgs(["--no-held-out"])).toThrow();
  });
});
