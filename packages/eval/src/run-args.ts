import { parseArgs } from "node:util";

/** Command-line options of the benchmark runner (src/run.ts). */
export function parseRunArgs(argv: string[]) {
  return parseArgs({
    // pnpm forwards a literal "--"; drop it so flags after it still parse.
    args: argv.filter((a) => a !== "--"),
    // Every boolean also has a `--no-` form; `--no-heldout` is the one in use.
    allowNegative: true,
    options: {
      pack: { type: "string" },
      offline: { type: "boolean", default: false },
      ci: { type: "boolean", default: false },
      "write-baseline": { type: "boolean", default: false },
      /** false (`--no-heldout`): the in-house suite only; held-out reports and baseline stay as they are. */
      heldout: { type: "boolean", default: true },
      models: { type: "string" },
      "alias-caps": { type: "string", default: "8,16,24" },
      "min-coverage": { type: "string", default: "0.5,0.6" },
    },
  }).values;
}
