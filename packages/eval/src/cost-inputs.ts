import { join } from "node:path";
import { readPackConfig } from "@emojisense/data/config";
import { getModel } from "@emojisense/data/models";
import { applyMeasuredRate, type CostAssumptions, loadAssumptions, type MeasuredRate } from "./cost.ts";

export const EVAL_ROOT = new URL("..", import.meta.url).pathname;
export const ASSUMPTIONS_PATH = join(EVAL_ROOT, "cost.assumptions.json");
export const LATEST_REPORT_PATH = join(EVAL_ROOT, "reports", "latest.json");

/** Assumptions with the production model filled in and the measured L0 share applied. */
export function loadCostInputs(path: string, measured: MeasuredRate | undefined): CostAssumptions {
  const a = loadAssumptions(path);
  if (a.model.id === null) a.model.id = getModel(readPackConfig().model.key).id;
  return applyMeasuredRate(a, measured);
}
