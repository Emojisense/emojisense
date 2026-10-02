/**
 * Effective cost per 1M searches across all layers, with a per-layer breakdown and sensitivity.
 *
 *   pnpm --filter @emojisense/eval cost [-- --assumptions FILE] [--report FILE] [--json]
 *
 * Inputs: cost.assumptions.json (edit it). The L0 share comes from the last `pnpm eval`
 * (reports/latest.json) when the assumptions say useMeasuredDeviceShare.
 */
import { parseArgs } from "node:util";
import { computeLayeredCost, readMeasuredRate, sensitivity } from "./cost.ts";
import { ASSUMPTIONS_PATH, LATEST_REPORT_PATH, loadCostInputs } from "./cost-inputs.ts";
import { renderCostReport } from "./cost-report.ts";

const { values: args } = parseArgs({
  // pnpm forwards a literal "--"; drop it so flags after it still parse.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    assumptions: { type: "string", default: ASSUMPTIONS_PATH },
    report: { type: "string", default: LATEST_REPORT_PATH },
    json: { type: "boolean", default: false },
  },
});

const measured = readMeasuredRate(args.report as string);
const assumptions = loadCostInputs(args.assumptions as string, measured);
if (args.json) {
  const { sensitivity: _ranges, ...inputs } = assumptions;
  const output = {
    inputs,
    measured,
    cost: computeLayeredCost(assumptions),
    sensitivity: sensitivity(assumptions),
  };
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(renderCostReport(assumptions, { level: 1, measured }).join("\n"));
}
